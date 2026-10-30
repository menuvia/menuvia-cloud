// src/lib/salesPanel.ts
// Decizii PURE ale panoului agentului / șefului de vânzări (pages/AfiliatPage.tsx,
// pachetul 8b-2): eticheta rolului, cele două propoziții „Banii tăi”, lista
// ADEVĂRATĂ a celor care îți văd datele de contact și plafonul de invitații.
// Fără React și fără supabase, ca să fie testabile direct.
import type { EarningsSummary } from './affiliateEarnings'
import type { SalesNetwork, SalesRole } from './salesNetwork'

/**
 * Titlul panoului după rol. `undefined` = rol NECUNOSCUT (get_sales_network
 * n-a răspuns încă sau a eșuat): titlu neutru, nu „agent” — un șef al cărui
 * apel a picat nu are voie să fie numit agent. `null` = programul public vechi
 * (fără `sales_role`): îi spunem tot „agent”.
 */
export function salesRoleTitle(role: SalesRole | null | undefined): string {
  if (role === undefined) return 'Panoul de vânzări'
  return role === 'head' ? 'Șef de vânzări' : 'Agent de vânzări'
}

export interface MoneySentences {
  /** Cât ai câștigat (net) și cât ți s-a plătit deja. */
  earned: string
  /** Ce poți primi acum și ce e deja în plată. */
  payout: string
}

/**
 * Cele două propoziții din „Banii tăi”, doar din cifrele serverului
 * (`summarizeEarnings`, mig 295). `fmt` formatează cenți (formatRON cu moneda
 * câștigurilor) — primit ca parametru ca funcția să rămână pură.
 */
export function moneySentences(
  sum: EarningsSummary,
  paidCents: number,
  fmt: (cents: number) => string,
): MoneySentences {
  const paid = Math.max(0, paidCents)
  let earned: string
  if (sum.netEarnedCents <= 0 && paid <= 0) {
    earned =
      'Încă n-ai câștigat nimic: primul comision apare după ce un restaurant adus de tine plătește abonamentul.'
  } else {
    earned =
      `Ai câștigat ${fmt(sum.netEarnedCents)} până acum` +
      (sum.serverNet ? ' (net, după stornări)' : '') +
      (paid > 0 ? `, iar ${fmt(paid)} ți-au fost deja plătiți.` : '.')
  }

  let payout: string
  if (sum.availableCents > 0 && !sum.belowMinimum) {
    payout = `Poți primi acum ${fmt(sum.availableCents)}`
  } else if (sum.availableCents > 0) {
    payout = `Ai ${fmt(sum.availableCents)} disponibili, sub pragul de ${fmt(sum.minPayoutCents)}, așa că se adună la următoarea plată`
  } else if (sum.pendingCents > 0) {
    payout = `Nu ai încă bani disponibili: ${fmt(sum.pendingCents)} sunt în perioada de siguranță`
  } else {
    payout = 'Nu ai încă bani disponibili pentru plată'
  }
  payout += sum.inProgressCents > 0 ? `; ${fmt(sum.inProgressCents)} sunt deja în plată.` : '.'
  return { earned, payout }
}

/**
 * Cine îți vede datele de contact, EXACT cum le întorc serverul:
 *  • patronii (`get_my_agent`, mig 303): NUMELE îl văd mereu (și managerii lor);
 *    telefonul și emailul DOAR cu consimțământul tău și DOAR proprietarul contului;
 *  • rețeaua (`get_sales_network`, mig 304): numele, telefonul și emailul DOAR cu
 *    consimțământul tău — șeful îi vede pe agenții lui direcți, agenții își văd
 *    șeful.
 * `shared` = starea curentă a consimțământului (de pe server).
 */
export function contactAudience(role: SalesRole | null, shared: boolean): string[] {
  const lines = [
    'Numele tău îl văd patronii restaurantelor aduse de tine (și managerii lor), în cardul „Agentul tău Menuvia” din panoul lor, indiferent de această opțiune.',
    shared
      ? 'Telefonul și emailul tău le vede acum proprietarul fiecărui restaurant adus de tine.'
      : 'Dacă pornești opțiunea, telefonul și emailul tău le vede proprietarul fiecărui restaurant adus de tine.',
  ]
  if (role === 'head') {
    lines.push(
      shared
        ? 'Agenții din echipa ta îți văd acum numele, telefonul și emailul.'
        : 'Dacă pornești opțiunea, agenții din echipa ta îți văd numele, telefonul și emailul.',
    )
  } else if (role === 'agent') {
    lines.push(
      shared
        ? 'Șeful tău de vânzări îți vede acum numele, telefonul și emailul.'
        : 'Dacă pornești opțiunea, șeful tău de vânzări îți vede numele, telefonul și emailul.',
    )
  }
  lines.push(
    'Poți opri oricând: din acel moment telefonul și emailul nu se mai afișează nicăieri. Ce a notat cineva între timp rămâne la el.',
  )
  return lines
}

export interface InviteSlots {
  open: number
  max: number
  /** Mai poți crea o invitație (serverul decide oricum: `too_many_open_invites`). */
  canCreate: boolean
}

/** Invitațiile deschise față de plafon. Un plafon necunoscut (0) nu blochează: decide serverul. */
export function inviteSlots(network: Pick<SalesNetwork, 'openInvites' | 'limits'>): InviteSlots {
  const open = network.openInvites.length
  const max = network.limits.openInvitesMax
  return { open, max, canCreate: max <= 0 || open < max }
}
