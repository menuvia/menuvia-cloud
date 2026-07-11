// ─────────────────────────────────────────────────────────────
// pdf — diacritice românești sigure în jsPDF (fonturi standard).
// ─────────────────────────────────────────────────────────────
// Fonturile built-in jsPDF (helvetica etc., encoding WinAnsi) NU conțin
// ă/â/î/ș/ț — în PDF apăreau caractere rupte în numele restaurantului, mese,
// produse și etichete. Paliativ (până la embed de font TTF cu Latin Extended):
// transliterare la echivalentele ASCII. Aplicat într-un singur punct per
// document prin patchPdfDiacritics, ca să acopere și call-site-urile viitoare.

const RO_MAP: Record<string, string> = {
  ă: 'a', â: 'a', î: 'i', ș: 's', ş: 's', ț: 't', ţ: 't',
  Ă: 'A', Â: 'A', Î: 'I', Ș: 'S', Ş: 'S', Ț: 'T', Ţ: 'T',
}

export function roPdfSafe(s: string): string {
  return s.replace(/[ăâîșşțţĂÂÎȘŞȚŢ]/g, (c) => RO_MAP[c] ?? c)
}

// Patch pe INSTANȚĂ (shadow peste metoda de pe prototip): orice doc.text(...)
// ulterior trece string-urile prin roPdfSafe. Semnătura structurală acoperă
// forma folosită în repo (text, x, y, options?).
interface PdfTextLike {
  text: (text: string | string[], x: number, y: number, options?: unknown) => unknown
}

export function patchPdfDiacritics<T extends PdfTextLike>(doc: T): T {
  const orig = doc.text.bind(doc)
  doc.text = (text: string | string[], x: number, y: number, options?: unknown) => {
    const safe = Array.isArray(text) ? text.map(roPdfSafe) : roPdfSafe(text)
    return orig(safe, x, y, options)
  }
  return doc
}
