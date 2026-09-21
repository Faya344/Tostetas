/**
 * Index lexical BM25 en mémoire, sérialisable en JSON.
 *
 * Choix assumé : pas de base vectorielle, pas de service externe. BM25 sur du
 * vocabulaire technique très spécifique (références, cotes, noms de lots) bat
 * régulièrement un embedding générique, et il coûte zéro téléchargement.
 * La couche dense vient s'ajouter par-dessus via embed.mjs quand elle est là.
 */

import { tokenize, queryTerms, tokenizePrefixe, queryTermsPrefixe } from './tokenize.mjs';

const K1 = 1.5;
const B = 0.75;

export class Bm25Index {
  /** @param {'exact'|'prefixe'} mode — voir tokenize.mjs pour ce que chaque mode attrape. */
  constructor(mode = 'exact') {
    this.mode = mode;
    this.docs = [];                  // métadonnées des chunks
    this.postings = new Map();       // terme -> [{ doc, tf }]
    this.lengths = [];
    this.avgLength = 0;
  }

  add(doc) {
    const terms = this.mode === 'prefixe' ? tokenizePrefixe(doc.text) : tokenize(doc.text);
    const index = this.docs.length;
    this.docs.push(doc);
    this.lengths.push(terms.length);

    const counts = new Map();
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    for (const [term, tf] of counts) {
      let list = this.postings.get(term);
      if (!list) this.postings.set(term, (list = []));
      list.push({ doc: index, tf });
    }
  }

  finalize() {
    const total = this.lengths.reduce((a, b) => a + b, 0);
    this.avgLength = this.lengths.length ? total / this.lengths.length : 0;
    return this;
  }

  /** @returns {{doc:object, score:number, matched:string[]}[]} */
  search(query, limit = 12, filter = null) {
    const terms = this.mode === 'prefixe' ? queryTermsPrefixe(query) : queryTerms(query);
    if (!terms.length) return [];
    const N = this.docs.length;
    const scores = new Map();
    const matched = new Map();

    for (const term of terms) {
      const list = this.postings.get(term);
      if (!list) continue;
      const idf = Math.log(1 + (N - list.length + 0.5) / (list.length + 0.5));
      for (const { doc, tf } of list) {
        if (filter && !filter(this.docs[doc])) continue;
        const norm = tf * (K1 + 1) /
          (tf + K1 * (1 - B + B * (this.lengths[doc] / (this.avgLength || 1))));
        scores.set(doc, (scores.get(doc) ?? 0) + idf * norm);
        if (!matched.has(doc)) matched.set(doc, new Set());
        matched.get(doc).add(term);
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([doc, score]) => ({
        doc: this.docs[doc],
        score,
        matched: [...(matched.get(doc) ?? [])]
      }));
  }

  toJSON() {
    return {
      mode: this.mode,
      docs: this.docs,
      lengths: this.lengths,
      postings: [...this.postings.entries()]
    };
  }

  static fromJSON(data) {
    const index = new Bm25Index(data.mode ?? 'exact');
    index.docs = data.docs ?? [];
    index.lengths = data.lengths ?? [];
    index.postings = new Map(data.postings ?? []);
    return index.finalize();
  }
}
