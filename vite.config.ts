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
        // Formă de FUNCȚIE (vite 8/rolldown nu mai acceptă obiectul — build-ul
        // pica cu „manualChunks is not a function"); aceeași împărțire pe
        // pachete ca vechiul obiect, cu scheduler lângă react (dep de runtime).
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined
          const after = id.split('node_modules/').pop() ?? ''
          const pkg = after.startsWith('@')
            ? after.split('/').slice(0, 2).join('/')
            : after.split('/')[0]
          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler')
            return 'vendor-react'
          if (pkg.startsWith('@supabase/')) return 'vendor-supabase'
          if (pkg === 'idb-keyval') return 'vendor-idb'
          if (pkg === 'recharts') return 'vendor-charts'
          if (pkg === 'jspdf') return 'vendor-pdf'
          if (pkg === 'qrcode') return 'vendor-qr'
          if (pkg.startsWith('@sentry/')) return 'vendor-sentry'
          return undefined
        },
      },
    },
  },
})
