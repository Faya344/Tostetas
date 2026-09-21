/** Utilitaires HTTP : pas de framework, pas de dépendance. */

import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webm': 'audio/webm'
};

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
  });
  res.end(payload);
}

export function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  res.end(text);
}

/** Lecture du corps avec plafond : un enregistrement long ne doit pas saturer la RAM. */
export function readBody(req, { limit = 512 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Corps de requête trop volumineux.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJsonBody(req) {
  const buffer = await readBody(req, { limit: 32 * 1024 * 1024 });
  if (!buffer.length) return {};
  return JSON.parse(buffer.toString('utf8'));
}

/** Sert un fichier statique sous `root`, en refusant toute sortie du dossier. */
export async function serveStatic(res, root, urlPath) {
  const relative = decodeURIComponent(urlPath).replace(/^\/+/, '') || 'index.html';
  const file = path.join(root, relative);
  if (!file.startsWith(root)) return sendText(res, 403, 'Interdit');

  try {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) return serveStatic(res, root, path.join(relative, 'index.html'));
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-cache'
    });
    createReadStream(file).pipe(res);
  } catch {
    sendText(res, 404, 'Introuvable');
  }
}
