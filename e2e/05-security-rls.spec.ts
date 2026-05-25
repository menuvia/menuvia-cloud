// e2e/05-security-rls.spec.ts
// ─────────────────────────────────────────────────────────────────
// Verifică securitatea RLS: anon nu poate scana tabele protejate.
// (P2 fix — test ne-skippable, forțează configurare corectă în CI)
// ─────────────────────────────────────────────────────────────────
import { test, expect, request } from '@playwright/test'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.E2E_SUPABASE_URL
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.E2E_SUPABASE_ANON_KEY

// Hard guard — NU mai facem silent skip.
test.beforeAll(async () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'RLS tests require VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY. ' +
        'Set them in .env or CI secrets. NO SILENT SKIP.',
    )
  }
})

test.describe('Security: RLS policies (NON-SKIPPABLE)', () => {
  test('anon cannot SELECT * on restaurants (SEC-002 fix)', async () => {
    const ctx = await request.newContext()
    const res = await ctx.get(`${SUPABASE_URL}/rest/v1/restaurants?select=*&limit=100`, {
      headers: {
        apikey: SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    })

    expect([200, 401, 403]).toContain(res.status())
    if (res.status() === 200) {
      const data = await res.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBe(0)
    }
  })

  test('anon cannot INSERT into restaurants', async () => {
    const ctx = await request.newContext()
    const res = await ctx.post(`${SUPABASE_URL}/rest/v1/restaurants`, {
      headers: {
        apikey: SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      data: {
        name: 'Hack Attempt Restaurant',
        slug: `hack-attempt-${Date.now()}`,
        owner_id: '00000000-0000-0000-0000-000000000000',
      },
    })

    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)
  })

  test('anon cannot SELECT profiles', async () => {
    const ctx = await request.newContext()
    const res = await ctx.get(`${SUPABASE_URL}/rest/v1/profiles?select=*&limit=10`, {
      headers: {
        apikey: SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    })

    expect([200, 401, 403]).toContain(res.status())
    if (res.status() === 200) {
      const data = await res.json()
      expect(data.length).toBe(0)
    }
  })

  test('anon cannot read orders directly', async () => {
    const ctx = await request.newContext()
    const res = await ctx.get(`${SUPABASE_URL}/rest/v1/orders?select=*&limit=10`, {
      headers: {
        apikey: SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    })

    expect([200, 401, 403]).toContain(res.status())
    if (res.status() === 200) {
      const data = await res.json()
      expect(data.length).toBe(0)
    }
  })

  test('get_restaurant_by_slug RPC works for non-existent slug', async ({ page }) => {
    await page.goto('/menu/nonexistent-slug-12345')
    await page.waitForLoadState('networkidle')

    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.waitForTimeout(2000)
    expect(errors.filter((e) => !e.includes('favicon'))).toEqual([])
  })

  test('anon cannot directly invoke privileged RPC', async () => {
    const ctx = await request.newContext()
    const res = await ctx.post(`${SUPABASE_URL}/rest/v1/rpc/delete_restaurant`, {
      headers: {
        apikey: SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      data: { p_restaurant_id: '00000000-0000-0000-0000-000000000000' },
    })

    // 404 (function doesn't exist) sau 401/403 (forbidden) ambele OK
    // Important: NU trebuie să fie 200 success
    expect(res.status()).not.toBe(200)
  })
})
