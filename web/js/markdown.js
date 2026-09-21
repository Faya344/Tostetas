/**
 * Rendu markdown minimal : titres, listes, gras, italique, code, citations.
 * Volontairement réduit — ce qui sort du modèle est du texte de compte rendu,
 * pas un document arbitraire. Tout est échappé avant d'être balisé, donc
 * aucune balise venue du texte ne peut s'exécuter.
 */

const echapper = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function enligne(texte) {
  return echapper(texte)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

export function markdown(source) {
  const lignes = String(source ?? '').split('\n');
  const sortie = [];
  let liste = null;

  const fermerListe = () => { if (liste) { sortie.push(`</${liste}>`); liste = null; } };

  for (const ligne of lignes) {
    const titre = ligne.match(/^(#{1,4})\s+(.*)$/);
    const puce = ligne.match(/^\s*[-*]\s+(.*)$/);
    const numero = ligne.match(/^\s*\d+[.)]\s+(.*)$/);
    const citation = ligne.match(/^>\s?(.*)$/);

    if (titre) {
      fermerListe();
      const niveau = Math.min(4, titre[1].length + 1);
      sortie.push(`<h${niveau}>${enligne(titre[2])}</h${niveau}>`);
    } else if (puce) {
      if (liste !== 'ul') { fermerListe(); sortie.push('<ul>'); liste = 'ul'; }
      sortie.push(`<li>${enligne(puce[1])}</li>`);
    } else if (numero) {
      if (liste !== 'ol') { fermerListe(); sortie.push('<ol>'); liste = 'ol'; }
      sortie.push(`<li>${enligne(numero[1])}</li>`);
    } else if (citation) {
      fermerListe();
      sortie.push(`<blockquote>${enligne(citation[1])}</blockquote>`);
    } else if (ligne.trim()) {
      fermerListe();
      sortie.push(`<p>${enligne(ligne.trim())}</p>`);
    } else {
      fermerListe();
    }
  }
  fermerListe();
  return sortie.join('\n');
}
