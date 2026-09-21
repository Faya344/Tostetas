/**
 * Production de la synthèse d'une visite.
 *
 * La sortie du modèle est normalisée avant d'être écrite : bornage des échelles,
 * horodatages ramenés dans la durée réelle, phases triées et non chevauchantes.
 * Le front peut alors dessiner sans jamais vérifier — les graphiques ne cassent
 * pas parce qu'un champ manque.
 */

import path from 'node:path';
import { loadVisite, saveVisite, visiteDir, writeJson } from './store.mjs';
import { buildSynthesePrompt, SYSTEM_SYNTHESE } from './claude/prompts.mjs';
import { runClaude, extractJson, dropToOutbox, ClaudeUnavailable } from './claude/bridge.mjs';
import { buildIndex } from './rag/index.mjs';

const ETATS = new Set(['fait', 'en_cours', 'a_faire', 'bloque']);
const STATUTS = new Set(['actee', 'a_valider', 'rejetee']);
const PRIORITES = new Set(['haute', 'moyenne', 'basse']);

const str = (v, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const arr = (v) => (Array.isArray(v) ? v : []);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : lo));

export function normaliserSynthese(raw, visite) {
  const duree = Math.max(1, Number(visite.duree) || 1);
  const t = (v) => clamp(v, 0, duree);

  const phases = arr(raw.phases)
    .map((p) => ({
      nom: str(p.nom, 'Phase'),
      t0: t(p.t0),
      t1: t(p.t1),
      etat: ETATS.has(p.etat) ? p.etat : 'fait',
      commentaire: str(p.commentaire)
    }))
    .filter((p) => p.t1 > p.t0)
    .sort((a, b) => a.t0 - b.t0);

  // Un chevauchement rend la chronologie illisible : on tronque la phase qui déborde.
  for (let i = 1; i < phases.length; i++) {
    if (phases[i].t0 < phases[i - 1].t1) phases[i - 1].t1 = phases[i].t0;
  }

  return {
    titre: str(raw.titre, visite.titre || 'Visite technique'),
    resume: str(raw.resume, 'Synthèse indisponible.'),
    points_saillants: arr(raw.points_saillants).map((s) => str(s)).filter(Boolean),
    intervenants: arr(raw.intervenants)
      .map((i) => ({
        nom: str(i.nom, 'Intervenant'),
        role: str(i.role),
        temps_parole_s: clamp(i.temps_parole_s, 0, duree)
      }))
      .filter((i) => i.nom),
    phases: phases.filter((p) => p.t1 > p.t0),
    decisions: arr(raw.decisions).map((d) => ({
      intitule: str(d.intitule, 'Décision'),
      justification: str(d.justification),
      statut: STATUTS.has(d.statut) ? d.statut : 'a_valider',
      responsable: str(d.responsable),
      t: t(d.t),
      alternatives: arr(d.alternatives).map((a) => ({
        option: str(a.option, 'Option'),
        retenue: Boolean(a.retenue),
        motif: str(a.motif)
      }))
    })),
    actions: arr(raw.actions).map((a) => ({
      intitule: str(a.intitule, 'Action'),
      responsable: str(a.responsable),
      echeance: str(a.echeance),
      priorite: PRIORITES.has(a.priorite) ? a.priorite : 'moyenne',
      t: t(a.t),
      fait: false
    })),
    risques: arr(raw.risques).map((r) => ({
      intitule: str(r.intitule, 'Risque'),
      gravite: clamp(r.gravite, 1, 4),
      probabilite: clamp(r.probabilite, 1, 4),
      mitigation: str(r.mitigation),
      t: t(r.t)
    })),
    mesures: arr(raw.mesures)
      .map((m) => ({
        libelle: str(m.libelle),
        valeur: Number.isFinite(+m.valeur) ? +m.valeur : null,
        unite: str(m.unite),
        t: t(m.t)
      }))
      .filter((m) => m.libelle && m.valeur !== null),
    questions_ouvertes: arr(raw.questions_ouvertes).map((s) => str(s)).filter(Boolean),
    genereLe: new Date().toISOString()
  };
}

/**
 * @param {string} id
 * @returns {Promise<{synthese:object, usage:object|null}>}
 * @throws {ClaudeUnavailable} avec le chemin du repli si le CLI est absent.
 */
export async function genererSynthese(id, { model } = {}) {
  const visite = await loadVisite(id);
  if (!visite) throw new Error(`Visite inconnue : ${id}`);
  if (!visite.transcript?.segments?.length) throw new Error('Aucune transcription à synthétiser.');

  const prompt = buildSynthesePrompt(visite);

  let result;
  try {
    result = await runClaude({ system: SYSTEM_SYNTHESE, prompt, model });
  } catch (err) {
    if (err instanceof ClaudeUnavailable) {
      const file = await dropToOutbox(`synthese-${id}`, { system: SYSTEM_SYNTHESE, prompt });
      throw new ClaudeUnavailable(
        `Claude Code n'est pas joignable. La demande a été déposée dans ${path.basename(file)}.`,
        { outbox: file }
      );
    }
    throw err;
  }

  const synthese = normaliserSynthese(extractJson(result.text), visite);
  await writeJson(path.join(visiteDir(id), 'synthese.json'), synthese);
  await saveVisite({ ...visite, transcript: undefined, synthese: undefined, audio: undefined, statut: 'synthetisee' });
  await buildIndex();

  return { synthese, usage: result.usage };
}
