import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'path'

const sentryAuth = process.env.SENTRY_AUTH_TOKEN
const sentryOrg = process.env.SENTRY_ORG
const sentryProject = process.env.SENTRY_PROJECT
const sentryReady = Boolean(sentryAuth && sentryOrg && sentryProject)
const release = process.env.COMMIT_REF || process.env.GITHUB_SHA

export default defineConfig({
  plugins: [
    react(),
    // Gated pe env vars: pe local dev / CI fără token = no-op silent.
    // Pe Netlify build cu SENTRY_AUTH_TOKEN setat = upload source maps +
    // injectează release name în bundle pentru decode stack traces.
    ...(sentryReady
      ? [
          sentryVitePlugin({
            org: sentryOrg,
            project: sentryProject,
            authToken: sentryAuth,
            release: release ? { name: release } : undefined,
            sourcemaps: {
              assets: ['./dist/**/*.js', './dist/**/*.js.map'],
              // Critic: șterge .map din dist/ după upload — Netlify deployează
              // doar bundle minified, Sentry păstrează maps privat pentru decode.
              filesToDeleteAfterUpload: ['./dist/**/*.js.map'],
            },
            telemetry: false,
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Generăm source maps DOAR pe build-uri cu Sentry ready (upload + delete).
    // Fără asta, dev/CI nu generează .map → zero risc de leak public.
    sourcemap: sentryReady,
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
