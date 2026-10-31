// ─────────────────────────────────────────────────────────────
// slug.ts — linkul public al meniului (/m/:slug) din numele localului.
//
// Defectul (audit oct 2026, ux-owner-slug): regula veche era
// `toLowerCase().replace(/[^a-z0-9]+/g, '-')`, aceeași ca în `create_restaurant`
// (mig 221). Orice literă cu diacritic e „non a–z”, deci se transforma în
// separator: „Casa Țărănească” → „casa-r-neasc”. Linkul tipărit pe mese și pe
// flyere ieșea stricat pentru aproape orice nume românesc.
//
// Aici: întâi se scot DIACRITICELE (descompunere NFD + eliminarea semnelor
// combinante U+0300–U+036F — acolo stau și virgula de sub ș/ț, U+0326, și
// sedila de sub ş/ţ, U+0327), plus câteva litere care nu se descompun (ß, æ,
// ø…), și abia apoi se aplică regula serverului. Serverul primește deja un
// slug curat, iar regula lui (care rămâne neschimbată, e în DATE) nu mai are ce
// strica. Coliziunile le rezolvă tot serverul (sufix aleator, mig 221).
// ─────────────────────────────────────────────────────────────

/** Litere fără descompunere NFD: le transliterăm explicit. */
const NON_DECOMPOSABLE: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  ł: 'l',
  þ: 'th',
  ı: 'i',
}

/** Lungimea maximă a unui slug generat (un link lung nu încape pe cardul de masă). */
export const SLUG_MAX_LENGTH = 60

/** Litere mici, fără diacritice; restul caracterelor rămân, pentru regula de separatori. */
function foldDiacritics(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ßæœøđðłþı]/g, (c) => NON_DECOMPOSABLE[c] ?? c)
}

/**
 * Slug-ul FINAL: litere a–z, cifre și cratime simple, fără cratime la capete,
 * cel mult `SLUG_MAX_LENGTH` caractere. Un nume din care nu rămâne nimic (doar
 * simboluri, emoji) cade pe `fallback`.
 */
export function slugify(input: string, fallback = 'restaurant'): string {
  const slug = foldDiacritics(input)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '')
  return slug || fallback
}

/**
 * Normalizarea LA TASTARE (câmpul de slug din Setări): fără diacritice, dar
 * FĂRĂ curățarea capetelor — altfel separatorul abia tastat ar dispărea
 * („pizza-” → „pizza”) și un slug cu cratimă n-ar putea fi scris de mână.
 * Curățarea finală o face `change_restaurant_slug` la salvare.
 */
export function slugifyWhileTyping(input: string): string {
  return foldDiacritics(input).replace(/[^a-z0-9-]+/g, '-')
}
