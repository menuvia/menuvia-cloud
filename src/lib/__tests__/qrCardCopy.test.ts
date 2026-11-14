// Textul TIPĂRIT pe cardurile QR (lib/qrCopy.ts + desenul din lib/qrPdf.ts),
// lotul L6a. Cardul e pentru OASPETE, deci urmează limba de BAZĂ a meniului
// (`restaurants.language`, lotul O6a), nu limba personalului: prima linie în
// limba de bază, a doua în engleză dacă baza nu e engleza.
// (Prefixul QC: verificat cu grep în src/, tests/ și supabase/tests,
// nefolosit înainte.)
//   QC1  limbile cardului sunt EXACT cele 7 ale meniului (MENU_LANGS). Mutația
//        care pică: o limbă scoasă din QR_CARD_LANGS (ex. „hu”).
//   QC2  româna (și baza necunoscută / lipsă) e cardul de DINAINTE, byte cu
//        byte: „Scanează pentru a comanda” + „Scan to order”, „Scanează pentru
//        a vedea meniul” + „Scan to see the menu”. Mutația care pică: baza
//        necunoscută căzută pe engleză (`qrCardLang` → 'en').
//   QC3  meniul englezesc are O SINGURĂ linie. Mutația care pică: `[en, en]`.
//   QC4  fiecare altă limbă: [bază, engleză], în limba ei, iar „comandă” apare
//        DOAR cu `canOrder` (regula PT4 din publicTruth, pe toate limbile).
//        Mutația care pică: `ORDER.de` copiat în `MENU.de`.
//   QC5  desenul: pe bază românească sau lipsă, exact două subtitluri, cu
//        mărimile și culorile de dinainte; pe engleză un singur subtitlu (fără
//        al doilea `text` și fără a doua mărime de font); pe franceză
//        „Scannez pour commander” + „Scan to order”. Mutația care pică: `if
//        (subtitleEn !== undefined)` scos (al doilea `text` cu `undefined`).
//   QC6  fontul (Helvetica / WinAnsi): după transliterarea românească a
//        patch-ului (`roPdfSafe`) și înlocuirea maghiară (`qrPdfText`: ő→ö,
//        ű→ü), FIECARE linie din toate limbile se poate coda în WinAnsi; control
//        POZITIV: „ő”/„ű” NU sunt în WinAnsi și `roPdfSafe` singur le lasă
//        acolo, româna trece prin `qrPdfText` NESCHIMBATĂ, iar desenul aplică
//        regula și pe date (numele restaurantului / mesei). Mutațiile care
//        pică: `qrPdfText` fără „ű”; `qrPdfText(rn)` scos din desen.
//   QC7  fără carduri: refuzul are mesajul românesc de dinainte și hint-ul
//        `qr_pdf_no_cards` (ecranul personalului îl traduce). Mutația care
//        pică: hint-ul scos.
import { describe, it, expect, vi } from 'vitest'

interface DocCall {
  m: string
  args: unknown[]
}

vi.mock('qrcode', () => ({
  default: { toDataURL: (url: string) => Promise.resolve('data:image/png;base64,' + url) },
}))
vi.mock('jspdf', () => ({ default: class {} }))

import { QR_CARD_LANGS, qrCardLang, qrCardLines, qrCardSubtitles, qrPdfText } from '../qrCopy'
import { MENU_LANGS } from '../i18nMenu'
import { roPdfSafe } from '../pdf'
import { QR_PDF_NO_CARDS_HINT, downloadQrPdf, drawQrPdf, type QrPdfDoc, type QrPdfInput } from '../qrPdf'

function makeDoc(): { calls: DocCall[]; doc: QrPdfDoc } {
  const calls: DocCall[] = []
  const rec =
    (m: string) =>
    (...args: unknown[]): void => {
      calls.push({ m, args })
    }
  const doc = {
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
  }
  return { calls, doc: doc as unknown as QrPdfDoc }
}

