// PDF-ul de tipărit cu QR-uri (lib/qrPdf.ts), extras din Mese & QR ca să fie
// descărcabil și de pe ecranul final al onboarding-ului (ux-owner-final-screen).
//
//   QP1  așezarea pe A4 e cea de dinainte: grilă 6/pagină (80×82), carduri
//        pliabile 4/pagină (90×90), poster 1/pagină cu margini de 15 mm; al
//        șaptelea card din grilă trece pe pagina 2, în primul loc. Mutația care
//        pică: orice constantă de așezare schimbată (ex. 3 coloane).
//   QP2  desenul: fiecare masă cu numele și QR-ul ei (link + 400 px), câte o
//        pagină nouă la fiecare 6 carduri, subtitlul urmează PLANUL (fără
//        comenzi → „vedea meniul”), numele lung al restaurantului e scurtat.
//        Mutația care pică: `canOrder` ignorat (subtitlu fix „pentru a comanda”).
//   QP3  un QR care nu se poate genera lasă un pătrat gol, nu oprește PDF-ul
//   QP4  descărcarea: jsPDF încărcat la cerere, diacriticele transliterate
//        (patchPdfDiacritics), numele de fișier neschimbat; fără carduri →
//        eroare, nu un PDF gol. Mutația care pică: scoaterea patch-ului.
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface DocCall {
  m: string
  args: unknown[]
}

const h = vi.hoisted(() => {
  const docs: Array<{ calls: DocCall[] }> = []
  function makeDoc() {
    const calls: DocCall[] = []
    const rec =
      (m: string) =>
      (...args: unknown[]): void => {
        calls.push({ m, args })
      }
    const doc = {
      calls,
      setFillColor: rec('setFillColor'),
      setDrawColor: rec('setDrawColor'),
      setTextColor: rec('setTextColor'),
      setLineWidth: rec('setLineWidth'),
      setFontSize: rec('setFontSize'),
      setFont: rec('setFont'),
      roundedRect: rec('roundedRect'),
      rect: rec('rect'),
      text: rec('text'),
      addImage: rec('addImage'),
      addPage: rec('addPage'),
      save: rec('save'),
    }
    docs.push(doc)
    return doc
  }
  return { docs, makeDoc }
})

vi.mock('jspdf', () => ({
  // `new jsPDF(...)` întoarce documentul fals (un constructor care întoarce un obiect).
  default: class FakeJsPdf {
    constructor() {
      return h.makeDoc()
    }
  },
}))
vi.mock('qrcode', () => ({
  default: { toDataURL: (url: string) => Promise.resolve('data:image/png;base64,' + url) },
}))

import {
  downloadQrPdf,
  drawQrPdf,
  qrPdfFileName,
  qrPdfLayout,
  type QrPdfDoc,
  type QrPdfInput,
} from '../qrPdf'

const texts = (calls: DocCall[]): string[] =>
  calls.filter((c) => c.m === 'text').map((c) => String(c.args[0]))
const count = (calls: DocCall[], m: string): number => calls.filter((c) => c.m === m).length

function input(over: Partial<QrPdfInput> = {}): QrPdfInput {
  return {
    restaurantName: 'La Bella',
    primaryColor: '#C8963C',
    cards: Array.from({ length: 7 }, (_, i) => ({
      label: `Masa ${i + 1}`,
      url: `https://menuvia.ro/q/tok${i + 1}`,
    })),
    format: 'grid',
    canOrder: false,
    brandHost: 'menuvia.ro',
    ...over,
  }
}

beforeEach(() => {
  h.docs.length = 0
})

describe('qrPdfLayout', () => {
  it('QP1 așezarea de dinainte: grilă 6/A4, pliabile 4/A4, poster 1/A4', () => {
    const grid = qrPdfLayout('grid', 7)
    expect(grid.map((s) => s.page)).toEqual([0, 0, 0, 0, 0, 0, 1])
    expect(grid[0]).toEqual({ page: 0, x: 50 / 3, y: 12.75, w: 80, h: 82, scale: 'sm' })
    expect(grid[1]!.x).toBeCloseTo(50 / 3 + 80 + 50 / 3, 6)
    expect(grid[2]!.y).toBeCloseTo(12.75 + 82 + 12.75, 6)
    // Primul card de pe pagina 2 stă în primul loc al paginii.
    expect({ x: grid[6]!.x, y: grid[6]!.y }).toEqual({ x: grid[0]!.x, y: grid[0]!.y })

    const tent = qrPdfLayout('tent', 5)
    expect(tent.map((s) => s.page)).toEqual([0, 0, 0, 0, 1])
    expect(tent[0]).toEqual({ page: 0, x: 10, y: 39, w: 90, h: 90, scale: 'md' })

    const poster = qrPdfLayout('poster', 2)
    expect(poster).toEqual([
      { page: 0, x: 15, y: 15, w: 180, h: 267, scale: 'lg' },
      { page: 1, x: 15, y: 15, w: 180, h: 267, scale: 'lg' },
    ])
    expect(qrPdfLayout('grid', 0)).toEqual([])
  })
})

