# Le RAG

Retrouver une phrase dite il y a huit mois sur un chantier dont on a oublié le
nom. C'est le problème à résoudre, et il a trois particularités qui écartent les
solutions toutes faites.

1. **Le vocabulaire est très spécifique** : références, cotes, noms de lots,
   marques. Un embedding générique les écrase ; BM25 les adore.
2. **Le corpus est petit** — quelques centaines de visites, pas des millions de
   documents. Une base vectorielle serait un marteau-pilon.
3. **La réponse doit être citable** : « le 14 mars, à 2 min 22, le chef de
   chantier a dit… ». Un passage sans ancrage ne sert à rien.

## Le découpage

`server/rag/chunk.mjs` — environ 620 caractères par passage, 150 de
recouvrement, coupure préférentielle sur une frontière de locuteur ou un point
clé.

Un passage n'est pas un bloc de texte anonyme. Il garde :

- son ancrage temporel `t0`/`t1` — pour citer et pour rejouer l'audio au bon endroit ;
- son locuteur dominant ;
- les points clés qu'il recouvre.

Les **synthèses sont indexées au même titre que les verbatims**. Une question
trouve souvent sa réponse dans une décision déjà formulée plutôt que dans le
brut de la transcription.

## L'index à trois bras

```
question
   ├─► BM25 exact      précision — références, chiffres, jargon
   ├─► BM25 tronqué    rappel — variantes morphologiques du français
   └─► vectoriel       sémantique — si les embeddings locaux sont installés
            │
            ▼
    Reciprocal Rank Fusion  →  passages classés
```

**Pourquoi un second bras lexical.** La désuffixation simple rate les
alternances de radical du français : « retenue » et « retient » ne se
rejoignent pas. Tronquer chaque terme à cinq caractères les rapproche
brutalement — trop brutalement pour servir seul, très bien comme second bras,
où il apporte du rappel pendant que l'index exact garde la précision.

**Pourquoi RRF.** La fusion combine des *rangs*, pas des scores. Aucune
calibration n'est nécessaire entre trois moteurs qui ne mesurent pas la même
chose, et la fusion dégénère proprement quand un bras manque — ce qui est le
cas par défaut pour le bras vectoriel.

## La couche dense, en option

`server/rag/embed.mjs` n'est actif que si `@huggingface/transformers` est
installé :

```bash
npm install @huggingface/transformers
npm run reindex
```

Le modèle `Xenova/multilingual-e5-small` (~120 Mo) tourne alors en local,
gratuitement et hors ligne. L'application doit fonctionner à l'identique dans
les deux cas — c'est la règle, et c'est pour ça que la couche est optionnelle
plutôt que centrale.

Elle apporte surtout sur les questions posées avec d'autres mots que ceux
prononcés. Sur un corpus de visites techniques, où l'on cherche généralement un
terme qui a réellement été dit, BM25 fait déjà l'essentiel.

## La génération

`retrieve()` remonte 10 passages, `formatContext()` les met en forme pour le
prompt avec un plafond de caractères, chacun préfixé `[S1]`, `[S2]`…

La consigne système impose de citer et d'admettre l'ignorance. Ce n'est pas
décoratif : sur un compte rendu de visite, une valeur inventée coûte un
déplacement, parfois davantage.

## Reconstruction

L'index se reconstruit à chaque transcription enregistrée et à chaque synthèse
produite. À la main : `npm run reindex`, ou le bouton dans Réglages.

Le coût est linéaire et le corpus est petit — une reconstruction complète est
plus sûre qu'une mise à jour incrémentale, et assez rapide pour qu'on ne la
remarque pas.

## Depuis le terminal

```bash
npm run ask -- --extraits "vase d'expansion"   # ce que le RAG remonte
npm run ask -- "qu'a-t-on décidé pour la toiture ?"
```

Quand une réponse est à côté, le problème est presque toujours dans les
extraits, pas dans le modèle. `--extraits` permet de le voir sans attendre la
génération.
