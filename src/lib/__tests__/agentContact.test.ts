// Teste pe logica PURĂ a cardului „Agentul tău” și a butonului „Ajutor” (mig 303).
//
//   AC1  parseMyAgent: formă validă → normalizată; orice formă necunoscută → null
//        (UI-ul nu randează nimic pe null — tristate, fail-closed)
//   AC2  linkurile de contact se reconstruiesc din CIFRE / email validat, niciodată
//        din textul brut al agentului (ajung în `href`)
//   AC3  „Ajutor": agentul DOAR cu consimțământ și cu un canal valid; altfel suportul
//   AC4  textul accesului spune ce NU vede agentul (regula de aur în copy)
import { describe, it, expect } from 'vitest'
import {
  AGENT_ACCESS_SCOPE_TEXT,
  buildHelpOptions,
  describeAgentAccess,
  mailtoHref,
  parseMyAgent,
  telHref,
  whatsappHref,
  type MyAgent,
} from '../agentContact'

function agent(over: Partial<MyAgent> = {}): MyAgent {
  return {
    has_agent: true,
    attribution_id: 'att-1',
    agent_name: 'Agent Unu',
    contact_shared: true,
    phone: '0721 000 111',
    email: 'agent@exemplu.ro',
    access_state: 'none',
    can_manage: true,
    ...over,
  }
}

describe('parseMyAgent', () => {
  it('AC1a: {has_agent:false} și un agent valid', () => {
    expect(parseMyAgent({ has_agent: false })).toEqual({ has_agent: false })
    expect(parseMyAgent({ ...agent(), agent_name: '  Agent Unu  ' })).toEqual(agent())
  })

  it('AC1b: nume gol / doar spații → null (cardul cade pe „Agent de vânzări”)', () => {
    const r = parseMyAgent({ ...agent(), agent_name: '   ' })
    expect(r).toMatchObject({ has_agent: true, agent_name: null })
  })

  it('AC1c: orice formă necunoscută → null (nu „fără agent”)', () => {
    const bad: unknown[] = [
      null,
      undefined,
      'x',
      [],
      42,
      {},
      { has_agent: 'true' },
      { has_agent: null },
      { ...agent(), attribution_id: '' },
      { ...agent(), attribution_id: 7 },
      { ...agent(), access_state: 'approved' },
      { ...agent(), access_state: undefined },
      { ...agent(), can_manage: 'yes' },
      { ...agent(), contact_shared: null },
      { ...agent(), phone: 5 },
      { ...agent(), email: {} },
    ]
    for (const b of bad) expect(parseMyAgent(b), JSON.stringify(b)).toBeNull()
  })
})

describe('linkuri de contact', () => {
  it('AC2a: telefonul RO în formate uzuale → același tel:/wa.me', () => {
    for (const p of ['0721000111', '0721 000 111', '+40 721 000 111', '0040721000111', '(0721) 000-111']) {
      expect(telHref(p), p).toBe('tel:+40721000111')
      expect(whatsappHref(p), p).toBe('https://wa.me/40721000111')
    }
  })

  it('AC2b: număr internațional păstrat; prefix național necunoscut → fără link', () => {
    expect(whatsappHref('+44 7911 123456')).toBe('https://wa.me/447911123456')
    expect(telHref('0721')).toBeNull()
    expect(telHref('072100011122')).toBeNull() // 0… cu lungime neRO: nu ghicim prefixul
    expect(telHref(null)).toBeNull()
    expect(whatsappHref('')).toBeNull()
  })

  it('AC2c: injecție în href — doar cifre ajung în link', () => {
    for (const evil of ['javascript:alert(1)', '0721000111" onclick="x', '+40721000111<script>', 'tel:+1;evil']) {
      expect(telHref(evil), evil).toBeNull()
      expect(whatsappHref(evil), evil).toBeNull()
    }
    expect(mailtoHref('a@b.ro"><script>')).toBeNull()
    expect(mailtoHref('a b@c.ro')).toBeNull()
    expect(mailtoHref('fara-arond.ro')).toBeNull()
    expect(mailtoHref('a@b')).toBeNull()
    expect(mailtoHref('agent@exemplu.ro')).toBe('mailto:agent@exemplu.ro')
  })
})

describe('buildHelpOptions', () => {
  const SUPPORT = 'contact@menuvia.ro'

  it('AC3a: agent cu consimțământ → apel + WhatsApp + email', () => {
    const h = buildHelpOptions(agent(), SUPPORT)
    expect(h.source).toBe('agent')
    expect(h.agentName).toBe('Agent Unu')
    expect(h.actions.map((a) => a.kind)).toEqual(['call', 'whatsapp', 'email'])
    expect(h.actions.map((a) => a.href)).toEqual([
      'tel:+40721000111',
      'https://wa.me/40721000111',
      'mailto:agent@exemplu.ro',
    ])
  })

  it('AC3b: fără consimțământ → suportul, chiar dacă (greșit) apar date de contact', () => {
    const h = buildHelpOptions(agent({ contact_shared: false }), SUPPORT)
    expect(h.source).toBe('support')
    expect(h.actions).toEqual([{ kind: 'email', label: 'Scrie-ne pe email', href: `mailto:${SUPPORT}` }])
    expect(JSON.stringify(h)).not.toContain('0721')
    expect(JSON.stringify(h)).not.toContain('agent@exemplu.ro')
  })

  it('AC3c: fără agent / necunoscut / fără niciun canal valid → suportul', () => {
    for (const a of [null, { has_agent: false as const }, agent({ phone: null, email: null }), agent({ phone: 'abc', email: 'x' })]) {
      const h = buildHelpOptions(a, SUPPORT)
      expect(h.source).toBe('support')
      expect(h.actions).toHaveLength(1)
    }
  })

  it('AC3d: doar email partajat → doar emailul agentului', () => {
    const h = buildHelpOptions(agent({ phone: null }), SUPPORT)
    expect(h.source).toBe('agent')
    expect(h.actions.map((a) => a.kind)).toEqual(['email'])
  })

  it('AC3e: textele „Ajutor” nu promit timp de răspuns sau acces personal (PT1)', () => {
    const texts = [
      ...buildHelpOptions(agent(), SUPPORT).actions.map((a) => a.label),
      ...buildHelpOptions(null, SUPPORT).actions.map((a) => a.label),
    ].join(' | ')
    expect(texts).not.toMatch(/\d+\s*ore/i)
    expect(texts).not.toMatch(/fondator|direct/i)
  })
})

describe('copy-ul accesului', () => {
  it('AC4: spune ce vede agentul și ce NU (meniu + mese/QR; nu bani, bon, rezervări, setări, echipă)', () => {
    expect(AGENT_ACCESS_SCOPE_TEXT).toMatch(/DOAR meniul/)
    expect(AGENT_ACCESS_SCOPE_TEXT).toMatch(/mesele/)
    for (const w of ['comenzile', 'încasările', 'rezervările', 'datele fiscale', 'setările', 'echipa']) {
      expect(AGENT_ACCESS_SCOPE_TEXT, w).toContain(w)
    }
    expect(AGENT_ACCESS_SCOPE_TEXT).toMatch(/retrage oricând/)
  })

  it('AC4b: etichetele de stare', () => {
    expect(describeAgentAccess('granted')).toEqual({ label: 'Acces acordat', tone: 'ok' })
    expect(describeAgentAccess('requested').tone).toBe('wait')
    expect(describeAgentAccess('none').label).toBe('Fără acces')
    expect(describeAgentAccess('revoked').label).toBe('Acces retras')
  })
})
