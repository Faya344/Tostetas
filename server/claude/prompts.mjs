/**
 * Prompts de synthèse. Le modèle ne dessine pas les graphiques : il produit des
 * données structurées, et le front les rend. Un LLM qui invente une mise en page
 * échoue de façon imprévisible ; un LLM qui remplit un schéma échoue de façon
 * visible et réparable.
 */

import { hms } from '../rag/chunk.mjs';

export const SYSTEM_SYNTHESE = `Tu es l'assistant de compte rendu d'un technicien en visite sur site.
Tu analyses la transcription brute d'une visite technique (chantier, maintenance, audit, relevé).
La transcription vient d'une reconnaissance vocale : elle contient des fautes, des hésitations et des
mots techniques mal orthographiés. Corrige-les silencieusement quand le contexte les rend évidents.

Règles absolues :
- N'invente jamais une cote, une référence, un nom, une date ou un montant. Si une information manque,
  place-la dans "questions_ouvertes" au lieu de la deviner.
- Chaque élément structuré porte "t", l'horodatage en secondes du moment où il est évoqué.
- Les points clés marqués par le technicien pendant l'enregistrement sont prioritaires : ils signalent
  ce qu'il a jugé important sur le moment.
- Réponds en français.
- Ta réponse est un unique objet JSON valide, sans texte autour, sans bloc de code.`;

/** Schéma attendu, décrit au modèle en même temps qu'il sert de contrat au front. */
export const SCHEMA_SYNTHESE = `{
  "titre": "titre court et factuel de la visite",
  "resume": "3 à 6 paragraphes en markdown : contexte, constats, décisions, suite",
  "points_saillants": ["3 à 6 phrases, une idée par phrase"],
  "intervenants": [{ "nom": "", "role": "", "temps_parole_s": 0 }],
  "phases": [{ "nom": "", "t0": 0, "t1": 0, "etat": "fait|en_cours|a_faire|bloque", "commentaire": "" }],
  "decisions": [{
    "intitule": "", "justification": "", "statut": "actee|a_valider|rejetee",
    "alternatives": [{ "option": "", "retenue": true, "motif": "" }],
    "responsable": "", "t": 0
  }],
  "actions": [{ "intitule": "", "responsable": "", "echeance": "", "priorite": "haute|moyenne|basse", "t": 0 }],
  "risques": [{ "intitule": "", "gravite": 1, "probabilite": 1, "mitigation": "", "t": 0 }],
  "mesures": [{ "libelle": "", "valeur": 0, "unite": "", "t": 0 }],
  "questions_ouvertes": ["ce qui reste à confirmer"]
}

"gravite" et "probabilite" vont de 1 (faible) à 4 (critique).
Les "phases" couvrent la durée de la visite sans se chevaucher.
Une "decision" sans alternative discutée a un tableau "alternatives" vide.`;

function renderTranscript(segments) {
  return segments
    .map((s) => `[${hms(s.t0)}]${s.speaker ? ` ${s.speaker} :` : ''} ${s.text.trim()}`)
    .join('\n');
}

function renderMarkers(markers) {
  if (!markers?.length) return 'Aucun point clé marqué.';
  return markers.map((m) => `- [${hms(m.t)}] ${m.label || 'Point clé'}${m.note ? ` — ${m.note}` : ''}`).join('\n');
}

export function buildSynthesePrompt(visite) {
  const segments = visite.transcript?.segments ?? [];
  return `# Visite à synthétiser

- Titre saisi : ${visite.titre || '(non renseigné)'}
- Site : ${visite.site || '(non renseigné)'}
- Date : ${visite.date || '(non renseignée)'}
- Durée : ${hms(visite.duree || 0)}

## Points clés marqués par le technicien
${renderMarkers(visite.markers)}

## Transcription
${renderTranscript(segments)}

## Sortie attendue
Renvoie exactement cet objet JSON, rempli :

${SCHEMA_SYNTHESE}`;
}

export const SYSTEM_QA = `Tu réponds à des questions sur un historique de visites techniques.
Tu ne disposes que des extraits fournis. Règles :
- Appuie chaque affirmation sur un extrait, cité sous la forme [S1], [S2]…
- Si les extraits ne permettent pas de répondre, dis-le franchement et indique ce qu'il faudrait chercher.
- Ne déduis jamais une valeur chiffrée qui n'est pas écrite.
- Réponds en français, en markdown, de façon dense et directe.`;

export function buildQaPrompt(question, context) {
  return `# Extraits disponibles

${context || '(aucun extrait — la base est vide ou la recherche n\'a rien remonté)'}

# Question

${question}`;
}
