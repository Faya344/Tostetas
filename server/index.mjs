#!/usr/bin/env node
/**
 * NOIRA — serveur local.
 *
 * Écoute sur 127.0.0.1 uniquement. Rien ne sort de la machine : l'audio, la
 * transcription et l'index restent sur le disque, et le seul appel réseau
 * possible est celui que Claude Code fait déjà pour votre compte.
 */

import http from 'node:http';
import path from 'node:path';
import { promises as fs, createReadStream } from 'node:fs';

import { ROOT, ensureDirs, loadVisite, loadAll, saveVisite, visiteDir, visiteExiste, writeJson, newId } from './store.mjs';
import { sendJson, sendText, readBody, readJsonBody, serveStatic } from './http.mjs';
import { retrieve, formatContext, buildIndex, getIndex, invalidate } from './rag/index.mjs';
import { genererSynthese } from './synthese.mjs';
import { checkAvailability, runClaude, dropToOutbox, ClaudeUnavailable } from './claude/bridge.mjs';
import { SYSTEM_QA, buildQaPrompt } from './claude/prompts.mjs';
import { exportMarkdown } from './export.mjs';

const WEB_DIR = path.join(ROOT, 'web');
const PORT = Number(process.env.NOIRA_PORT || 7331);
const HOST = process.env.NOIRA_HOST || '127.0.0.1';

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

// ---------------------------------------------------------------- état global

route('GET', /^\/api\/state$/, async (req, res) => {
  const [claude, index, visites] = await Promise.all([checkAvailability(), getIndex(), loadAll()]);
  sendJson(res, 200, {
    claude,
    rag: index?.meta ?? null,
    visites: visites.map(({ transcript, synthese, ...meta }) => ({
      ...meta,
      aTranscription: Boolean(transcript?.segments?.length),
      aSynthese: Boolean(synthese),
      titreSynthese: synthese?.titre ?? null
    }))
  });
});

// ------------------------------------------------------------------- visites

route('POST', /^\/api\/visites$/, async (req, res) => {
  const body = await readJsonBody(req);
  const now = new Date();
  const visite = {
    id: newId(now),
    titre: String(body.titre || '').trim() || `Visite du ${now.toLocaleDateString('fr-FR')}`,
    site: String(body.site || '').trim(),
    date: body.date || now.toISOString().slice(0, 10),
    creeLe: now.toISOString(),
    duree: 0,
    statut: 'en_cours',
    markers: []
  };
  await saveVisite(visite);
  sendJson(res, 201, visite);
});

route('GET', /^\/api\/visites\/([\w-]+)$/, async (req, res, [id]) => {
  const visite = await loadVisite(id);
  return visite ? sendJson(res, 200, visite) : sendJson(res, 404, { erreur: 'Visite inconnue' });
});

route('PATCH', /^\/api\/visites\/([\w-]+)$/, async (req, res, [id]) => {
  const current = await loadVisite(id);
  if (!current) return sendJson(res, 404, { erreur: 'Visite inconnue' });
  const patch = await readJsonBody(req);
  const { transcript, synthese, audio, ...meta } = current;
  const updated = { ...meta, ...patch, id };
  await saveVisite(updated);
  sendJson(res, 200, updated);
});

route('DELETE', /^\/api\/visites\/([\w-]+)$/, async (req, res, [id]) => {
  await fs.rm(visiteDir(id), { recursive: true, force: true });
  invalidate();
  await buildIndex();
  sendJson(res, 200, { supprime: id });
});

// --------------------------------------------------------------------- audio

route('PUT', /^\/api\/visites\/([\w-]+)\/audio$/, async (req, res, [id]) => {
  // Sans ce garde-fou, un identifiant erroné créerait une visite fantôme,
  // invisible dans la liste mais bien présente sur le disque.
  if (!(await visiteExiste(id))) return sendJson(res, 404, { erreur: 'Visite inconnue' });
  const buffer = await readBody(req);
  if (!buffer.length) return sendJson(res, 400, { erreur: 'Aucun audio reçu' });
  await fs.mkdir(visiteDir(id), { recursive: true });
  await fs.writeFile(path.join(visiteDir(id), 'audio.webm'), buffer);
  sendJson(res, 200, { octets: buffer.length });
});

route('GET', /^\/api\/visites\/([\w-]+)\/audio$/, async (req, res, [id]) => {
  const file = path.join(visiteDir(id), 'audio.webm');
  try {
    const stat = await fs.stat(file);
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      // Le lecteur a besoin du Range pour sauter directement sur un point clé.
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : stat.size - 1;
      res.writeHead(206, {
        'content-type': 'audio/webm',
        'content-range': `bytes ${start}-${end}/${stat.size}`,
        'accept-ranges': 'bytes',
        'content-length': end - start + 1
      });
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': 'audio/webm', 'content-length': stat.size, 'accept-ranges': 'bytes' });
    createReadStream(file).pipe(res);
  } catch {
    sendText(res, 404, 'Pas d\'audio pour cette visite');
  }
});

