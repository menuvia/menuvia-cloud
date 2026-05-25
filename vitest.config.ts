/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    css: false, // skip CSS pentru viteză
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Include doar fișierele cu logică pură. Fișierele care sunt 99%
      // wrappers RPC Supabase (cashShifts, happyHour, invoices, qr, etc.)
      // necesită mock-uri sau teste integrare cu DB local — alt nivel.
      include: [
        'src/lib/utils.ts',
        'src/lib/vat.ts',
        'src/lib/orders.ts',
        'src/lib/stocks.ts',
        'src/lib/reports.ts',
        'src/schemas/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/schemas/index.ts', // re-exports, fără logică testabilă direct
      ],
      thresholds: {
        // Praguri inițiale realiste pentru start incremental.
        // Pe măsură ce adaugi teste pentru cashShifts, happyHour, invoices etc.,
        // ridică treptat (50% → 60% → 70% în 3 luni).
        lines: 15,
        functions: 20,
        branches: 12,
        statements: 15,
      },
    },
    // Filtru: doar fișiere din src/, nu din e2e/ sau node_modules
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'e2e', '.idea', '.git', '.cache'],
  },
})
