// ─────────────────────────────────────────────────────────────
// qrPdf.ts — PDF-ul de tipărit cu QR-urile meselor (sau cu QR-ul meniului).
//
// Extras din TablesManager (Mese & QR), ca același PDF să poată fi descărcat
// și de pe ecranul final al onboarding-ului (ux-owner-final-screen): înainte,
// patronul care tocmai își crease mesele afla doar că „PDF-ul e în tab-ul Mese
// & QR”, adică încă patru apăsări până la primul QR tipărit. Desenul e IDENTIC
// cu cel de dinainte (aceleași dimensiuni, culori, texte și nume de fișier).
//
// jsPDF (~560 KB) se încarcă la cerere, doar la descărcare. Desenul primește
// documentul și generatorul de QR ca parametri, ca să poată fi testat cu
// falsuri (fără canvas și fără jsPDF în jsdom).
// ─────────────────────────────────────────────────────────────
import QRCode from 'qrcode'
import { patchPdfDiacritics } from './pdf'
import { qrCardSubtitles } from './qrCopy'

export type QrPdfFormat = 'grid' | 'tent' | 'poster'

export interface QrPdfCard {
  /** Textul mare de pe card: numele mesei (sau „Meniu” pentru QR-ul general). */
  label: string
  /** Linkul codat în QR (ex. https://menuvia.ro/q/<token>). */
  url: string
}

export interface QrPdfInput {
  restaurantName: string
  primaryColor?: string | null
  cards: QrPdfCard[]
  format: QrPdfFormat
  /**
   * Planul permite comenzi prin QR (`order_qr`). `false` când nu se știe: un
   * card tipărit care promite comenzi nu se mai poate retrage de pe mese (qrCopy).
   */
  canOrder: boolean
  /** Hostul de brand din subsolul cardului (`siteHost()`). */
  brandHost: string
  /** Prefixul numelui de fișier: „QR-Mese” (implicit) sau „QR-Meniu”. */
  filePrefix?: string
}

type CardScale = 'sm' | 'md' | 'lg'

/** Locul unui card pe pagină, în mm (A4 portret). */
export interface QrCardSlot {
  page: number
  x: number
  y: number
  w: number
  h: number
  scale: CardScale
}

const PAGE_W = 210
const PAGE_H = 297

/**
 * Așezarea cardurilor: `grid` = 6 / A4 (2×3, pentru lipit pe mese), `tent` =
 * 4 / A4 (2×2, carduri pliabile), `poster` = 1 / A4 (intrare, vitrină).
 */
export function qrPdfLayout(format: QrPdfFormat, count: number): QrCardSlot[] {
  const slots: QrCardSlot[] = []
  if (format === 'poster') {
    const margin = 15
    for (let i = 0; i < count; i++) {
      slots.push({
        page: i,
        x: margin,
        y: margin,
        w: PAGE_W - 2 * margin,
        h: PAGE_H - 2 * margin,
        scale: 'lg',
      })
    }
    return slots
  }
  const grid =
    format === 'tent'
      ? { cols: 2, rows: 2, w: 90, h: 90, scale: 'md' as const }
      : { cols: 2, rows: 3, w: 80, h: 82, scale: 'sm' as const }
  const perPage = grid.cols * grid.rows
  const mX = (PAGE_W - grid.cols * grid.w) / (grid.cols + 1)
  const mY = (PAGE_H - grid.rows * grid.h) / (grid.rows + 1)
  for (let i = 0; i < count; i++) {
    const idx = i % perPage
    const col = idx % grid.cols
    const row = Math.floor(idx / grid.cols)
    slots.push({
      page: Math.floor(i / perPage),
      x: mX + col * (grid.w + mX),
      y: mY + row * (grid.h + mY),
      w: grid.w,
      h: grid.h,
      scale: grid.scale,
    })
  }
  return slots
}

/** "#C8963C" → [200, 150, 60]; `null` pe valoare invalidă (apelantul pune accentul implicit). */
export function hexToRgb(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) return null
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Numele fișierului descărcat — neschimbat față de exportul din Mese & QR. */
export function qrPdfFileName(
  format: QrPdfFormat,
  restaurantName: string,
  prefix = 'QR-Mese',
): string {
  return `${prefix}-${format}-${restaurantName.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`
}

/** Minimul din jsPDF pe care îl folosește desenul (un doc fals în teste). */
export interface QrPdfDoc {
  setFillColor(r: number, g: number, b: number): unknown
  setDrawColor(r: number, g: number, b: number): unknown
  setTextColor(r: number, g: number, b: number): unknown
  setLineWidth(width: number): unknown
  setFontSize(size: number): unknown
  setFont(name: string, style: string): unknown
  roundedRect(
    x: number,
    y: number,
    w: number,
    h: number,
    rx: number,
    ry: number,
    style: string,
  ): unknown
  rect(x: number, y: number, w: number, h: number, style: string): unknown
  text(text: string, x: number, y: number, options: { align: 'center' }): unknown
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): unknown
  addPage(): unknown
}

