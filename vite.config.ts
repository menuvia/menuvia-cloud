import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
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
