/// Le service qui a réellement produit un résultat — transcription ou
/// résumé.
///
/// Pur Dart, sans dépendance Flutter : ça permet de tester
/// [AiAggregatorService] hors d'un widget. Le nom exact du modèle appelé
/// (qui, lui, change au fil des dépréciations des tiers gratuits — voir
/// [AiPipelineResult]) n'est volontairement pas figé ici.
enum AiProvider {
  geminiFlash('Gemini (audio direct)'),
  groqWhisper('Groq Whisper (cloud)'),
  whisperLocal('Whisper local (hors ligne)'),
  groqChat('Groq (résumé)'),
  cohere('Cohere (résumé)');

  const AiProvider(this.label);

  /// Nom lisible, prêt à afficher dans l'indicateur d'interface.
  final String label;
}
