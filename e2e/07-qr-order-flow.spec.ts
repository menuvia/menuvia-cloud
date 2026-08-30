// e2e/07-qr-order-flow.spec.ts
// Fluxul de BANI cap-coadă pe care stă tot produsul: clientul scanează QR-ul
// mesei, adaugă un produs în coș și trimite comanda. Confirmarea („Comanda a
// fost trimisă") se randează DOAR cu un id real întors de create_order — deci
// trece prin resolve_qr_menu, open_table_session (Gate B, mig 088), guard-urile
// de grup (mig 191) și idempotența pe cheie. Un fail aici = comanda QR e ruptă
// în producție, indiferent ce zic testele unitare.
//
// Prerequisite: seed_tinctura_demo.sql (secțiunea 5: masa-1 + token-ul fix
// `tinctura-e2e-masa-1`). Skip curat dacă seed-ul lipsește (ca spec 06).
import { test, expect } from '@playwright/test'
import { prepConsent } from './helpers'

const QR_PATH = '/q/tinctura-e2e-masa-1'

test.describe('QR ordering — flux complet de comandă', () => {
  test('scanare → adaugă în coș → trimite → confirmare', async ({ page }) => {
    // Diagnostic: erorile de consolă apar în mesajul de fail (pattern spec 06).
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })

    // Bannerul de cookie-uri (role="dialog") se randează ȘI pe /q/ și
    // interceptează click-ul pe CTA-ul coșului (prima rulare a picat exact
    // aici) — consimțământul se setează ÎNAINTE de navigare, ca în helpers.
    await prepConsent(page)
    await page.goto(QR_PATH)

    // Așteptăm UNA dintre stările terminale ale încărcării: meniul (card de
    // produs), QR invalid (seed lipsă) sau eroarea de rețea — fără
    // networkidle, care e fragil pe pagini cu fetch-uri non-blocking.
    const firstCard = page.getByTestId('product-card').first()
    const invalidMsg = page.getByText(/Acest QR nu mai este activ/i)
    const netErrMsg = page.getByText(/Conexiune slabă/i)
    await expect(firstCard.or(invalidMsg).or(netErrMsg).first()).toBeVisible({ timeout: 15_000 })

    test.skip(
      (await invalidMsg.count()) > 0,
      'seed_tinctura_demo.sql (secțiunea masă + token QR) nu e aplicat pe această instanță',
    )
    if ((await netErrMsg.count()) > 0) {
      throw new Error(
        `Meniul QR a intrat în starea de eroare de rețea.\n` +
          `Console: ${consoleErrors.slice(0, 5).join(' | ') || '(nimic)'}`,
      )
    }

    // Header-ul poartă badge-ul mesei — dovada că token-ul s-a rezolvat la masă.
    await expect(page.getByText('Masa 1').first()).toBeVisible()

    // Quick-add direct în coș (espresso-ul din seed nu are modificatori
    // obligatorii, deci „+" nu deschide ProductSheet).
    await page.getByRole('button', { name: 'Adaugă Espresso Tinctura' }).click()

    // Bara persistentă „Comanda mea" reflectă coșul și deschide sheet-ul.
    const cartBar = page.getByRole('button', { name: 'Comanda mea' })
    await expect(cartBar).toContainText(/1\s/)
    await cartBar.click()

    // Sheet-ul de coș e lazy (Suspense) — CTA-ul apare cu totalul în etichetă.
    const submit = page.getByRole('button', { name: /Trimite comanda/ })
    await expect(submit).toBeVisible({ timeout: 10_000 })
    await submit.click()

    // Confirmarea = create_order a REUȘIT server-side (insert + trigger-e +
    // session gate). 20s: submit-ul are retry intern cu backoff pe blip de rețea.
    await expect(page.getByText(/Comanda a fost trimisă/i)).toBeVisible({ timeout: 20_000 })

    // Tracker-ul arată numărul scurt al comenzii — vine din răspunsul
    // serverului (confirmation.short_id), nu din starea locală a coșului.
    const receipt = page.getByText(/Bucătăria a primit comanda/i)
    await expect(receipt).toBeVisible()
    await expect(receipt).toContainText('#')
  })
})