const texts = (calls: DocCall[]): string[] =>
  calls.filter((c) => c.m === 'text').map((c) => String(c.args[0]))

function input(over: Partial<QrPdfInput> = {}): QrPdfInput {
  return {
    restaurantName: 'La Bella',
    primaryColor: '#C8963C',
    cards: [{ label: 'Masa 1', url: 'https://menuvia.ro/q/tok1' }],
    format: 'grid',
    canOrder: true,
    brandHost: 'menuvia.ro',
    ...over,
  }
}

const qr = (): Promise<string> => Promise.resolve('png')

// Cuvântul „comandă” în fiecare limbă a cardului (QC4).
const ORDER_WORD: Record<string, RegExp> = {
  ro: /comand/i,
  en: /\border\b/i,
  de: /bestell/i,
  fr: /command/i,
  it: /ordin/i,
  hu: /rendel/i,
  es: /pedi/i,
}

// WinAnsi (cp1252): ASCII tipăribil, 0xA0–0xFF și cele 27 de semne din 0x80–0x9F.
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
function winAnsi(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    const ok = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.includes(ch)
    if (!ok) return false
  }
  return true
}

describe('limbile cardului QR', () => {
  it('QC1: exact cele 7 limbi ale meniului', () => {
    expect([...QR_CARD_LANGS].sort()).toEqual(MENU_LANGS.map((l) => l.code).sort())
    for (const order of [true, false]) {
      expect(Object.keys(qrCardSubtitles(order)).sort()).toEqual([...QR_CARD_LANGS].sort())
    }
  })

  it('QC2: baza românească (și lipsă / necunoscută) = cardul de dinainte', () => {
    expect(qrCardSubtitles(true).ro).toBe('Scanează pentru a comanda')
    expect(qrCardSubtitles(true).en).toBe('Scan to order')
    expect(qrCardSubtitles(false).ro).toBe('Scanează pentru a vedea meniul')
    expect(qrCardSubtitles(false).en).toBe('Scan to see the menu')
    for (const lang of ['ro', null, undefined, '', 'xx', 'RO', 'ro-RO']) {
      expect(qrCardLang(lang)).toBe('ro')
      expect(qrCardLines(qrCardSubtitles(true), lang)).toEqual(['Scanează pentru a comanda', 'Scan to order'])
      expect(qrCardLines(qrCardSubtitles(false), lang)).toEqual([
        'Scanează pentru a vedea meniul',
        'Scan to see the menu',
      ])
    }
  })

  it('QC3: meniul englezesc are o singură linie', () => {
    expect(qrCardLines(qrCardSubtitles(true), 'en')).toEqual(['Scan to order'])
    expect(qrCardLines(qrCardSubtitles(false), 'en')).toEqual(['Scan to see the menu'])
  })

  it('QC4: fiecare limbă de bază pe prima linie, engleza pe a doua; „comandă” doar cu comenzi', () => {
    for (const lang of QR_CARD_LANGS) {
      for (const order of [true, false]) {
        const subs = qrCardSubtitles(order)
        const lines = qrCardLines(subs, lang)
        const ctx = `${lang} canOrder=${order}`
        expect(lines[0], ctx).toBe(subs[lang])
        expect(lines[lines.length - 1], ctx).toBe(subs.en)
        expect(lines.length, ctx).toBe(lang === 'en' ? 1 : 2)
        expect(subs[lang].trim().length, ctx).toBeGreaterThan(0)
        expect(ORDER_WORD[lang]!.test(subs[lang]), ctx).toBe(order)
        // Fiecare limbă are textul ei (nu o copie a românei sau a englezei).
        if (lang !== 'ro') expect(subs[lang], ctx).not.toBe(subs.ro)
        if (lang !== 'en') expect(subs[lang], ctx).not.toBe(subs.en)
      }
    }
  })
})

