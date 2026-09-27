// tests/stripe-contract/helpers/transport.js
// Transport HTTP fals pentru SDK-ul Stripe REAL: interceptează
// require('https').request la momentul apelului (NodeHttpClient din
// stripe-node îl citește per cerere tocmai ca să poată fi interceptat — vezi
// src/net/NodeHttpClient.ts), înregistrează cererea (metodă, cale, antete,
// corp) și răspunde cu un corp scriptat. Nicio conexiune nu pleacă din proces.
//
// De ce nu fake-ul din tests/functions: acela înlocuiește modulul 'stripe' cu
// totul, deci nu vede NIMIC din ce face SDK-ul — antetul Stripe-Version,
// codarea form a parametrilor imbricați, unde ajunge `stripeAccount`. Exact
// acolo a stat defectul găsit la bump-ul 14 → 22 (anularea pe contul
// platformei în loc de contul conectat).

'use strict'

const https = require('https')
const { EventEmitter } = require('events')
const { Readable } = require('stream')

const original = https.request
let routes = []
let captured = []

// route(method, pathPrefix, reply) — reply: { status, body } sau funcție (req) => {status, body}
function route(method, pathPrefix, reply) {
  routes.push({ method, pathPrefix, reply })
}

function install() {
  routes = []
  captured = []
  https.request = function fakeRequest(opts) {
    const req = new EventEmitter()
    const chunks = []
    const rec = {
      method: opts.method,
      path: opts.path,
      host: opts.host,
      headers: Object.fromEntries(
        Object.entries(opts.headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
      ),
      body: '',
    }
    req.setTimeout = () => req
    req.destroy = (err) => { if (err) setImmediate(() => req.emit('error', err)) }
    req.write = (c) => { if (c) chunks.push(Buffer.from(c)) }
    req.end = () => {
      rec.body = Buffer.concat(chunks).toString('utf8')
      captured.push(rec)
      const r = routes.find((x) => x.method === rec.method && rec.path.startsWith(x.pathPrefix))
      const reply = r
        ? (typeof r.reply === 'function' ? r.reply(rec) : r.reply)
        : { status: 599, body: { error: { type: 'api_error', message: `transport: rută nescriptată ${rec.method} ${rec.path}` } } }
      const res = new Readable({ read() {} })
      res.statusCode = reply.status || 200
      res.headers = { 'request-id': 'req_test', 'content-type': 'application/json' }
      res.complete = true
      res.push(JSON.stringify(reply.body || {}))
      res.push(null)
      setImmediate(() => req.emit('response', res))
    }
    // SDK-ul atașează ascultătorii DUPĂ ce request() întoarce → 'socket' asincron.
    setImmediate(() => req.emit('socket', { connecting: false }))
    return req
  }
}

function restore() {
  https.request = original
}

function requests() {
  return captured
}

// Corpul form-encoded → obiect plat { 'a[b][c]': 'v' }.
function form(rec) {
  return Object.fromEntries(new URLSearchParams(rec.body))
}

module.exports = { install, restore, route, requests, form }
