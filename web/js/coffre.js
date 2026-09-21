/**
 * Coffre local (IndexedDB) : les morceaux d'audio y tombent au fil de
 * l'enregistrement.
 *
 * La raison est simple : une visite de deux heures ne doit pas disparaître
 * parce que l'onglet a planté ou que le téléphone a mis le navigateur en
 * veille. Ce qui est dans le coffre est récupérable au prochain démarrage.
 */

const BASE = 'noira';
const MAGASIN = 'morceaux';

let connexion = null;

function ouvrir() {
  if (connexion) return connexion;
  connexion = new Promise((resolve, reject) => {
    const requete = indexedDB.open(BASE, 1);
    requete.onupgradeneeded = () => {
      const db = requete.result;
      if (!db.objectStoreNames.contains(MAGASIN)) {
        db.createObjectStore(MAGASIN, { keyPath: 'cle', autoIncrement: true })
          .createIndex('visite', 'visiteId');
      }
    };
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });
  return connexion;
}

function transaction(mode) {
  return ouvrir().then((db) => db.transaction(MAGASIN, mode).objectStore(MAGASIN));
}

export async function deposer(visiteId, blob, index) {
  const magasin = await transaction('readwrite');
  return new Promise((resolve, reject) => {
    const requete = magasin.add({ visiteId, index, blob, le: Date.now() });
    requete.onsuccess = () => resolve();
    requete.onerror = () => reject(requete.error);
  });
}

export async function recuperer(visiteId) {
  const magasin = await transaction('readonly');
  return new Promise((resolve, reject) => {
    const requete = magasin.index('visite').getAll(visiteId);
    requete.onsuccess = () =>
      resolve(requete.result.sort((a, b) => a.index - b.index).map((r) => r.blob));
    requete.onerror = () => reject(requete.error);
  });
}

/** Liste des visites dont des morceaux traînent encore : candidates à reprise. */
export async function enAttente() {
  const magasin = await transaction('readonly');
  return new Promise((resolve, reject) => {
    const requete = magasin.getAll();
    requete.onsuccess = () => {
      const par = new Map();
      for (const r of requete.result) {
        const e = par.get(r.visiteId) ?? { visiteId: r.visiteId, morceaux: 0, octets: 0, le: 0 };
        e.morceaux++;
        e.octets += r.blob.size;
        e.le = Math.max(e.le, r.le);
        par.set(r.visiteId, e);
      }
      resolve([...par.values()].sort((a, b) => b.le - a.le));
    };
    requete.onerror = () => reject(requete.error);
  });
}

export async function vider(visiteId) {
  const magasin = await transaction('readwrite');
  return new Promise((resolve, reject) => {
    const requete = magasin.index('visite').openCursor(IDBKeyRange.only(visiteId));
    requete.onsuccess = () => {
      const curseur = requete.result;
      if (!curseur) return resolve();
      curseur.delete();
      curseur.continue();
    };
    requete.onerror = () => reject(requete.error);
  });
}
