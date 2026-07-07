// Test pentru sanitize-ul payload-ului de UPDATE pe `restaurants`.
//
// Acoperă obligația post-096B (PR 1B): `slug` este OMIS din whitelist —
// schimbarea slug-ului trece exclusiv prin RPC-ul `change_restaurant_slug`.
// Dacă cineva re-adaugă `slug` în `RESTAURANT_UPDATE_FIELDS`, testul ăsta
// pică imediat și prinde regresia înainte ca PostgREST să returneze 42501.

import { describe, it, expect } from 'vitest'
import type { Restaurant } from '../../hooks/useData'
import { RESTAURANT_UPDATE_FIELDS, pickAllowed } from '../sanitize'

describe('RESTAURANT_UPDATE_FIELDS', () => {
  it('does NOT contain slug (handled by change_restaurant_slug RPC after PR 1B)', () => {
    expect((RESTAURANT_UPDATE_FIELDS as readonly string[]).includes('slug')).toBe(false)
  })

  it('does NOT contain ownership / billing / entitlement fields', () => {
    const forbidden = ['id', 'owner_id', 'created_at', 'updated_at', 'qr_token', 'is_active']
    for (const f of forbidden) {
      expect((RESTAURANT_UPDATE_FIELDS as readonly string[]).includes(f)).toBe(false)
    }
  })

  it('contains exactly the 23 columns granted UPDATE (mig 096B + menu_languages mig 197 + currency mig 205)', () => {
    expect(RESTAURANT_UPDATE_FIELDS.length).toBe(23)
    expect([...RESTAURANT_UPDATE_FIELDS].sort()).toEqual(
      [
        'name',
        'tagline',
        'city',
        'description',
        'address',
        'phone',
        'hours',
        'hours_structured',
        'timezone',
        'wifi_password',
        'primary_color',
        'logo_url',
        'cover_url',
        'floor_layout',
        'socials',
        'amenities',
        'checkout_suggestion_settings',
        'theme_settings',
        'pickup_settings',
        'google_place_id',
        'google_review_url',
        // mig 197 — meniu multilingv: grant update (menu_languages) pe restaurants.
        'currency',
        'menu_languages',
      ].sort(),
    )
  })
})

describe('pickAllowed', () => {
  it('strips slug from a payload that includes it (post-096B guarantee)', () => {
    // Anotăm explicit ca `Partial<Restaurant>` ca TypeScript să nu îngusteze
    // generic-ul T la literal-ul anonim (altfel `RESTAURANT_UPDATE_FIELDS`
    // ar conține mai multe chei decât `T` și inferența ar respinge apelul).
    const dirty: Partial<Restaurant> = {
      name: 'X',
      slug: 'attacker-owned',
      primary_color: '#000',
    }
    const safe = pickAllowed(dirty, RESTAURANT_UPDATE_FIELDS)
    expect(safe).toEqual({ name: 'X', primary_color: '#000' })
    expect((safe as Record<string, unknown>).slug).toBeUndefined()
  })

  it('strips owner_id even if injected in the payload', () => {
    const dirty: Partial<Restaurant> = {
      name: 'X',
      owner_id: '00000000-0000-0000-0000-aaaaaaaaaaaa',
    }
    const safe = pickAllowed(dirty, RESTAURANT_UPDATE_FIELDS)
    expect(safe).toEqual({ name: 'X' })
  })

  it('keeps only allowed keys present in the input', () => {
    // Pentru cazul cu cheie sintetică nedeclarată în Restaurant, castăm la
    // `unknown` apoi la `Partial<Restaurant>` ca să oglindim ce poate ajunge
    // în production prin payload-uri rău-intenționate trecute de tipuri.
    const dirty = {
      name: 'X',
      tagline: 'Y',
      address: 'Str. Test 1',
      attacker_field: 'ignored',
    } as unknown as Partial<Restaurant>
    const safe = pickAllowed(dirty, RESTAURANT_UPDATE_FIELDS)
    expect(safe).toEqual({ name: 'X', tagline: 'Y', address: 'Str. Test 1' })
  })

  it('returns an empty object when no allowed keys are present', () => {
    const dirty = { attacker_field: 'x' } as unknown as Partial<Restaurant>
    expect(pickAllowed(dirty, RESTAURANT_UPDATE_FIELDS)).toEqual({})
  })

  it('preserves explicit null values for allowed keys (not skipped)', () => {
    const dirty: Partial<Restaurant> = { name: 'X', tagline: null }
    const safe = pickAllowed(dirty, RESTAURANT_UPDATE_FIELDS)
    expect(safe).toEqual({ name: 'X', tagline: null })
  })
})
