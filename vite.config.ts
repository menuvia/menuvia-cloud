import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Sentry source maps upload: scos temporar pentru CI green (package-lock.json
// out of sync). Re-adăugat via post-build script separat după ce avem env+lock OK.

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Source maps OFF — zero risc de leak public + bundle mai mic.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Chunks separate pentru:
        //   - vendor stabili (react/supabase/query) → cache între deploy-uri
        //   - libs grele (charts/pdf/qr) → descărcate doar pe rutele care le folosesc
        //   - Sentry → încărcat oricum la pornire dar separat de aplicație
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-query': ['@tanstack/react-query', 'idb-keyval'],
          'vendor-charts': ['recharts'],
          'vendor-pdf': ['jspdf'],
          'vendor-qr': ['qrcode'],
          'vendor-sentry': ['@sentry/react'],
        },
      },
    },
  },
})
