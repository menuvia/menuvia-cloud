// Sunetul de pe ecranele de staff (Bucătărie / Ospătar): beep-ul pentru o
// comandă nouă, o comandă gata, un apel de ospătar.
//
// ux-staff-audio-unlock: politica de autoplay a browserelor pornește un
// AudioContext creat FĂRĂ gest în starea `suspended`. Vechiul `playSound`
// crea contextul abia la primul beep — declanșat de un eveniment realtime, nu
// de un gest — deci pe o tabletă KDS proaspăt deschisă beep-ul era MUT până
// atingea cineva ecranul; pe iPhone/iPad (Safari cere `resume()` CHIAR în
// handler-ul gestului) rămânea mut pentru totdeauna, oricâte atingeri ar fi
// urmat, fiindcă `resume()` se chema doar din evenimentul realtime.
// Acum: `unlock()` se cheamă din primul gest de pe pagină (useAudioUnlock),
// iar pagina știe când sunetul e blocat și poate cere o atingere.

type AudioCtor = new () => AudioContext

export type AudioStatus = 'unsupported' | 'locked' | 'running'

export interface StaffAudio {
  /** 'unsupported' = browser fără Web Audio; 'locked' = așteaptă un gest. */
  status(): AudioStatus
  /** Deblochează ieșirea audio. Trebuie chemat DIN handler-ul unui gest. */
  unlock(): void
  /** Beep scurt (notificare). Nu aruncă niciodată. */
  beep(hz: number, ms: number): void
  subscribe(listener: () => void): () => void
}

export function createStaffAudio(resolveCtor: () => AudioCtor | undefined): StaffAudio {
  let ctx: AudioContext | null = null
  let unavailable = false
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const l of listeners) l()
  }

  // Context UNIC, partajat (OPT-R2: Chrome plafonează ~6 contexte live pe
  // pagină — un context nou per beep omora sunetul după ~6 comenzi).
  function get(): AudioContext | null {
    if (ctx || unavailable) return ctx
    const Ctor = resolveCtor()
    if (!Ctor) {
      unavailable = true
      return null
    }
    try {
      ctx = new Ctor()
      ctx.addEventListener('statechange', notify)
    } catch {
      unavailable = true
      ctx = null
    }
    return ctx
  }

  return {
    status() {
      const c = get()
      if (!c) return 'unsupported'
      return c.state === 'running' ? 'running' : 'locked'
    },
    unlock() {
      const c = get()
      if (!c || c.state === 'running') return
      try {
        void c.resume().then(notify, () => {
          /* gestul n-a fost acceptat — rămâne blocat, bannerul rămâne */
        })
        // Safari/iOS: un buffer mut de un eșantion, pornit ÎN gest, deblochează
        // ieșirea audio a paginii.
        const src = c.createBufferSource()
        src.buffer = c.createBuffer(1, 1, 22050)
        src.connect(c.destination)
        src.start(0)
      } catch {
        /* Web Audio indisponibil — beep-ul rămâne no-op */
      }
    },
    beep(hz, ms) {
      const c = get()
      if (!c) return
      try {
        // Un context încă suspendat: încercarea nu strică (Chrome o acceptă
        // dacă pagina a primit deja un gest), dar NU ne bazăm pe ea.
        if (c.state === 'suspended') void c.resume().catch(() => {})
        const osc = c.createOscillator()
        const gain = c.createGain()
        osc.connect(gain)
        gain.connect(c.destination)
        osc.frequency.value = hz
        gain.gain.setValueAtTime(0.3, c.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + ms / 1000)
        osc.start()
        osc.stop(c.currentTime + ms / 1000)
      } catch {
        /* AudioContext indisponibil */
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function browserAudioCtor(): AudioCtor | undefined {
  if (typeof AudioContext !== 'undefined') return AudioContext
  // iOS < 14.5 are doar varianta cu prefix.
  return (globalThis as { webkitAudioContext?: AudioCtor }).webkitAudioContext
}

/** Instanța unică a aplicației (un singur context audio pe pagină). */
export const staffAudio: StaffAudio = createStaffAudio(browserAudioCtor)
