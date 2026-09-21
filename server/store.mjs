/**
 * Stockage sur disque, sans base de données.
 *
 * Une visite = un dossier autonome. On peut la zipper, la copier sur une clé,
 * la relire à la main dix ans plus tard. C'est volontaire : l'outil doit
 * survivre à l'outil.
 *
 *   data/visites/<id>/visite.json      métadonnées + points clés
 *   data/visites/<id>/audio.<ext>      la copie du vocal, telle qu'enregistrée
 *   data/visites/<id>/transcript.json  segments horodatés
 *   data/visites/<id>/synthese.json    sortie structurée de Claude
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
export const DATA_DIR = path.join(ROOT, 'data');
export const VISITES_DIR = path.join(DATA_DIR, 'visites');
export const INDEX_DIR = path.join(DATA_DIR, 'index');
export const OUTBOX_DIR = path.join(DATA_DIR, 'outbox');

export function visiteDir(id) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error(`Identifiant de visite invalide : ${id}`);
  return path.join(VISITES_DIR, id);
}

export async function ensureDirs() {
  for (const dir of [DATA_DIR, VISITES_DIR, INDEX_DIR, OUTBOX_DIR]) {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file); // écriture atomique : jamais de visite à moitié écrite
}

export function newId(date = new Date()) {
  // Seuls les chiffres de l'horodatage : toISOString laisse sinon passer le
  // point des millisecondes, que visiteDir() refuse à juste titre.
  const stamp = date.toISOString().replace(/\D/g, '').slice(0, 14);
  const salt = Math.random().toString(36).slice(2, 6);
  return `v${stamp}-${salt}`;
}

/** Vrai si la visite existe sur le disque. */
export async function visiteExiste(id) {
  try {
    await fs.access(path.join(visiteDir(id), 'visite.json'));
    return true;
  } catch {
    return false;
  }
}

export async function listVisiteIds() {
  await ensureDirs();
  const entries = await fs.readdir(VISITES_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
}

export async function loadVisite(id) {
  const dir = visiteDir(id);
  const meta = await readJson(path.join(dir, 'visite.json'));
  if (!meta) return null;
  const [transcript, synthese] = await Promise.all([
    readJson(path.join(dir, 'transcript.json'), null),
    readJson(path.join(dir, 'synthese.json'), null)
  ]);
  const fichier = await trouverAudio(id);
  let audio = null;
  if (fichier) {
    const stat = await fs.stat(fichier);
    audio = { url: `/api/visites/${id}/audio`, octets: stat.size, format: path.extname(fichier).slice(1) };
  }
  return { ...meta, transcript, synthese, audio };
}

/**
 * Conteneurs acceptés. Le navigateur envoie du WebM/Opus, l'application Android
 * du MP4/AAC : on range le fichier sous son vrai nom plutôt que de mentir sur
 * l'extension, et on le retrouve ici.
 */
export const FORMATS_AUDIO = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav'
};

export const TYPES_AUDIO = {
  webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav'
};

/** @returns {Promise<string|null>} chemin du fichier audio, s'il y en a un. */
export async function trouverAudio(id) {
  const dir = visiteDir(id);
  for (const ext of Object.keys(TYPES_AUDIO)) {
    const fichier = path.join(dir, `audio.${ext}`);
    try {
      await fs.access(fichier);
      return fichier;
    } catch { /* format suivant */ }
  }
  return null;
}

export async function saveVisite(meta) {
  const dir = visiteDir(meta.id);
  await writeJson(path.join(dir, 'visite.json'), meta);
  return meta;
}

export async function loadAll() {
  const ids = await listVisiteIds();
  const visites = await Promise.all(ids.map((id) => loadVisite(id)));
  return visites.filter(Boolean);
}
