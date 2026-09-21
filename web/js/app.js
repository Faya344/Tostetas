/**
 * Plodo — orchestration de l'interface.
 *
 * Le fil conducteur : appuyer sur un seul bouton doit suffire. Tout ce qui
 * suit — sauvegarde, transcription, synthèse, indexation — s'enchaîne sans
 * qu'on ait à y penser, et chaque étape dit où elle en est.
 */

import { api } from './api.js';
import { Enregistreur } from './enregistreur.js';
import { Declencheurs } from './declencheurs.js';
import { Dictee, MODELES, transcrireAvecWhisper } from './transcription.js';
import { markdown } from './markdown.js';
import * as viz from './viz.js';
import { enAttente, recuperer, vider } from './coffre.js';

const $ = (sel, racine = document) => racine.querySelector(sel);
const $$ = (sel, racine = document) => [...racine.querySelectorAll(sel)];
const el = viz.el;

/* ------------------------------------------------------------------- état */

const reglages = {
  moteur: 'les-deux',
  modele: MODELES.rapide.id,
  langue: 'fr',
  ...JSON.parse(localStorage.getItem('plodo:reglages') || '{}')
};
const sauverReglages = () => localStorage.setItem('plodo:reglages', JSON.stringify(reglages));

const etat = {
  vue: 'studio',
  visites: [],
  visiteId: null,
  visite: null,
  claude: { ok: false },
  rag: null
};

let veille = false;

const enregistreur = new Enregistreur();
const declencheurs = new Declencheurs();
let dictee = null;

/* ----------------------------------------------------------------- toasts */

function toast(message, ton = 'info', duree = 5200) {
  const noeud = el('div', { class: `toast toast--${ton}`, text: message });
  $('#toasts').append(noeud);
  setTimeout(() => {
    noeud.style.opacity = '0';
    setTimeout(() => noeud.remove(), 220);
  }, duree);
}

/* ------------------------------------------------------------ navigation */

function aller(vue) {
  etat.vue = vue;
  $$('.vue').forEach((section) => { section.hidden = section.id !== `vue-${vue}`; });
  $$('.nav__lien').forEach((lien) => {
    if (lien.dataset.vue === vue) lien.setAttribute('aria-current', 'page');
    else lien.removeAttribute('aria-current');
  });
}

$$('.nav__lien').forEach((lien) => lien.addEventListener('click', () => aller(lien.dataset.vue)));

/* -------------------------------------------------------------- l'onde --- */

const ondeSvg = $('#onde');
const BARRES = 64;
const historique = new Array(BARRES).fill(0);

function dessinerOnde() {
  const largeur = 460 / BARRES;
  ondeSvg.replaceChildren(...historique.map((niveau, i) => {
    const hauteur = Math.max(2, niveau * 58);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(i * largeur + 1));
    rect.setAttribute('y', String((64 - hauteur) / 2));
    rect.setAttribute('width', String(largeur - 2));
    rect.setAttribute('height', String(hauteur));
    rect.setAttribute('rx', '1.5');
    // La barre la plus récente est la plus vive : l'œil suit le bord droit.
    rect.setAttribute('fill', i > BARRES - 6 ? 'var(--quartz-300)' : 'var(--quartz-600)');
    rect.setAttribute('fill-opacity', String(0.25 + (i / BARRES) * 0.75));
    return rect;
  }));
}
dessinerOnde();

/* ------------------------------------------------------- studio : rendu -- */

function majChrono(secondes) {
  $('#chrono').textContent = viz.hms(secondes);
  $('#chrono').classList.toggle('chrono--repos', enregistreur.etat === 'repos');
}

const LIBELLE_ETAT = { repos: 'Au repos', enregistre: 'Enregistrement', pause: 'En pause' };

function majEtatRec() {
  const e = enregistreur.etat;
  $('#etat-rec').dataset.etat = e;
  $('#etat-rec-texte').textContent = LIBELLE_ETAT[e];
  $('#btn-rec').dataset.actif = String(e !== 'repos');
  $('#btn-rec').setAttribute('aria-label', e === 'repos' ? "Démarrer l'enregistrement" : "Arrêter l'enregistrement");
  $('#btn-clef').disabled = e === 'repos';
  $('#btn-pause').disabled = e === 'repos';
  $('#btn-veille').disabled = e === 'repos';
  $('#btn-pause').textContent = e === 'pause' ? 'Reprendre' : 'Pause';
  $('#ch-titre').disabled = $('#ch-site').disabled = e !== 'repos';
}

