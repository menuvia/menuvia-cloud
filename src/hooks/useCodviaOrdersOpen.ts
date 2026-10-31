// =============================================================
// Menuvia — src/hooks/useCodviaOrdersOpen.ts
// Sunt deschise comenzile magazinului Codvia (suporturi QR fizice)?
// =============================================================
// Sursa unică e serverul: GET pe codvia-order.js întoarce `{open}` (pauza e
// fail-closed cât CODVIA_ORDERS_OPEN nu e exact `true`, decizia D4 din
// docs/ECOSISTEM.md). TRISTATE: `null` = necunoscut (rețea, funcție veche,
// răspuns fără formă). Acțiunea rapidă de pe Acasă apare DOAR pe `true` —
// înainte ducea patronul într-un magazin care îi spunea că nu primește comenzi
// (ux-owner-codvia-quick-action). Pe `null` NU o arătăm: spre deosebire de
// pagina /codvia (unde formularul rămâne și decide serverul), aici e o
// scurtătură opțională, iar o scurtătură spre o fundătură e mai rea decât
// lipsa ei. La redeschidere apare singură, fără deploy.
import { useEffect, useState } from 'react'
import { fnUrl } from '../lib/fn'

// O citire per încărcare de pagină (Acasă se remontează la fiecare vizită a
// tab-ului). Un rezultat NECUNOSCUT nu se memorează: următoarea montare reîncearcă.
let memo: Promise<boolean | null> | null = null

async function readOrdersOpen(): Promise<boolean | null> {
  try {
    const res = await fetch(fnUrl('codvia-order'), { method: 'GET' })
    if (!res.ok) return null
    const body = (await res.json()) as { open?: unknown }
    return typeof body.open === 'boolean' ? body.open : null
  } catch {
    return null
  }
}

function ordersOpen(): Promise<boolean | null> {
  if (!memo) {
    memo = readOrdersOpen().then((open) => {
      if (open === null) memo = null
      return open
    })
  }
  return memo
}

export function useCodviaOrdersOpen(): boolean | null {
  const [open, setOpen] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    void ordersOpen().then((v) => {
      if (alive) setOpen(v)
    })
    return () => {
      alive = false
    }
  }, [])
  return open
}
