// Cloudflare Pages Function — proxy transparent /_fn/<name> → funcțiile Netlify.
//
// Frontend-ul (cu VITE_FUNCTIONS_BASE=/_fn) lovește /_fn/<name>; aici proxăm 1:1
// spre https://<netlify>/.netlify/functions/<name>, ca cele 22 de funcții Node +
// cron-urile să rămână pe Netlify NEATINSE. Same-origin din perspectiva
// browserului → fără CORS/preflight. Vezi docs/CLOUDFLARE_PAGES.md.
//
// NETLIFY_FN_ORIGIN se setează ca variabilă în Cloudflare Pages (Settings →
// Environment variables). Fallback pe domeniul Netlify implicit.
export async function onRequest(context) {
  const { request, params, env } = context
  const origin = (env && env.NETLIFY_FN_ORIGIN) || 'https://menuvia.netlify.app'

  // [[name]] e catch-all → poate fi string sau array de segmente.
  const raw = params && params.name
  const name = Array.isArray(raw) ? raw.join('/') : raw || ''

  const incoming = new URL(request.url)
  const target = `${origin.replace(/\/+$/, '')}/.netlify/functions/${name}${incoming.search}`

  // Reconstruim requestul (metodă, headere, corp) 1:1. `redirect: manual` ca un
  // eventual redirect al funcției să nu fie urmat de proxy, ci pasat clientului.
  const proxied = new Request(target, {
    method: request.method,
    headers: request.headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  })

  return fetch(proxied)
}