function majClefs(markers) {
  const hote = $('#clefs');
  $('#compte-clefs').textContent = String(markers.length);
  $('#clefs-vide').hidden = markers.length > 0;

  hote.replaceChildren(...markers.map((m, i) => {
    const supprimer = el('button', { class: 'clef__sup', 'aria-label': `Supprimer le point clé ${i + 1}` },
      el('span', { text: '×', style: 'font-size:16px;line-height:1' }));
    supprimer.addEventListener('click', () => enregistreur.supprimerMarqueur(i));
    return el('div', { class: 'clef' }, [
      el('span', { class: 'clef__t', text: viz.hms(m.t) }),
      el('span', { class: 'clef__label', text: m.label }),
      supprimer
    ]);
  }));
}

/* ------------------------------------------------- studio : le cœur ------ */

async function demarrer() {
  try {
    const visite = await api.creerVisite({
      titre: $('#ch-titre').value.trim(),
      site: $('#ch-site').value.trim()
    });
    etat.visiteId = visite.id;

    await enregistreur.demarrer(visite.id);
    declencheurs.annoncerMedia({ titre: visite.titre, actif: true, discret: veille });

    if (reglages.moteur === 'dictee' || reglages.moteur === 'les-deux') {
      lancerDictee();
    }
    toast('Enregistrement lancé. Posez vos points clés avec K ou le bouton.', 'ok');
    await rafraichirListe();
  } catch (err) {
    toast(`Impossible de démarrer : ${err.message}`, 'ko', 8000);
  }
}

function lancerDictee() {
  if (!Dictee.disponible) {
    if (reglages.moteur === 'dictee') toast('La dictée directe n\'existe pas sur ce navigateur — Whisper prendra le relais.', 'ko');
    return;
  }
  dictee = new Dictee(() => enregistreur.position, `${reglages.langue}-FR`);
  $('#bloc-direct').hidden = false;
  $('#direct').replaceChildren();

  dictee.addEventListener('segment', ({ detail }) => rendreDirect(detail.segments, ''));
  dictee.addEventListener('provisoire', ({ detail }) => rendreDirect(dictee.segments, detail.texte));
  dictee.addEventListener('probleme', ({ detail }) => toast(detail.message, 'ko'));
  try { dictee.demarrer(); } catch (err) { toast(err.message, 'ko'); }
}

function rendreDirect(segments, provisoire) {
  const hote = $('#direct');
  hote.replaceChildren(...segments.slice(-40).map((s) =>
    el('div', { class: 'ligne-v' }, [
      el('span', { class: 'ligne-v__t', text: viz.hms(s.t0) }),
      el('span', { class: 'ligne-v__texte', text: s.text })
    ])));
  if (provisoire) {
    hote.append(el('div', { class: 'ligne-v' }, [
      el('span', { class: 'ligne-v__t', text: '…' }),
      el('span', { class: 'ligne-v__texte', text: provisoire, style: 'opacity:.55' })
    ]));
  }
  hote.scrollTop = hote.scrollHeight;
}

function etape(message, part = null) {
  $('#bloc-traitement').hidden = false;
  $('#traitement-etat').textContent = message;
  if (part !== null) $('#traitement-jauge').style.width = `${Math.round(part)}%`;
}

function detailEtape(texte) {
  $('#traitement-detail').textContent = texte ?? '';
}

