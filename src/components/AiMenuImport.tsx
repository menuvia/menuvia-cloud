// AiMenuImport — import meniu din poze (Faza D; upgrade audit aug 2026)
// Userul încarcă până la 4 poze cu meniul (paginile) → AI (vision, prin
// ai-proxy) extrage produsele CU categoriile lor → ecran de REVIZUIRE editabil
// → creare categorii lipsă + inserare în bulk prin useProducts (respectă RLS).
//
// Cele 3 reparații din audit (fluxul-vedetă de onboarding era sabotat exact
// la primul contact):
//  1. MULTI-POZĂ: meniurile reale au 4–8 pagini; toate pozele intră într-UN
//     singur apel AI (o singură lovitură de cotă), nu N rulări manuale.
//  2. COMPRESIE client-side (canvas, max 1800px, JPEG): pozele de telefon de
//     4–8MB picau pe limita de 5MB; acum intră lejer și N pagini în payload.
//  3. CATEGORII: AI-ul întoarce și secțiunea din meniu; potrivim automat cu
//     categoriile existente (case-insensitive) și oferim „➕ (nouă)" pentru
//     rest — zero dropdown-uri manuale pe 100 de produse.
import { useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { D } from '../lib/constants'
import { useIsMobile } from '../hooks/useIsMobile'
import { useProducts, useCategories } from '../hooks/useData'
import { aiMenuImport, type AiPart } from '../lib/ai'

interface DraftProduct {
  name: string
  description: string
  price: number
  emoji: string
  // '' = fără categorie · uuid = categorie existentă · 'new:<nume>' = de creat
  category_id: string
  category_name: string
  include: boolean
}

const MAX_PHOTOS = 4
// Baza64 combinată ≤ ~4,2MB: sub limita de body a funcției Netlify (~6MB)
// cu marjă pentru restul payload-ului.
const MAX_TOTAL_BASE64 = 4_200_000

function fileToBase64(file: File): Promise<{ media_type: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve({ media_type: file.type || 'image/jpeg', data: comma >= 0 ? result.slice(comma + 1) : result })
    }
    reader.onerror = () => reject(new Error('Nu am putut citi fișierul.'))
    reader.readAsDataURL(file)
  })
}

// Redimensionează + recomprimă poza pe canvas (max 1800px latura mare, JPEG).
// Pozele direct din cameră au 4–8MB — fără compresie picau pe limita de 5MB
// și făceau multi-poza imposibilă. Dacă browserul nu poate decoda formatul
// (ex. HEIC pe unele desktop-uri), cădem pe fișierul original nemodificat.
async function prepareImage(file: File): Promise<{ media_type: string; data: string }> {
  try {
    const bitmap = await createImageBitmap(file)
    const maxSide = 1800
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas indisponibil')
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
    const comma = dataUrl.indexOf(',')
    return { media_type: 'image/jpeg', data: dataUrl.slice(comma + 1) }
  } catch {
    return fileToBase64(file)
  }
}

// Validează output-ul AI (array de produse) → drafturi tipate.
function parseDrafts(text: string): DraftProduct[] {
  const clean = text.replace(/```json|```/g, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(clean)
  } catch {
    // încearcă să extragă primul array din text
    const m = clean.match(/\[[\s\S]*\]/)
    if (!m) return []
    try { parsed = JSON.parse(m[0]) } catch { return [] }
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as Record<string, unknown>).name === 'string')
    .slice(0, 200)
    .map((p) => ({
      name: String(p.name).slice(0, 200),
      description: p.description == null ? '' : String(p.description).slice(0, 1000),
      price: Number.isFinite(Number(p.price)) && Number(p.price) >= 0 ? Number(p.price) : 0,
      emoji: typeof p.emoji === 'string' ? p.emoji.slice(0, 8) : '',
      category_id: '',
      category_name: typeof p.category === 'string' ? p.category.trim().slice(0, 80) : '',
      include: true,
    }))
}

