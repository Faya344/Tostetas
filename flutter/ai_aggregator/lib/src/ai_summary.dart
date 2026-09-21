import 'ai_provider.dart';

/// Un résumé structuré — jamais un simple bloc de texte à reparser, ni côté
/// Gemini (voie courte, JSON forcé par schéma) ni côté Groq/Cohere (voie de
/// secours, prompt qui demande explicitement ces trois champs).
class AiSummary {
  const AiSummary({
    required this.resumeExecutif,
    required this.pointsCles,
    required this.actions,
  });

  final String resumeExecutif;
  final List<String> pointsCles;
  final List<String> actions;

  factory AiSummary.depuisJson(Map<String, dynamic> json) => AiSummary(
        resumeExecutif: (json['resume_executif'] as String? ?? '').trim(),
        pointsCles: (json['points_cles'] as List<dynamic>? ?? const [])
            .map((e) => e.toString())
            .toList(),
        actions: (json['actions'] as List<dynamic>? ?? const [])
            .map((e) => e.toString())
            .toList(),
      );
}

/// Le résultat complet d'une visite traitée : transcription, résumé, et —
/// c'est tout le sens de cette classe — qui a produit quoi.
///
/// [transcriptionModel] et [summaryModel] portent le nom exact du modèle
/// appelé (ex. "whisper-large-v3-turbo", "gemini-3.8-flash"), pas seulement
/// la famille de fournisseur : les tiers gratuits changent de modèle sans
/// prévenir — Groq a retiré Llama 3.3 de son offre gratuite le 16 août
/// 2026 — et savoir *lequel* a répondu est ce qui permet de comprendre une
/// dégradation de qualité après coup.
class AiPipelineResult {
  const AiPipelineResult({
    required this.transcript,
    required this.summary,
    required this.transcriptionProvider,
    required this.transcriptionModel,
    required this.summaryProvider,
    required this.summaryModel,
    required this.elapsed,
    required this.appelUnique,
  });

  final String transcript;
  final AiSummary summary;

  final AiProvider transcriptionProvider;
  final String transcriptionModel;

  final AiProvider summaryProvider;
  final String summaryModel;

  final Duration elapsed;

  /// Vrai quand un seul appel (Gemini, audio envoyé directement) a produit
  /// la transcription ET le résumé. Dans ce cas [transcriptionProvider] et
  /// [summaryProvider] valent tous les deux [AiProvider.geminiFlash], mais
  /// ce booléen évite d'avoir à le déduire pour choisir entre un badge
  /// double ou un badge unique dans l'interface.
  final bool appelUnique;
}
