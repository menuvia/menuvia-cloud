// playwright.config.ts
// Configurație Playwright pentru E2E tests Menuvia.
//
// Run:
//   npm run test:e2e         — headless, toate browser-ele
//   npm run test:e2e:ui      — UI mode interactiv (recomandat în dev)
//   npm run test:e2e:debug   — debugger Playwright pentru un singur test
//
// Mediu:
//   PLAYWRIGHT_BASE_URL  default http://localhost:4173 (vite preview)
//   CI=true              activează retries + reporter HTML
import { defineConfig, devices } from '@playwright/test'

const PORT     = process.env.PORT ?? '4173'
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  // CI: paralelizare prudentă, retries pentru flake
  fullyParallel: true,
  forbidOnly:    !!process.env.CI,
  retries:       process.env.CI ? 2 : 0,
  workers:       process.env.CI ? 2 : undefined,

  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
    locale: 'ro-RO',
    timezoneId: 'Europe/Bucharest',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },
  ],

  // Pornește vite preview înainte de teste, dacă nu rulează deja
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm run preview',
    port: parseInt(PORT, 10),
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
})
