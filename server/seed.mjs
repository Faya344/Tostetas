#!/usr/bin/env node
/**
 * Jeu de démonstration : une visite de chaufferie, avec ses points clés.
 * Sert à voir l'interface remplie sans avoir à enregistrer quoi que ce soit.
 *   node server/seed.mjs
 */

import path from 'node:path';
import { ensureDirs, saveVisite, visiteDir, writeJson } from './store.mjs';
import { buildIndex } from './rag/index.mjs';

const ID = 'demo-chaufferie';

const REPLIQUES = [
  [0, 'Technicien', "Visite du 14 mars, chaufferie du bâtiment C, niveau moins un. Je suis avec Marc Vidal, responsable maintenance, et Sophie Renard du bureau d'études."],
  [12, 'Marc Vidal', "On est sur les deux chaudières gaz de 2009. La numéro un tient encore, la deux a claqué son échangeur en janvier."],
  [26, 'Technicien', "Je relève la pression au primaire : un virgule huit bar. C'est bas pour un réseau de cette hauteur."],
  [38, 'Sophie Renard', "Le vase d'expansion est sous-dimensionné, on l'avait signalé dans l'audit de 2023. Quatre-vingts litres pour un volume d'eau estimé à mille deux cents litres."],
  [55, 'Technicien', "Point important : le vase est à remplacer avant tout le reste, sinon on reprend le problème sur du neuf."],
  [68, 'Marc Vidal', "Sur le remplacement, on a trois pistes. Soit deux chaudières gaz condensation en cascade, soit une pompe à chaleur air-eau haute température, soit une solution hybride PAC plus appoint gaz."],
  [88, 'Sophie Renard', "La PAC seule ne passe pas : le régime de départ est à soixante-dix degrés sur les radiateurs fonte, et on n'a pas le budget pour reprendre les émetteurs."],
  [104, 'Technicien', "Et l'alimentation électrique ? On a quoi au tableau ?"],
  [110, 'Marc Vidal', "Trois cent cinquante ampères disponibles sur le TGBT, mais le transformateur est déjà chargé à quatre-vingt-cinq pour cent en hiver."],
  [124, 'Sophie Renard', "Donc hybride. PAC de quarante kilowatts pour la base, chaudière gaz condensation en appoint sur les pointes. On couvre environ soixante-dix pour cent des besoins en renouvelable."],
  [142, 'Technicien', "Point clé : on retient l'hybride. Marc valide auprès de la direction avant fin mars."],
  [156, 'Marc Vidal', "Il faudra aussi traiter le désenfumage. La grille d'amenée d'air est obstruée depuis les travaux de façade."],
  [170, 'Technicien', "Ça c'est un point de sécurité, c'est bloquant pour la réception. Je note en risque élevé."],
  [182, 'Sophie Renard', "Dernier sujet, le comptage. Il n'y a aucun sous-comptage par bâtiment, on ne peut pas répartir les charges."],
  [196, 'Technicien', "On pose trois compteurs d'énergie thermique sur les départs. C'est deux mille euros environ, ça se finance sur les CEE."],
  [212, 'Marc Vidal', "Je récupère les plans du réseau et je te les envoie cette semaine. Il me manque le schéma du secondaire."],
  [226, 'Technicien', "Parfait. Sophie, tu fais le dimensionnement de la PAC pour le quinze avril ?"],
  [234, 'Sophie Renard', "Oui, avec la note de calcul et le bilan carbone comparatif."],
  [244, 'Technicien', "Fin de visite. Température extérieure relevée : six degrés, départ chaudière à soixante-huit degrés."]
];

await ensureDirs();

const visite = {
  id: ID,
  titre: 'Chaufferie bâtiment C — diagnostic et arbitrage',
  site: 'Bâtiment C, niveau -1',
  date: '2026-03-14',
  creeLe: new Date().toISOString(),
  duree: 258,
  statut: 'transcrite',
  markers: [
    { t: 55, label: 'Vase d\'expansion sous-dimensionné', note: 'Préalable à tout remplacement' },
    { t: 142, label: 'Choix de la solution hybride' },
    { t: 170, label: 'Désenfumage obstrué — bloquant' },
    { t: 196, label: 'Sous-comptage à poser' }
  ]
};

await saveVisite(visite);
await writeJson(path.join(visiteDir(ID), 'transcript.json'), {
  moteur: 'démonstration',
  langue: 'fr',
  majLe: new Date().toISOString(),
  segments: REPLIQUES.map(([t0, speaker, text], i) => ({
    t0,
    t1: REPLIQUES[i + 1]?.[0] ?? visite.duree,
    speaker,
    text
  }))
});

const index = await buildIndex();
console.log(`Visite de démonstration « ${visite.titre} » créée.`);
console.log(`Index : ${index.meta.chunks} passages.`);
console.log('Lancez `npm start`, puis ouvrez la visite et cliquez sur « Synthétiser ».');
