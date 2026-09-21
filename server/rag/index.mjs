/**
 * Le RAG : construction de l'index et récupération hybride.
 *
 * Trois bras, fusionnés par Reciprocal Rank Fusion :
 *   1. BM25 exact    — précision sur le vocabulaire technique et les références ;
 *   2. BM25 tronqué  — rappel sur les variantes du français (« retenue » /
 *                      « retient »), là où la désuffixation simple abandonne ;
 *   3. vectoriel     — optionnel, seulement si les embeddings locaux sont là.
 *
 * RRF combine des rangs, pas des scores : aucune calibration entre trois
 * moteurs qui ne mesurent pas la même chose, et la fusion dégénère proprement
 * quand un bras manque.
 */

import path from 'node:path';
import { Bm25Index } from './bm25.mjs';
import { chunkTranscript, hms } from './chunk.mjs';
import { embedAll, embedQuery, cosine } from './embed.mjs';
import { INDEX_DIR, loadAll, readJson, writeJson } from '../store.mjs';

const INDEX_FILE = path.join(INDEX_DIR, 'rag.json');
const RRF_K = 60; // constante usuelle : amortit la queue du classement

let cache = null;

/** Reconstruit l'index complet depuis les visites sur disque. */
export async function buildIndex({ verbose = false } = {}) {
  const visites = await loadAll();
  const chunks = [];

  for (const visite of visites) {
    const segments = visite.transcript?.segments ?? [];
    if (segments.length) {
      chunks.push(...chunkTranscript(visite, segments, visite.markers ?? []));
    }
    // La synthèse est elle-même indexée : une question peut trouver sa réponse
    // dans une décision déjà formulée plutôt que dans le brut du verbatim.
    const synthese = visite.synthese;
    if (synthese?.resume) {
      chunks.push({
        id: `${visite.id}#synthese`,
        visiteId: visite.id,
        visiteTitre: visite.titre ?? visite.id,
        visiteDate: visite.date ?? null,
        site: visite.site ?? null,
        t0: 0, t1: 0, speakers: [], speaker: null, markers: [],
        kind: 'synthese',
        text: [
          synthese.resume,
          ...(synthese.decisions ?? []).map((d) => `Décision : ${d.intitule}. ${d.justification ?? ''}`),
          ...(synthese.actions ?? []).map((a) => `Action : ${a.intitule} (${a.responsable ?? 'non assigné'})`),
          ...(synthese.risques ?? []).map((r) => `Risque : ${r.intitule}. ${r.mitigation ?? ''}`)
        ].join('\n')
      });
    }
  }

  const bm25 = new Bm25Index('exact');
  const prefixe = new Bm25Index('prefixe');
  for (const chunk of chunks) {
    bm25.add(chunk);
    prefixe.add(chunk);
  }
  bm25.finalize();
  prefixe.finalize();

  const vectors = await embedAll(chunks.map((c) => c.text));
  const payload = {
    version: 3,
    builtAt: new Date().toISOString(),
    visites: visites.length,
    chunks: chunks.length,
    dense: Boolean(vectors),
    bm25: bm25.toJSON(),
    prefixe: prefixe.toJSON(),
    vectors: vectors ? vectors.map((v) => Array.from(v)) : null
  };

  await writeJson(INDEX_FILE, payload);
  cache = hydrate(payload);
  if (verbose) {
    console.log(`Index : ${payload.chunks} passages / ${payload.visites} visites` +
      (payload.dense ? ' · couche dense active' : ' · lexical seul'));
  }
  return cache;
}

function hydrate(payload) {
  return {
    meta: { builtAt: payload.builtAt, chunks: payload.chunks, visites: payload.visites, dense: payload.dense },
    bm25: Bm25Index.fromJSON(payload.bm25),
    prefixe: payload.prefixe ? Bm25Index.fromJSON(payload.prefixe) : null,
    vectors: payload.vectors ? payload.vectors.map((v) => Float32Array.from(v)) : null
  };
}

export async function getIndex({ rebuildIfMissing = true } = {}) {
  if (cache) return cache;
  const payload = await readJson(INDEX_FILE, null);
  if (payload?.version === 3) return (cache = hydrate(payload));
  return rebuildIfMissing ? buildIndex() : null;
}

export function invalidate() {
  cache = null;
}

/**
 * Récupération hybride.
 * @param {string} question
 * @param {{limit?:number, visiteId?:string}} options
 */
export async function retrieve(question, { limit = 8, visiteId = null } = {}) {
  const index = await getIndex();
  if (!index || !index.bm25.docs.length) return { passages: [], meta: index?.meta ?? null };

  const filter = visiteId ? (doc) => doc.visiteId === visiteId : null;
  const lexical = index.bm25.search(question, limit * 3, filter);

  const ranks = new Map();
  const byId = new Map();
  const bump = (doc, rank, source) => {
    byId.set(doc.id, doc);
    const entry = ranks.get(doc.id) ?? { score: 0, sources: [] };
    entry.score += 1 / (RRF_K + rank);
    entry.sources.push(source);
    ranks.set(doc.id, entry);
  };

  lexical.forEach((hit, i) => bump(hit.doc, i + 1, 'lexical'));

  if (index.prefixe) {
    index.prefixe.search(question, limit * 3, filter)
      .forEach((hit, i) => bump(hit.doc, i + 1, 'morpho'));
  }

  if (index.vectors) {
    const queryVector = await embedQuery(question);
    if (queryVector) {
      const scored = [];
      index.bm25.docs.forEach((doc, i) => {
        if (filter && !filter(doc)) return;
        scored.push({ doc, score: cosine(queryVector, index.vectors[i]) });
      });
      scored.sort((a, b) => b.score - a.score);
      scored.slice(0, limit * 3).forEach((hit, i) => bump(hit.doc, i + 1, 'dense'));
    }
  }

  const passages = [...ranks.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([id, entry]) => {
      const doc = byId.get(id);
      return {
        ...doc,
        score: entry.score,
        sources: [...new Set(entry.sources)],
        citation: `${doc.visiteTitre} · ${hms(doc.t0)}${doc.speaker ? ` · ${doc.speaker}` : ''}`
      };
    });

  return { passages, meta: index.meta };
}

/** Met en forme les passages pour un prompt : citables, horodatés, bornés. */
export function formatContext(passages, { maxChars = 12000 } = {}) {
  const parts = [];
  let total = 0;
  for (const [i, p] of passages.entries()) {
    const block = `[S${i + 1}] ${p.citation}\n${p.text}`;
    if (total + block.length > maxChars) break;
    parts.push(block);
    total += block.length;
  }
  return parts.join('\n\n---\n\n');
}