/** Generatorul de imagine QR (data URL PNG) pentru un link. */
export type QrDataUrlFn = (url: string, size: number) => Promise<string>

/** QR-ul local (fără API extern), cu culorile cardurilor tipărite. */
export function qrDataUrl(url: string, size: number): Promise<string> {
  return QRCode.toDataURL(url, {
    width: size,
    margin: 1,
    color: { dark: '#1A1208', light: '#F8F3EB' },
  })
}

const CARD_SIZES: Record<
  CardScale,
  { rn: number; tn: number; qFrac: number; sub: number; brand: number }
> = {
  sm: { rn: 8, tn: 13, qFrac: 0.5, sub: 7, brand: 5 },
  md: { rn: 11, tn: 18, qFrac: 0.55, sub: 9, brand: 6 },
  lg: { rn: 18, tn: 36, qFrac: 0.6, sub: 14, brand: 9 },
}

/** Desenează toate cardurile în `doc` (paginile noi se adaugă aici). */
export async function drawQrPdf(
  doc: QrPdfDoc,
  input: QrPdfInput,
  makeQr: QrDataUrlFn,
): Promise<void> {
  const accent = hexToRgb(input.primaryColor) || [200, 150, 60]
  const { ro: subtitleRo, en: subtitleEn } = qrCardSubtitles(input.canOrder)
  const slots = qrPdfLayout(input.format, input.cards.length)
  let page = 0
  for (let i = 0; i < input.cards.length; i++) {
    const card = input.cards[i]!
    const { x, y, w: cW, h: cH, scale } = slots[i]!
    if (slots[i]!.page > page) {
      doc.addPage()
      page = slots[i]!.page
    }
    const sizes = CARD_SIZES[scale]

    // Fundal + chenar (cu accentul restaurantului)
    doc.setFillColor(248, 243, 235)
    doc.roundedRect(x, y, cW, cH, 4, 4, 'F')
    doc.setDrawColor(accent[0], accent[1], accent[2])
    doc.setLineWidth(scale === 'lg' ? 1.2 : 0.5)
    doc.roundedRect(x, y, cW, cH, 4, 4, 'S')

    // Numele restaurantului
    doc.setFontSize(sizes.rn)
    doc.setTextColor(26, 18, 8)
    doc.setFont('helvetica', 'bold')
    const maxRn = scale === 'lg' ? 38 : 26
    const rn =
      input.restaurantName.length > maxRn
        ? input.restaurantName.slice(0, maxRn - 2) + '…'
        : input.restaurantName
    doc.text(rn, x + cW / 2, y + cH * 0.1, { align: 'center' })

    // Masa (cu accentul restaurantului)
    doc.setFontSize(sizes.tn)
    doc.setTextColor(accent[0], accent[1], accent[2])
    doc.text(card.label, x + cW / 2, y + cH * 0.2, { align: 'center' })

    // QR-ul — generat local, fără cerere externă
    const qs = Math.min(cW, cH) * sizes.qFrac
    const qx = x + (cW - qs) / 2
    const qy = y + cH * 0.27
    try {
      const imgData = await makeQr(card.url, 400)
      doc.addImage(imgData, 'PNG', qx, qy, qs, qs)
    } catch {
      doc.setFillColor(220, 215, 208)
      doc.rect(qx, qy, qs, qs, 'F')
    }

    // Subtitlu bilingv
    doc.setFontSize(sizes.sub)
    doc.setTextColor(60, 50, 38)
    doc.setFont('helvetica', 'normal')
    doc.text(subtitleRo, x + cW / 2, y + cH * 0.85, { align: 'center' })
    doc.setFontSize(sizes.sub - 1)
    doc.setTextColor(138, 126, 108)
    doc.text(subtitleEn, x + cW / 2, y + cH * 0.9, { align: 'center' })

    // Subsol de brand
    doc.setFontSize(sizes.brand)
    doc.setTextColor(190, 180, 170)
    doc.text(input.brandHost, x + cW / 2, y + cH * 0.96, { align: 'center' })
  }
}

/**
 * Generează PDF-ul și îl descarcă (jsPDF încărcat la cerere). Întoarce numele
 * fișierului. Aruncă dacă nu există niciun card sau dacă jsPDF nu se încarcă —
 * apelantul afișează eroarea.
 */
export async function downloadQrPdf(input: QrPdfInput): Promise<string> {
  if (input.cards.length === 0) throw new Error('Niciun QR de tipărit')
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  // Fonturile standard jsPDF nu au ă/ș/ț — fără patch, numele restaurantului
  // și al meselor ieșeau cu caractere rupte în PDF-ul de print.
  patchPdfDiacritics(doc)
  // Aserțiune structurală (ca în pdf.ts): tipurile jsPDF au supraîncărcări pe
  // care o interfață minimală nu le poate reproduce exact; desenul folosește
  // doar metodele din QrPdfDoc, cu exact argumentele de mai sus.
  await drawQrPdf(doc as unknown as QrPdfDoc, input, qrDataUrl)
  const name = qrPdfFileName(input.format, input.restaurantName, input.filePrefix)
  doc.save(name)
  return name
}
