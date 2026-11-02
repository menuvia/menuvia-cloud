import { useCallback, useEffect, useState } from 'react'
import { staffAudio, type AudioStatus, type StaffAudio } from '../lib/staffAudio'

// Gesturile care pot debloca audio: Chrome acceptă primul `pointerdown`,
// Safari/iOS abia `touchend`/`click`. Ascultăm în faza de CAPTURĂ, ca un
// `stopPropagation` dintr-un buton să nu ne fure gestul.
const GESTURES = ['pointerdown', 'touchend', 'click', 'keydown'] as const

/**
 * Deblochează sunetul ecranelor de staff la PRIMUL gest de pe pagină și spune
 * când e încă blocat (`locked`), ca pagina să ceară o atingere. Fără el,
 * beep-ul pentru comandă nouă era mut pe o tabletă KDS proaspăt deschisă
 * (ux-staff-audio-unlock). `unlock` e pentru un buton explicit („Pornește
 * sunetul") — se cheamă tot dintr-un gest.
 */
export function useAudioUnlock(audio: StaffAudio = staffAudio): {
  locked: boolean
  unlock: () => void
} {
  const [status, setStatus] = useState<AudioStatus>(() => audio.status())

  useEffect(() => {
    const sync = (): void => setStatus(audio.status())
    const unsubscribe = audio.subscribe(sync)
    const onGesture = (): void => {
      audio.unlock()
      sync()
    }
    for (const g of GESTURES) window.addEventListener(g, onGesture, true)
    sync()
    return () => {
      unsubscribe()
      for (const g of GESTURES) window.removeEventListener(g, onGesture, true)
    }
  }, [audio])

  const unlock = useCallback(() => {
    audio.unlock()
    setStatus(audio.status())
  }, [audio])

  return { locked: status === 'locked', unlock }
}
