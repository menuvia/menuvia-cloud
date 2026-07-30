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
// ulterior trece string-urile prin roPdfSafe. Semnătura e intenționat OPACĂ
// (variadic unknown, prin aserțiune structurală) ca să nu depindă de forma
// exactă a tipurilor jsPDF — o semnătură structurală „prietenoasă" nu era
// asignabilă înapoi peste metoda reală (return jsPDF, param TextOptionsLight)
// și pica build-ul Netlify, invizibil local fără node_modules.
export function patchPdfDiacritics(doc: object): void {
  const d = doc as { text: (...args: unknown[]) => unknown }
  const orig = d.text.bind(d)
  d.text = (...args: unknown[]) => {
    const [first, ...rest] = args
    const safe =
      typeof first === 'string'
        ? roPdfSafe(first)
        : Array.isArray(first)
          ? first.map((s) => (typeof s === 'string' ? roPdfSafe(s) : (s as unknown)))
          : first
    return orig(safe, ...rest)
  }
}
