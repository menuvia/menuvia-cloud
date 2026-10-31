// Codarea pozelor urcate din panou (audit perf oct 2026). Pe iPhone,
// `canvas.toBlob(…, 'image/webp')` întoarce PNG, iar codul vechi îl urca sub
// nume `.webp` cu `contentType: 'image/webp'` — poze de produs, thumb-uri și
// cover-ul (LCP-ul meniului public) de ~10× mai grele. Ce păzesc:
//   IE1  unde există encoder WebP, rezultatul e WebP (fără regresie pe Chrome).
//   IE2  Safari + fotografie → JPEG adevărat, cu extensie `jpg`.
//   IE3  Safari + sursă cu transparență (logo, PNG decupat) → PNG cu `png`,
//        refolosind blob-ul deja codat (fără a doua codare).
//   IE4  nicio imagine codată → eroare, nu un upload cu tip inventat.
//   IE5  thumb-ul iese în ACELAȘI format ca originalul, altfel null.
//   IE6  thumbUrlFor știe convenția `_t` pe webp/jpg/png și sare imaginile AI.
//   IE7  clichet pe surse: niciun upload din ProductsTab/SettingsTab nu mai
//        scrie `'image/webp'` / `.webp` fix (pică pe codul vechi — mutația
//        „revino la contentType fix").
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { encodeForUpload, encodeSameFormat, mayHaveAlpha, type BlobSource } from '../imageEncode'
import { thumbUrlFor } from '../images'

interface FakeCanvas extends BlobSource {
  calls: string[]
}

// `encodes` = tipurile pe care „browserul" le știe coda; orice alt tip cade pe
// PNG, exact ca în specificație (și ca în Safari pentru WebP).
function fakeCanvas(encodes: string[] | null): FakeCanvas {
  const calls: string[] = []
  return {
    calls,
    toBlob(callback, type = 'image/png') {
      calls.push(type)
      if (encodes === null) {
        callback(null)
        return
      }
      const out = encodes.includes(type) ? type : 'image/png'
      callback(new Blob(['pixeli'], { type: out }))
    },
  }
}

const CHROME = ['image/webp', 'image/jpeg', 'image/png']
const SAFARI = ['image/jpeg', 'image/png']

describe('encodeForUpload', () => {
  it('IE1: WebP unde browserul îl codează', async () => {
    const out = await encodeForUpload(fakeCanvas(CHROME), { quality: 0.85 })
    expect(out.ext).toBe('webp')
    expect(out.contentType).toBe('image/webp')
    expect(out.blob.type).toBe('image/webp')
  })

  it('IE2: pe Safari o fotografie devine JPEG, nu PNG deghizat', async () => {
    const canvas = fakeCanvas(SAFARI)
    const out = await encodeForUpload(canvas, { quality: 0.85 })
    expect(out.ext).toBe('jpg')
    expect(out.contentType).toBe('image/jpeg')
    expect(out.blob.type).toBe('image/jpeg')
    expect(canvas.calls).toEqual(['image/webp', 'image/jpeg'])
  })

  it('IE3: pe Safari o sursă cu transparență rămâne PNG adevărat', async () => {
    const canvas = fakeCanvas(SAFARI)
    const out = await encodeForUpload(canvas, { quality: 0.85, alpha: true })
    expect(out.ext).toBe('png')
    expect(out.contentType).toBe('image/png')
    // Blob-ul PNG întors la cererea de WebP e refolosit.
    expect(canvas.calls).toEqual(['image/webp'])
  })

  it('IE4: fără nicio imagine codată aruncă', async () => {
    await expect(encodeForUpload(fakeCanvas(null), { quality: 0.85 })).rejects.toThrow()
  })
})

describe('encodeSameFormat (thumb)', () => {
  it('IE5: același format ca originalul, altfel null', async () => {
    const original = await encodeForUpload(fakeCanvas(SAFARI), { quality: 0.85 })
    const thumb = await encodeSameFormat(fakeCanvas(SAFARI), original, 0.8)
    expect(thumb?.ext).toBe('jpg')

    const webpOriginal = await encodeForUpload(fakeCanvas(CHROME), { quality: 0.85 })
    // Un browser care nu mai codează WebP la thumb nu produce un thumb `.webp` cu PNG.
    expect(await encodeSameFormat(fakeCanvas(SAFARI), webpOriginal, 0.8)).toBeNull()
  })

  it('mayHaveAlpha: doar formatele care pot avea transparență', () => {
    expect(mayHaveAlpha('image/png')).toBe(true)
    expect(mayHaveAlpha('image/webp')).toBe(true)
    expect(mayHaveAlpha('image/jpeg')).toBe(false)
    expect(mayHaveAlpha('image/heic')).toBe(false)
  })
})

describe('thumbUrlFor', () => {
  const base = 'https://x.supabase.co/storage/v1/object/public/product-images/u/r/abc'
  it('IE6: convenția `_t` pe webp / jpg / png; AI și URL-uri externe sar', () => {
    expect(thumbUrlFor(`${base}.webp`)).toBe(`${base}_t.webp`)
    expect(thumbUrlFor(`${base}.jpg`)).toBe(`${base}_t.jpg`)
    expect(thumbUrlFor(`${base}.png`)).toBe(`${base}_t.png`)
    expect(thumbUrlFor(`${base}_t.jpg`)).toBe(`${base}_t.jpg`)
    expect(
      thumbUrlFor('https://x.supabase.co/storage/v1/object/public/product-images/ai/r/p-1.png'),
    ).toBeNull()
    expect(thumbUrlFor('https://cdn.example.com/poza.jpg')).toBeNull()
    expect(thumbUrlFor(null)).toBeNull()
  })
})

describe('clichet pe surse', () => {
  const ROOT = process.cwd()
  const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')
  it('IE7: upload-urile nu mai fixează WebP în nume sau în Content-Type', () => {
    for (const file of ['src/components/ProductsTab.tsx', 'src/components/SettingsTab.tsx']) {
      const src = read(file)
      expect(src, file).not.toMatch(/contentType:\s*'image\/webp'/)
      expect(src, file).not.toMatch(/'(_t)?\.webp'/)
      expect(src, file).toMatch(/encodeForUpload\(/)
    }
  })
})
