/**
 * Pont vers Claude Code en mode non interactif (`claude -p`).
 *
 * C'est le cœur du « zéro token » : l'appel passe par le CLI déjà authentifié
 * avec l'abonnement de l'utilisateur, jamais par une clé API facturée à l'usage.
 * Aucune clé n'est lue, aucune n'est nécessaire.
 *
 * Le CLI est lancé en mode restreint : pas d'outils d'exécution, pas de MCP.
 * On lui demande de rédiger, pas d'agir sur la machine.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { OUTBOX_DIR } from '../store.mjs';

const BIN = process.env.PLODO_CLAUDE_BIN || 'claude';
const MODEL = process.env.PLODO_CLAUDE_MODEL || 'sonnet';
const TIMEOUT_MS = Number(process.env.PLODO_CLAUDE_TIMEOUT_MS || 10 * 60 * 1000);

export class ClaudeUnavailable extends Error {
  constructor(message, { outbox = null } = {}) {
    super(message);
    this.name = 'ClaudeUnavailable';
    this.outbox = outbox;
  }
}

let availability = null;

export async function checkAvailability() {
  if (availability) return availability;
  availability = new Promise((resolve) => {
    const child = spawn(BIN, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve({ ok: false, version: null }));
    child.on('close', (code) => resolve({ ok: code === 0, version: out.trim() || null }));
  });
  return availability;
}

/**
 * Exécute un prompt et renvoie le texte produit.
 * @param {{system:string, prompt:string, model?:string, cwd?:string}} options
 */
export async function runClaude({ system, prompt, model = MODEL, cwd = OUTBOX_DIR }) {
  // Le CLI refuse de démarrer dans un dossier absent ; il peut l'être au tout
  // premier lancement, avant qu'aucune visite n'ait été écrite.
  await fs.mkdir(cwd, { recursive: true });

  const args = [
    '--print',
    '--output-format', 'json',
    '--model', model,
    '--restricted',          // pas de Bash, pas d'exécution de code
    '--strict-mcp-config',   // aucun serveur MCP hérité
    '--permission-mode', 'manual',
    '--system-prompt', system
  ];

  return await new Promise((resolve, reject) => {
    const child = spawn(BIN, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Claude n'a pas répondu en ${Math.round(TIMEOUT_MS / 1000)} s.`));
    }, TIMEOUT_MS);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new ClaudeUnavailable(`CLI « ${BIN} » introuvable : ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`claude a quitté avec le code ${code}. ${stderr.trim().slice(0, 800)}`));
      }
      try {
        const payload = JSON.parse(stdout);
        if (payload.is_error) return reject(new Error(String(payload.result ?? 'Erreur Claude')));
        resolve({ text: String(payload.result ?? ''), usage: payload.usage ?? null });
      } catch {
        // Certaines versions impriment du texte brut : on l'accepte tel quel.
        if (stdout.trim()) return resolve({ text: stdout.trim(), usage: null });
        reject(new Error(`Réponse illisible de claude. ${stderr.trim().slice(0, 800)}`));
      }
    });

    child.stdin.end(prompt);
  });
}

/**
 * Extrait le premier objet JSON d'une réponse, même entourée de texte ou de
 * balises de code. Tolérant par nécessité : le coût d'un faux négatif est une
 * synthèse perdue.
 */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch { /* on tente le candidat suivant */ }
  }
  throw new Error('Aucun JSON exploitable dans la réponse.');
}

/**
 * Repli hors ligne : on dépose le prompt sur disque. L'utilisateur ouvre une
 * session Claude Code dans le dossier et dit « traite la corbeille » — le
 * résultat est le même, le trajet est manuel.
 */
export async function dropToOutbox(name, { system, prompt }) {
  await fs.mkdir(OUTBOX_DIR, { recursive: true });
  const file = path.join(OUTBOX_DIR, `${name}.md`);
  await fs.writeFile(file, `<!-- Consigne système -->\n\n${system}\n\n<!-- Demande -->\n\n${prompt}\n`);
  return file;
}
