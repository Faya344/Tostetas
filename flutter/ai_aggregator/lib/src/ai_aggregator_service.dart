import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:whisper_flutter_plus/whisper_flutter_plus.dart';

import 'ai_exceptions.dart';
import 'ai_provider.dart';
import 'ai_summary.dart';

/// Traite un enregistrement audio en transcription + résumé structuré, en
/// ne s'appuyant que sur des paliers gratuits.
///
/// ## Deux voies
///
/// **Voie courte** — quand le fichier tient dans la limite d'envoi direct
/// de Gemini (voir [limiteInlineOctets]) : un seul appel multimodal envoie
/// l'audio et récupère transcription + résumé en une fois, en JSON forcé
/// par schéma. C'est la voie recommandée par la doc Gemini elle-même pour
/// ce cas d'usage, et celle qui consomme le moins d'appels sur un quota
/// gratuit.
///
/// **Voie de secours** — si la voie courte échoue, ou si le fichier est
/// trop volumineux pour un envoi direct : transcription et résumé
/// redeviennent deux étapes séparées, chacune avec sa propre chaîne.
///
/// ```
/// Transcription : Groq Whisper (cloud) ──échec──► Whisper local (hors ligne)
/// Résumé        : Groq (chat)         ──échec──► Cohere
/// ```
///
/// Le résumé de secours ne retente PAS Gemini en texte seul après un échec
/// de la voie courte : les deux appels partagent le même quota par projet,
/// retenter juste après un échec gaspillerait une tentative presque
/// certainement vouée au même sort. Gemini garde en revanche sa place en
/// tête de la chaîne de résumé quand la voie courte n'a jamais été
/// tentée — fichier trop gros pour l'envoi direct.
///
/// ## Ce qui n'est PAS géré
///
/// Un fichier au-delà de [limiteInlineOctets] n'est jamais envoyé à Gemini
/// pour la transcription : l'API Files de Google (upload en deux temps,
/// protocole resumable) n'est pas implémentée ici, faute d'un moyen de la
/// vérifier par un appel réel au moment de l'écriture. Ces visites passent
/// directement par la chaîne Groq Whisper → Whisper local.
class AiAggregatorService {
  AiAggregatorService({
    required String groqApiKey,
    required String geminiApiKey,
    required String cohereApiKey,
    this.modeleGemini = 'gemini-3.8-flash',
    this.modeleGroqWhisper = 'whisper-large-v3-turbo',
    this.modeleGroqChat = 'openai/gpt-oss-20b',
    this.modeleCohere = 'command-r-plus',
    WhisperModel modeleLocal = WhisperModel.base,
    Duration? delaiMax,
    int? limiteInlineOctets,
  })  : _groqApiKey = groqApiKey,
        _geminiApiKey = geminiApiKey,
        _cohereApiKey = cohereApiKey,
        _modeleLocal = modeleLocal,
        delaiMax = delaiMax ?? const Duration(seconds: 60),
        // La limite Gemini porte sur la requête ENCODÉE (20 Mo), et le
        // Base64 gonfle les octets bruts d'environ un tiers. 14 Mo de
        // fichier laisse aussi de la place pour le prompt et le schéma.
        // Au débit de Plodo (~15 Mo/h en AAC 16 kHz mono), ça couvre une
        // visite d'un peu moins d'une heure.
        limiteInlineOctets = limiteInlineOctets ?? 14 * 1024 * 1024;

  /// Lit les trois clés depuis des variables passées au moment de la
  /// compilation (`flutter run --dart-define=GROQ_API_KEY=...`, ou
  /// `--dart-define-from-file=secrets.json`). Aucune clé n'est jamais
  /// écrite en dur dans le code : un dépôt git n'oublie rien.
  factory AiAggregatorService.depuisEnvironnement() {
    const groq = String.fromEnvironment('GROQ_API_KEY');
    const gemini = String.fromEnvironment('GEMINI_API_KEY');
    const cohere = String.fromEnvironment('COHERE_API_KEY');

    final manquantes = <String>[
      if (groq.isEmpty) 'GROQ_API_KEY',
      if (gemini.isEmpty) 'GEMINI_API_KEY',
      if (cohere.isEmpty) 'COHERE_API_KEY',
    ];
    if (manquantes.isNotEmpty) {
      throw StateError(
        "Variable(s) d'environnement absente(s) : ${manquantes.join(', ')}. "
        'Lancez avec --dart-define=NOM=valeur pour chacune, '
        'ou --dart-define-from-file=secrets.json.',
      );
    }
    return AiAggregatorService(
      groqApiKey: groq,
      geminiApiKey: gemini,
      cohereApiKey: cohere,
    );
  }

