# ai_aggregator

Pipeline audio → résumé, pour Plodo, qui ne s'appuie que sur des paliers
gratuits — pas de clé « payante » à prévoir dans le budget.

Deux échecs de lecture sur le lien Gemini partagé au départ de ce travail
(page qui se rend côté client, non accessible à un récupérateur) : les
chiffres ci-dessous viennent d'une vérification indépendante, au
21 septembre 2026, pas de ce lien.

## Ce qui a changé depuis le premier brouillon

| Prévu initialement | Réalité vérifiée (sept. 2026) |
|---|---|
| Bascule sur **Groq Llama 3.3** | **Retiré du tier gratuit le 16 août 2026**, enterprise-only désormais |
| **Gemini 1.5 Flash** | Obsolète ; le modèle courant est `gemini-3.8-flash` |
| Deux appels séparés (STT puis résumé) | Gemini accepte l'audio directement : un seul appel gratuit peut faire les deux |

## Architecture

**Voie courte** (fichier ≤ 14 Mo, soit ~55 min d'audio au débit de Plodo) :
un seul appel à Gemini, audio envoyé en pièce jointe inline, réponse en JSON
forcé par schéma — transcript et résumé structuré en une fois.

**Voie de secours** (la voie courte échoue, ou le fichier est trop gros) :
deux étapes indépendantes.

```
Transcription : Groq Whisper (cloud) ──échec──► Whisper local (hors ligne)
Résumé        : Groq (chat, gratuit) ──échec──► Cohere
```

Le résumé de secours ne retente **pas** Gemini en texte seul juste après un
échec de la voie courte : les deux appels partagent le même quota par
projet, retenter serait presque toujours voué au même sort. Gemini garde en
revanche sa place en tête de la chaîne de résumé quand la voie courte n'a
jamais été tentée (fichier trop gros pour l'envoi direct).

## Paliers gratuits vérifiés (septembre 2026)

| Service | Palier gratuit | Rôle ici |
|---|---|---|
| Groq Whisper | ~8h audio/jour (28 800 s) | STT, en premier |
| Whisper local (`whisper_flutter_plus`) | illimité, hors ligne | STT, dernier recours |
| Gemini `gemini-3.8-flash` | 5–15 req/min selon le modèle, audio en entrée | Voie courte + 1er recours résumé |
| Groq (chat) `openai/gpt-oss-20b` | 30 req/min, 1000 req/jour | Résumé, 2e recours |
| Cohere (trial) | **1000 appels/mois au total**, 20 req/min | Résumé, dernier recours |

Le plafond Cohere est mensuel, pas quotidien — ce n'est pas un filet
confortable, seulement une vraie roue de secours.

## Installation

```bash
flutter pub get
```

Vérifiez la version de `whisper_flutter_plus` réellement installée (le
paquet évolue vite) et comparez sa signature `transcribe()` à celle utilisée
dans `lib/src/ai_aggregator_service.dart` — commentée à l'endroit où elle
est appelée.

### Clés d'API

Jamais en dur dans le code. Au lancement :

```bash
flutter run \
  --dart-define=GROQ_API_KEY=... \
  --dart-define=GEMINI_API_KEY=... \
  --dart-define=COHERE_API_KEY=...
```

ou, plus confortable, un fichier non versionné :

```bash
flutter run --dart-define-from-file=secrets.json
```

```dart
final service = AiAggregatorService.depuisEnvironnement();
```

## Utilisation

```dart
final service = AiAggregatorService.depuisEnvironnement();

final resultat = await service.traiterAudio(fichierAudio);
print(resultat.transcript);
print(resultat.summary.resumeExecutif);

// Dans l'interface, à côté du résumé :
ProviderBadge(resultat: service.dernierResultat)
```

`service.dernierResultat` est un `ValueNotifier` : `ProviderBadge` l'écoute
et affiche « Transcrit et résumé par Gemini » (voie courte) ou « Transcrit
par… / Résumé par… » (voie de secours, deux fournisseurs distincts).

## Ce qui n'est pas construit

**L'API Files de Google** (upload en deux temps pour l'audio au-delà de
20 Mo encodé, soit ~14 Mo de fichier brut) n'est pas implémentée : le
protocole d'upload resumable est fragile à écrire sans pouvoir le tester
contre un vrai appel. Un fichier trop gros passe directement par la chaîne
Groq Whisper → Whisper local, qui n'a pas cette limite de taille par
requête de la même façon. À construire si des visites de plus d'une heure
deviennent courantes.

## Ce qui n'a pas pu être vérifié ici

Aucun SDK Flutter/Dart n'était disponible dans l'environnement où ce paquet
a été écrit : ni `flutter pub get`, ni `dart analyze`, ni un appel réel aux
quatre API n'a pu être exécuté. Le code a été relu à la main pour la
cohérence des types et l'équilibre des accolades, mais un premier
`flutter analyze` chez vous reste la vraie vérification.
