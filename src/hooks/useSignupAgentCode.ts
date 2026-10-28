// src/hooks/useSignupAgentCode.ts
// Starea codului de agent de pe formularul de ÎNSCRIERE (mig 301, pachetul 7).
//
//   • codul din link/cookie (`mv_ref`) se verifică la server DOAR când formularul
//     e pe „Cont nou" (`enabled`); un cod valid afișează bannerul „Ai venit prin
//     agentul tău Menuvia", unul necunoscut se ignoră (nu se trimite);
//   • câmpul de cod tastat apare DOAR după „Am un cod de agent" — patronii veniți
//     singuri nu văd niciun câmp;
//   • la „Creează cont", `resolveForSubmit` decide ce plecă în
//     `user_metadata.agent_code` (reguli în lib/agentCode.ts).
import { useCallback, useEffect, useState } from 'react'
import { getStoredReferral, resolvePendingReferral } from '../lib/affiliate'
import {
  lookupAgentCode,
  isAgentFieldVisible,
  pickSubmitCandidate,
  resolveAgentCodeForSubmit,
  type AgentCodeLookup,
  type SubmitAgentCode,
} from '../lib/agentCode'

export type AgentCodeProblem = 'shape' | 'unknown' | null

export interface SignupAgentCode {
  /** Cod din link/cookie VERIFICAT de server (bannerul se afișează doar cu el). */
  verifiedLinkCode: string | null
  dismissed: boolean
  dismissLink: () => void
  typed: string
  setTyped: (value: string) => void
  fieldOpen: boolean
  openField: () => void
  problem: AgentCodeProblem
  resolveForSubmit: () => Promise<SubmitAgentCode>
}

export function useSignupAgentCode(enabled: boolean): SignupAgentCode {
  const [storedCode, setStoredCode] = useState<string | null>(null)
  const [linkLookup, setLinkLookup] = useState<AgentCodeLookup | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [typed, setTypedState] = useState('')
  const [fieldOpen, setFieldOpen] = useState(false)
  const [problem, setProblem] = useState<AgentCodeProblem>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      // Un vanity încă nerezolvat (RPC picat la captură) se reîncearcă acum,
      // cu timeout — nu blochează formularul.
      await resolvePendingReferral()
      const stored = getStoredReferral()
      if (cancelled || !stored) return
      setStoredCode(stored)
      const res = await lookupAgentCode(stored)
      if (!cancelled) setLinkLookup(res)
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  const setTyped = useCallback((value: string) => {
    setTypedState(value)
    setProblem(null)
  }, [])

  const verifiedLinkCode = linkLookup?.state === 'valid' ? linkLookup.code : null
  // „Necunoscut" = serverul a spus clar că nu există → nu-l trimitem. Cât timp
  // verificarea nu a răspuns (sau a dat eroare) pleacă ce avem în cookie: serverul
  // re-validează oricum la INSERT-ul profilului.
  const linkCandidate =
    linkLookup?.state === 'unknown' ? null : (verifiedLinkCode ?? storedCode)

  // Câmpul tastat e VIZIBIL doar fără banner (AuthPage: `!verifiedLinkCode ||
  // dismissed`). Dacă omul a tastat ceva înainte ca verificarea link-ului să se
  // întoarcă `valid`, câmpul s-a demontat și bannerul a apărut: valoarea ascunsă
  // NU are voie să bată codul verificat din link și nici să oprească formularul
  // cu un mesaj afișat într-un câmp care nu se mai vede.
  const fieldVisible = isAgentFieldVisible(verifiedLinkCode !== null, dismissed)

  // Mesajul de problemă aparține câmpului: când câmpul se ascunde, dispare și el.
  useEffect(() => {
    if (!fieldVisible) setProblem(null)
  }, [fieldVisible])

  const resolveForSubmit = useCallback(async (): Promise<SubmitAgentCode> => {
    const choice = pickSubmitCandidate({
      typed,
      stored: linkCandidate,
      dismissed,
      linkVerified: verifiedLinkCode !== null,
    })
    const res = await resolveAgentCodeForSubmit(choice)
    setProblem(res.ok ? null : res.problem)
    return res
  }, [typed, linkCandidate, dismissed, verifiedLinkCode])

  return {
    verifiedLinkCode,
    dismissed,
    dismissLink: () => setDismissed(true),
    typed,
    setTyped,
    fieldOpen,
    openField: () => setFieldOpen(true),
    problem,
    resolveForSubmit,
  }
}
