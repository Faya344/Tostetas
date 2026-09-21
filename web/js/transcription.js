/**
 * Transcription — deux moteurs, un seul format de sortie.
 *
 * « Dictée » écrit pendant que vous parlez (moteur du navigateur, instantané,
 * qualité moyenne). « Whisper » repasse sur l'enregistrement complet à la fin
 * (local, lent au premier lancement, nettement plus juste sur le jargon).
 * Rien n'empêche d'utiliser les deux : la dictée pour suivre en direct, Whisper
 * pour le rendu final.
 */

export const MODELES = {
  rapide:  { id: 'onnx-community/whisper-base',            label: 'Rapide',  poids: '~150 Mo' },
  equilibre:{ id: 'onnx-community/whisper-small',          label: 'Équilibré', poids: '~500 Mo' },
  fidele:  { id: 'onnx-community/whisper-large-v3-turbo',  label: 'Fidèle',  poids: '~1,6 Go' }
};

/** Ramène n'importe quel audio en mono 16 kHz — ce qu'attend Whisper. */
export async function preparerAudio(blob) {
  const brut = await blob.arrayBuffer();
  const contexte = new AudioContext({ sampleRate: 16000 });
  try {
    const decode = await contexte.decodeAudioData(brut);
    if (decode.sampleRate === 16000 && decode.numberOfChannels === 1) {
      return decode.getChannelData(0);
    }
    const hors = new OfflineAudioContext(1, Math.ceil(decode.duration * 16000), 16000);
    const source = hors.createBufferSource();
    source.buffer = decode;
    source.connect(hors.destination);
    source.start();
    return (await hors.startRendering()).getChannelData(0);
  } finally {
    contexte.close();
  }
}

/**
 * Transcrit un enregistrement complet avec Whisper.
 * @param {Blob} blob
 * @param {{modele?:string, langue?:string, onEtat?:(e:object)=>void}} options
 * @returns {Promise<{segments:object[], moteur:string}>}
 */
export function transcrireAvecWhisper(blob, { modele = MODELES.rapide.id, langue = 'fr', onEtat } = {}) {
  return new Promise(async (resolve, reject) => {
    let audio;
    try {
      onEtat?.({ phase: 'preparation', message: 'Décodage de l\'audio…' });
      audio = await preparerAudio(blob);
    } catch (err) {
      return reject(new Error(`Audio illisible : ${err.message}`));
    }

    const worker = new Worker(new URL('./whisper.worker.js', import.meta.url), { type: 'module' });
    const fin = (fn) => (valeur) => { worker.terminate(); fn(valeur); };
    const terminer = fin(resolve);
    const echouer = fin(reject);

    worker.onmessage = ({ data }) => {
      switch (data.type) {
        case 'progres':
          onEtat?.({ phase: 'telechargement', part: data.part, message: `Chargement du modèle — ${Math.round(data.part)} %` });
          break;
        case 'pret':
          onEtat?.({ phase: 'pret', message: `Modèle prêt (${data.moteur === 'webgpu' ? 'GPU' : 'processeur'})` });
          break;
        case 'etape':
        case 'partiel':
          onEtat?.({ phase: 'transcription', message: data.message ?? data.texte });
          break;
        case 'fini':
          terminer({ segments: data.segments, moteur: `whisper:${modele}` });
          break;
        case 'erreur':
          echouer(new Error(data.message));
          break;
      }
    };
    worker.onerror = (event) => echouer(new Error(event.message || 'Worker de transcription interrompu.'));

    // L'audio est transféré, pas copié : pas de doublon en mémoire.
    worker.postMessage({ type: 'transcrire', audio, modele, langue }, [audio.buffer]);
  });
}

/**
 * Dictée en direct via le moteur du navigateur.
 * Les horodatages viennent de l'enregistreur : le moteur, lui, n'en fournit pas.
 */
export class Dictee extends EventTarget {
  constructor(position = () => 0, langue = 'fr-FR') {
    super();
    this.segments = [];
    this.actif = false;
    this._position = position;
    this._langue = langue;
    this._moteur = null;
    this._debutSegment = 0;
  }

  static get disponible() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  demarrer() {
    const Moteur = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Moteur) throw new Error('La dictée directe n\'est pas disponible sur ce navigateur.');

    const moteur = new Moteur();
    moteur.lang = this._langue;
    moteur.continuous = true;
    moteur.interimResults = true;

    moteur.onresult = (event) => {
      let provisoire = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const resultat = event.results[i];
        const texte = resultat[0].transcript.trim();
        if (!texte) continue;
        if (resultat.isFinal) {
          this.segments.push({ t0: this._debutSegment, t1: this._position(), text: texte });
          this._debutSegment = this._position();
          this.dispatchEvent(new CustomEvent('segment', { detail: { segments: [...this.segments] } }));
        } else {
          provisoire += `${texte} `;
        }
      }
      if (provisoire) this.dispatchEvent(new CustomEvent('provisoire', { detail: { texte: provisoire.trim() } }));
    };

    // Le moteur s'arrête tout seul après un silence : on le relance tant qu'on enregistre.
    moteur.onend = () => { if (this.actif) { try { moteur.start(); } catch { /* relance trop rapide */ } } };
    moteur.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        this.dispatchEvent(new CustomEvent('probleme', { detail: { message: `Dictée : ${event.error}` } }));
      }
    };

    this._moteur = moteur;
    this.actif = true;
    this._debutSegment = this._position();
    moteur.start();
  }

  arreter() {
    this.actif = false;
    try { this._moteur?.stop(); } catch { /* déjà arrêté */ }
    return [...this.segments];
  }
}
