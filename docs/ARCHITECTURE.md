# Architecture

## Le trajet complet

```
   micro
     │  MediaRecorder, tranches de 5 s
     ▼
  IndexedDB ────────────► le coffre : survit à un plantage d'onglet
     │
     │  à l'arrêt
     ▼
  PUT /api/visites/:id/audio ──► data/visites/<id>/audio.webm
     │
     ▼
  Whisper (navigateur, WebGPU ou WASM)
     │  segments horodatés
     ▼
  PUT …/transcript ──► transcript.json  ──►  reconstruction de l'index RAG
     │
     ▼
  POST …/synthese
     │  prompt + schéma
     ▼
  claude -p --restricted   (abonnement, pas de clé API)
     │  JSON strict
     ▼
  normalisation ──► synthese.json ──► graphiques SVG
```

## Pourquoi cette répartition

**Le navigateur fait le travail lourd.** Capture, transcription, décodage : tout
ce qui se mesure en minutes de calcul tourne sur la machine de l'utilisateur.
C'est ce qui rend la gratuité tenable, et c'est aussi ce qui garantit que
l'audio ne sort jamais.

**Le serveur ne fait que ranger.** Pas de base de données, pas de framework,
zéro dépendance npm. Il écrit des fichiers, sert des fichiers, et lance un
sous-processus. Un serveur qu'on peut lire en entier en vingt minutes est un
serveur qu'on peut réparer.

**Claude ne dessine pas.** Le modèle remplit un schéma JSON ; le front dessine.
Un LLM qui invente une mise en page échoue de façon imprévisible ; un LLM qui
remplit un schéma échoue de façon visible — un champ manque, on le voit, on
relance.

## Le pont Claude

`server/claude/bridge.mjs` lance :

```
claude --print --output-format json --model sonnet
       --restricted --strict-mcp-config --permission-mode manual
       --system-prompt "…"
```

- `--restricted` retire Bash et les outils d'exécution : on demande une
  rédaction, pas une action sur la machine.
- `--strict-mcp-config` coupe les serveurs MCP hérités de la configuration
  globale : le contexte est exactement celui qu'on fournit, rien de plus.
- Le prompt passe par l'entrée standard : pas de limite de longueur d'argument.

Si le binaire est absent, `dropToOutbox` écrit la demande dans `data/outbox/`
et l'API répond `503` avec le chemin. L'interface le dit, et rien n'est perdu.

## Normalisation

`server/synthese.mjs` ne fait pas confiance à la sortie du modèle. Il borne les
échelles (gravité et probabilité de 1 à 4), ramène les horodatages dans la durée
réelle, trie les phases et tronque celles qui se chevauchent, remplit les champs
manquants.

Conséquence : `web/js/viz.js` dessine sans jamais vérifier. Aucun graphique ne
peut casser parce qu'un champ manque — la garantie est posée une fois, en amont,
au lieu d'être répétée dans chaque figure.

## Les graphiques

Quatre figures, aucune bibliothèque, du SVG écrit à la main
(`web/js/viz.js`) :

| Figure | Forme | Encodage |
|---|---|---|
| Déroulé de la visite | bande de temps | position = moment, teinte = état de la phase |
| Choix et alternatives | arbre | trait plein = retenu, pointillé = écarté |
| Matrice des risques | grille 4 × 4 | position = gravité × probabilité, fond = criticité |
| Temps de parole | barres | longueur = durée |

Les couleurs de série viennent d'une palette validée pour le daltonisme et le
contraste sur fond `#0a0a12`. Elles sont **séparées** des couleurs de marque :
le violet quartz habille l'interface et ne signifie jamais une valeur. Chaque
figure expose sa table de données — la couleur n'est jamais le seul canal.

## Le fichier de jetons

`web/styles/tokens.css` porte toutes les couleurs, l'espacement et le rythme.
Changer de thème, c'est changer ce fichier. La séparation parure / série y est
écrite noir sur blanc pour qu'on ne la perde pas de vue.
