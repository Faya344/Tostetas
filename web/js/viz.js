/**
 * Graphiques — SVG écrit à la main, zéro bibliothèque.
 *
 * Règles tenues ici, et vérifiables à l'œil :
 * - la couleur de série ne sort jamais de la palette validée ; les couleurs
 *   d'état (bon/attention/sérieux/critique) ne servent qu'à des états et
 *   voyagent toujours avec un libellé ;
 * - un seul axe, jamais deux échelles superposées ;
 * - 2 px de fond entre deux aplats voisins, extrémités arrondies à 4 px ;
 * - au moins deux séries ⇒ légende présente, et étiquettes directes quand
 *   elles tiennent ;
 * - chaque figure expose sa table de données : la couleur n'est jamais le
 *   seul canal d'information.
 */

const NS = 'http://www.w3.org/2000/svg';

export const SERIE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const ETAT = { bon: '#0ca30c', attention: '#fab219', serieux: '#ec835a', critique: '#d03b3b' };
const SURFACE = '#0a0a12';

const ETAT_PHASE = {
  fait:     { couleur: ETAT.bon,       libelle: 'Fait',     icone: '✓' },
  en_cours: { couleur: ETAT.attention, libelle: 'En cours', icone: '◐' },
  a_faire:  { couleur: '#71708a',      libelle: 'À faire',  icone: '○' },
  bloque:   { couleur: ETAT.critique,  libelle: 'Bloqué',   icone: '✕' }
};

const NIVEAU = ['', 'faible', 'modéré', 'élevé', 'critique'];

/* --------------------------------------------------------------- primitives */

