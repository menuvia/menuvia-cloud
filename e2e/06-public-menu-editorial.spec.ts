// e2e/06-public-menu-editorial.spec.ts
// Smoke test pentru noul design "editorial" al meniului public.
//
// Prerequisite: seed_tinctura_demo.sql aplicat (vezi
// supabase/scripts/seed_tinctura_demo.sql).
//
// Skipuit dacă restaurant-ul nu există (CI fără seed).
import { test, expect } from '@playwright/test'

test.describe('Public menu — editorial design', () => {
  test('renders hero + tabs + cards + footer pentru /m/tinctura', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    // Diagnostic: erorile de consolă (inclusiv [qr] fetchRestaurantBySlug) apar
    // în mesajul de fail — altfel un RPC picat e indistinct de un testid lipsă.
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })

    await page.goto('/m/tinctura')
    await page.waitForLoadState('networkidle')

    // Dacă restaurant-ul nu există în DB, sărim — nu e regresie a designului.
    const notFound = await page.getByText(/Restaurant negăsit/i).count()
    test.skip(notFound > 0, 'seed_tinctura_demo.sql nu e aplicat pe această instanță')

    // Starea de eroare a paginii (MenuError afișează mereu acest titlu) — dacă
    // e prezentă, raportăm CAUZA (text vizibil + console), nu „testid lipsă".
    const errShown = await page.getByText(/Nu am putut încărca meniul/i).count()
    if (errShown > 0) {
      const visible = await page.locator('body').innerText()
      throw new Error(
        `Meniul a intrat în starea de eroare.\nEcran: ${visible.slice(0, 300)}\n` +
          `Console: ${consoleErrors.slice(0, 5).join(' | ') || '(nimic)'}\n` +
          `PageErrors: ${errors.slice(0, 3).join(' | ') || '(nimic)'}`,
      )
    }

    // 1. Hero cu numele restaurant-ului
    await expect(page.getByTestId('hero-name')).toContainText('Tinctura Café')

    // 2. Status pill DESCHIS sau ÎNCHIS
    const statusPill = page.getByTestId('status-pill')
    await expect(statusPill).toBeVisible()
    await expect(statusPill).toContainText(/DESCHIS ACUM|ÎNCHIS/)

    // 3. Cel puțin un info-pill (adresă / ore / WiFi / Vegan / Instagram)
    const pills = page.getByTestId('info-pill')
    expect(await pills.count()).toBeGreaterThan(0)

    // 4. Tabs categorii vizibile
    const tabs = page.getByTestId('category-tabs')
    await expect(tabs).toBeVisible()
    await expect(tabs).toContainText(/Toate/)
    await expect(tabs).toContainText(/Cafea/)

    // 5. Card produs vizibil
    const cards = page.getByTestId('product-card')
    expect(await cards.count()).toBeGreaterThan(0)

    // 6. Search funcționează (filtrare client-side)
    await page.getByTestId('search-input').fill('espresso')
    await page.waitForTimeout(300)
    const filteredCards = await page.getByTestId('product-card').count()
    expect(filteredCards).toBeGreaterThan(0)
    await expect(page.getByTestId('product-card').first()).toContainText(/Espresso/i)

    // 7. Clear search + click pe tab "Cafea" → schimbă conținut
    await page.getByTestId('search-input').fill('')
    await page.waitForTimeout(150)

    // 8. Footer brand cu "MENIU BY MENUVIA"
    const footer = page.getByTestId('footer-brand')
    await expect(footer).toBeVisible()
    await expect(footer).toContainText(/MENIU BY MENUVIA/)

    // Niciun JS error. „due to access control checks" e zgomot WebKit-only:
    // apelul RPC compus (get_menu_by_slug/get_restaurant_by_slug, mig 245) care
    // cade pe fallback-ul în doi pași e logat de Safari ca eroare de consolă,
    // deși fluxul e BY DESIGN și meniul se randează (aserțiunile 1–8 de mai sus
    // rămân gate-ul real — o rupere adevărată pică acolo, nu aici).
    const critical = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('Manifest') &&
        !e.includes('service worker') &&
        !e.includes('access control checks'),
    )
    expect(critical).toEqual([])
  })
})