describe('desenul subtitlului', () => {
  const SUB_SIZE_SM = 7 // CARD_SIZES.sm.sub din qrPdf.ts
  it('QC5: două linii pe ro / lipsă, una pe en, [fr, en] pe franceză', async () => {
    for (const menuLanguage of [undefined, null, 'ro'] as const) {
      const { calls, doc } = makeDoc()
      await drawQrPdf(doc, input({ menuLanguage }), qr)
      expect(texts(calls)).toEqual(['La Bella', 'Masa 1', 'Scanează pentru a comanda', 'Scan to order', 'menuvia.ro'])
      const sizes = calls.filter((c) => c.m === 'setFontSize').map((c) => c.args[0])
      expect(sizes).toEqual([8, 13, SUB_SIZE_SM, SUB_SIZE_SM - 1, 5])
      const colors = calls.filter((c) => c.m === 'setTextColor').map((c) => c.args)
      expect(colors).toContainEqual([138, 126, 108])
    }

    const en = makeDoc()
    await drawQrPdf(en.doc, input({ menuLanguage: 'en', canOrder: false }), qr)
    expect(texts(en.calls)).toEqual(['La Bella', 'Masa 1', 'Scan to see the menu', 'menuvia.ro'])
    expect(en.calls.filter((c) => c.m === 'setFontSize').map((c) => c.args[0])).toEqual([8, 13, SUB_SIZE_SM, 5])
    expect(en.calls.filter((c) => c.m === 'setTextColor').map((c) => c.args)).not.toContainEqual([138, 126, 108])

    const fr = makeDoc()
    await drawQrPdf(fr.doc, input({ menuLanguage: 'fr' }), qr)
    expect(texts(fr.calls)).toEqual(['La Bella', 'Masa 1', 'Scannez pour commander', 'Scan to order', 'menuvia.ro'])
  })
})

describe('fontul PDF-ului (WinAnsi)', () => {
  it('QC6: toate liniile, în toate limbile, se pot desena; ő/ű înlocuite, româna neatinsă', async () => {
    // Control pozitiv: verificarea chiar respinge ce fontul nu are.
    expect(winAnsi('ő')).toBe(false)
    expect(winAnsi('ű')).toBe(false)
    expect(winAnsi('ș')).toBe(false)
    expect(winAnsi('é ü ñ à ç ä ß ö')).toBe(true)
    expect(roPdfSafe('Kőrösi')).toBe('Kőrösi') // patch-ul românesc nu le atinge
    expect(qrPdfText('Kőrösi Űrhajó ŐŰ')).toBe('Körösi Ürhajó ÖÜ')
    for (const s of ['Scanează pentru a comanda', 'Țară, ăîâș', 'Masa 1']) expect(qrPdfText(s)).toBe(s)

    for (const order of [true, false]) {
      const subs = qrCardSubtitles(order)
      for (const lang of QR_CARD_LANGS) {
        const line = roPdfSafe(qrPdfText(subs[lang]))
        expect(winAnsi(line), `${lang}: ${line}`).toBe(true)
      }
    }

    const { calls, doc } = makeDoc()
    await drawQrPdf(doc, input({ restaurantName: 'Kőrösi Étterem', cards: [{ label: 'Kert ű', url: 'u' }], menuLanguage: 'hu' }), qr)
    expect(texts(calls)).toEqual(['Körösi Étterem', 'Kert ü', 'Olvasd be a rendeléshez', 'Scan to order', 'menuvia.ro'])
  })
})

describe('refuzul fără carduri', () => {
  it('QC7: mesajul românesc de dinainte + hint-ul traductibil', async () => {
    let caught: unknown = null
    try {
      await downloadQrPdf(input({ cards: [] }))
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('Niciun QR de tipărit')
    expect((caught as { hint?: string }).hint).toBe(QR_PDF_NO_CARDS_HINT)
    expect(QR_PDF_NO_CARDS_HINT).toBe('qr_pdf_no_cards')
  })
})