async function arreter() {
  const visiteId = etat.visiteId;
  const segmentsDictes = dictee ? dictee.arreter() : [];
  dictee = null;

  const resultat = await enregistreur.arreter();
  declencheurs.annoncerMedia({ titre: 'Plodo', actif: false });
  if (veille) basculerVeille(false);
  majEtatRec();
  if (!resultat) return;

  const { blob, duree, markers } = resultat;

  try {
    etape('Sauvegarde de l\'audio…', 10);
    detailEtape(`${(blob.size / 1e6).toFixed(1)} Mo · ${viz.hms(duree)}`);
    await api.envoyerAudio(visiteId, blob);
    await api.majVisite(visiteId, { duree: Math.round(duree), markers });
    await enregistreur.purger(visiteId);

    let segments = segmentsDictes;
    const veutWhisper = reglages.moteur === 'whisper' || reglages.moteur === 'les-deux';

    if (veutWhisper) {
      etape('Transcription locale…', 25);
      const sortie = await transcrireAvecWhisper(blob, {
        modele: reglages.modele,
        langue: reglages.langue,
        onEtat: ({ phase, part, message }) => {
          detailEtape(message);
          if (phase === 'telechargement') etape('Chargement du modèle…', 25 + (part ?? 0) * 0.35);
          else if (phase === 'transcription') etape('Transcription locale…', 62);
        }
      });
      segments = sortie.segments;
    }

    if (!segments.length) {
      etape('Enregistrement conservé — pas de transcription.', 100);
      detailEtape('Vous pouvez saisir le texte depuis la fiche de la visite.');
      toast('Audio sauvegardé. Aucune transcription produite.', 'ko');
    } else {
      etape('Indexation…', 80);
      await api.enregistrerTranscription(visiteId, {
        segments,
        moteur: veutWhisper ? reglages.modele : 'dictee-navigateur',
        langue: reglages.langue
      });

      if (etat.claude.ok) {
        etape('Synthèse par Claude…', 88);
        detailEtape('Lecture de la transcription, repérage des phases, des décisions et des risques.');
        await api.synthetiser(visiteId);
        etape('Terminé.', 100);
        toast('Synthèse prête.', 'ok');
      } else {
        etape('Transcription indexée — synthèse en attente.', 100);
        detailEtape('Claude Code n\'est pas joignable : la demande attend dans data/outbox.');
      }
    }

    await rafraichirListe();
    await ouvrirVisite(visiteId);
  } catch (err) {
    etape('Interrompu.', 100);
    detailEtape(err.message);
    toast(`Traitement interrompu : ${err.message}`, 'ko', 9000);
    await rafraichirListe();
  }
}

/* ------------------------------------------------------- fiche de visite - */

const LIB_STATUT = { actee: 'Actée', a_valider: 'À valider', rejetee: 'Rejetée' };
const COUL_STATUT = { actee: viz.ETAT.bon, a_valider: viz.ETAT.attention, rejetee: 'var(--encre-4)' };
const COUL_PRIORITE = { haute: viz.ETAT.critique, moyenne: viz.ETAT.attention, basse: 'var(--encre-4)' };

async function ouvrirVisite(id) {
  aller('visite');
  const hote = $('#visite-contenu');
  hote.replaceChildren(el('div', { class: 'panneau', text: 'Chargement…' }));

  const visite = await api.lireVisite(id);
  etat.visite = visite;
  etat.visiteId = id;
  majListe();
  hote.replaceChildren(...rendreVisite(visite));
}

