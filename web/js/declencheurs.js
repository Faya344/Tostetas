/**
 * Déclencheurs physiques.
 *
 * Objectif : poser un point clé sans sortir le téléphone de la poche ni
 * enlever ses gants. Quatre chemins, du plus universel au plus spécifique ;
 * aucun n'exige d'acheter quoi que ce soit, tous acceptent un accessoire
 * si vous en avez un.
 *
 * 1. Clavier — barre d'espace, K, et les touches qu'envoient les
 *    télécommandes Bluetooth « page turner » à 15 € (flèches, Page suivante,
 *    Entrée, Échap). Elles se présentent au système comme un clavier : rien
 *    à installer.
 * 2. MediaSession — le bouton du casque filaire ou des écouteurs Bluetooth.
 *    « Piste suivante » devient « point clé », « lecture/pause » démarre et
 *    arrête. Fonctionne écran éteint.
 * 3. Gamepad — les télécommandes en mode manette et les pédales USB.
 * 4. WebHID — un périphérique HID branché, si le navigateur l'autorise.
 *
 * Aucun de ces chemins ne remonte quoi que ce soit sur le réseau.
 */

const TOUCHES_MARQUEUR = new Set([
  'KeyK', 'Enter', 'NumpadEnter',
  'PageDown', 'ArrowRight', 'ArrowDown',   // télécommandes page-turner
  'AudioVolumeUp'                          // rare en navigateur, gratuit à tenter
]);

const TOUCHES_BASCULE = new Set(['Space', 'PageUp', 'ArrowLeft', 'ArrowUp']);

export class Declencheurs extends EventTarget {
  constructor() {
    super();
    this.sources = new Set(['clavier']);
    this._gamepadBoucle = null;
    this._etatsBoutons = new Map();
  }

  _tirer(action, source) {
    this.dispatchEvent(new CustomEvent('action', { detail: { action, source } }));
  }

  /** Branche le clavier. Les champs de saisie gardent la priorité. */
  brancherClavier(cible = window) {
    cible.addEventListener('keydown', (event) => {
      const actif = document.activeElement;
      if (actif && (actif.tagName === 'INPUT' || actif.tagName === 'TEXTAREA' || actif.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (TOUCHES_MARQUEUR.has(event.code)) {
        event.preventDefault();
        this._tirer('marqueur', 'clavier');
      } else if (TOUCHES_BASCULE.has(event.code)) {
        event.preventDefault();
        this._tirer('bascule', 'clavier');
      }
    });
  }

  /**
   * Boutons de casque et de télécommande média. Il faut un média « en cours »
   * pour que le système route les touches : on publie donc des métadonnées
   * pendant l'enregistrement.
   */
  brancherMedia() {
    if (!('mediaSession' in navigator)) return false;
    const poser = (action, cible) => {
      try {
        navigator.mediaSession.setActionHandler(action, () => this._tirer(cible, 'casque'));
      } catch { /* action non supportée par ce navigateur */ }
    };
    poser('nexttrack', 'marqueur');
    poser('previoustrack', 'marqueur');
    poser('play', 'bascule');
    poser('pause', 'bascule');
    poser('stop', 'arret');
    this.sources.add('casque');
    return true;
  }

  annoncerMedia({ titre, actif }) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titre,
      artist: 'NOIRA — visite en cours',
      album: 'Enregistrement terrain'
    });
    navigator.mediaSession.playbackState = actif ? 'playing' : 'paused';
  }

  /** Manettes, pédales et télécommandes en mode gamepad. */
  brancherGamepad() {
    if (!('getGamepads' in navigator)) return false;

    const scruter = () => {
      for (const manette of navigator.getGamepads?.() ?? []) {
        if (!manette) continue;
        manette.buttons.forEach((bouton, i) => {
          const cle = `${manette.index}:${i}`;
          const avant = this._etatsBoutons.get(cle) ?? false;
          if (bouton.pressed && !avant) {
            // Un bouton quelconque pose un repère ; le premier bascule l'enregistrement.
            this._tirer(i === 0 ? 'bascule' : 'marqueur', 'manette');
          }
          this._etatsBoutons.set(cle, bouton.pressed);
        });
      }
      this._gamepadBoucle = requestAnimationFrame(scruter);
    };

    window.addEventListener('gamepadconnected', () => {
      this.sources.add('manette');
      this.dispatchEvent(new CustomEvent('source', { detail: { source: 'manette', branche: true } }));
      if (!this._gamepadBoucle) scruter();
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.sources.delete('manette');
      this.dispatchEvent(new CustomEvent('source', { detail: { source: 'manette', branche: false } }));
    });
    return true;
  }

  /**
   * Appairage HID explicite — nécessite un geste de l'utilisateur.
   * Tout rapport entrant contenant un octet non nul est traité comme un appui :
   * on ne connaît pas le protocole du boîtier, mais « quelque chose a changé »
   * suffit pour un clicker.
   */
  async appairerHid() {
    if (!('hid' in navigator)) throw new Error('WebHID indisponible sur ce navigateur.');
    const appareils = await navigator.hid.requestDevice({ filters: [] });
    if (!appareils.length) return null;
    const appareil = appareils[0];
    if (!appareil.opened) await appareil.open();

    let dernier = '';
    appareil.addEventListener('inputreport', (event) => {
      const octets = new Uint8Array(event.data.buffer);
      const signature = octets.join(',');
      const appui = octets.some((o) => o !== 0);
      if (appui && signature !== dernier) this._tirer('marqueur', 'hid');
      dernier = appui ? signature : '';
    });

    this.sources.add('hid');
    this.dispatchEvent(new CustomEvent('source', { detail: { source: 'hid', branche: true, nom: appareil.productName } }));
    return appareil.productName || 'Périphérique HID';
  }

  /** Nom des sources actives, pour affichage. */
  get actives() {
    return [...this.sources];
  }
}