export function hms(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const parts = [Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0'));
  return h ? [String(h).padStart(2, '0'), ...parts].join(':') : parts.join(':');
}

function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

/* ------------------------------------------------------------- info-bulle */

let bulle = null;

function laBulle() {
  if (!bulle) {
    bulle = el('div', { class: 'info-bulle', role: 'tooltip' });
    document.body.append(bulle);
  }
  return bulle;
}

/** Attache survol + focus clavier : la bulle n'est pas réservée à la souris. */
function survol(node, contenu) {
  const montrer = (event) => {
    const b = laBulle();
    b.innerHTML = contenu;
    b.dataset.visible = 'true';
    const rect = node.getBoundingClientRect();
    const x = event?.clientX ?? rect.left + rect.width / 2;
    const y = event?.clientY ?? rect.top;
    const largeur = b.offsetWidth;
    b.style.left = `${Math.min(Math.max(8, x - largeur / 2), innerWidth - largeur - 8)}px`;
    b.style.top = `${Math.max(8, y - b.offsetHeight - 12)}px`;
  };
  const cacher = () => { if (bulle) bulle.dataset.visible = 'false'; };

  node.setAttribute('data-survol', '');
  node.setAttribute('tabindex', '0');
  node.addEventListener('mousemove', montrer);
  node.addEventListener('mouseenter', montrer);
  node.addEventListener('focus', () => montrer());
  node.addEventListener('mouseleave', cacher);
  node.addEventListener('blur', cacher);
  return node;
}

/* ------------------------------------------------------------- assemblages */

function legende(entrees) {
  return el('div', { class: 'legende' }, entrees.map(({ couleur, libelle }) =>
    el('span', { class: 'legende__item' }, [
      el('span', { class: 'legende__marque', style: `background:${couleur}` }),
      el('span', { text: libelle })
    ])));
}

function tableRepli(colonnes, lignes) {
  if (!lignes.length) return null;
  return el('details', { class: 'tableau-repli' }, [
    el('summary', { text: 'Voir les données' }),
    el('table', {}, [
      el('thead', {}, el('tr', {}, colonnes.map((c) => el('th', { text: c })))),
      el('tbody', {}, lignes.map((l) => el('tr', {}, l.map((c) => el('td', { text: String(c) })))))
    ])
  ]);
}

function figure({ titre, sous, svg, legende: lg, table, largeurMax = null }) {
  // Un SVG en largeur 100 % s'étire jusqu'à l'absurde sur grand écran :
  // les figures à proportions fixes (matrice, jauge) plafonnent.
  return el('figure', { class: 'figure' }, [
    el('figcaption', {}, [
      el('div', { class: 'figure__titre', text: titre }),
      sous ? el('div', { class: 'figure__legende-texte', text: sous }) : null
    ]),
    el('div', { class: 'viz', style: largeurMax ? `max-width:${largeurMax}px` : null }, svg),
    lg,
    table
  ]);
}

/**
 * Tronque une étiquette à la largeur disponible, en unités du viewBox.
 * L'estimation est volontairement pessimiste ; un découpage SVG garantit le
 * reste, l'estimation ne sert qu'à placer les points de suspension au bon
 * endroit. En dessous de six caractères utiles, on n'écrit rien : une
 * étiquette réduite à « Dé… » n'apprend rien que la bulle ne dise mieux.
 */
function tronquer(texte, largeurDispo, taillePolice) {
  const parCaractere = taillePolice * 0.62;
  const max = Math.floor(largeurDispo / parCaractere);
  if (max < 6) return '';
  return texte.length <= max ? texte : `${texte.slice(0, max - 1).trimEnd()}…`;
}

let compteurDecoupe = 0;

/** Découpe SVG : garantit qu'un texte ne dépasse jamais de sa bande. */
function decouper(svg, x, y, largeur, hauteur) {
  const id = `coupe-${++compteurDecoupe}`;
  let defs = svg.querySelector('defs');
  if (!defs) svg.prepend((defs = svgEl('defs')));
  defs.append(svgEl('clipPath', { id }, svgEl('rect', { x, y, width: largeur, height: hauteur })));
  return `url(#${id})`;
}

const echapper = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ==========================================================================
   Tuiles de chiffres — quand une seule valeur suffit, pas de graphique.
   ========================================================================== */

export function tuiles(entrees) {
  return el('div', { class: 'grille grille--tuiles' }, entrees.map(({ label, valeur, note }) =>
    el('div', { class: 'tuile' }, [
      el('div', { class: 'tuile__label', text: label }),
      el('div', { class: 'tuile__valeur', text: String(valeur) }),
      note ? el('div', { class: 'tuile__note', text: note }) : null
    ])));
}

/* ==========================================================================
   1 — Chronologie des phases
   Une bande de temps, les phases dans l'ordre, les points clés piqués dessus.
   ========================================================================== */

export function chronologie(phases, markers = [], duree = 0) {
  const total = Math.max(duree, ...phases.map((p) => p.t1), 1);
  const W = 920, PAD_G = 12, PAD_D = 12;
  const HAUT_PIN = 34, Y_BANDE = HAUT_PIN + 14, H_BANDE = 40;
  const H = Y_BANDE + H_BANDE + 46;
  const util = W - PAD_G - PAD_D;
  const x = (t) => PAD_G + (t / total) * util;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Chronologie des phases de la visite' });

  // Axe du temps : cinq repères suffisent à situer, davantage encombre.
  const pas = total / 5;
  for (let i = 0; i <= 5; i++) {
    const t = i * pas;
    svg.append(
      svgEl('line', { x1: x(t), y1: Y_BANDE - 6, x2: x(t), y2: Y_BANDE + H_BANDE + 6, class: 'viz-grille' }),
      svgEl('text', {
        x: x(t), y: Y_BANDE + H_BANDE + 22, class: 'viz-axe',
        'text-anchor': i === 0 ? 'start' : i === 5 ? 'end' : 'middle'
      }, document.createTextNode(hms(t)))
    );
  }
  svg.append(svgEl('line', { x1: PAD_G, y1: Y_BANDE + H_BANDE + 6, x2: W - PAD_D, y2: Y_BANDE + H_BANDE + 6, class: 'viz-ligne-axe' }));

  for (const phase of phases) {
    const x0 = x(phase.t0);
    const largeur = Math.max(3, x(phase.t1) - x0 - 2); // 2 px de fond entre deux phases
    const meta = ETAT_PHASE[phase.etat] ?? ETAT_PHASE.fait;

    const groupe = svgEl('g');
    // Aplat teinté + liseré net : sur fond noir, un aplat saturé plein écrase
    // tout le reste. Le liseré porte la teinte, l'aplat porte la surface.
    groupe.append(svgEl('rect', {
      x: x0, y: Y_BANDE, width: largeur, height: H_BANDE, rx: 4,
      fill: meta.couleur, 'fill-opacity': 0.2,
      stroke: meta.couleur, 'stroke-opacity': 0.75, 'stroke-width': 1
    }));

    // Étiquette directe, tronquée à la largeur de sa propre bande ; le nom
    // complet reste dans la bulle et dans la table.
    const etiquette = tronquer(phase.nom, largeur - 20, 12);
    if (etiquette) {
      groupe.append(svgEl('text', {
        x: x0 + 10, y: Y_BANDE + H_BANDE / 2 + 4, class: 'viz-nom', 'font-weight': '560',
        'clip-path': decouper(svg, x0, Y_BANDE, largeur, H_BANDE)
      }, document.createTextNode(etiquette)));
    }

    survol(groupe, `<strong>${echapper(phase.nom)}</strong>${meta.icone} ${meta.libelle} · ${hms(phase.t0)} → ${hms(phase.t1)}
      ${phase.commentaire ? `<br>${echapper(phase.commentaire)}` : ''}`);
    svg.append(groupe);
  }

  for (const [i, m] of markers.entries()) {
    const mx = x(m.t);
    const pin = svgEl('g');
    pin.append(
      svgEl('line', { x1: mx, y1: HAUT_PIN, x2: mx, y2: Y_BANDE + H_BANDE, stroke: '#8b7cf0', 'stroke-width': 1, 'stroke-dasharray': '2 3', 'stroke-opacity': 0.75 }),
      svgEl('circle', { cx: mx, cy: HAUT_PIN - 8, r: 8, fill: '#8b7cf0', stroke: SURFACE, 'stroke-width': 2 }),
      svgEl('text', { x: mx, y: HAUT_PIN - 4.5, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': '700', fill: '#0a0a12' },
        document.createTextNode(String(i + 1)))
    );
    survol(pin, `<strong>Point clé ${i + 1} — ${hms(m.t)}</strong>${echapper(m.label || 'Point clé')}${m.note ? `<br>${echapper(m.note)}` : ''}`);
    svg.append(pin);
  }

  const etatsPresents = [...new Set(phases.map((p) => p.etat))]
    .map((e) => ({ couleur: (ETAT_PHASE[e] ?? ETAT_PHASE.fait).couleur, libelle: `${(ETAT_PHASE[e] ?? ETAT_PHASE.fait).icone} ${(ETAT_PHASE[e] ?? ETAT_PHASE.fait).libelle}` }));
  if (markers.length) etatsPresents.push({ couleur: '#8b7cf0', libelle: '◆ Point clé marqué sur le terrain' });

  return figure({
    titre: 'Déroulé de la visite',
    sous: `${phases.length} phase${phases.length > 1 ? 's' : ''} · ${hms(total)} au total${markers.length ? ` · ${markers.length} point(s) clé(s)` : ''}`,
    svg,
    legende: etatsPresents.length > 1 ? legende(etatsPresents) : null,
    table: tableRepli(['Phase', 'Début', 'Fin', 'Durée', 'État'],
      phases.map((p) => [p.nom, hms(p.t0), hms(p.t1), hms(p.t1 - p.t0), (ETAT_PHASE[p.etat] ?? ETAT_PHASE.fait).libelle]))
  });
}

/* ==========================================================================
   2 — Temps de parole
   Une seule série : pas de légende, la valeur est écrite au bout de la barre.
   ========================================================================== */

export function tempsParole(intervenants) {
  const data = intervenants.filter((i) => i.temps_parole_s > 0).sort((a, b) => b.temps_parole_s - a.temps_parole_s);
  if (!data.length) return null;

  const max = Math.max(...data.map((d) => d.temps_parole_s));
  const total = data.reduce((s, d) => s + d.temps_parole_s, 0);
  const H_BARRE = 26, ESPACE = 12, LABEL = 150, VALEUR = 96;
  const W = 920, H = data.length * (H_BARRE + ESPACE);
  const util = W - LABEL - VALEUR;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Temps de parole par intervenant' });

  data.forEach((d, i) => {
    const y = i * (H_BARRE + ESPACE);
    const largeur = Math.max(3, (d.temps_parole_s / max) * util);
    const part = Math.round((d.temps_parole_s / total) * 100);

    svg.append(svgEl('text', { x: 0, y: y + H_BARRE / 2 + 4, class: 'viz-nom' }, document.createTextNode(d.nom)));
    const barre = svgEl('rect', { x: LABEL, y, width: largeur, height: H_BARRE, rx: 4, fill: SERIE[0] });
    survol(barre, `<strong>${echapper(d.nom)}</strong>${d.role ? `${echapper(d.role)}<br>` : ''}${hms(d.temps_parole_s)} — ${part} % du temps de parole`);
    svg.append(barre);
    svg.append(svgEl('text', { x: LABEL + largeur + 10, y: y + H_BARRE / 2 + 4, class: 'viz-valeur' },
      document.createTextNode(`${hms(d.temps_parole_s)} · ${part} %`)));
  });

  return figure({
    titre: 'Temps de parole',
    sous: `${data.length} intervenant${data.length > 1 ? 's' : ''} identifié${data.length > 1 ? 's' : ''}`,
    svg,
    legende: null,
    table: tableRepli(['Intervenant', 'Rôle', 'Temps', 'Part'],
      data.map((d) => [d.nom, d.role || '—', hms(d.temps_parole_s), `${Math.round((d.temps_parole_s / total) * 100)} %`]))
  });
}

/* ==========================================================================
   3 — Arbre des décisions
   Ce qui a été retenu, ce qui a été écarté, et pourquoi. Le trait plein porte
   la branche retenue ; le pointillé les options abandonnées.
   ========================================================================== */

export function arbreDecisions(decisions) {
  const avecChoix = decisions.filter((d) => d.alternatives?.length);
  if (!avecChoix.length) return null;

  const W = 920, X_NOEUD = 18, LARG_NOEUD = 260, X_OPT = 340, H_OPT = 34, ESPACE_OPT = 8, MARGE = 26;
  let y = 12;
  const blocs = avecChoix.map((d) => {
    const hauteur = d.alternatives.length * (H_OPT + ESPACE_OPT) - ESPACE_OPT;
    const bloc = { d, y, hauteur, centre: y + hauteur / 2 };
    y += Math.max(hauteur, 46) + MARGE;
    return bloc;
  });

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${y}`, role: 'img', 'aria-label': 'Arbre des décisions et alternatives' });

  for (const { d, y: y0, centre } of blocs) {
    svg.append(
      svgEl('rect', { x: X_NOEUD, y: centre - 20, width: LARG_NOEUD, height: 40, rx: 8, fill: 'rgba(139,124,240,0.14)', stroke: 'rgba(139,124,240,0.45)' }),
      svgEl('text', { x: X_NOEUD + 14, y: centre + 4, class: 'viz-nom' },
        document.createTextNode(d.intitule.length > 32 ? `${d.intitule.slice(0, 31)}…` : d.intitule))
    );

    d.alternatives.forEach((alt, j) => {
      const yo = y0 + j * (H_OPT + ESPACE_OPT);
      const milieu = yo + H_OPT / 2;
      const depart = X_NOEUD + LARG_NOEUD;

      svg.append(svgEl('path', {
        d: `M ${depart} ${centre} C ${depart + 40} ${centre}, ${X_OPT - 40} ${milieu}, ${X_OPT} ${milieu}`,
        fill: 'none',
        stroke: alt.retenue ? ETAT.bon : '#4a4960',
        'stroke-width': alt.retenue ? 2 : 1,
        'stroke-dasharray': alt.retenue ? null : '3 4'
      }));

      const groupe = svgEl('g');
      groupe.append(
        svgEl('rect', {
          x: X_OPT, y: yo, width: W - X_OPT - 18, height: H_OPT, rx: 6,
          fill: alt.retenue ? 'rgba(12,163,12,0.14)' : 'rgba(255,255,255,0.03)',
          stroke: alt.retenue ? ETAT.bon : 'rgba(255,255,255,0.10)'
        }),
        // Icône + mot : l'état ne repose jamais sur la seule couleur.
        svgEl('text', {
          x: X_OPT + 12, y: milieu + 4, 'font-size': 12,
          fill: alt.retenue ? ETAT.bon : '#71708a', 'font-weight': '700'
        }, document.createTextNode(alt.retenue ? '✓' : '✕')),
        svgEl('text', { x: X_OPT + 30, y: milieu + 4, class: 'viz-nom' },
          document.createTextNode(alt.option.length > 58 ? `${alt.option.slice(0, 57)}…` : alt.option)),
        svgEl('text', { x: W - 26, y: milieu + 4, 'text-anchor': 'end', class: 'viz-axe' },
          document.createTextNode(alt.retenue ? 'Retenue' : 'Écartée'))
      );
      survol(groupe, `<strong>${echapper(alt.option)}</strong>${alt.retenue ? 'Retenue' : 'Écartée'}${alt.motif ? ` — ${echapper(alt.motif)}` : ''}<br>Décision : ${echapper(d.intitule)}`);
      svg.append(groupe);
    });
  }

  return figure({
    titre: 'Choix et alternatives',
    sous: `${avecChoix.length} décision${avecChoix.length > 1 ? 's' : ''} avec options discutées`,
    svg,
    legende: legende([
      { couleur: ETAT.bon, libelle: '✓ Option retenue' },
      { couleur: '#4a4960', libelle: '✕ Option écartée' }
    ]),
    table: tableRepli(['Décision', 'Option', 'Issue', 'Motif'],
      avecChoix.flatMap((d) => d.alternatives.map((a) => [d.intitule, a.option, a.retenue ? 'Retenue' : 'Écartée', a.motif || '—'])))
  });
}

/* ==========================================================================
   4 — Matrice des risques
   Gravité × probabilité. Le fond est une rampe d'une seule teinte : plus le
   risque est fort, plus la cellule s'éclaire au-dessus du noir.
   ========================================================================== */

const RAMPE = ['#184f95', '#1c5cab', '#256abf', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4'];

export function matriceRisques(risques) {
  if (!risques.length) return null;

  const W = 560, MARGE_G = 92, MARGE_H = 18, MARGE_B = 66, MARGE_D = 18;
  const CELL = (W - MARGE_G - MARGE_D) / 4;
  const H = MARGE_H + CELL * 4 + MARGE_B;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Matrice des risques : gravité par probabilité' });

  for (let g = 1; g <= 4; g++) {
    for (let p = 1; p <= 4; p++) {
      const niveau = Math.round(((g * p) / 16) * (RAMPE.length - 1));
      svg.append(svgEl('rect', {
        x: MARGE_G + (p - 1) * CELL + 1,
        y: MARGE_H + (4 - g) * CELL + 1,
        width: CELL - 2, height: CELL - 2, rx: 4,   // 2 px de fond entre cellules
        fill: RAMPE[niveau], 'fill-opacity': 0.26
      }));
    }
  }

  for (let i = 1; i <= 4; i++) {
    svg.append(
      svgEl('text', { x: MARGE_G - 12, y: MARGE_H + (4 - i) * CELL + CELL / 2 + 4, 'text-anchor': 'end', class: 'viz-axe' },
        document.createTextNode(NIVEAU[i])),
      svgEl('text', { x: MARGE_G + (i - 1) * CELL + CELL / 2, y: MARGE_H + CELL * 4 + 20, 'text-anchor': 'middle', class: 'viz-axe' },
        document.createTextNode(NIVEAU[i]))
    );
  }
  svg.append(
    svgEl('text', { x: MARGE_G - 12, y: MARGE_H - 4, 'text-anchor': 'end', class: 'viz-axe', 'font-weight': '600' },
      document.createTextNode('Gravité')),
    svgEl('text', { x: MARGE_G + CELL * 2, y: MARGE_H + CELL * 4 + 44, 'text-anchor': 'middle', class: 'viz-axe', 'font-weight': '600' },
      document.createTextNode('Probabilité →'))
  );

  // Plusieurs risques dans la même case : on les décale en spirale courte
  // plutôt que de les empiler l'un sur l'autre.
  const occupation = new Map();
  risques.forEach((r, i) => {
    const cle = `${r.gravite}:${r.probabilite}`;
    const rang = occupation.get(cle) ?? 0;
    occupation.set(cle, rang + 1);
    const decalage = [[0, 0], [-15, -15], [15, -15], [-15, 15], [15, 15], [0, -26], [0, 26]][rang % 7];

    const cx = MARGE_G + (r.probabilite - 1) * CELL + CELL / 2 + decalage[0];
    const cy = MARGE_H + (4 - r.gravite) * CELL + CELL / 2 + decalage[1];

    const groupe = svgEl('g');
    groupe.append(
      svgEl('circle', { cx, cy, r: 11, fill: '#f3f2fb', stroke: SURFACE, 'stroke-width': 2 }), // anneau de fond : marques superposées lisibles
      svgEl('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': '700', fill: '#0a0a12' },
        document.createTextNode(String(i + 1)))
    );
    survol(groupe, `<strong>${i + 1}. ${echapper(r.intitule)}</strong>Gravité ${NIVEAU[r.gravite]} · probabilité ${NIVEAU[r.probabilite]}${r.mitigation ? `<br>Parade : ${echapper(r.mitigation)}` : ''}`);
    svg.append(groupe);
  });

  const liste = el('ol', { class: 'legende', style: 'list-style:none;padding:0;margin-top:12px' },
    risques.map((r, i) => el('li', { class: 'legende__item' }, [
      el('span', {
        class: 'legende__marque',
        style: 'background:#f3f2fb;color:#0a0a12;border-radius:999px;display:grid;place-items:center;font-size:9px;font-weight:700;width:14px;height:14px',
        text: String(i + 1)
      }),
      el('span', { text: r.intitule })
    ])));

  return figure({
    titre: 'Matrice des risques',
    sous: `${risques.length} risque${risques.length > 1 ? 's' : ''} relevé${risques.length > 1 ? 's' : ''} — le fond s'éclaircit avec la criticité`,
    svg,
    largeurMax: 520,
    legende: liste,
    table: tableRepli(['#', 'Risque', 'Gravité', 'Probabilité', 'Parade'],
      risques.map((r, i) => [i + 1, r.intitule, NIVEAU[r.gravite], NIVEAU[r.probabilite], r.mitigation || '—']))
  });
}

export { el, echapper };
