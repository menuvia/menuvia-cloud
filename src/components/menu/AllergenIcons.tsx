import { allergenEntries } from '../../lib/allergens'
import { Tf } from '../../lib/guestI18n'

// ─────────────────────────────────────────────────────────────
// AllergenIcons — alergenii produsului, ca pictograme, pe FIECARE card din
// meniul oaspetelui (decizia fondatorului: toți, niciodată ascunși).
//
// Regulamentul UE 1169/2011 cere ca informația să fie disponibilă ÎNAINTE de
// comandă. Până acum ea stătea doar în foaia produsului: oaspetele cu alergie
// trebuia să deschidă fiecare produs ca s-o vadă, iar butonul „+” de pe card
// adăuga în coș fără să o fi văzut vreodată.
//
// Reguli:
//   - TOȚI alergenii, fără plafon și fără „+N” (spre deosebire de etichetele
//     dietetice, care sunt marketing și au voie să fie tăiate);
//   - ordinea canonică din ALLERGENS (aceeași pe orice card), duplicatele o
//     singură dată;
//   - un id necunoscut (date vechi, import) NU se aruncă: apare cu o
//     pictogramă generică, iar numele lui brut intră în textul accesibil;
//   - numele întreg, în limba aleasă, stă în `aria-label` + `title` (un
//     singur rol `img` — e conținut de frază într-un <button>, deci fără listă).
// ─────────────────────────────────────────────────────────────

export function AllergenIcons({
  allergens,
  lang = 'ro',
  chipBg,
  chipBorder,
  size = 22,
}: {
  allergens: readonly string[] | null | undefined
  lang?: string
  /** Fundalul pastilei — din tema cardului (pe poză: sticlă întunecată). */
  chipBg: string
  chipBorder: string
  size?: number
}) {
  const entries = allergenEntries(allergens, lang)
  if (entries.length === 0) return null
  const label = Tf(lang, 'allergens_list_aria', { list: entries.map((e) => e.label).join(', ') })
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="allergen-icons"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}
    >
      {entries.map((e) => (
        <span
          key={e.id}
          aria-hidden
          data-allergen={e.id}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size,
            height: size,
            borderRadius: size / 2,
            background: chipBg,
            border: `1px solid ${chipBorder}`,
            fontSize: Math.round(size * 0.58),
            lineHeight: 1,
          }}
        >
          {e.emoji}
        </span>
      ))}
    </span>
  )
}

export default AllergenIcons