  final String _groqApiKey;
  final String _geminiApiKey;
  final String _cohereApiKey;
  final WhisperModel _modeleLocal;

  /// Noms de modèles exposés en paramètres, pas en constantes internes : la
  /// leçon du retrait de Llama 3.3 du tier gratuit de Groq (16 août 2026)
  /// est qu'un modèle gratuit peut disparaître du jour au lendemain. Le
  /// remplacer devient un argument de constructeur, jamais une modification
  /// du corps de la classe.
  final String modeleGemini;
  final String modeleGroqWhisper;
  final String modeleGroqChat;
  final String modeleCohere;

  final Duration delaiMax;
  final int limiteInlineOctets;

  /// Le dernier résultat produit — `null` tant qu'aucun traitement n'a
  /// encore réussi. L'interface écoute cette valeur pour afficher
  /// l'indicateur de fournisseur sans avoir à retenir l'état elle-même :
  /// voir `ProviderBadge` dans `provider_badge.dart`.
  final ValueNotifier<AiPipelineResult?> dernierResultat = ValueNotifier(null);

  void dispose() => dernierResultat.dispose();

  // ------------------------------------------------------------- pipeline

  /// Traite un enregistrement de bout en bout : transcription puis résumé.
  ///
  /// @throws AiAggregatorException si la voie courte échoue (ou n'est pas
  /// tentée) ET que la chaîne de secours est elle aussi épuisée pour l'une
  /// des deux étapes.
  Future<AiPipelineResult> traiterAudio(File audioFile) async {
    final chrono = Stopwatch()..start();
    final octets = await audioFile.length();

    if (octets <= limiteInlineOctets) {
      try {
        final combine = await _transcrireEtResumerAvecGemini(audioFile);
        chrono.stop();
        final resultat = AiPipelineResult(
          transcript: combine.transcript,
          summary: combine.summary,
          transcriptionProvider: AiProvider.geminiFlash,
          transcriptionModel: modeleGemini,
          summaryProvider: AiProvider.geminiFlash,
          summaryModel: modeleGemini,
          elapsed: chrono.elapsed,
          appelUnique: true,
        );
        dernierResultat.value = resultat;
        return resultat;
      } on AiProviderException {
        // On bascule sur la voie de secours ; le résumé n'y retentera pas
        // Gemini, voir la note sur le partage de quota en tête de fichier.
      }
    }

    final (texte, fournisseurStt, modeleStt) = await _essayerChaine<String>('transcription', [
      (AiProvider.groqWhisper, modeleGroqWhisper, () => _transcrireAvecGroq(audioFile)),
      (AiProvider.whisperLocal, '(local)', () => _transcrireEnLocal(audioFile)),
    ]);

    final (resume, fournisseurResume, modeleResume) = await _essayerChaine<AiSummary>('résumé', [
      if (octets > limiteInlineOctets)
        (AiProvider.geminiFlash, modeleGemini, () => _resumerAvecGemini(texte)),
      (AiProvider.groqChat, modeleGroqChat, () => _resumerAvecGroq(texte)),
      (AiProvider.cohere, modeleCohere, () => _resumerAvecCohere(texte)),
    ]);

    chrono.stop();
    final resultat = AiPipelineResult(
      transcript: texte,
      summary: resume,
      transcriptionProvider: fournisseurStt,
      transcriptionModel: modeleStt,
      summaryProvider: fournisseurResume,
      summaryModel: modeleResume,
      elapsed: chrono.elapsed,
      appelUnique: false,
    );
    dernierResultat.value = resultat;
    return resultat;
  }

  /// Essaie chaque étape dans l'ordre, s'arrête à la première qui réussit.
  ///
  /// Chaque `_transcrireX` / `_resumerX` normalise déjà toute erreur —
  /// réseau, HTTP, JSON illisible — en [AiProviderException] : c'est ce qui
  /// permet à cette méthode de ne capturer que ce seul type, sans avaler
  /// une erreur de programmation par accident.
  Future<(T, AiProvider, String)> _essayerChaine<T>(
    String etape,
    List<(AiProvider, String, Future<T> Function())> etapes,
  ) async {
    final echecs = <AiProviderException>[];
    for (final (provider, modele, appel) in etapes) {
      try {
        final valeur = await appel();
        return (valeur, provider, modele);
      } on AiProviderException catch (e) {
        echecs.add(e);
      }
    }
    throw AiAggregatorException(etape, echecs);
  }

