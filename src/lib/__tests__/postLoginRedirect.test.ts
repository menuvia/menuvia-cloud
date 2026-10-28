// Ieșirea din /auth după login (regresia prinsă de E2E „back button does not
// redirect to /auth (FE-001 fix)"): două căi async independente (efectul de
// auto-redirect și `onSuccess` din AuthPage) duc omul din /auth; în ORICE ordine
// intrarea /auth trebuie ÎNLOCUITĂ, niciodată lăsată în istoric.
//
//   PR1  ordinea „efect întâi, apoi onSuccess": o singură înlocuire, zero push,
//        a doua cale nu face nimic
//   PR2  ordinea „onSuccess întâi, apoi efect" cu destinații DIFERITE: prima
//        câștigă, a doua nu o suprascrie (și nu adaugă intrări)
//   PR3  Back din starea finală nu ajunge pe /auth, în ambele ordini
//   PR4  CONTROL: vechiul comportament (push din onSuccess când pathname e încă
//        /auth, apoi replace din efect) lasă /auth în istoric — fără el PR3 ar fi
//        adevărat și cu un model care nu poate arăta defectul
//   PR5  omul nu mai e pe /auth (a plecat de la sine) → nicio scriere
import { describe, it, expect } from 'vitest'
import { leaveAuth, type AuthExitEnv } from '../postLoginRedirect'

// Model minimal de istoric de browser: intrări + indice curent.
function fakeHistory(initial: string[]) {
  const entries = [...initial]
  let idx = entries.length - 1
  const log = { pushes: 0, replaces: 0 }
  return {
    entries,
    log,
    current: () => entries[idx],
    push(path: string) {
      entries.splice(idx + 1, entries.length, path)
      idx += 1
      log.pushes += 1
    },
    replace(path: string) {
      entries[idx] = path
      log.replaces += 1
    },
    back() {
      if (idx > 0) idx -= 1
      return entries[idx]
    },
  }
}

function envOf(h: ReturnType<typeof fakeHistory>): AuthExitEnv {
  return { pathname: h.current, replace: (p) => h.replace(p) }
}

describe('leaveAuth', () => {
  it('PR1 efect întâi, apoi onSuccess: o singură înlocuire, zero push', () => {
    const h = fakeHistory(['/start', '/auth'])
    expect(leaveAuth(envOf(h), '/dashboard')).toBe(true) // efectul
    expect(leaveAuth(envOf(h), '/dashboard')).toBe(false) // onSuccess ajunge al doilea
    expect(h.entries).toEqual(['/start', '/dashboard'])
    expect(h.log).toEqual({ pushes: 0, replaces: 1 })
  })

  it('PR2 onSuccess întâi, apoi efect cu altă destinație: prima câștigă', () => {
    const h = fakeHistory(['/start', '/auth'])
    expect(leaveAuth(envOf(h), '/afiliat')).toBe(true) // onSuccess (intenție de afiliere)
    expect(leaveAuth(envOf(h), '/dashboard')).toBe(false) // efectul, târziu
    expect(h.entries).toEqual(['/start', '/afiliat'])
    expect(h.log).toEqual({ pushes: 0, replaces: 1 })
  })

  it('PR3 Back din starea finală nu ajunge pe /auth, în ambele ordini', () => {
    for (const order of [['/dashboard', '/dashboard'], ['/waiter', '/dashboard']]) {
      const h = fakeHistory(['/start', '/auth'])
      for (const dest of order) leaveAuth(envOf(h), dest)
      expect(h.back(), order.join(' → ')).toBe('/start')
      expect(h.entries).not.toContain('/auth')
    }
  })

  it('PR4 control: vechiul push din onSuccess lasă /auth în istoric', () => {
    const h = fakeHistory(['/start', '/auth'])
    // vechiul onSuccess: navigate (push) cât pathname e încă /auth
    if (h.current() === '/auth') h.push('/dashboard')
    // apoi efectul înlocuiește intrarea NOUĂ
    h.replace('/dashboard')
    expect(h.log.pushes).toBe(1)
    expect(h.back()).toBe('/auth')
  })

  it('PR5 dacă omul nu mai e pe /auth, nu se scrie nimic', () => {
    const h = fakeHistory(['/start', '/pricing'])
    expect(leaveAuth(envOf(h), '/dashboard')).toBe(false)
    expect(h.entries).toEqual(['/start', '/pricing'])
    expect(h.log).toEqual({ pushes: 0, replaces: 0 })
  })
})
