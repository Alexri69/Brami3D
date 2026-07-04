#!/usr/bin/env node
/*
 * Tests de la lógica de negocio de brami3d_supabase.html.
 *
 * La app es un HTML sin build, así que no hay módulos que importar: este
 * script EXTRAE las funciones reales del HTML (por nombre, con emparejado de
 * llaves) y las evalúa en un contexto aislado con stubs mínimos. Así los
 * tests prueban el código de producción, no una copia.
 *
 * Se centra en lo que toca dinero e impuestos: costes, totales de líneas,
 * hash canónico VeriFactu, resolución de plan y validación numérica.
 *
 * Uso:  node scripts/test.js   (también corre en CI junto a validate.js)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const HTML = path.join(__dirname, '..', 'brami3d_supabase.html');
const src = fs.readFileSync(HTML, 'utf8');

// ── Extractores ─────────────────────────────────────────────────────────────
function extractFunction(name) {
  const sig = `function ${name}(`;
  const i = src.indexOf(sig);
  if (i < 0) throw new Error(`No se encontró "function ${name}(" en el HTML`);
  // 1) Saltar la lista de parámetros balanceando paréntesis (los parámetros
  //    desestructurados como {min=0}={} llevan llaves que no son el cuerpo).
  let k = i + sig.length - 1;   // apunta al '(' de la firma
  let pd = 0;
  for (; k < src.length; k++) {
    if (src[k] === '(') pd++;
    else if (src[k] === ')') { pd--; if (pd === 0) { k++; break; } }
  }
  // 2) Balancear las llaves del cuerpo desde la primera '{' tras los parámetros.
  let m = src.indexOf('{', k);
  let depth = 0;
  for (; m < src.length; m++) {
    if (src[m] === '{') depth++;
    else if (src[m] === '}') { depth--; if (depth === 0) { m++; break; } }
  }
  return src.slice(i, m);
}

function extractConstLine(name) {
  const m = src.match(new RegExp(`^const ${name}\\s*=.*$`, 'm'));
  if (!m) throw new Error(`No se encontró "const ${name} = …" en el HTML`);
  return m[0];
}

// ── Contexto de evaluación con stubs mínimos ────────────────────────────────
const ctx = vm.createContext({ console, URLSearchParams });
const code = [
  'var CU = null;',
  'var _plan = {};',
  'var _cache = { filamentos: [], impresoras: [] };',
  extractConstLine('ADMIN_EMAILS'),
  extractConstLine('isoDate'),
  extractFunction('calcLineasTotals'),
  extractFunction('calcOrderCosts'),
  extractFunction('canonicalRegistroString'),
  extractFunction('resolvePlan'),
  extractFunction('numVal'),
  extractFunction('validateNum'),
  extractFunction('qrAEATUrl'),
  // isoDate es const (léxico): exponerla al exterior del script.
  'var __isoDate = isoDate;',
].join('\n\n');
vm.runInContext(code, ctx, { filename: 'extraido-de-brami3d_supabase.html' });

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// ── calcLineasTotals ────────────────────────────────────────────────────────
test('calcLineasTotals: peso y tiempo multiplican por qty', () => {
  const r = ctx.calcLineasTotals([{ qty: 2, peso: '10', tiempoImpresion: '1.5' }]);
  approx(r.pesoTotal, 20);
  approx(r.tiempoTotal, 3);
});

test('calcLineasTotals: multi-filamento suma los pesos de la línea', () => {
  const r = ctx.calcLineasTotals([{ qty: 2, filamentos: [{ peso: '5' }, { peso: '3' }], tiempoImpresion: '' }]);
  approx(r.pesoTotal, 16);
  approx(r.tiempoTotal, 0);
});

test('calcLineasTotals: entradas vacías o no numéricas cuentan 0', () => {
  const r = ctx.calcLineasTotals([{ qty: '', peso: 'abc', tiempoImpresion: null }]);
  approx(r.pesoTotal, 0);
  approx(r.tiempoTotal, 0);
});

// ── calcOrderCosts ──────────────────────────────────────────────────────────
const CFG = { costePorGramo: 0.05, costePorHora: 0.20, margen: 50 };

test('calcOrderCosts: pedido legado (sin líneas) con margen por defecto del cfg', () => {
  ctx._cache.filamentos = []; ctx._cache.impresoras = [];
  const c = ctx.calcOrderCosts({ peso: 100, tiempoImpresion: 10 }, CFG);
  approx(c.mc, 5);            // 100 g × 0.05
  approx(c.ec, 0.4);          // 10 h × 0.2 kW (defecto) × 0.20 €/kWh
  approx(c.tc, 5.4);
  approx(c.fp, 8.1);          // tc × 1.5 (margen 50 %)
  approx(c.profit, 2.7);
});

test('calcOrderCosts: precioFinal manda sobre margen y ganancia', () => {
  const c = ctx.calcOrderCosts({ peso: 100, tiempoImpresion: 10, precioFinal: 20, gananciaManual: 5 }, CFG);
  approx(c.fp, 20);
});

test('calcOrderCosts: gananciaManual = coste total + ganancia', () => {
  const c = ctx.calcOrderCosts({ peso: 100, tiempoImpresion: 10, gananciaManual: 5 }, CFG);
  approx(c.fp, 10.4);         // tc 5.4 + 5
});

test('calcOrderCosts: filamento asignado usa su precio/kg, no el cfg', () => {
  ctx._cache.filamentos = [{ id: 'f1', precioPorKg: 30 }];
  const c = ctx.calcOrderCosts({ lineas: [{ qty: 1, peso: '100', filamentoId: 'f1' }], tiempoImpresion: 0 }, CFG);
  approx(c.mc, 3);            // 100 g × 30 €/kg / 1000
});

test('calcOrderCosts: coste eléctrico usa el consumo de la impresora asignada', () => {
  ctx._cache.impresoras = [{ id: 'i1', consumoW: 400 }];
  const c = ctx.calcOrderCosts({ peso: 0, tiempoImpresion: 10, impresoraId: 'i1' }, CFG);
  approx(c.ec, 0.8);          // 10 h × 0.4 kW × 0.20
});

// ── canonicalRegistroString (hash VeriFactu) ────────────────────────────────
test('canonicalRegistroString: formato canónico exacto (Orden HAC/1177/2024)', () => {
  const s = ctx.canonicalRegistroString({
    emisor_nif: 'B12345678', factura_num: 'B3D-F-2026-001', factura_fecha: '2026-07-03',
    tipo: 'emision', cuota_iva: 4.2, importe_total: 24.2,
    hash_anterior: 'abc123', ts_emision: '2026-07-03T10:00:00.000Z',
  });
  assert.equal(s,
    'IDEmisorFactura=B12345678&NumSerieFactura=B3D-F-2026-001&' +
    'FechaExpedicionFactura=03-07-2026&TipoFactura=F1&CuotaTotal=4.20&' +
    'ImporteTotal=24.20&Huella=abc123&FechaHoraHusoGenRegistro=2026-07-03T10:00:00.000Z');
});

test('canonicalRegistroString: códigos de tipo R1/F2 y campos vacíos', () => {
  assert.match(ctx.canonicalRegistroString({ tipo: 'rectificativa', ts_emision: 'T' }), /TipoFactura=R1/);
  assert.match(ctx.canonicalRegistroString({ tipo: 'anulacion', ts_emision: 'T' }), /TipoFactura=F2/);
  assert.match(ctx.canonicalRegistroString({ ts_emision: 'T' }), /FechaExpedicionFactura=&/);
});

test('canonicalRegistroString: rectificativa con importes negativos (2 decimales con signo)', () => {
  const s = ctx.canonicalRegistroString({
    tipo: 'rectificativa', cuota_iva: -4.2, importe_total: -24.2, ts_emision: 'T',
  });
  assert.match(s, /TipoFactura=R1/);
  assert.match(s, /CuotaTotal=-4\.20/);
  assert.match(s, /ImporteTotal=-24\.20/);
});

// ── resolvePlan ─────────────────────────────────────────────────────────────
const FUTURO = new Date(Date.now() + 30 * 864e5).toISOString();
const PASADO = new Date(Date.now() - 30 * 864e5).toISOString();

test('resolvePlan: email de la whitelist es admin aunque no haya fila', () => {
  ctx.CU = { email: 'ALEXRI69@GMAIL.COM' };   // case-insensitive
  ctx.resolvePlan(null);
  assert.equal(ctx._plan.tier, 'admin');
  assert.ok(ctx._plan.isAdmin && ctx._plan.isPro);
});

test('resolvePlan: pro vigente', () => {
  ctx.CU = { email: 'taller@ejemplo.com' };
  ctx.resolvePlan({ plan: 'pro', expires_at: FUTURO });
  assert.equal(ctx._plan.tier, 'pro');
  assert.equal(ctx._plan.source, 'db');
});

test('resolvePlan: pro caducado con trial vigente cae a trial (sigue siendo pro efectivo)', () => {
  ctx.CU = { email: 'taller@ejemplo.com' };
  ctx.resolvePlan({ plan: 'pro', expires_at: PASADO, trial_until: FUTURO });
  assert.equal(ctx._plan.tier, 'pro');
  assert.equal(ctx._plan.source, 'trial');
});

test('resolvePlan: pro y trial caducados → free', () => {
  ctx.CU = { email: 'taller@ejemplo.com' };
  ctx.resolvePlan({ plan: 'pro', expires_at: PASADO, trial_until: PASADO });
  assert.equal(ctx._plan.tier, 'free');
  assert.equal(ctx._plan.isPro, false);
});

test('resolvePlan: sin fila → free por defecto; hasStripe refleja el customer', () => {
  ctx.CU = { email: 'taller@ejemplo.com' };
  ctx.resolvePlan(null);
  assert.equal(ctx._plan.tier, 'free');
  assert.equal(ctx._plan.source, 'default');
  ctx.resolvePlan({ plan: 'free', stripe_customer_id: 'cus_123' });
  assert.equal(ctx._plan.hasStripe, true);
});

// ── numVal / validateNum ────────────────────────────────────────────────────
test('numVal: coma decimal, clamps y valores por defecto', () => {
  assert.equal(ctx.numVal('3,5'), 3.5);
  assert.equal(ctx.numVal('-2', { min: 0 }), 0);
  assert.equal(ctx.numVal('999', { max: 100 }), 100);
  assert.equal(ctx.numVal('', { def: 7 }), 7);
  assert.equal(ctx.numVal('abc', { def: 7 }), 7);
});

test('validateNum: estricta, sin clamp silencioso', () => {
  assert.equal(ctx.validateNum('X', '3,25').value, 3.25);
  assert.equal(ctx.validateNum('X', '2.5', { integer: true }).ok, false);
  assert.equal(ctx.validateNum('X', '7', { min: 10 }).ok, false);
  assert.equal(ctx.validateNum('X', '', { allowEmpty: false }).ok, false);
  const vacio = ctx.validateNum('X', '');   // objetos del contexto VM: comparar campos, no referencia
  assert.equal(vacio.ok, true);
  assert.equal(vacio.value, null);
});

// ── qrAEATUrl / isoDate ─────────────────────────────────────────────────────
test('qrAEATUrl: NIF sin espacios, fecha DD-MM-YYYY, importe con 2 decimales', () => {
  const url = ctx.qrAEATUrl({ emisorNif: 'B 123 45678', numSerie: 'F-1', fecha: '2026-07-03', importe: 24.2 });
  assert.match(url, /^https:\/\/www2\.agenciatributaria\.gob\.es\//);
  assert.match(url, /nif=B12345678/);
  assert.match(url, /fecha=03-07-2026/);
  assert.match(url, /importe=24\.20/);
});

test('isoDate: fecha local YYYY-MM-DD con padding', () => {
  assert.equal(ctx.__isoDate(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(ctx.__isoDate(new Date(2026, 11, 31)), '2026-12-31');
});
