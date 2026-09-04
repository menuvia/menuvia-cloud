// tests/functions/helpers/mocks.js
// Harness zero-dependențe pentru funcțiile Netlify de BANI (stripe-webhook,
// table-payment, oblio-generator): interceptează require('@supabase/supabase-js')
// și require('stripe') prin Module._load, ca handler-ele să ruleze NESCHIMBATE
// (Lambda-style, exports.handler(event)) contra unor fake-uri scriptabile.
//
// Aceeași filozofie ca bridge/test (node --test, zero deps): testele acoperă
// LOGICA NOASTRĂ (mapări de hint→status, idempotență, ambiguu vs. retryabil,
// fail-closed pe bani), nu bibliotecile vendorilor. Se rulează cu
// `node --test` din tests/functions/ — local (fără node_modules) și în CI.

'use strict'

const Module = require('module')

// ── Stare scriptabilă per-test ───────────────────────────────────────────────
// Testele setează handler-e înainte de a chema handler-ul funcției; fiecare
// beforeEach cheamă resetMocks(). Toate apelurile sunt înregistrate pentru
// asserțiuni (cine, cu ce argumente, în ce ordine).
const state = {
  // supabase.rpc(name, args) → handler-ul întoarce {data, error}
  rpcHandlers: Object.create(null),
  rpcCalls: [],
  // supabase.from(table)... → handler-ul primește lista de operații din lanț
  // (ex. [{m:'update',args:[...]},{m:'eq',...}]) și întoarce {data, error}
  fromHandlers: Object.create(null),
  fromCalls: [],
  // Stripe: impls['paymentIntents.create'] = async (...args) => ...
  stripeImpls: Object.create(null),
  stripeCalls: [],
  stripeCtors: [],
}

function resetMocks() {
  state.rpcHandlers = Object.create(null)
  state.rpcCalls = []
  state.fromHandlers = Object.create(null)
  state.fromCalls = []
  state.stripeImpls = Object.create(null)
  state.stripeCalls = []
  state.stripeCtors = []
}

// ── Fake supabase-js ─────────────────────────────────────────────────────────
// Query builder minimal: orice metodă din lanț se înregistrează și întoarce
// builder-ul; builder-ul e thenable, deci `await` îl rezolvă prin handler-ul
// tabelei. Handler-ul vede TOT lanțul, ca testul să distingă insert/update/
// select(.single()) pe aceeași tabelă.
// `abortSignal` e in lant fiindca /health il foloseste pe ping-ul DB si pe
// prospetimea cron-ului (timeout defensiv, nu Promise.race).
const CHAIN_METHODS = ['insert', 'update', 'select', 'eq', 'neq', 'single', 'limit', 'order', 'is', 'in', 'gte', 'lte', 'abortSignal']

function makeBuilder(table) {
  const ops = []
  const builder = {}
  for (const m of CHAIN_METHODS) {
    builder[m] = (...args) => {
      ops.push({ m, args })
      return builder
    }
  }
  builder.then = (resolve, reject) => {
    state.fromCalls.push({ table, ops })
    const handler = state.fromHandlers[table]
    let out
    try {
      out = handler ? handler(ops) : { data: null, error: null }
    } catch (e) {
      return Promise.reject(e).then(resolve, reject)
    }
    return Promise.resolve(out).then(resolve, reject)
  }
  return builder
}

const fakeSupabaseModule = {
  createClient: () => ({
    // rpc(...) intoarce un THENABLE, nu un Promise: clientul real permite
    // `.abortSignal(...)` in lant inainte de await (asa face /health). `await`
    // functioneaza identic, deci apelantii care nu inlantuie nimic nu se schimba.
    rpc: (name, args) => {
      state.rpcCalls.push({ name, args })
      const run = () => {
        const handler = state.rpcHandlers[name]
        if (!handler) return { data: null, error: null }
        return handler(args)
      }
      const thenable = {
        abortSignal: () => thenable,
        then: (resolve, reject) => {
          let out
          try {
            out = run()
          } catch (e) {
            return Promise.reject(e).then(resolve, reject)
          }
          return Promise.resolve(out).then(resolve, reject)
        },
      }
      return thenable
    },
    from: (table) => makeBuilder(table),
  }),
}

// ── Fake Stripe ──────────────────────────────────────────────────────────────
// new Stripe(key, opts) → obiect cu namespace-urile folosite de funcții.
// Fiecare metodă caută state.stripeImpls['<ns>.<metodă>']; nescriptată → throw
// (testul care o atinge fără s-o scripteze e un test greșit, nu un fallback).
function stripeMethod(name) {
  return async (...args) => {
    state.stripeCalls.push({ name, args })
    const impl = state.stripeImpls[name]
    if (!impl) throw new Error(`stripe mock: '${name}' nescriptat în acest test`)
    return impl(...args)
  }
}

function FakeStripe(key, opts) {
  state.stripeCtors.push({ key, opts })
  return {
    paymentIntents: {
      create: stripeMethod('paymentIntents.create'),
      cancel: stripeMethod('paymentIntents.cancel'),
    },
    subscriptions: { retrieve: stripeMethod('subscriptions.retrieve') },
    refunds: { list: stripeMethod('refunds.list') },
    charges: { retrieve: stripeMethod('charges.retrieve') },
    webhooks: {
      // constructEvent e SINCRON în stripe-node — nu-l trecem prin stripeMethod
      // (care e async): handler-ul îl cheamă în try/catch sincron.
      constructEvent: (...args) => {
        state.stripeCalls.push({ name: 'webhooks.constructEvent', args })
        const impl = state.stripeImpls['webhooks.constructEvent']
        if (!impl) throw new Error("stripe mock: 'webhooks.constructEvent' nescriptat")
        return impl(...args)
      },
    },
  }
}

// ── Interceptarea require-urilor ─────────────────────────────────────────────
let installed = false
function installModuleMocks() {
  if (installed) return
  installed = true
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === '@supabase/supabase-js') return fakeSupabaseModule
    if (request === 'stripe') return FakeStripe
    return originalLoad.apply(this, arguments)
  }
}

// Încarcă o funcție Netlify cu mock-urile instalate. path relativ la repo root.
function loadFunction(relPath) {
  installModuleMocks()
  return require(require('path').join(__dirname, '..', '..', '..', relPath))
}

// ── Utilitare de asserțiune ──────────────────────────────────────────────────
function rpcCallsFor(name) {
  return state.rpcCalls.filter((c) => c.name === name)
}
function stripeCallsFor(name) {
  return state.stripeCalls.filter((c) => c.name === name)
}
// Primul argument al unei operații dintr-un lanț from() (ex. payload-ul lui insert).
function opArg(ops, method) {
  const found = ops.find((o) => o.m === method)
  return found ? found.args[0] : undefined
}
function hasOp(ops, method) {
  return ops.some((o) => o.m === method)
}

function parseBody(res) {
  return JSON.parse(res.body)
}

module.exports = {
  state,
  resetMocks,
  installModuleMocks,
  loadFunction,
  rpcCallsFor,
  stripeCallsFor,
  opArg,
  hasOp,
  parseBody,
}