describe('drawQrPdf', () => {
  it('QP2 fiecare masă cu QR-ul ei, pagină nouă la 6, subtitlul după plan', async () => {
    const doc = h.makeDoc()
    const makeQr = vi.fn((url: string, size: number) => Promise.resolve(`png:${url}:${size}`))
    await drawQrPdf(doc as unknown as QrPdfDoc, input(), makeQr)
    expect(count(doc.calls, 'addPage')).toBe(1)
    expect(count(doc.calls, 'addImage')).toBe(7)
    expect(makeQr).toHaveBeenCalledTimes(7)
    expect(makeQr).toHaveBeenCalledWith('https://menuvia.ro/q/tok7', 400)
    const all = texts(doc.calls)
    for (let i = 1; i <= 7; i++) expect(all).toContain(`Masa ${i}`)
    expect(all.filter((t) => t === 'Scanează pentru a vedea meniul')).toHaveLength(7)
    expect(all).not.toContain('Scanează pentru a comanda')
    expect(all.filter((t) => t === 'menuvia.ro')).toHaveLength(7)

    const ordering = h.makeDoc()
    await drawQrPdf(ordering as unknown as QrPdfDoc, input({ canOrder: true }), makeQr)
    expect(texts(ordering.calls)).toContain('Scanează pentru a comanda')

    const long = h.makeDoc()
    await drawQrPdf(
      long as unknown as QrPdfDoc,
      input({
        restaurantName: 'Restaurantul cu un nume foarte foarte lung',
        cards: [input().cards[0]!],
      }),
      makeQr,
    )
    expect(texts(long.calls)[0]).toBe('Restaurantul cu un nume …')
  })

  it('QP3 un QR care eșuează lasă un pătrat gol, restul PDF-ului continuă', async () => {
    const doc = h.makeDoc()
    const makeQr = vi.fn((url: string) =>
      url.endsWith('tok2') ? Promise.reject(new Error('qr')) : Promise.resolve('png'),
    )
    await drawQrPdf(doc as unknown as QrPdfDoc, input({ cards: input().cards.slice(0, 3) }), makeQr)
    expect(count(doc.calls, 'addImage')).toBe(2)
    expect(count(doc.calls, 'rect')).toBe(1)
    expect(texts(doc.calls)).toContain('Masa 3')
  })
})

describe('downloadQrPdf', () => {
  it('QP4 jsPDF la cerere, diacritice transliterate, numele de fișier de dinainte', async () => {
    const name = await downloadQrPdf(
      input({ restaurantName: 'Casa Țărănească', cards: [{ label: 'Terasă 1', url: 'u1' }] }),
    )
    expect(name).toBe(qrPdfFileName('grid', 'Casa Țărănească'))
    expect(name).toBe('QR-Mese-grid-Casa---r-neasc-.pdf')
    expect(h.docs).toHaveLength(1)
    const doc = h.docs[0]!
    expect(texts(doc.calls)).toContain('Casa Taraneasca')
    expect(texts(doc.calls)).toContain('Terasa 1')
    expect(doc.calls.find((c: DocCall) => c.m === 'save')?.args[0]).toBe(name)
    expect(doc.calls.find((c: DocCall) => c.m === 'addImage')?.args[0]).toBe('data:image/png;base64,u1')

    await expect(downloadQrPdf(input({ cards: [] }))).rejects.toThrow(/Niciun QR/)
  })

  it('QP4b prefixul de fișier pentru QR-ul meniului general', () => {
    expect(qrPdfFileName('poster', 'La Bella', 'QR-Meniu')).toBe('QR-Meniu-poster-La-Bella.pdf')
  })
})
