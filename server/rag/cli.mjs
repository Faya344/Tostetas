#!/usr/bin/env node
/**
 * Interroger ses visites depuis le terminal, sans lancer le serveur.
 *
 *   npm run ask -- "qu'a-t-on décidé pour la toiture ?"
 *   npm run ask -- --extraits "vase d'expansion"
 *
 * Utile pour vérifier ce que le RAG remonte réellement avant de se demander
 * pourquoi une réponse est à côté : dans neuf cas sur dix, le problème est
 * dans les extraits, pas dans le modèle.
 */

import { retrieve, formatContext } from './index.mjs';
import { hms } from './chunk.mjs';
import { runClaude, ClaudeUnavailable } from '../claude/bridge.mjs';
import { SYSTEM_QA, buildQaPrompt } from '../claude/prompts.mjs';

const args = process.argv.slice(2);
const extraitsSeuls = args.includes('--extraits');
const question = args.filter((a) => !a.startsWith('--')).join(' ').trim();

if (!question) {
  console.error('Usage : npm run ask -- [--extraits] "votre question"');
  process.exit(1);
}

const { passages, meta } = await retrieve(question, { limit: 10 });

if (!passages.length) {
  console.error(meta?.chunks
    ? "Aucun extrait ne correspond. Essayez d'autres mots."
    : 'Index vide — lancez `npm run reindex` après avoir enregistré une visite.');
  process.exit(1);
}

console.log(`\n${passages.length} extrait(s) sur ${meta.chunks} passages indexés\n`);
passages.forEach((p, i) => {
  console.log(`[S${i + 1}] ${p.visiteTitre} · ${hms(p.t0)}${p.speaker ? ` · ${p.speaker}` : ''}`);
  console.log(`      ${p.text.slice(0, 160).replace(/\s+/g, ' ')}…\n`);
});

if (extraitsSeuls) process.exit(0);

try {
  const { text } = await runClaude({
    system: SYSTEM_QA,
    prompt: buildQaPrompt(question, formatContext(passages))
  });
  console.log(`${'─'.repeat(72)}\n\n${text}\n`);
} catch (err) {
  if (err instanceof ClaudeUnavailable) {
    console.error(`\n${err.message}\nLes extraits ci-dessus restent exploitables tels quels.`);
    process.exit(2);
  }
  throw err;
}
