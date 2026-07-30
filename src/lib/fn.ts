// src/lib/fn.ts
// URL-ul unei funcții serverless, centralizat + portabil între hosturi.
//
// Default = same-origin `/.netlify/functions/<name>` → comportament BYTE-identic
// pe Netlify (nicio schimbare de rețea față de înainte). Overridabil prin
// `VITE_FUNCTIONS_BASE`: pe Cloudflare Pages setezi `/_fn`, iar o Pages Function
// (functions/_fn/[[name]].js) proxează transparent spre funcțiile Netlify, care
// rămân neatinse. Astfel mutarea frontendului pe alt host devine o schimbare de
// ENV, nu de cod. Vezi docs/CLOUDFLARE_PAGES.md.
const RAW_BASE = import.meta.env.VITE_FUNCTIONS_BASE
const FUNCTIONS_BASE = (
  typeof RAW_BASE === 'string' && RAW_BASE.trim() ? RAW_BASE.trim() : '/.netlify/functions'
).replace(/\/+$/, '')

/** Construiește URL-ul unei funcții serverless după numele ei (fără extensie). */
export function fnUrl(name: string): string {
  return `${FUNCTIONS_BASE}/${name}`
}
