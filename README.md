# NOIRA

**Carnet de visites techniques piloté par la voix.** Vous enregistrez, vous
marquez ce qui compte, et le compte rendu s'écrit : transcription horodatée,
synthèse structurée, graphiques des phases, des choix et des risques, et une
mémoire interrogeable de toutes vos visites passées.

Thème **quartz galaxie noir** : fond d'encre, panneaux taillés, une seule
couleur d'accent.

---

## Ce que ça coûte

Rien de plus que votre abonnement Claude.

| Étage | Où ça tourne | Coût |
|---|---|---|
| Enregistrement, points clés | Votre navigateur | 0 |
| Transcription (Whisper) | Votre machine, en local | 0 |
| Index et recherche (RAG) | Votre machine, sans dépendance | 0 |
| Synthèse et questions | Claude Code, avec **votre abonnement** | 0 en plus |

Aucune clé API n'est lue ni nécessaire. NOIRA appelle le binaire `claude` déjà
authentifié sur votre poste (`claude -p`), exactement comme si vous tapiez la
demande vous-même. Pas de jeton facturé à l'usage, pas de service tiers, pas de
compte à créer.

L'audio ne quitte jamais la machine : le serveur écoute sur `127.0.0.1` et écrit
tout dans `data/`.

---

## Démarrer

```bash
node server/seed.mjs     # crée une visite de démonstration (facultatif)
npm start                # http://127.0.0.1:7331
```

Aucune installation : Node 20+ suffit, le projet n'a aucune dépendance.

Ouvrez la page, cliquez sur le gros bouton, parlez. À l'arrêt, tout s'enchaîne
tout seul : sauvegarde de l'audio, transcription, indexation, synthèse.

---

## Le geste central : le point clé

Pendant l'enregistrement, un appui pose un repère horodaté. Ces repères sont
transmis au modèle comme signal prioritaire — ce que vous avez jugé important
sur le moment pèse dans la synthèse — et servent de chapitres dans le lecteur
audio.

Quatre façons d'appuyer, sans rien acheter :

| Moyen | Geste |
|---|---|
| Clavier | `K`, `Entrée`, `→`, `↓` |
| Bouton du casque | « piste suivante » — marche écran éteint |
| Télécommande Bluetooth | un « page turner » à 15 € se présente comme un clavier |
| Manette, pédale, boîtier HID | n'importe quel bouton |

`Espace`, `←` ou « lecture/pause » démarrent et arrêtent l'enregistrement.
Détails et modèles conseillés : [docs/MATERIEL.md](docs/MATERIEL.md).

---

## Ce que vous récupérez

- **La copie du vocal**, telle qu'enregistrée, avec saut direct sur chaque point clé.
- **Le verbatim horodaté**, cliquable — chaque ligne rejoue l'audio à sa seconde.
- **Le compte rendu écrit** : contexte, constats, décisions, suites.
- **Quatre graphiques** : déroulé des phases, arbre des choix (retenu / écarté
  et pourquoi), matrice des risques, temps de parole.
- **Les listes exploitables** : décisions, actions avec responsable et échéance,
  risques, mesures relevées, et ce qui reste à confirmer.
- **Un export `.md`** prêt à envoyer.
- **La mémoire** : posez une question, obtenez une réponse sourcée sur
  l'ensemble de vos visites, chaque affirmation citée avec son horodatage.

---

## Sécurités

- Les morceaux d'audio tombent dans IndexedDB toutes les 5 secondes : un onglet
  qui plante ne fait pas perdre la visite, elle est récupérée au démarrage suivant.
- Écriture atomique des fichiers : jamais de visite à moitié écrite.
- Si `claude` n'est pas joignable, la demande est déposée dans `data/outbox/`.
  Ouvrez une session Claude Code dans le dossier et traitez-la à la main — rien
  n'est perdu.

---

## Organisation du disque

```
data/visites/<id>/
  visite.json      métadonnées et points clés
  audio.webm       l'enregistrement brut
  transcript.json  segments horodatés
  synthese.json    sortie structurée
data/index/rag.json
data/outbox/       demandes en attente si Claude n'est pas joignable
```

Une visite est un dossier autonome : copiable sur une clé, lisible à la main
dans dix ans. C'est voulu — l'outil doit survivre à l'outil.

---

## Documentation

| Document | Contenu |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Le trajet complet, du micro au graphique |
| [docs/RAG.md](docs/RAG.md) | Découpage, index à trois bras, fusion RRF |
| [docs/MATERIEL.md](docs/MATERIEL.md) | Boutons physiques, micros, autonomie |
| [docs/FEUILLE-DE-ROUTE.md](docs/FEUILLE-DE-ROUTE.md) | Ce qui manque encore, par ordre de valeur |

---

## Commandes

```bash
npm start                # serveur
npm run dev              # serveur avec rechargement
npm run reindex          # reconstruire l'index de recherche
npm run ask -- "…"       # interroger ses visites depuis le terminal
node server/seed.mjs     # jeu de démonstration
```

Variables d'environnement : `NOIRA_PORT` (7331), `NOIRA_HOST` (127.0.0.1),
`NOIRA_CLAUDE_MODEL` (sonnet), `NOIRA_CLAUDE_BIN` (claude).
