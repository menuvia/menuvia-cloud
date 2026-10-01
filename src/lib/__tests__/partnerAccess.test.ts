// Teste pe logica PURĂ a accesului de partener (mig 286).
//
// Regulile pe care le păzesc:
//  - partenerul vede în dashboard DOAR tab-urile acoperite de politicile lui din
//    DB (meniu + mese/QR) — un tab nou adăugat în listă fără politică în DB ar
//    reface exact interfața de manager goală și plină de erori;
//  - rolul „partner" se alege din my_role(): non-null = fondator (manager
//    virtual), null = partener; pe eroare de RPC cădem pe „partner" (fail-closed).
import { describe, it, expect } from 'vitest'
import {
  PARTNER_TAB_IDS,
  isPartnerTab,
  resolveVisitRole,
  describePartnerState,
} from '../partnerAccess'

describe('PARTNER_TAB_IDS / isPartnerTab', () => {
  it('conține EXACT suprafața acoperită în DB: meniu + mese/QR', () => {
    expect([...PARTNER_TAB_IDS].sort()).toEqual(['categories', 'mese', 'modificatori', 'products'])
  })

  it('tab-urile sensibile NU sunt ale partenerului', () => {
    for (const id of [
      'home',
      'comenzi',
      'raport',
      'analytics',
      'echipa',
      'settings',
      'invoices',
      'casa-marcat',
      'casa-tura',
      'tva',
      'reservations',
      'ai',
      'ai-founder',
      'gestiune',
      'ture',
      'happy-hour',
      'arhitectura',
    ]) {
      expect(isPartnerTab(id), id).toBe(false)
    }
  })

  it('tab-urile de meniu și mese sunt ale partenerului', () => {
    for (const id of ['products', 'categories', 'modificatori', 'mese']) {
      expect(isPartnerTab(id), id).toBe(true)
    }
  })
})

describe('resolveVisitRole', () => {
  it('my_role non-null (fondator, manager virtual) → manager', () => {
    expect(resolveVisitRole('manager', false)).toBe('manager')
  })

  it('my_role null (partener — nu are rol în DB) → partner', () => {
    expect(resolveVisitRole(null, false)).toBe('partner')
    expect(resolveVisitRole(undefined, false)).toBe('partner')
  })

  it('eroare de RPC (necunoscut) → partner, fail-closed pe UI', () => {
    expect(resolveVisitRole('manager', true)).toBe('partner')
    expect(resolveVisitRole(null, true)).toBe('partner')
  })
})

describe('describePartnerState', () => {
  it('etichete pe fiecare stare', () => {
    expect(describePartnerState('granted')).toEqual({ label: 'Acces acordat', tone: 'ok' })
    expect(describePartnerState('requested')).toEqual({ label: 'Cerere trimisă', tone: 'wait' })
    expect(describePartnerState('revoked')).toEqual({ label: 'Acces revocat', tone: 'bad' })
    expect(describePartnerState('none')).toEqual({ label: 'Fără acces', tone: 'neutral' })
  })
})
