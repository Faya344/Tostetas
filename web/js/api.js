/** Client HTTP de l'API locale. Toutes les erreurs remontent en français. */

async function demande(url, options = {}) {
  const reponse = await fetch(url, options);
  const type = reponse.headers.get('content-type') ?? '';
  const corps = type.includes('json') ? await reponse.json() : await reponse.text();
  if (!reponse.ok) {
    const erreur = new Error(corps?.erreur || `Erreur ${reponse.status}`);
    erreur.statut = reponse.status;
    erreur.details = corps;
    throw erreur;
  }
  return corps;
}

const json = (methode, body) => ({
  method: methode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body ?? {})
});

export const api = {
  etat: () => demande('/api/state'),

  creerVisite: (meta) => demande('/api/visites', json('POST', meta)),
  lireVisite: (id) => demande(`/api/visites/${id}`),
  majVisite: (id, patch) => demande(`/api/visites/${id}`, json('PATCH', patch)),
  supprimerVisite: (id) => demande(`/api/visites/${id}`, { method: 'DELETE' }),

  envoyerAudio: (id, blob) =>
    demande(`/api/visites/${id}/audio`, { method: 'PUT', headers: { 'content-type': 'audio/webm' }, body: blob }),

  enregistrerTranscription: (id, payload) => demande(`/api/visites/${id}/transcript`, json('PUT', payload)),
  synthetiser: (id, options) => demande(`/api/visites/${id}/synthese`, json('POST', options)),

  rechercher: (question, options = {}) => demande('/api/recherche', json('POST', { question, ...options })),
  interroger: (question, options = {}) => demande('/api/ask', json('POST', { question, ...options })),
  reindexer: () => demande('/api/reindex', json('POST'))
};
