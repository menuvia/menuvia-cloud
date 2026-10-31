// Linkul de recenzie Google apare TUTUROR (audit v3, S0 — „review gating").
//
// Defectul: linkul se arăta doar când media notelor era ≥ 4, iar o notă slabă
// ducea la un formular „privat" fără link. Google interzice filtrarea
// recenziilor după notă, iar „feedback privat" nu era citit de nimeni.
//
//   FG1  notă slabă (1–3 stele) → comentariu → ecranul final ARE linkul Google
//   FG2  notă bună → ecranul final are linkul (control pozitiv: trecea și înainte)
//   FG3  fără URL sau cu URL nesigur (javascript:) → niciun link, doar mulțumire
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
}))

import { FeedbackWidget } from '../PaymentConfirmedScreen'
import { T } from '../../lib/publicMenuStrings'
import { Tf } from '../../lib/guestI18n'

const REVIEW_URL = 'https://g.page/r/bistro-test/review'

function renderWidget(googleReviewUrl: string | null) {
  return render(
    <FeedbackWidget
      orderId="o1"
      restaurantName="Bistro Test"
      googleReviewUrl={googleReviewUrl}
      accent="#C8963C"
      lang="ro"
      initialStep="service"
    />,
  )
}

const stars = (n: number) => screen.getByRole('button', { name: Tf('ro', 'fb_stars', { n }) })

describe('FeedbackWidget — fără filtrare după notă', () => {
  for (const n of [1, 2, 3]) {
    it(`FG1: ${n} stele → comentariu → linkul Google apare`, () => {
      renderWidget(REVIEW_URL)
      fireEvent.click(stars(n))
      // Formularul de comentariu al notei slabe.
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A fost rece.' } })
      fireEvent.click(screen.getByRole('button', { name: T('ro', 'send') }))
      const link = screen.getByText(T('ro', 'fb_google_button')).closest('a')
      expect(link?.getAttribute('href')).toBe(REVIEW_URL)
    })
  }

  it('FG2 (control pozitiv): notă bună la servire și mâncare → linkul Google apare', async () => {
    renderWidget(REVIEW_URL)
    fireEvent.click(stars(5))
    // Trecerea la pasul următor are o pauză de 600 ms (animația bifei).
    await screen.findByText(T('ro', 'fb_ask_food'))
    fireEvent.click(stars(5))
    const label = await screen.findByText(T('ro', 'fb_google_button'))
    expect(label.closest('a')?.getAttribute('href')).toBe(REVIEW_URL)
  })

  it('FG3: fără URL sau cu URL nesigur → niciun link, doar mulțumirea', () => {
    for (const url of [null, 'javascript:alert(1)']) {
      const view = renderWidget(url)
      fireEvent.click(stars(1))
      fireEvent.click(screen.getByRole('button', { name: T('ro', 'send') }))
      expect(screen.queryByText(T('ro', 'fb_google_button'))).toBeNull()
      expect(screen.getAllByText(new RegExp(T('ro', 'fb_thanks'))).length).toBeGreaterThan(0)
      view.unmount()
    }
  })
})
