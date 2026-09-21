/**
 * Enregistreur : micro → MediaRecorder → coffre local.
 *
 * Trois exigences de terrain ont dicté la forme :
 * 1. on doit voir que ça capte (niveau d'entrée en direct) ;
 * 2. on doit pouvoir poser un repère sans regarder l'écran ;
 * 3. rien ne doit se perdre si l'appareil décroche — d'où le dépôt des
 *    morceaux dans le coffre toutes les cinq secondes.
 */

import { deposer, recuperer, vider } from './coffre.js';

const TRANCHE_MS = 5000;

export class Enregistreur extends EventTarget {
  constructor() {
    super();
    this.etat = 'repos';           // repos | enregistre | pause
    this.visiteId = null;
    this.markers = [];
    this.debut = 0;
    this.ecoule = 0;               // secondes accumulées hors pauses
    this._index = 0;
    this._flux = null;
    this._recorder = null;
    this._audio = null;
    this._analyseur = null;
    this._boucle = null;
  }

  /** Secondes écoulées depuis le début, pauses déduites. */
  get position() {
    if (this.etat !== 'enregistre') return this.ecoule;
    return this.ecoule + (performance.now() - this.debut) / 1000;
  }

  _emettre(nom, detail = {}) {
    this.dispatchEvent(new CustomEvent(nom, { detail }));
  }

  async demarrer(visiteId) {
    if (this.etat !== 'repos') return;
    this.visiteId = visiteId;
    this.markers = [];
    this.ecoule = 0;
    this._index = 0;

    this._flux = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,   // un local technique n'a pas de niveau constant
        channelCount: 1
      }
    });

    this._brancherAnalyse(this._flux);

    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      .find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    this._recorder = new MediaRecorder(this._flux, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);

    this._recorder.ondataavailable = async (event) => {
      if (!event.data?.size) return;
      try {
        await deposer(this.visiteId, event.data, this._index++);
      } catch (err) {
        this._emettre('probleme', { message: `Coffre local indisponible : ${err.message}` });
      }
    };

    this._recorder.start(TRANCHE_MS);
    this.debut = performance.now();
    this.etat = 'enregistre';
    this._tic();
    this._emettre('etat', { etat: this.etat });
  }

  pause() {
    if (this.etat !== 'enregistre') return;
    this._recorder.pause();
    this.ecoule = this.position;
    this.etat = 'pause';
    this._emettre('etat', { etat: this.etat });
  }

  reprendre() {
    if (this.etat !== 'pause') return;
    this._recorder.resume();
    this.debut = performance.now();
    this.etat = 'enregistre';
    this._emettre('etat', { etat: this.etat });
  }

  /** Pose un repère à l'instant présent. C'est le geste le plus important de l'app. */
  marquer(label = 'Point clé', note = '') {
    if (this.etat === 'repos') return null;
    const marker = { t: Math.round(this.position * 10) / 10, label, note, le: new Date().toISOString() };
    this.markers.push(marker);
    this._emettre('marqueur', { marker, markers: [...this.markers] });
    return marker;
  }

  supprimerMarqueur(index) {
    this.markers.splice(index, 1);
    this._emettre('marqueur', { markers: [...this.markers] });
  }

  /** @returns {Promise<{blob:Blob, duree:number, markers:object[]}>} */
  async arreter() {
    if (this.etat === 'repos') return null;
    const duree = this.position;

    await new Promise((resolve) => {
      this._recorder.addEventListener('stop', resolve, { once: true });
      this._recorder.stop();
    });

    this._flux.getTracks().forEach((piste) => piste.stop());
    cancelAnimationFrame(this._boucle);
    this._audio?.close();
    this._audio = this._analyseur = this._recorder = this._flux = null;

    const morceaux = await recuperer(this.visiteId);
    const blob = new Blob(morceaux, { type: 'audio/webm' });

    this.etat = 'repos';
    this.ecoule = duree;
    this._emettre('etat', { etat: this.etat });
    return { blob, duree, markers: [...this.markers] };
  }

  /** À appeler une fois l'audio remonté au serveur : le coffre a fait son office. */
  async purger(visiteId = this.visiteId) {
    if (visiteId) await vider(visiteId);
  }

  _brancherAnalyse(flux) {
    this._audio = new AudioContext();
    const source = this._audio.createMediaStreamSource(flux);
    this._analyseur = this._audio.createAnalyser();
    this._analyseur.fftSize = 1024;
    this._analyseur.smoothingTimeConstant = 0.72;
    source.connect(this._analyseur);
  }

  _tic() {
    const tampon = new Uint8Array(this._analyseur.frequencyBinCount);
    const pas = () => {
      if (!this._analyseur) return;
      this._analyseur.getByteTimeDomainData(tampon);
      let somme = 0;
      for (const v of tampon) {
        const ecart = (v - 128) / 128;
        somme += ecart * ecart;
      }
      this._emettre('niveau', {
        niveau: Math.min(1, Math.sqrt(somme / tampon.length) * 3.2),
        position: this.position
      });
      this._boucle = requestAnimationFrame(pas);
    };
    pas();
  }
}