function rendreVisite(visite) {
  const s = visite.synthese;
  const blocs = [];

  /* En-tête */
  // Une visite qui arrive de l'application Android n'a que l'audio : ni
  // transcription, ni synthèse. C'est le seul cas où ce bouton apparaît —
  // sans lui, une visite synchronisée depuis le téléphone reste bloquée,
  // « Synthétiser » restant grisé faute de transcript à lire.
  const actionsListe = [];
  if (visite.audio && !visite.transcript?.segments?.length) {
    actionsListe.push(boutonAction('Transcrire (Whisper local)', 'bouton--fantome', async (bouton) => {
      bouton.disabled = true;
      const texteInitial = bouton.textContent;
      try {
        bouton.textContent = 'Récupération de l\'audio…';
        const reponse = await fetch(visite.audio.url);
        if (!reponse.ok) throw new Error(`Audio illisible (${reponse.status}).`);
        const blob = await reponse.blob();

        const { segments } = await transcrireAvecWhisper(blob, {
          modele: reglages.modele,
          langue: reglages.langue,
          onEtat: ({ message }) => { if (message) bouton.textContent = message; }
        });
        if (!segments.length) throw new Error('Aucune parole détectée dans cet enregistrement.');

        await api.enregistrerTranscription(visite.id, {
          segments, moteur: `whisper:${reglages.modele}`, langue: reglages.langue
        });
        toast('Transcription terminée. Vous pouvez lancer la synthèse.', 'ok');
        await ouvrirVisite(visite.id);
      } catch (err) {
        toast(`Transcription impossible : ${err.message}`, 'ko', 9000);
        bouton.disabled = false;
        bouton.textContent = texteInitial;
      }
    }));
  }
  actionsListe.push(
    boutonAction('Synthétiser', 'bouton--quartz', async (bouton) => {
      bouton.disabled = true;
      bouton.textContent = 'Claude lit la visite…';
      try {
        await api.synthetiser(visite.id);
        toast('Synthèse mise à jour.', 'ok');
        await ouvrirVisite(visite.id);
      } catch (err) {
        toast(err.details?.repli
          ? `${err.message} Ouvrez une session Claude Code dans le dossier pour la traiter.`
          : `Synthèse impossible : ${err.message}`, 'ko', 10000);
        bouton.disabled = false;
        bouton.textContent = 'Synthétiser';
      }
    }, !visite.transcript?.segments?.length),
    boutonLien('Exporter (.md)', `/api/visites/${visite.id}/export`),
    boutonAction('Supprimer', 'bouton--danger', async () => {
      if (!confirm('Supprimer définitivement cette visite, son audio et sa transcription ?')) return;
      await api.supprimerVisite(visite.id);
      toast('Visite supprimée.');
      etat.visiteId = null;
      await rafraichirListe();
      aller('studio');
    })
  );
  const actions = el('div', { class: 'rang rang--fin' }, actionsListe);

  blocs.push(el('header', { class: 'entete' }, [
    el('div', { class: 'entete__sur', text: [visite.site, visite.date].filter(Boolean).join(' · ') || 'Visite' }),
    el('h2', { text: s?.titre || visite.titre }),
    el('p', { class: 'entete__note', text: `${viz.hms(visite.duree)} · ${visite.markers?.length ?? 0} point(s) clé(s) · ${visite.transcript?.segments?.length ?? 0} segment(s)` }),
    actions
  ]));

  /* Lecteur audio — la copie du vocal, toujours accessible */
  if (visite.audio) {
    const lecteur = el('audio', { controls: '', preload: 'metadata', style: 'width:100%' });
    lecteur.src = visite.audio.url;
    etat.lecteur = lecteur;

    const sauts = el('div', { class: 'rang', style: 'margin-top:var(--e3)' },
      (visite.markers ?? []).map((m, i) => {
        const bouton = el('button', { class: 'bouton bouton--fantome', text: `${i + 1}. ${viz.hms(m.t)}` });
        bouton.addEventListener('click', () => { lecteur.currentTime = m.t; lecteur.play(); });
        return bouton;
      }));

    blocs.push(el('section', { class: 'panneau', style: 'margin-bottom:var(--e5)' }, [
      el('div', { class: 'panneau__entete' }, [
        el('h3', { class: 'panneau__titre', text: 'Enregistrement' }),
        el('span', { class: 'panneau__sous', text: `${(visite.audio.octets / 1e6).toFixed(1)} Mo` })
      ]),
      lecteur,
      sauts
    ]));
  }

  if (!s) {
    blocs.push(el('div', { class: 'panneau' }, el('div', { class: 'vide' },
      el('span', { text: visite.transcript?.segments?.length
        ? 'Transcription prête. Lancez la synthèse pour obtenir le compte rendu et les graphiques.'
        : visite.audio
          ? 'Pas encore de transcription. Cliquez sur « Transcrire » ci-dessus — le calcul se fait ici, dans ce navigateur.'
          : 'Pas encore de transcription pour cette visite.' }))));
    if (visite.transcript?.segments?.length) blocs.push(blocVerbatim(visite));
    return blocs;
  }

  /* Chiffres */
  blocs.push(viz.tuiles([
    { label: 'Durée', valeur: viz.hms(visite.duree) },
    { label: 'Décisions', valeur: s.decisions.length, note: `${s.decisions.filter((d) => d.statut === 'actee').length} actée(s)` },
    { label: 'Actions', valeur: s.actions.length, note: `${s.actions.filter((a) => a.priorite === 'haute').length} prioritaire(s)` },
    { label: 'Risques', valeur: s.risques.length, note: `${s.risques.filter((r) => r.gravite >= 3).length} à gravité élevée` },
    { label: 'Points clés', valeur: visite.markers?.length ?? 0 }
  ]));

  /* Résumé */
  blocs.push(el('section', { class: 'panneau', style: 'margin-top:var(--e5)' }, [
    el('div', { class: 'panneau__entete' }, [
      el('h3', { class: 'panneau__titre', text: 'Compte rendu' }),
      el('span', { class: 'panneau__sous', text: `Généré le ${new Date(s.genereLe).toLocaleString('fr-FR')}` })
    ]),
    el('div', { class: 'prose', html: markdown(s.resume) }),
    s.points_saillants.length
      ? el('div', { style: 'margin-top:var(--e4)' }, [
          el('div', { class: 'label', text: 'Points saillants' }),
          el('ul', { class: 'prose' }, s.points_saillants.map((p) => el('li', { text: p })))
        ])
      : null
  ]));

  /* Graphiques */
  const figures = [
    s.phases.length ? viz.chronologie(s.phases, visite.markers ?? [], visite.duree) : null,
    s.decisions.length ? viz.arbreDecisions(s.decisions) : null,
    s.risques.length ? viz.matriceRisques(s.risques) : null,
    s.intervenants.length ? viz.tempsParole(s.intervenants) : null
  ].filter(Boolean);

  for (const figure of figures) {
    blocs.push(el('section', { class: 'panneau', style: 'margin-top:var(--e5)' }, figure));
  }

  /* Décisions détaillées */
  if (s.decisions.length) {
    blocs.push(el('section', { class: 'panneau', style: 'margin-top:var(--e5)' }, [
      el('div', { class: 'panneau__entete' }, el('h3', { class: 'panneau__titre', text: 'Décisions' })),
      el('div', {}, s.decisions.map((d) => el('div', { class: 'fiche' }, [
        el('div', { class: 'fiche__titre', text: d.intitule }),
        el('div', { class: 'fiche__meta' }, [
          jeton(LIB_STATUT[d.statut], COUL_STATUT[d.statut]),
          d.responsable ? el('span', { text: d.responsable }) : null,
          boutonTemps(d.t)
        ]),
        d.justification ? el('div', { class: 'fiche__corps', text: d.justification }) : null
      ])))
    ]));
  }

  /* Actions */
  if (s.actions.length) {
    blocs.push(el('section', { class: 'panneau', style: 'margin-top:var(--e5)' }, [
      el('div', { class: 'panneau__entete' }, [
        el('h3', { class: 'panneau__titre', text: 'À faire' }),
        el('span', { class: 'panneau__sous', text: `${s.actions.length} action(s)` })
      ]),
      el('div', {}, s.actions.map((a, i) => {
        const case_ = el('input', { type: 'checkbox', id: `act-${i}` });
        case_.checked = Boolean(a.fait);
        case_.addEventListener('change', async () => {
          a.fait = case_.checked;
          ligne.style.opacity = case_.checked ? '0.5' : '1';
        });
        const ligne = el('div', { class: 'fiche', style: 'display:flex;gap:var(--e3);align-items:flex-start' }, [
          case_,
          el('div', { style: 'flex:1' }, [
            el('label', { class: 'fiche__titre', for: `act-${i}`, text: a.intitule }),
            el('div', { class: 'fiche__meta' }, [
              jeton(a.priorite, COUL_PRIORITE[a.priorite]),
              a.responsable ? el('span', { text: `→ ${a.responsable}` }) : null,
              a.echeance ? el('span', { text: `échéance ${a.echeance}` }) : null,
              boutonTemps(a.t)
            ])
          ])
        ]);
        return ligne;
      }))
    ]));
  }

  /* Mesures & questions */
  const colonnes = [];
  if (s.mesures.length) {
    colonnes.push(el('section', { class: 'panneau' }, [
      el('div', { class: 'panneau__entete' }, el('h3', { class: 'panneau__titre', text: 'Mesures relevées' })),
      el('div', {}, s.mesures.map((m) => el('div', { class: 'clef' }, [
        el('span', { class: 'clef__t', text: viz.hms(m.t) }),
        el('span', { class: 'clef__label', text: m.libelle }),
        el('strong', { text: `${m.valeur} ${m.unite}` })
      ])))
    ]));
  }
  if (s.questions_ouvertes.length) {
    colonnes.push(el('section', { class: 'panneau' }, [
      el('div', { class: 'panneau__entete' }, el('h3', { class: 'panneau__titre', text: 'À confirmer' })),
      el('ul', { class: 'prose' }, s.questions_ouvertes.map((q) => el('li', { text: q })))
    ]));
  }
  if (colonnes.length) {
    blocs.push(el('div', { class: 'grille grille--2', style: 'margin-top:var(--e5)' }, colonnes));
  }

  if (visite.transcript?.segments?.length) blocs.push(blocVerbatim(visite));
  return blocs;
}

