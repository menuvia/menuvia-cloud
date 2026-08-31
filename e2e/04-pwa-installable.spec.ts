// e2e/04-pwa-installable.spec.ts
// Verifică că PWA-ul e configurat corect: manifest valid, SW se înregistrează.
import { test, expect } from '@playwright/test'

test.describe('PWA installability', () => {
  test('manifest.json is served and valid', async ({ page, request }) => {
    const res = await request.get('/manifest.json')
    expect(res.status()).toBe(200)

    const manifest = await res.json()
    expect(manifest.name).toMatch(/Menuvia/i)
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.theme_color).toBeTruthy()
    expect(manifest.icons).toBeInstanceOf(Array)
    expect(manifest.icons.length).toBeGreaterThan(0)

    // PNG-urile de instalare (audit aug 2026): doar SVG nu ajunge — Android
    // cere 192/512 PNG pentru install prompt, iar variantele maskable au
    // safe-zone. Asserțiile îngheață prezența lor în manifest ȘI pe disc.
    const pngs = manifest.icons.filter((i: { type?: string }) => i.type === 'image/png')
    expect(pngs.length).toBeGreaterThanOrEqual(4)
    expect(
      manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable'),
    ).toBe(true)
    for (const path of ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']) {
      const iconRes = await request.get(path)
      expect(iconRes.status(), `${path} trebuie servit`).toBe(200)
    }
  })

  test('apple-touch-icon este PNG (iOS nu suportă SVG aici)', async ({ page }) => {
    await page.goto('/')
    const appleIcon = page.locator('link[rel="apple-touch-icon"]')
    await expect(appleIcon).toHaveAttribute('href', /\.png$/)
  })

  test('sw.js is served with no-cache headers', async ({ request }) => {
    const res = await request.get('/sw.js')
    expect(res.status()).toBe(200)
    const cacheControl = res.headers()['cache-control'] || ''
    expect(cacheControl).toMatch(/no-cache|no-store/i)
  })

  test('homepage links to manifest', async ({ page }) => {
    await page.goto('/')
    const manifestLink = page.locator('link[rel="manifest"]')
    await expect(manifestLink).toHaveAttribute('href', /manifest\.json/)
  })

  test('service worker registers successfully', async ({ page, context }) => {
    // Visit a page that registers SW
    await page.goto('/')
    await page.waitForLoadState('load')

    // Wait for SW to register (give it time)
    await page.waitForTimeout(2000)

    // Check via JS that SW is registered
    const swStatus = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'not-supported'
      try {
        const reg = await navigator.serviceWorker.getRegistration()
        if (!reg) return 'not-registered'
        return reg.active ? 'active' : (reg.installing ? 'installing' : 'unknown')
      } catch (e) {
        return 'error:' + (e instanceof Error ? e.message : 'unknown')
      }
    })

    // SW should be active or installing (both valid)
    expect(['active', 'installing']).toContain(swStatus)
  })
})
