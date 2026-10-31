// =============================================================
// Menuvia — src/hooks/useContractTextHash.ts
// sha256 al textului de contract din bundle (rețeaua de vânzări, mig 304).
//
// Serverul leagă versiunea publicată de amprenta textului EXACT; ecranele
// compară amprenta locală cu ea (lib/salesInviteFlow.ts `contractGate`) înainte
// să lase pe cineva să accepte sau să arate „corespunde”. Calculul e asincron
// (`crypto.subtle`), deci rezultatul e TRISTATE: `pending` cât se calculează,
// `error` fără `crypto.subtle` (context nesigur) — niciodată un hash inventat.
//
// Un rezultat calculat pentru ALT text (textul s-a schimbat între timp) e
// raportat ca `pending`, nu ca amprenta textului nou.
// =============================================================
import { useEffect, useState } from 'react'
import { SalesNetworkError, sha256Hex } from '../lib/salesNetwork'
import type { ContractTextHash } from '../lib/salesInviteFlow'

interface Computed {
  text: string
  hash: string | null
  error: SalesNetworkError | null
}

export function useContractTextHash(text: string | null): ContractTextHash {
  const [computed, setComputed] = useState<Computed | null>(null)

  useEffect(() => {
    if (text === null) return
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        const hash = await sha256Hex(text)
        if (!cancelled) setComputed({ text, hash, error: null })
      } catch (e) {
        if (cancelled) return
        setComputed({
          text,
          hash: null,
          error: e instanceof SalesNetworkError ? e : new SalesNetworkError('hash_unavailable'),
        })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [text])

  if (text === null) return { status: 'none' }
  if (computed === null || computed.text !== text) return { status: 'pending' }
  if (computed.hash !== null) return { status: 'ready', hash: computed.hash }
  return {
    status: 'error',
    error: computed.error ?? new SalesNetworkError('hash_unavailable'),
  }
}
