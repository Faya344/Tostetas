/**
 * Worker de transcription : Whisper exécuté dans le navigateur.
 *
 * Le modèle est téléchargé une fois depuis le CDN Hugging Face puis mis en
 * cache par le navigateur. Ensuite, tout se passe sur la machine : aucun audio
 * ne part sur un serveur, aucun jeton n'est facturé. C'est le compromis central
 * de NOIRA — un premier chargement un peu long contre une gratuité durable.
 */

let transcripteur = null;
let modeleCharge = null;

async function charger(modele) {
  if (transcripteur && modeleCharge === modele) return transcripteur;

  const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5');
  env.allowLocalModels = false;

  // WebGPU quand la machine l'a (5 à 10× plus rapide), WASM sinon.
  const gpu = 'gpu' in navigator && Boolean(await navigator.gpu?.requestAdapter?.().catch(() => null));

  transcripteur = await pipeline('automatic-speech-recognition', modele, {
    dtype: gpu ? { encoder_model: 'fp16', decoder_model_merged: 'q4' } : 'q8',
    device: gpu ? 'webgpu' : 'wasm',
    progress_callback: (info) => {
      if (info.status === 'progress') {
        self.postMessage({ type: 'progres', fichier: info.file, part: info.progress ?? 0 });
      } else if (info.status === 'ready') {
        self.postMessage({ type: 'pret', moteur: gpu ? 'webgpu' : 'wasm' });
      }
    }
  });

  modeleCharge = modele;
  return transcripteur;
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'transcrire') return;
  try {
    const moteur = await charger(data.modele);
    self.postMessage({ type: 'etape', message: 'Transcription en cours…' });

    const sortie = await moteur(data.audio, {
      language: data.langue || 'fr',
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      // Le décalage de temps entre deux morceaux est géré par la bibliothèque ;
      // on ne recolle rien à la main.
      callback_function: (elements) => {
        const partiel = elements?.[0]?.output_token_ids ? null : elements?.[0]?.text;
        if (partiel) self.postMessage({ type: 'partiel', texte: partiel });
      }
    });

    const segments = (sortie.chunks ?? [])
      .map((morceau) => ({
        t0: morceau.timestamp?.[0] ?? 0,
        t1: morceau.timestamp?.[1] ?? morceau.timestamp?.[0] ?? 0,
        text: String(morceau.text ?? '').trim()
      }))
      .filter((s) => s.text);

    self.postMessage({
      type: 'fini',
      segments: segments.length ? segments : [{ t0: 0, t1: 0, text: String(sortie.text ?? '').trim() }],
      texte: String(sortie.text ?? '').trim()
    });
  } catch (err) {
    self.postMessage({ type: 'erreur', message: err?.message || String(err) });
  }
};
