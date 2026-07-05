'use strict';

// Utilitare mici, fără dependențe.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Log structurat pe stdout/stderr cu timestamp ISO. Nivel: info/warn/error.
function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}` + (extra ? ` — ${extra}` : '');
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = { sleep, log };
