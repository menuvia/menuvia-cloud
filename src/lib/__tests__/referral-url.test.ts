// Linkul de referral al afiliatului pe cele două site-uri (recenzie #288).
//
//   RU1  menuvia.com (și www) → originea CANONICĂ .com, nu VITE_APP_URL (.ro)
//   RU2  .ro și orice alt host → EXACT formula veche `VITE_APP_URL || origin`
//        (control pozitiv: comportamentul de pe .ro nu se schimbă)
//   RU3  slash-ul final al bazei nu dublează separatorul
import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: { rpc: vi.fn() } }))

import { buildReferralUrl } from '../affiliate'

const PINNED = 'https://menuvia.ro'

describe('buildReferralUrl', () => {
  it('RU1: pe menuvia.com linkul rămâne pe .com (canonic, fără www)', () => {
    expect(buildReferralUrl('ionpop', 'menuvia.com', PINNED, 'https://menuvia.com')).toBe(
      'https://menuvia.com/r/ionpop',
    )
    expect(buildReferralUrl('ionpop', 'www.menuvia.com', PINNED, 'https://www.menuvia.com')).toBe(
      'https://menuvia.com/r/ionpop',
    )
  })

  it('RU2: în afara .com — identic cu `VITE_APP_URL || origin`', () => {
    for (const [host, vite, origin] of [
      ['menuvia.ro', PINNED, 'https://menuvia.ro'],
      ['menuvia.netlify.app', PINNED, 'https://menuvia.netlify.app'],
      ['deploy-preview-7--menuvia.netlify.app', '', 'https://deploy-preview-7--menuvia.netlify.app'],
      ['localhost', undefined, 'http://localhost:5173'],
      ['menuvia.com.evil.example', PINNED, 'https://menuvia.com.evil.example'],
    ] as const) {
      const legacy = `${(vite || origin).replace(/\/$/, '')}/r/abc123`
      expect(buildReferralUrl('abc123', host, vite, origin)).toBe(legacy)
    }
  })

  it('RU3: baza cu slash final → un singur separator', () => {
    expect(buildReferralUrl('abc123', 'menuvia.ro', 'https://menuvia.ro/', 'https://menuvia.ro')).toBe(
      'https://menuvia.ro/r/abc123',
    )
  })
})
