/**
 * Découpage d'une transcription en passages indexables.
 *
 * Un chunk n'est pas un bloc de texte anonyme : il garde son ancrage temporel
 * (t0/t1), le locuteur dominant et les points clés qu'il recouvre. C'est ce qui
 * permet de citer « 00:14:32 — Chef de chantier » dans une réponse, et de
 * rejouer l'audio exactement au bon endroit.
 */

const TARGET_CHARS = 620;   // ~150 tokens : assez pour porter une décision, assez fin pour la citer
const OVERLAP_CHARS = 150;  // recouvrement : évite de couper une décision en deux

/** @typedef {{t0:number, t1:number, speaker?:string, text:string}} Segment */

function flush(acc, visite, chunks, markers) {
  if (!acc.segments.length) return;
  const text = acc.segments.map((s) => s.text.trim()).filter(Boolean).join(' ');
  if (!text) return;
  const t0 = acc.segments[0].t0;
  const t1 = acc.segments[acc.segments.length - 1].t1;

  const speakerTime = new Map();
  for (const s of acc.segments) {
    const key = s.speaker || 'inconnu';
    speakerTime.set(key, (speakerTime.get(key) ?? 0) + Math.max(0, s.t1 - s.t0));
  }
  const speakers = [...speakerTime.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

  chunks.push({
    id: `${visite.id}#${chunks.length.toString().padStart(4, '0')}`,
    visiteId: visite.id,
    visiteTitre: visite.titre ?? visite.id,
    visiteDate: visite.date ?? null,
    site: visite.site ?? null,
    t0, t1,
    speakers,
    speaker: speakers[0] ?? null,
    markers: markers.filter((m) => m.t >= t0 && m.t <= t1).map((m) => m.label ?? 'Point clé'),
    text
  });
}

/**
 * @param {{id:string, titre?:string, date?:string, site?:string}} visite
 * @param {Segment[]} segments
 * @param {{t:number,label?:string}[]} markers
 */
export function chunkTranscript(visite, segments, markers = []) {
  const chunks = [];
  let acc = { segments: [], chars: 0 };

  for (const segment of segments) {
    const text = String(segment.text ?? '').trim();
    if (!text) continue;
    acc.segments.push({ ...segment, text });
    acc.chars += text.length + 1;

    // Une frontière de locuteur ou un point clé est un endroit naturel pour couper.
    const isBoundary =
      acc.chars >= TARGET_CHARS ||
      markers.some((m) => Math.abs(m.t - segment.t1) < 1.5 && acc.chars > TARGET_CHARS / 2);

    if (isBoundary) {
      flush(acc, visite, chunks, markers);
      const tail = [];
      let kept = 0;
      for (let i = acc.segments.length - 1; i >= 0 && kept < OVERLAP_CHARS; i--) {
        tail.unshift(acc.segments[i]);
        kept += acc.segments[i].text.length;
      }
      acc = { segments: tail, chars: kept };
    }
  }
  flush(acc, visite, chunks, markers);
  return chunks;
}

/** Horodatage lisible : 00:14:32 */
export function hms(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}
