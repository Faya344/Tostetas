/** Export markdown d'une visite : le livrable qu'on envoie au client. */

import { hms } from './rag/chunk.mjs';

const ETAT_LABEL = { fait: 'Fait', en_cours: 'En cours', a_faire: 'À faire', bloque: 'Bloqué' };
const STATUT_LABEL = { actee: 'Actée', a_valider: 'À valider', rejetee: 'Rejetée' };
const NIVEAU = ['', 'faible', 'modéré', 'élevé', 'critique'];

export function exportMarkdown(visite) {
  const s = visite.synthese;
  const out = [];
  const push = (...lines) => out.push(...lines, '');

  push(`# ${s?.titre || visite.titre || 'Visite technique'}`);
  push([
    visite.site && `**Site** : ${visite.site}`,
    visite.date && `**Date** : ${visite.date}`,
    visite.duree && `**Durée** : ${hms(visite.duree)}`
  ].filter(Boolean).join('  \n'));

  if (!s) {
    push('> Synthèse non générée.');
  } else {
    push('## Résumé', s.resume);

    if (s.points_saillants?.length) {
      push('## Points saillants', s.points_saillants.map((p) => `- ${p}`).join('\n'));
    }
    if (s.phases?.length) {
      push('## Phases',
        '| Phase | Début | Fin | État |',
        '| --- | --- | --- | --- |',
        s.phases.map((p) => `| ${p.nom} | ${hms(p.t0)} | ${hms(p.t1)} | ${ETAT_LABEL[p.etat]} |`).join('\n'));
    }
    if (s.decisions?.length) {
      push('## Décisions');
      for (const d of s.decisions) {
        push(`### ${d.intitule}`,
          `*${STATUT_LABEL[d.statut]}${d.responsable ? ` — ${d.responsable}` : ''} — ${hms(d.t)}*`,
          d.justification,
          d.alternatives?.length
            ? d.alternatives.map((a) => `- ${a.retenue ? '**Retenue**' : 'Écartée'} : ${a.option}${a.motif ? ` — ${a.motif}` : ''}`).join('\n')
            : '');
      }
    }
    if (s.actions?.length) {
      push('## Actions',
        '| Action | Responsable | Échéance | Priorité |',
        '| --- | --- | --- | --- |',
        s.actions.map((a) => `| ${a.intitule} | ${a.responsable || '—'} | ${a.echeance || '—'} | ${a.priorite} |`).join('\n'));
    }
    if (s.risques?.length) {
      push('## Risques',
        s.risques.map((r) =>
          `- **${r.intitule}** — gravité ${NIVEAU[r.gravite]}, probabilité ${NIVEAU[r.probabilite]}` +
          (r.mitigation ? `  \n  Parade : ${r.mitigation}` : '')).join('\n'));
    }
    if (s.mesures?.length) {
      push('## Mesures relevées',
        s.mesures.map((m) => `- ${m.libelle} : **${m.valeur} ${m.unite}** (${hms(m.t)})`).join('\n'));
    }
    if (s.questions_ouvertes?.length) {
      push('## À confirmer', s.questions_ouvertes.map((q) => `- ${q}`).join('\n'));
    }
  }

  if (visite.markers?.length) {
    push('## Points clés marqués sur le terrain',
      visite.markers.map((m) => `- \`${hms(m.t)}\` ${m.label || 'Point clé'}${m.note ? ` — ${m.note}` : ''}`).join('\n'));
  }

  if (visite.transcript?.segments?.length) {
    push('---', '## Transcription',
      visite.transcript.segments
        .map((seg) => `\`${hms(seg.t0)}\`${seg.speaker ? ` **${seg.speaker}** :` : ''} ${seg.text}`)
        .join('\n\n'));
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
