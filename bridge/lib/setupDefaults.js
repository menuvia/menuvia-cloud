'use strict';

// ═════════════════════════════════════════════════════════════════════════════
// Valorile implicite ale wizardului `--setup`, din config.json-ul deja aflat
// lângă executabil (lotul C7a).
//
// Panoul (BridgeTab) dă la descărcare un config.json cu adresa Supabase, cheia
// anon și device_secret-ul dispozitivului abia înregistrat; installer-ul îl
// copiază lângă exe (build/installer.iss, `{src}\config.json`), iar wizardul
// rulat la final îl citește aici: Enter = păstrează. Înainte wizardul cerea
// „Supabase anon key" FĂRĂ valoare implicită — o cheie pe care patronul nu o
// putea citi nicăieri — și propunea „nu" la imprimanta de bucătărie, deci pe
// Planul 2 (PC doar pentru tichete) cine apăsa Enter primea un bridge care nu
// tipărea nimic.
// ═════════════════════════════════════════════════════════════════════════════

const DEFAULT_SUPABASE_URL = 'https://swjcptdylfmpvopdepqf.supabase.co';

// Un câmp text real; locurile goale din config.example.json („PUNE_AICI_…")
// nu sunt valori, deci nu devin implicite.
function str(v) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return t.startsWith('PUNE_AICI') ? '' : t;
}

function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/**
 * Implicitele wizardului. `existing` = config.json-ul găsit (sau orice altceva,
 * inclusiv null/JSON stricat → implicitele de fabrică).
 */
function wizardDefaults(existing) {
  const e = obj(existing);
  const fn = obj(e.fiscalnet);
  const kt = obj(e.kitchen);
  const port = Number(kt.port);
  return {
    supabaseUrl: str(e.supabaseUrl) || DEFAULT_SUPABASE_URL,
    supabaseAnonKey: str(e.supabaseAnonKey),
    deviceSecret: str(e.deviceSecret),
    // `false` doar explicit: config.json-ul de Plan 2 (PC fără FiscalNet).
    fiscalRequired: fn.required !== false,
    fiscalMode: fn.mode === 'file' ? 'file' : 'api',
    apiUrl: str(fn.apiUrl) || 'http://localhost:65400/api/receipt',
    bonuriDir: str(fn.bonuriDir) || 'C:\\FiscalNet\\Bonuri',
    raspunsDir: str(fn.raspunsDir) || 'C:\\FiscalNet\\Raspuns',
    kitchen: kt.enabled === true,
    kitchenMode: kt.mode === 'file' ? 'file' : 'tcp',
    kitchenHost: str(kt.host) || '192.168.1.100',
    kitchenPort: Number.isInteger(port) && port > 0 ? String(port) : '9100',
    kitchenDir: str(kt.dir) || 'C:\\Menuvia\\Tichete',
  };
}

/** Cheia afișată în prompt: doar ultimele 4 caractere (`…a1b2`). */
function maskSecret(v) {
  const s = typeof v === 'string' ? v : '';
  if (!s) return '';
  return s.length <= 4 ? '…' : `…${s.slice(-4)}`;
}

module.exports = { wizardDefaults, maskSecret, DEFAULT_SUPABASE_URL };