  // --------------------------------------------------------- voie courte

  Future<({String transcript, AiSummary summary})> _transcrireEtResumerAvecGemini(
    File audioFile,
  ) async {
    try {
      final octetsAudio = await audioFile.readAsBytes();
      final reponse = await http
          .post(
            Uri.parse(
              'https://generativelanguage.googleapis.com/v1beta/models/'
              '$modeleGemini:generateContent?key=$_geminiApiKey',
            ),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'contents': [
                {
                  'parts': [
                    {'text': _promptCombine},
                    {
                      'inlineData': {
                        'mimeType': _typeMimeAudio(audioFile.path),
                        'data': base64Encode(octetsAudio),
                      },
                    },
                  ],
                },
              ],
              'generationConfig': {
                'responseMimeType': 'application/json',
                'responseSchema': _schemaCombine,
              },
            }),
          )
          .timeout(delaiMax);

      if (reponse.statusCode != 200) {
        throw AiProviderException(
          AiProvider.geminiFlash,
          'HTTP ${reponse.statusCode} : ${reponse.body}',
          statusCode: reponse.statusCode,
        );
      }

      final structure = _lireJsonGemini(reponse.body, AiProvider.geminiFlash);
      final transcript = (structure['transcript'] as String? ?? '').trim();
      if (transcript.isEmpty) {
        throw AiProviderException(AiProvider.geminiFlash, 'Transcription vide.');
      }
      return (transcript: transcript, summary: AiSummary.depuisJson(structure));
    } on AiProviderException {
      rethrow;
    } catch (e) {
      throw AiProviderException(AiProvider.geminiFlash, e.toString());
    }
  }

  // ------------------------------------------------------ transcription

  Future<String> _transcrireAvecGroq(File audioFile) async {
    try {
      final requete = http.MultipartRequest(
        'POST',
        Uri.parse('https://api.groq.com/openai/v1/audio/transcriptions'),
      )
        ..headers['Authorization'] = 'Bearer $_groqApiKey'
        ..fields['model'] = modeleGroqWhisper
        ..fields['response_format'] = 'json'
        ..files.add(await http.MultipartFile.fromPath('file', audioFile.path));

      final reponse = await http.Response.fromStream(
        await requete.send().timeout(delaiMax),
      );

      if (reponse.statusCode != 200) {
        throw AiProviderException(
          AiProvider.groqWhisper,
          'HTTP ${reponse.statusCode} : ${reponse.body}',
          statusCode: reponse.statusCode,
        );
      }
      final texte = (jsonDecode(reponse.body) as Map<String, dynamic>)['text'] as String?;
      if (texte == null || texte.trim().isEmpty) {
        throw AiProviderException(AiProvider.groqWhisper, 'Réponse sans texte exploitable.');
      }
      return texte.trim();
    } on AiProviderException {
      rethrow;
    } catch (e) {
      throw AiProviderException(AiProvider.groqWhisper, e.toString());
    }
  }

  /// Dernier recours, et le seul qui fonctionne sans réseau. Le modèle
  /// GGML doit avoir été téléchargé au moins une fois (premier lancement,
  /// en ligne) : `whisper_flutter_plus` le met ensuite en cache sur
  /// l'appareil.
  Future<String> _transcrireEnLocal(File audioFile) async {
    try {
      // Signature vérifiée sur whisper_flutter_plus ^1.x au moment de
      // l'écriture. Le paquet évolue vite — si `flutter pub get` signale
      // un membre introuvable, consultez l'exemple de la version que vous
      // avez réellement installée (pub.dev → whisper_flutter_plus →
      // Example) plutôt que cette signature.
      final whisper = Whisper(model: _modeleLocal);
      final resultat = await whisper.transcribe(
        transcribeRequest: TranscribeRequest(
          audio: audioFile.path,
          language: 'fr',
          isTranslate: false,
          isNoTimestamps: true,
        ),
      );
      final texte = resultat.text.trim();
      if (texte.isEmpty) {
        throw AiProviderException(AiProvider.whisperLocal, 'Transcription locale vide.');
      }
      return texte;
    } on AiProviderException {
      rethrow;
    } catch (e) {
      throw AiProviderException(
        AiProvider.whisperLocal,
        'Whisper local indisponible (modèle absent ou erreur native) : $e',
      );
    }
  }

  // ------------------------------------------------------------- résumé

  Future<AiSummary> _resumerAvecGemini(String transcript) async {
    try {
      final reponse = await http
          .post(
            Uri.parse(
              'https://generativelanguage.googleapis.com/v1beta/models/'
              '$modeleGemini:generateContent?key=$_geminiApiKey',
            ),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'contents': [
                {
                  'parts': [
                    {'text': '$_promptResume\n\nTranscription :\n$transcript'},
                  ],
                },
              ],
              'generationConfig': {
                'responseMimeType': 'application/json',
                'responseSchema': _schemaResume,
              },
            }),
          )
          .timeout(delaiMax);

      if (reponse.statusCode != 200) {
        throw AiProviderException(
          AiProvider.geminiFlash,
          'HTTP ${reponse.statusCode} : ${reponse.body}',
          statusCode: reponse.statusCode,
        );
      }
      return AiSummary.depuisJson(_lireJsonGemini(reponse.body, AiProvider.geminiFlash));
    } on AiProviderException {
      rethrow;
    } catch (e) {
      throw AiProviderException(AiProvider.geminiFlash, e.toString());
    }
  }

  Future<AiSummary> _resumerAvecGroq(String transcript) async {
    try {
      final reponse = await http
          .post(
            Uri.parse('https://api.groq.com/openai/v1/chat/completions'),
            headers: {
              'Authorization': 'Bearer $_groqApiKey',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({
              'model': modeleGroqChat,
              'messages': [
                {'role': 'user', 'content': '$_promptResume\n\nTranscription :\n$transcript'},
              ],
              'response_format': {'type': 'json_object'},
            }),
          )
          .timeout(delaiMax);

      if (reponse.statusCode != 200) {
        throw AiProviderException(
          AiProvider.groqChat,
          'HTTP ${reponse.statusCode} : ${reponse.body}',
          statusCode: reponse.statusCode,
        );
      }
      final donnees = jsonDecode(reponse.body) as Map<String, dynamic>;
      final choix = donnees['choices'] as List<dynamic>?;
      final contenu = choix != null && choix.isNotEmpty
          ? (choix.first as Map<String, dynamic>)['message']?['content'] as String?
          : null;
      if (contenu == null || contenu.trim().isEmpty) {
        throw AiProviderException(AiProvider.groqChat, 'Réponse sans contenu exploitable.');
      }
      // `response_format: json_object` n'est pas garanti sur tous les
      // modèles gratuits : on extrait le premier bloc { ... } plutôt que
      // de supposer que la réponse est du JSON pur, comme pour Cohere.
      return AiSummary.depuisJson(_extraireJson(contenu, AiProvider.groqChat));
    } on AiProviderException {
      rethrow;
    } catch (e) {
      throw AiProviderException(AiProvider.groqChat, e.toString());
    }
  }

  /// Dernier recours pour le résumé. Le tier gratuit Cohere plafonne à
  /// 1000 appels par MOIS (pas par jour) : ce n'est pas un filet
  /// confortable, c'est une vraie roue de secours à n'utiliser qu'en cas
  /// de panne conjointe de Gemini et de Groq.
  Future<AiSummary> _resumerAvecCohere(String transcript) async {
    try {
      final reponse = await http
          .post(
            Uri.parse('https://api.cohere.com/v1/chat'),
            headers: {
              'Authorization': 'Bearer $_cohereApiKey',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({
              'model': modeleCohere,
              'message': '$_promptResume\n\nRéponds uniquement en JSON valide, '
                  'avec les clés resume_executif (chaîne), points_cles (liste '
                  'de chaînes) et actions (liste de chaînes).'
                  '\n\nTranscription :\n$transcript',
            }),
          )
          .timeout(delaiMax);

      if (reponse.statusCode != 200) {
        throw AiProviderException(
          AiProvider.cohere,
          'HTTP ${reponse.statusCode} : ${reponse.body}',
          statusCode: reponse.statusCode,
        );
      }
      final donnees = jsonDecode(reponse.body) as Map<String, dynamic>;
      final texte = donnees['text'] as String?;
      if (texte == null || texte.trim().isEmpty) {
        throw AiProviderException(AiProvider.cohere, 'Réponse sans texte exploitable.');
      }
      // Cohere n'a pas de mode JSON forcé par schéma comme Gemini : on
      // extrait le premier bloc { ... } plutôt que de faire confiance à
      // ce que le modèle n'ait rien ajouté autour.
      return AiSummary.depuisJson(_extraireJson(texte, AiProvider.cohere));
    } on AiProviderException {
      rethrow;
    } catch (e) {
      throw AiProviderException(AiProvider.cohere, e.toString());
    }
  }

  // ----------------------------------------------------------- utilitaires

  /// Extrait le premier objet JSON d'un texte, même entouré de prose ou de
  /// balises de code — utile pour Groq et Cohere, qui n'offrent pas de
  /// garantie de sortie JSON pure aussi stricte que le schéma de Gemini.
  Map<String, dynamic> _extraireJson(String texte, AiProvider provider) {
    final debut = texte.indexOf('{');
    final fin = texte.lastIndexOf('}');
    if (debut == -1 || fin <= debut) {
      throw AiProviderException(provider, 'Aucun JSON exploitable dans la réponse.');
    }
    try {
      return jsonDecode(texte.substring(debut, fin + 1)) as Map<String, dynamic>;
    } catch (e) {
      throw AiProviderException(provider, 'JSON illisible : $e');
    }
  }

  Map<String, dynamic> _lireJsonGemini(String corpsReponse, AiProvider provider) {
    final donnees = jsonDecode(corpsReponse) as Map<String, dynamic>;
    final candidats = donnees['candidates'] as List<dynamic>?;
    if (candidats == null || candidats.isEmpty) {
      throw AiProviderException(provider, 'Réponse sans candidat (filtrée par la sécurité ?).');
    }

    // Écrit avec des vérifications de nullité explicites, plutôt qu'un
    // chaînage d'accès null-aware imbriqué : sans compilateur sous la main
    // pour vérifier une syntaxe à la limite, la version la plus simple est
    // la plus sûre à livrer.
    final premier = candidats.first as Map<String, dynamic>;
    final contenu = premier['content'] as Map<String, dynamic>?;
    final parties = contenu == null ? null : contenu['parts'] as List<dynamic>?;
    final texteJson = parties != null && parties.isNotEmpty
        ? (parties.first as Map<String, dynamic>)['text'] as String?
        : null;
    if (texteJson == null || texteJson.trim().isEmpty) {
      throw AiProviderException(provider, 'Réponse sans texte exploitable.');
    }
    return jsonDecode(texteJson) as Map<String, dynamic>;
  }

  String _typeMimeAudio(String chemin) {
    final extension = chemin.contains('.') ? chemin.split('.').last.toLowerCase() : '';
    return switch (extension) {
      'm4a' || 'aac' || 'mp4' => 'audio/mp4',
      'webm' => 'audio/webm',
      'wav' => 'audio/wav',
      'mp3' => 'audio/mpeg',
      'ogg' => 'audio/ogg',
      'flac' => 'audio/flac',
      _ => 'audio/mp4',
    };
  }
}

const _promptCombine = '''
Tu es l'assistant de compte rendu de Plodo. Écoute cet enregistrement audio
d'une visite technique et produis :

1. Une transcription fidèle, mot à mot, sans reformulation.
2. Un résumé structuré, en français, basé UNIQUEMENT sur ce qui est dit :
   un résumé exécutif, des points clés, des actions à faire.

N'invente aucune information absente de l'audio. Si un passage est
inintelligible, indique-le dans la transcription plutôt que de le deviner.
''';

const _promptResume = '''
Tu es l'assistant de compte rendu de Plodo. Analyse la transcription
suivante et produis un résumé structuré, en français : un résumé exécutif,
des points clés, des actions à faire. N'invente aucune information absente
de la transcription.
''';

const _schemaResume = {
  'type': 'OBJECT',
  'properties': {
    'resume_executif': {'type': 'STRING'},
    'points_cles': {
      'type': 'ARRAY',
      'items': {'type': 'STRING'},
    },
    'actions': {
      'type': 'ARRAY',
      'items': {'type': 'STRING'},
    },
  },
  'required': ['resume_executif', 'points_cles', 'actions'],
};

const _schemaCombine = {
  'type': 'OBJECT',
  'properties': {
    'transcript': {
      'type': 'STRING',
      'description': 'Transcription mot à mot, fidèle, sans reformulation.',
    },
    'resume_executif': {'type': 'STRING'},
    'points_cles': {
      'type': 'ARRAY',
      'items': {'type': 'STRING'},
    },
    'actions': {
      'type': 'ARRAY',
      'items': {'type': 'STRING'},
    },
  },
  'required': ['transcript', 'resume_executif', 'points_cles', 'actions'],
};
