#!/usr/bin/env node
// Brami3D — validador de sintaxis previo al despliegue.
// Recorre los .html del repo, extrae los <script> inline (sin src) y los compila
// con vm.Script para detectar errores de sintaxis ANTES de que lleguen a producción
// (recuerda: push a main = producción vía GitHub Pages).
// También comprueba que los .json/.webmanifest parsean.
// Uso: node scripts/validate.js   → sale con código 1 si encuentra algún error.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let errors = 0;
let filesChecked = 0;
let blocksChecked = 0;

// Carpetas que NO se despliegan (gitignoreadas o internas): no tiene sentido
// validarlas y meten ruido (p. ej. plantillas de skills de terceros con sintaxis
// que no es JS plano). Lo que importa es lo que llega a producción vía Pages.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.agents', '.claude', '.github',
  'marketing', 'secretos', 'supabase',
]);

// Lista los ficheros del repo con una extensión dada (ignora SKIP_DIRS).
function listFiles(dir, exts, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, exts, acc);
    else if (exts.includes(path.extname(entry.name).toLowerCase())) acc.push(full);
  }
  return acc;
}

const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

// ── 1) HTML: validar cada <script> inline ──────────────────────────────────
const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
for (const file of listFiles(ROOT, ['.html'])) {
  const html = fs.readFileSync(file, 'utf8');
  let m, i = 0, fileErrs = 0;
  while ((m = SCRIPT_RE.exec(html))) {
    i++;
    blocksChecked++;
    try {
      new vm.Script(m[1]);
    } catch (e) {
      fileErrs++;
      errors++;
      console.error(`❌ ${rel(file)} — bloque <script> #${i}: ${e.message}`);
    }
  }
  filesChecked++;
  if (fileErrs === 0) console.log(`✅ ${rel(file)} (${i} bloque(s))`);
}

// ── 2) JSON / webmanifest: validar que parsea ──────────────────────────────
for (const file of listFiles(ROOT, ['.json', '.webmanifest'])) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(`✅ ${rel(file)}`);
  } catch (e) {
    errors++;
    console.error(`❌ ${rel(file)} — JSON inválido: ${e.message}`);
  }
}

console.log(`\n${filesChecked} HTML · ${blocksChecked} bloques JS · ${errors} error(es)`);
if (errors > 0) {
  console.error('\n🚫 Validación FALLIDA — corrige los errores antes de desplegar.');
  process.exit(1);
}
console.log('🎉 Todo correcto.');