// -------------------------------------------------------------- transcription

route('PUT', /^\/api\/visites\/([\w-]+)\/transcript$/, async (req, res, [id]) => {
  if (!(await visiteExiste(id))) return sendJson(res, 404, { erreur: 'Visite inconnue' });
  const body = await readJsonBody(req);
  const segments = (body.segments ?? [])
    .map((s) => ({
      t0: Number(s.t0) || 0,
      t1: Number(s.t1) || Number(s.t0) || 0,
      speaker: s.speaker ? String(s.speaker) : null,
      text: String(s.text ?? '').trim()
    }))
    .filter((s) => s.text)
    .sort((a, b) => a.t0 - b.t0);

  await writeJson(path.join(visiteDir(id), 'transcript.json'), {
    moteur: String(body.moteur || 'inconnu'),
    langue: String(body.langue || 'fr'),
    majLe: new Date().toISOString(),
    segments
  });

  const visite = await loadVisite(id);
  if (visite) {
    const { transcript, synthese, audio, ...meta } = visite;
    await saveVisite({
      ...meta,
      duree: Math.max(meta.duree || 0, segments.at(-1)?.t1 || 0),
      statut: meta.statut === 'en_cours' ? 'transcrite' : meta.statut
    });
  }
  invalidate();
  await buildIndex();
  sendJson(res, 200, { segments: segments.length });
});

// ------------------------------------------------------------------ synthèse

route('POST', /^\/api\/visites\/([\w-]+)\/synthese$/, async (req, res, [id]) => {
  const body = await readJsonBody(req).catch(() => ({}));
  try {
    const { synthese, usage } = await genererSynthese(id, { model: body.model });
    sendJson(res, 200, { synthese, usage });
  } catch (err) {
    if (err instanceof ClaudeUnavailable) {
      return sendJson(res, 503, { erreur: err.message, outbox: err.outbox, repli: true });
    }
    sendJson(res, 500, { erreur: err.message });
  }
});

route('GET', /^\/api\/visites\/([\w-]+)\/export$/, async (req, res, [id]) => {
  const visite = await loadVisite(id);
  if (!visite) return sendJson(res, 404, { erreur: 'Visite inconnue' });
  res.writeHead(200, {
    'content-type': 'text/markdown; charset=utf-8',
    'content-disposition': `attachment; filename="${id}.md"`
  });
  res.end(exportMarkdown(visite));
});

// ------------------------------------------------------------------ recherche

route('POST', /^\/api\/recherche$/, async (req, res) => {
  const { question, visiteId, limit } = await readJsonBody(req);
  if (!question) return sendJson(res, 400, { erreur: 'Question vide' });
  const { passages, meta } = await retrieve(question, { limit: limit ?? 8, visiteId });
  sendJson(res, 200, { passages, meta });
});

route('POST', /^\/api\/ask$/, async (req, res) => {
  const { question, visiteId } = await readJsonBody(req);
  if (!question) return sendJson(res, 400, { erreur: 'Question vide' });

  const { passages } = await retrieve(question, { limit: 10, visiteId });
  const prompt = buildQaPrompt(question, formatContext(passages));
  try {
    const { text } = await runClaude({ system: SYSTEM_QA, prompt });
    sendJson(res, 200, { reponse: text, passages });
  } catch (err) {
    if (err instanceof ClaudeUnavailable) {
      const file = await dropToOutbox(`question-${Date.now()}`, { system: SYSTEM_QA, prompt });
      return sendJson(res, 503, { erreur: err.message, outbox: file, passages, repli: true });
    }
    sendJson(res, 500, { erreur: err.message, passages });
  }
});

route('POST', /^\/api\/reindex$/, async (req, res) => {
  invalidate();
  const index = await buildIndex();
  sendJson(res, 200, index.meta);
});

// ------------------------------------------------------------------- serveur

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    for (const { method, pattern, handler } of routes) {
      if (req.method !== method) continue;
      const match = url.pathname.match(pattern);
      if (match) return await handler(req, res, match.slice(1), url);
    }
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { erreur: 'Route inconnue' });
    await serveStatic(res, WEB_DIR, url.pathname);
  } catch (err) {
    console.error(`${req.method} ${url.pathname} —`, err);
    if (!res.headersSent) sendJson(res, 500, { erreur: err.message });
  }
});

await ensureDirs();
server.listen(PORT, HOST, async () => {
  const claude = await checkAvailability();
  console.log(`\n  NOIRA — http://${HOST}:${PORT}`);
  console.log(`  Claude Code : ${claude.ok ? `détecté (${claude.version})` : 'absent — mode corbeille'}`);
  console.log(`  Données     : ${path.join(ROOT, 'data')}\n`);
});
