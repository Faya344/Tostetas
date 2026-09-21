/**
 * Tokenisation FR/EN sans dépendance.
 * Pliage des accents, stopwords français+anglais, désuffixation légère.
 * Objectif : robustesse sur du vocabulaire technique (chantier, CVC, CTA, VMC…)
 * plutôt que finesse linguistique.
 */

const STOPWORDS = new Set(`
au aux avec ce ces dans de des du elle en et eux il ils je la le les leur lui ma mais me meme mes moi mon ne
nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y
etre avoir fait faire cela celui cette ceux donc alors aussi tres plus moins bien alors alors apres avant
the a an and or of to in on for with is are was were be been it this that there here as at by from
`.trim().split(/\s+/));

// Suffixes français les plus fréquents, retirés seulement si le radical reste lisible.
const SUFFIXES = [
  'issements', 'issement', 'ations', 'ation', 'ements', 'ement', 'ances', 'ance',
  'ences', 'ence', 'ables', 'able', 'ibles', 'ible', 'euses', 'euse', 'eurs', 'eur',
  'ives', 'ive', 'ifs', 'if', 'aux', 'als', 'els', 'iques', 'ique', 'ees', 'ee', 'es', 's'
];

/** Retire les diacritiques et passe en minuscules. */
export function fold(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function stem(word) {
  if (word.length <= 4) return word;
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= 4 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/**
 * Découpe en termes indexables. Les nombres et références techniques
 * (R410A, DN80, 3x400V) sont conservés tels quels : ce sont souvent
 * les termes les plus discriminants d'une visite.
 */
export function tokenize(text) {
  const folded = fold(String(text ?? ''));
  const raw = folded.match(/[a-z0-9]+(?:[.,][0-9]+)?/g) ?? [];
  const out = [];
  for (const token of raw) {
    if (token.length < 2) continue;
    if (STOPWORDS.has(token)) continue;
    out.push(/\d/.test(token) ? token : stem(token));
  }
  return out;
}

/** Termes d'une requête, dédupliqués en gardant l'ordre. */
export function queryTerms(text) {
  return [...new Set(tokenize(text))];
}

/**
 * Second passage : tronque chaque terme à cinq caractères.
 *
 * La désuffixation ci-dessus rate les alternances de radical du français
 * (« retenue » / « retient », « choix » / « choisi »). La troncature les
 * rapproche brutalement — trop brutalement pour servir seule, mais très bien
 * comme second bras de recherche, où elle apporte du rappel pendant que
 * l'index exact garde la précision.
 */
export function tokenizePrefixe(text) {
  return tokenize(text).map((t) => (/\d/.test(t) ? t : t.slice(0, 5)));
}

export function queryTermsPrefixe(text) {
  return [...new Set(tokenizePrefixe(text))];
}
