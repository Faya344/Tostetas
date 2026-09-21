import 'ai_provider.dart';

/// Erreur portée par un appel à un fournisseur, avec son code HTTP quand
/// il y en a un.
///
/// Chaque méthode d'appel du service normalise TOUTE erreur — HTTP, réseau,
/// délai dépassé, JSON illisible, réponse filtrée par la sécurité du
/// modèle — vers ce type avant de la laisser remonter. C'est ce qui permet
/// à la chaîne de secours de basculer sur n'importe quel échec sans avoir
/// à deviner, au niveau de l'agrégateur, quelles exceptions un paquet tiers
/// peut lever.
class AiProviderException implements Exception {
  const AiProviderException(this.provider, this.message, {this.statusCode});

  final AiProvider provider;
  final String message;
  final int? statusCode;

  /// Quota dépassé ou débit trop élevé — la raison la plus fréquente d'une
  /// bascule sur un tier gratuit, et la seule qui n'indique aucune panne
  /// réelle du fournisseur.
  bool get estQuotaDepasse => statusCode == 429;

  /// Panne côté fournisseur (5xx) : bascule légitime, à ne pas confondre
  /// avec une erreur de notre côté (4xx hors 429 — une requête mal formée
  /// échouerait de la même façon à chaque tentative).
  bool get estPanneServeur => statusCode != null && statusCode! >= 500;

  @override
  String toString() {
    final code = statusCode == null ? '—' : '$statusCode';
    return '${provider.label} (HTTP $code) : $message';
  }
}

/// Levée quand la chaîne de secours entière est épuisée pour une étape.
///
/// Porte le détail de chaque tentative : c'est ce qu'il faut afficher (ou
/// journaliser) pour comprendre pourquoi une visite ne s'est pas résumée,
/// plutôt qu'un message générique « les IA ne marchent pas ».
class AiAggregatorException implements Exception {
  const AiAggregatorException(this.etape, this.tentatives);

  /// « transcription » ou « résumé ».
  final String etape;

  /// Une entrée par fournisseur essayé, dans l'ordre de la chaîne.
  final List<AiProviderException> tentatives;

  @override
  String toString() {
    final detail = tentatives.map((t) => t.toString()).join(' → ');
    return 'Tous les fournisseurs ont échoué pour $etape : $detail';
  }
}
