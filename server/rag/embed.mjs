/**
 * Couche dense facultative.
 *
 * Si `@huggingface/transformers` est installé localement, on l'utilise pour
 * calculer des embeddings multilingues sur la machine — gratuit, hors ligne,
 * aucun token consommé. Sinon on ne fait rien et le retrieval reste lexical.
 * L'app doit marcher à l'identique dans les deux cas : c'est la règle.
 */

let pipelinePromise = null;
let unavailable = false;

const MODEL = 'Xenova/multilingual-e5-small'; // ~120 Mo, FR/EN, correct sur du jargon métier

export async function getEmbedder() {
  if (unavailable) return null;
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      try {
        const { pipeline } = await import('@huggingface/transformers');
        return await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
      } catch {
        unavailable = true;
        return null;
      }
    })();
  }
  return pipelinePromise;
}

export function embeddingsAvailable() {
  return !unavailable;
}

/** @returns {Promise<Float32Array[]|null>} null si la couche dense n'est pas dispo. */
export async function embedAll(texts, { prefix = 'passage: ' } = {}) {
  const embed = await getEmbedder();
  if (!embed) return null;
  const vectors = [];
  for (const text of texts) {
    const out = await embed(prefix + text, { pooling: 'mean', normalize: true });
    vectors.push(Float32Array.from(out.data));
  }
  return vectors;
}

export async function embedQuery(text) {
  const embed = await getEmbedder();
  if (!embed) return null;
  const out = await embed('query: ' + text, { pooling: 'mean', normalize: true });
  return Float32Array.from(out.data);
}

/** Vecteurs normalisés : le produit scalaire suffit. */
export function cosine(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