export default function AiMenuImport({ restaurantId, onClose }: { restaurantId: string; onClose: () => void }) {
  useBodyScrollLock(true)
  const isMobile = useIsMobile()
  const products = useProducts(restaurantId)
  const categories = useCategories(restaurantId)
  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftProduct[]>([])
  const [imported, setImported] = useState(0)
  const [importErrors, setImportErrors] = useState<string[]>([])

  // Potrivește numele de categorie extras de AI cu categoriile existente
  // (trim + case-insensitive). Nepotrivit → marker 'new:<nume>' (creat la
  // salvare). Fără nume → fără categorie.
  function seedCategoryIds(parsed: DraftProduct[]): DraftProduct[] {
    const byName = new Map(categories.categories.map((c) => [c.name.trim().toLowerCase(), c.id]))
    return parsed.map((d) => {
      if (!d.category_name) return d
      const existing = byName.get(d.category_name.toLowerCase())
      return { ...d, category_id: existing ?? `new:${d.category_name}` }
    })
  }

  async function handleFiles(fileList: FileList) {
    const files = Array.from(fileList)
    if (files.length === 0) return
    // FĂRĂ slice tăcut (audit aug 2026): la 6 pagini selectate, paginile 5-6
    // dispăreau din import fără niciun mesaj — meniu publicat incomplet,
    // nedetectabil de patron. Respingem explicit, cu instrucțiune.
    if (files.length > MAX_PHOTOS) {
      setError(`Poți încărca maximum ${MAX_PHOTOS} poze odată. Importă restul paginilor într-o a doua rundă — produsele se adaugă, nu se înlocuiesc.`)
      return
    }
    setError(null)
    setImportErrors([])
    setBusy(true)
    try {
      const images: { media_type: string; data: string }[] = []
      for (const f of files) {
        images.push(await prepareImage(f))
      }
      // Formate pe care API-ul de vision nu le acceptă (ex. HEIC de pe iPhone,
      // când canvas-ul nu l-a putut decoda și am căzut pe fișierul original):
      // mesaj clar AICI, nu eroare criptică de API după ce s-a consumat timpul.
      const SUPPORTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
      if (images.some((im) => !SUPPORTED.includes(im.media_type))) {
        setError('Un fișier are un format nesuportat (ex. HEIC). Exportă-l ca JPEG/PNG sau fă un screenshot al meniului.')
        setBusy(false)
        return
      }
      const total = images.reduce((s, im) => s + im.data.length, 0)
      if (total > MAX_TOTAL_BASE64) {
        setError('Pozele sunt prea mari chiar și comprimate. Încearcă mai puține pagini odată.')
        setBusy(false)
        return
      }
      const content: AiPart[] = [
        ...images.map((im): AiPart => ({ type: 'image', media_type: im.media_type, data: im.data })),
        {
          type: 'text',
          text:
            'Extrage toate produsele din aceste poze de meniu (pot fi mai multe pagini ale ACELUIAȘI meniu). ' +
            'Returnează DOAR un JSON array, fără markdown, cu obiecte de forma ' +
            '{"name": string, "description": string|null, "price": number, "emoji": string, "category": string|null}. ' +
            'Prețurile în lei (număr fără simbol). Emoji relevant pentru fiecare produs. ' +
            '"category" = numele secțiunii din meniu în care apare produsul (ex. "Feluri principale", "Băuturi") — ' +
            'folosește EXACT același nume pentru toate produsele din aceeași secțiune; null dacă nu e clar.',
        },
      ]
      // 8000, nu 4000 (audit aug 2026): 4 pagini × ~40 produse × ~50 tokens
      // per obiect JSON depășeau 4000 → output TRUNCAT mid-array → parseDrafts
      // întorcea [] → mesajul FALS „nu am găsit produse", cu cota consumată.
      const res = await aiMenuImport({ restaurant_id: restaurantId, messages: [{ role: 'user', content }], max_tokens: 8000 })
      const parsed = seedCategoryIds(parseDrafts(res.text))
      if (parsed.length === 0) {
        setError('Nu am găsit produse în poze. Încearcă poze mai clare.')
        setBusy(false)
        return
      }
      setDrafts(parsed)
      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la procesarea pozelor.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmImport() {
    setBusy(true)
    setError(null)
    let ok = 0
    const failed: string[] = []
    const selected = drafts.filter((d) => d.include && d.name.trim())

    // 1. Creează categoriile noi ('new:<nume>') o singură dată per nume.
    //    RE-POTRIVIRE întâi contra listei PROASPETE de categorii: seedCategoryIds
    //    a rulat la procesarea pozelor, când `categories` putea fi încă în curs
    //    de încărcare — fără re-check aici, „Băuturi" existent ar fi fost
    //    re-creat ca duplicat (tabela NU are unique pe nume, verificat).
    //    Eșecul unei creări nu blochează importul: produsele ei cad pe „fără
    //    categorie" (recuperabil din tab-ul Produse), raportat vizibil.
    const freshByName = new Map(categories.categories.map((c) => [c.name.trim().toLowerCase(), c.id]))
    const newNames = [...new Set(
      selected
        .filter((d) => d.category_id.startsWith('new:'))
        .map((d) => d.category_id.slice(4)),
    )]
    const createdByName = new Map<string, string>()
    for (const name of newNames) {
      const existing = freshByName.get(name.trim().toLowerCase())
      if (existing) {
        createdByName.set(name, existing)
        continue
      }
      const r = await categories.create({ name })
      if (!r.error && r.data) {
        createdByName.set(name, (r.data as { id: string }).id)
      } else {
        console.error('confirmImport category create failed', name, r.error)
        failed.push(`categoria „${name}": nu a putut fi creată (produsele ei intră fără categorie)`)
      }
    }

    const resolveCategory = (d: (typeof selected)[number]): string | null => {
      if (!d.category_id) return null
      if (d.category_id.startsWith('new:')) return createdByName.get(d.category_id.slice(4)) ?? null
      return d.category_id
    }
    const toRow = (d: (typeof selected)[number]) => ({
      name: d.name.trim(),
      description: d.description.trim() || null,
      price: d.price,
      emoji: d.emoji,
      category_id: resolveCategory(d),
    })
    // OPT-5: UN singur INSERT în lot + UN singur refetch (createMany) — la 50
    // de produse: ~100 RTT-uri seriale → 2. Fallback pe bucla per-rând DOAR
    // dacă batch-ul eșuează (păstrează raportarea per-produs a eșecurilor).
    const batch = selected.length > 0 ? await products.createMany(selected.map(toRow)) : null
    if (batch && !batch.error) {
      ok = batch.data?.length ?? selected.length
    } else if (selected.length > 0) {
      if (batch?.error) console.error('confirmImport batch insert failed, per-row fallback', batch.error)
      for (const d of selected) {
        const r = await products.create(toRow(d))
        if (!r.error) ok++
        else {
          console.error('confirmImport product create failed', r.error)
          failed.push(`${d.name.trim() || 'produs fără nume'}: nu a putut fi salvat`)
        }
      }
    }
    setImported(ok)
    setImportErrors(failed)
    setBusy(false)
    setStep('done')
  }

  function patch(i: number, p: Partial<DraftProduct>) {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...p } : d)))
  }

  // Numele de categorii NOI distincte din drafturi — opțiunile '➕ (nouă)'
  // din select (aceeași listă pentru toate rândurile, ca să poți muta un
  // produs într-o secțiune nouă găsită la alt produs).
  const newCategoryNames = [...new Set(
    drafts.filter((d) => d.category_id.startsWith('new:')).map((d) => d.category_id.slice(4)),
  )]

  const field = { background: D.s3, border: `1px solid ${D.border}`, borderRadius: 7, color: D.t1, padding: '7px 9px', fontSize: '0.82rem', fontFamily: 'DM Sans,sans-serif', boxSizing: 'border-box' as const }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', zIndex: 1000, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: D.s1, border: `1px solid ${D.border}`, borderRadius: isMobile ? '18px 18px 0 0' : 18, width: '100%', maxWidth: 640, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'Fraunces,serif', fontSize: '1.1rem', color: D.t1 }}>📸 Import meniu din poze</span>
          <button onClick={onClose} aria-label="Închide" style={{ background: 'transparent', border: 'none', color: D.t2, cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          {error && <div style={{ background: D.redA, border: `1px solid ${D.red}44`, color: D.red, borderRadius: 9, padding: '10px 13px', fontSize: '0.84rem', marginBottom: 14 }}>{error}</div>}

          {step === 'upload' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <p style={{ color: D.t2, fontSize: '0.9rem', lineHeight: 1.5, marginBottom: 20 }}>
                Fotografiază sau încarcă până la {MAX_PHOTOS} poze clare cu meniul (paginile lui).
                AI-ul extrage produsele și secțiunile, apoi verifici și corectezi înainte de salvare.
              </p>
              <label style={{ display: 'inline-block', background: D.gold, color: '#000', borderRadius: 10, padding: '13px 28px', fontSize: '0.9rem', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Se procesează…' : 'Alege pozele'}
                <input type="file" accept="image/*" multiple disabled={busy} onChange={(e) => { if (e.target.files && e.target.files.length > 0) void handleFiles(e.target.files) }} style={{ display: 'none' }} />
              </label>
            </div>
          )}

          {step === 'review' && (
            <>
              <p style={{ color: D.t1, fontSize: '0.92rem', marginBottom: 4, fontWeight: 600 }}>Am găsit {drafts.length} produse. E totul corect?</p>
              <p style={{ color: D.t2, fontSize: '0.8rem', marginBottom: 16 }}>
                Corectează ce e greșit, debifează ce nu vrei, apoi salvează.
                {newCategoryNames.length > 0 && ` Secțiunile marcate cu ➕ se creează automat la salvare.`}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {drafts.map((d, i) => (
                  <div key={i} style={{ background: d.include ? D.s2 : D.s1, border: `1px solid ${D.border}`, borderRadius: 10, padding: 12, opacity: d.include ? 1 : 0.55 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <input type="checkbox" checked={d.include} onChange={(e) => patch(i, { include: e.target.checked })} style={{ width: 18, height: 18, accentColor: '#C8963C' }} />
                      <input style={{ ...field, width: 56, textAlign: 'center' }} value={d.emoji} onChange={(e) => patch(i, { emoji: e.target.value })} placeholder="🍽️" />
                      <input style={{ ...field, flex: 1 }} value={d.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Nume produs" />
                      <input style={{ ...field, width: 80 }} type="number" value={d.price} onChange={(e) => patch(i, { price: parseFloat(e.target.value) || 0 })} />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input style={{ ...field, flex: 1 }} value={d.description} onChange={(e) => patch(i, { description: e.target.value })} placeholder="Descriere (opțional)" />
                      <select style={{ ...field, width: 170 }} value={d.category_id} onChange={(e) => patch(i, { category_id: e.target.value })}>
                        <option value="">Fără categorie</option>
                        {categories.categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                        ))}
                        {newCategoryNames.map((name) => (
                          <option key={`new:${name}`} value={`new:${name}`}>➕ {name} (nouă)</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 'done' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{importErrors.length > 0 ? '⚠️' : '✅'}</div>
              <p style={{ color: D.t1, fontSize: '1rem', fontWeight: 600, marginBottom: 6 }}>
                {importErrors.length > 0
                  ? `${imported} produse salvate, ${importErrors.length} probleme`
                  : `${imported} produse adăugate!`}
              </p>
              <p style={{ color: D.t2, fontSize: '0.85rem', marginBottom: importErrors.length > 0 ? 14 : 0 }}>Le găsești în tab-ul Produse.</p>
              {importErrors.length > 0 && (
                <div style={{ textAlign: 'left', background: D.redA, border: `1px solid ${D.red}44`, borderRadius: 9, padding: '10px 13px', fontSize: '0.8rem', color: D.red, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {importErrors.map((msg, i) => (
                    <span key={i}>• {msg}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {step === 'review' && (
          <div style={{ padding: 16, borderTop: `1px solid ${D.border}`, display: 'flex', gap: 10 }}>
            <button onClick={() => setStep('upload')} style={{ background: 'transparent', color: D.t2, border: `1px solid ${D.border}`, borderRadius: 10, padding: '12px 18px', fontSize: '0.86rem', cursor: 'pointer' }}>
              Înapoi
            </button>
            <button onClick={() => void confirmImport()} disabled={busy} className="pressable" style={{ flex: 1, background: D.gold, color: '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: '0.9rem', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Se salvează…' : `Salvează ${drafts.filter((d) => d.include).length} produse`}
            </button>
          </div>
        )}
        {step === 'done' && (
          <div style={{ padding: 16, borderTop: `1px solid ${D.border}` }}>
            <button onClick={onClose} className="pressable" style={{ width: '100%', background: D.gold, color: '#000', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer' }}>
              Gata
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