function blocVerbatim(visite) {
  const markers = visite.markers ?? [];
  const lignes = visite.transcript.segments.map((seg) => {
    const estClef = markers.some((m) => m.t >= seg.t0 - 2 && m.t <= seg.t1 + 2);
    const ligne = el('div', { class: 'ligne-v', 'data-clef': String(estClef) }, [
      el('span', { class: 'ligne-v__t', text: viz.hms(seg.t0) }),
      el('span', { class: 'ligne-v__texte' }, [
        seg.speaker ? el('span', { class: 'ligne-v__qui', text: `${seg.speaker} :` }) : null,
        el('span', { text: seg.text })
      ])
    ]);
    ligne.addEventListener('click', () => allerA(seg.t0));
    return ligne;
  });

  return el('section', { class: 'panneau', style: 'margin-top:var(--e5)' }, [
    el('div', { class: 'panneau__entete' }, [
      el('h3', { class: 'panneau__titre', text: 'Transcription' }),
      el('span', { class: 'panneau__sous', text: `${visite.transcript.segments.length} segments · ${visite.transcript.moteur}` })
    ]),
    el('div', { class: 'verbatim' }, lignes)
  ]);
}

function allerA(secondes) {
  if (!etat.lecteur) return;
  etat.lecteur.currentTime = secondes;
  etat.lecteur.play().catch(() => { /* lecture refusée sans geste utilisateur */ });
  etat.lecteur.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function boutonTemps(t) {
  const bouton = el('button', { class: 'bouton bouton--fantome', style: 'padding:1px 8px;font-size:var(--t-xs)', text: `▶ ${viz.hms(t)}` });
  bouton.addEventListener('click', () => allerA(t));
  return bouton;
}

function jeton(texte, couleur) {
  return el('span', { class: 'jeton' }, [
    el('span', { class: 'jeton__point', style: `background:${couleur}` }),
    el('span', { text: texte })
  ]);
}

function boutonAction(texte, classe, action, desactive = false) {
  const bouton = el('button', { class: `bouton ${classe}`, text: texte });
  bouton.disabled = desactive;
  bouton.addEventListener('click', () => action(bouton));
  return bouton;
}

function boutonLien(texte, href) {
  return el('a', { class: 'bouton', href, download: '', text: texte });
}

/* ------------------------------------------------------------- mémoire --- */

$('#form-memoire').addEventListener('submit', async (event) => {
  event.preventDefault();
  await interroger(true);
});
$('#btn-extraits').addEventListener('click', () => interroger(false));

async function interroger(avecClaude) {
  const question = $('#ch-question').value.trim();
  if (!question) return;
  const hote = $('#memoire-resultat');
  hote.replaceChildren(el('div', { class: 'panneau' }, [
    el('span', { class: 'chargement' }),
    el('span', { text: avecClaude ? '  Claude lit vos visites…' : '  Recherche…', style: 'margin-left:8px' })
  ]));

  try {
    const resultat = avecClaude ? await api.interroger(question) : await api.rechercher(question);
    const blocs = [];

    if (resultat.reponse) {
      blocs.push(el('section', { class: 'panneau' }, [
        el('div', { class: 'panneau__entete' }, el('h3', { class: 'panneau__titre', text: 'Réponse' })),
        el('div', { class: 'prose', html: markdown(resultat.reponse) })
      ]));
    }

    const passages = resultat.passages ?? [];
    blocs.push(el('section', { class: 'panneau', style: 'margin-top:var(--e5)' }, [
      el('div', { class: 'panneau__entete' }, [
        el('h3', { class: 'panneau__titre', text: 'Extraits retenus' }),
        el('span', { class: 'panneau__sous', text: `${passages.length} passage(s)` })
      ]),
      passages.length
        ? el('div', {}, passages.map((p, i) => {
            const fiche = el('div', { class: 'fiche' }, [
              el('div', { class: 'fiche__titre', text: `[S${i + 1}] ${p.citation}` }),
              el('div', { class: 'fiche__meta' }, [
                el('span', { text: p.sources.join(' + ') }),
                p.markers?.length ? jeton('point clé', 'var(--quartz-500)') : null
              ]),
              el('div', { class: 'fiche__corps', text: p.text })
            ]);
            fiche.style.cursor = 'pointer';
            fiche.addEventListener('click', () => ouvrirVisite(p.visiteId));
            return fiche;
          }))
        : el('div', { class: 'vide', text: 'Rien trouvé. Essayez d\'autres mots, ou reconstruisez l\'index.' })
    ]));

    hote.replaceChildren(...blocs);
  } catch (err) {
    hote.replaceChildren(el('div', { class: 'panneau' },
      el('div', { class: 'vide', text: err.details?.repli
        ? `${err.message} La question attend dans data/outbox.`
        : err.message })));
  }
}

/* ------------------------------------------------------------ réglages --- */

const selModele = $('#ch-modele');
selModele.replaceChildren(...Object.values(MODELES).map((m) =>
  el('option', { value: m.id, text: `${m.label} — ${m.poids}` })));

$('#ch-moteur').value = reglages.moteur;
selModele.value = reglages.modele;
$('#ch-langue').value = reglages.langue;

$('#ch-moteur').addEventListener('change', (e) => { reglages.moteur = e.target.value; sauverReglages(); });
selModele.addEventListener('change', (e) => { reglages.modele = e.target.value; sauverReglages(); });
$('#ch-langue').addEventListener('change', (e) => { reglages.langue = e.target.value; sauverReglages(); });

$('#btn-hid').addEventListener('click', async () => {
  try {
    const nom = await declencheurs.appairerHid();
    if (nom) toast(`Boîtier appairé : ${nom}`, 'ok');
  } catch (err) {
    toast(err.message, 'ko');
  }
});

$('#btn-test-clef').addEventListener('click', () => {
  signalerPointClef('test');
  toast('Déclenchement reçu. Le même geste posera un repère pendant l\'enregistrement.', 'ok');
});

$('#btn-reindex').addEventListener('click', async (event) => {
  event.target.disabled = true;
  try {
    const meta = await api.reindexer();
    etat.rag = meta;
    majSondes();
    toast(`Index reconstruit : ${meta.chunks} passages.`, 'ok');
  } finally {
    event.target.disabled = false;
  }
});

/* ------------------------------------------------------------- sondes ---- */

function majSondes() {
  const claude = $('#sonde-claude');
  claude.className = `sonde ${etat.claude.ok ? 'sonde--ok' : 'sonde--ko'}`;
  claude.lastElementChild.textContent = etat.claude.ok
    ? `Claude Code ${etat.claude.version ?? ''}`.trim()
    : 'Claude Code absent';

  const copie = $('#sonde-claude-2');
  copie.className = claude.className;
  copie.lastElementChild.textContent = etat.claude.ok
    ? 'Synthèses via votre abonnement Claude Code — aucun jeton API.'
    : 'CLI « claude » introuvable : les demandes attendent dans data/outbox.';

  const rag = $('#sonde-rag');
  rag.className = `sonde ${etat.rag?.chunks ? 'sonde--ok' : ''}`;
  rag.lastElementChild.textContent = etat.rag
    ? `${etat.rag.chunks} passages${etat.rag.dense ? ' · dense' : ''}`
    : 'Index vide';

  $('#info-rag').textContent = etat.rag
    ? `${etat.rag.chunks} passages issus de ${etat.rag.visites} visite(s). ` +
      `Recherche ${etat.rag.dense ? 'hybride (lexicale + vectorielle)' : 'lexicale BM25'}.`
    : 'Index non construit.';

  const sources = declencheurs.actives;
  for (const id of ['#sonde-declencheurs', '#sonde-sources']) {
    const noeud = $(id);
    if (noeud) noeud.lastElementChild.textContent = sources.join(' · ');
  }
}

/* --------------------------------------------------------- liste visites - */

function majListe() {
  const hote = $('#liste-visites');
  hote.replaceChildren(...etat.visites.map((v) => {
    const bouton = el('button', {
      class: 'visite-item',
      'aria-current': String(v.id === etat.visiteId)
    }, [
      el('div', { class: 'visite-item__titre', text: v.titreSynthese || v.titre }),
      el('div', { class: 'visite-item__meta' }, [
        el('span', { class: `pastille pastille--${v.statut}` }),
        el('span', { text: v.date }),
        el('span', { text: viz.hms(v.duree) })
      ])
    ]);
    bouton.addEventListener('click', () => ouvrirVisite(v.id));
    return bouton;
  }));

  if (!etat.visites.length) {
    hote.replaceChildren(el('div', { class: 'vide', style: 'padding:var(--e4)', text: 'Aucune visite.' }));
  }
}

async function rafraichirListe() {
  const state = await api.etat();
  etat.visites = state.visites;
  etat.claude = state.claude;
  etat.rag = state.rag;
  majListe();
  majSondes();
}

/* ------------------------------------------------------- déclenchements -- */

function signalerPointClef(source = 'bouton') {
  const bouton = $('#btn-clef');
  bouton.classList.remove('pulse');
  void bouton.offsetWidth; // force le redémarrage de l'animation
  bouton.classList.add('pulse');

  if (enregistreur.etat === 'repos') return;
  const marker = enregistreur.marquer(`Point clé ${enregistreur.markers.length + 1}`);
  if (marker) {
    // Un retour physique : l'écran est peut-être dans la poche.
    navigator.vibrate?.([18, 40, 18]);
    majVeille();
    // En veille, la vibration est le seul retour : un bandeau rallumerait l'écran.
    if (!veille) toast(`Repère posé à ${viz.hms(marker.t)}${source !== 'bouton' ? ` (${source})` : ''}.`);
  }
}

/**
 * Mode discrétion.
 *
 * L'écran passe au noir, l'horodatage reste lisible à bout de bras, et toute la
 * surface devient le bouton « point clé ». On ne demande volontairement aucun
 * verrou d'écran : le but est justement que l'écran s'éteigne tout seul.
 *
 * Limite à connaître : un navigateur n'est pas maître de son sort. Android
 * suspend un onglet dont l'écran est éteint, et la capture finit par caler —
 * c'est le système qui décide, pas la page. Pour une visite entière téléphone
 * en poche, c'est l'application Android qui tient la promesse, parce qu'elle
 * dispose d'un service au premier plan que le navigateur n'a pas.
 */
function basculerVeille(actif) {
  veille = actif;
  $('#veille').hidden = !actif;
  $('#btn-veille').textContent = actif ? 'Quitter la veille' : 'Mode discrétion';
  if (enregistreur.etat !== 'repos') {
    declencheurs.annoncerMedia({ titre: etat.visite?.titre ?? 'Plodo', actif: true, discret: actif });
  }
  if (actif) majVeille();
}

function majVeille() {
  if (!veille) return;
  const n = enregistreur.markers.length;
  $('#veille-chrono').textContent = viz.hms(enregistreur.position);
  $('#veille-clefs').textContent = `${n} point${n > 1 ? 's' : ''} clé${n > 1 ? 's' : ''}`;
}

$('#btn-veille').addEventListener('click', () => basculerVeille(!veille));
$('#veille-sortie').addEventListener('click', () => basculerVeille(false));
$('#veille-cible').addEventListener('click', () => signalerPointClef('veille'));

async function basculer() {
  if (enregistreur.etat === 'repos') await demarrer();
  else await arreter();
}

$('#btn-rec').addEventListener('click', basculer);
$('#btn-clef').addEventListener('click', () => signalerPointClef('bouton'));
$('#btn-pause').addEventListener('click', () => {
  if (enregistreur.etat === 'enregistre') enregistreur.pause();
  else enregistreur.reprendre();
  majEtatRec();
});

declencheurs.addEventListener('action', ({ detail }) => {
  if (detail.action === 'marqueur') signalerPointClef(detail.source);
  else if (detail.action === 'bascule') basculer();
  else if (detail.action === 'arret' && enregistreur.etat !== 'repos') arreter();
});
declencheurs.addEventListener('source', majSondes);

enregistreur.addEventListener('etat', majEtatRec);
enregistreur.addEventListener('marqueur', ({ detail }) => majClefs(detail.markers));
enregistreur.addEventListener('probleme', ({ detail }) => toast(detail.message, 'ko'));
enregistreur.addEventListener('niveau', ({ detail }) => {
  historique.push(detail.niveau);
  historique.shift();
  if (!veille) dessinerOnde();   // inutile de dessiner ce que personne ne regarde
  majChrono(detail.position);
  majVeille();
});

// Fermer l'onglet en plein enregistrement doit coûter un avertissement.
addEventListener('beforeunload', (event) => {
  if (enregistreur.etat !== 'repos') {
    event.preventDefault();
    event.returnValue = '';
  }
});

/* -------------------------------------------------------- récupération --- */

async function proposerReprise() {
  const restes = await enAttente().catch(() => []);
  for (const reste of restes) {
    if (reste.visiteId === etat.visiteId) continue;
    const visite = etat.visites.find((v) => v.id === reste.visiteId);
    // Si l'audio est déjà remonté, le coffre n'a plus de raison d'être.
    if (!visite) { await vider(reste.visiteId); continue; }

    toast(`Un enregistrement interrompu de ${(reste.octets / 1e6).toFixed(1)} Mo a été retrouvé.`, 'ko', 12000);
    const blob = new Blob(await recuperer(reste.visiteId), { type: 'audio/webm' });
    try {
      await api.envoyerAudio(reste.visiteId, blob);
      await vider(reste.visiteId);
      toast('Enregistrement récupéré et sauvegardé.', 'ok');
    } catch (err) {
      toast(`Récupération impossible : ${err.message}`, 'ko');
    }
  }
}

/* ------------------------------------------------------------- démarrage - */

declencheurs.brancherClavier();
declencheurs.brancherMedia();
declencheurs.brancherGamepad();

majEtatRec();
majClefs([]);
await rafraichirListe();
await proposerReprise();

if (etat.visites.length && !etat.visiteId) {
  // On ouvre la dernière visite en arrière-plan : la vue Synthèse est prête
  // si l'utilisateur y va, sans lui imposer au démarrage.
  etat.visiteId = etat.visites[0].id;
  majListe();
}
