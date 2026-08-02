// src/lib/onboardingPreset.ts
// Intenția de produs setată pe landing (ex. /rezervari) care trebuie să
// SUPRAVIEȚUIASCĂ redirectului de auth (signup/magic-link = navigare completă,
// state-ul React moare) — același pattern ca lib/founder.ts. OnboardingPage o
// consumă imediat după create_restaurant.
//
// TTL 24h: fără el, un vizitator care a atins CTA-ul de pe /rezervari azi și
// se înscrie organic peste o lună ar primi presetul pe nepusă masă.

const KEY = 'menuvia_onboarding_preset'
const TTL_MS = 24 * 60 * 60 * 1000

export type OnboardingPreset = 'rezervari'

export function setOnboardingPreset(preset: OnboardingPreset): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: preset, at: Date.now() }))
  } catch {
    // localStorage indisponibil (private mode vechi) — presetul e best-effort,
    // onboarding-ul normal rămâne neafectat.
  }
}

/** Citește ȘI șterge presetul (consum unic). Expirat sau malformat → null. */
export function consumeOnboardingPreset(): OnboardingPreset | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw == null) return null
    localStorage.removeItem(KEY)
    const parsed = JSON.parse(raw) as { v?: unknown; at?: unknown }
    if (parsed.v !== 'rezervari') return null
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > TTL_MS) return null
    return 'rezervari'
  } catch {
    return null
  }
}
