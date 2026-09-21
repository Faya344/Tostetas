import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'ai_provider.dart';
import 'ai_summary.dart';

/// Indicateur « généré par » — c'est le point 5 de la demande initiale,
/// et ce n'est pas cosmétique : sur un tier gratuit, savoir si un résumé
/// vient de Gemini ou d'un dernier recours moins capable (Cohere, quota
/// serré à 1000 appels/mois) change la confiance qu'on lui accorde.
///
/// Écoute directement `service.dernierResultat` : aucun état à
/// synchroniser à la main dans l'écran qui l'affiche.
class ProviderBadge extends StatelessWidget {
  const ProviderBadge({super.key, required this.resultat});

  /// `service.dernierResultat` (le `ValueListenable` exposé par
  /// [AiAggregatorService]).
  final ValueListenable<AiPipelineResult?> resultat;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AiPipelineResult?>(
      valueListenable: resultat,
      builder: (context, r, _) {
        if (r == null) return const SizedBox.shrink();
        return Wrap(
          spacing: 8,
          runSpacing: 4,
          children: r.appelUnique
              ? [_puce(context, 'Transcrit et résumé par', r.summaryProvider, r.summaryModel)]
              : [
                  _puce(context, 'Transcrit par', r.transcriptionProvider, r.transcriptionModel),
                  _puce(context, 'Résumé par', r.summaryProvider, r.summaryModel),
                ],
        );
      },
    );
  }

  Widget _puce(BuildContext context, String prefixe, AiProvider provider, String modele) {
    return Tooltip(
      message: modele,
      child: Chip(
        avatar: const Icon(Icons.smart_toy_outlined, size: 16),
        label: Text('$prefixe ${provider.label}'),
        visualDensity: VisualDensity.compact,
      ),
    );
  }
}
