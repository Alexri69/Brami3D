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

// La app vive en el HTML + los módulos de /js (i18n, verifactu). Se concatena
// todo para que extractFunction encuentre las funciones vivan donde vivan.
const ROOT = path.join(__dirname, '..');
const src = [
  path.join(ROOT, 'brami3d_supabase.html'),
  path.join(ROOT, 'js', 'i18n.js'),
  path.join(ROOT, 'js', 'verifactu.js'),
  path.join(ROOT, 'js', 'slicer.js'),
].filter(fs.existsSync).map((f) => fs.readFileSync(f, 'utf8')).join('\n\n');

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
  extractFunction('costeGramoFil'),
  extractFunction('congelarPreciosLineas'),
  extractFunction('calcOrderCosts'),
  extractFunction('canonicalRegistroString'),
  extractFunction('resolvePlan'),
  extractFunction('numVal'),
  extractFunction('validateNum'),
  extractFunction('qrAEATUrl'),
  extractFunction('desgloseImpuestos'),
  extractFunction('precioCongelado'),
  extractConstLine('DENSIDADES'),
  extractFunction('normalizarMaterial'),
  extractFunction('densidadMaterial'),
  extractFunction('gramosDesdeMetros'),
  extractFunction('parseTiempoTexto'),
  extractFunction('hexColor'),
  extractFunction('nombreDesdeArchivo'),
  extractFunction('detectarLaminador'),
  extractFunction('parseSlicerGcode'),
  extractFunction('parseSliceInfo'),
  extractFunction('sumarResultados'),
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

test('calcOrderCosts: presupuesto aceptado usa el precio aceptado (precioPublico)', () => {
  const c = ctx.calcOrderCosts({ peso: 100, tiempoImpresion: 10, gananciaManual: 5, aceptado: true, precioPublico: 45 }, CFG);
  approx(c.fp, 45);
  // precioFinal manual sigue mandando
  approx(ctx.calcOrderCosts({ peso: 100, tiempoImpresion: 10, precioFinal: 50, aceptado: true, precioPublico: 45 }, CFG).fp, 50);
  // sin aceptar, precioPublico no influye
  const libre = ctx.calcOrderCosts({ peso: 100, tiempoImpresion: 10, gananciaManual: 5 }, CFG).fp;
  approx(ctx.calcOrderCosts({ peso: 100, tiempoImpresion: 10, gananciaManual: 5, precioPublico: 45 }, CFG).fp, libre);
});

test('calcOrderCosts: gananciaManual = coste total + ganancia', () => {
  const c = ctx.calcOrderCosts({ peso: 100, tiempoImpresion: 10, gananciaManual: 5 }, CFG);
  approx(c.fp, 10.4);         // tc 5.4 + 5
});

test('calcOrderCosts: precio redondeado a céntimos (los totales cuadran con las filas)', () => {
  // tc 6.664 × 1.5 = 9.996 → 10.00 ; tc 16.664 × 1.5 = 24.996 → 25.00 ; suma 35, no 34.99
  const a = ctx.calcOrderCosts({ peso: 133.28, tiempoImpresion: 0 }, CFG);
  const b = ctx.calcOrderCosts({ peso: 333.28, tiempoImpresion: 0 }, CFG);
  assert.strictEqual(a.fp, 10);
  assert.strictEqual(b.fp, 25);
  assert.strictEqual((a.fp + b.fp).toFixed(2), '35.00');
});

test('calcOrderCosts: filamento asignado usa su precio/kg, no el cfg', () => {
  ctx._cache.filamentos = [{ id: 'f1', precioPorKg: 30 }];
  const c = ctx.calcOrderCosts({ lineas: [{ qty: 1, peso: '100', filamentoId: 'f1' }], tiempoImpresion: 0 }, CFG);
  approx(c.mc, 3);            // 100 g × 30 €/kg / 1000
});

test('calcOrderCosts: precio congelado manda aunque cambie el rollo', () => {
  ctx._cache.filamentos = [{ id: 'f1', precioPorKg: 30 }];
  const lineas = ctx.congelarPreciosLineas([{ qty: 1, filamentos: [{ filamentoId: 'f1', peso: '100' }] }], CFG);
  ctx._cache.filamentos = [{ id: 'f1', precioPorKg: 60 }];      // sube el precio del rollo
  approx(ctx.calcOrderCosts({ lineas, tiempoImpresion: 0 }, CFG).mc, 3);
  ctx._cache.filamentos = [];                                      // rollo borrado
  approx(ctx.calcOrderCosts({ lineas, tiempoImpresion: 0 }, CFG).mc, 3);
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

// ── desgloseImpuestos (XML AEAT, CSV gestor, PDFs) ──────────────────────────
test('desgloseImpuestos: solo IVA → un detalle con la cuota registrada', () => {
  const d = ctx.desgloseImpuestos({ base_imponible: 100, tipo_iva: 21, cuota_iva: 21, datos_json: {} });
  assert.strictEqual(d.length, 1);
  approx(d[0].tipo, 21); approx(d[0].cuota, 21);
});

test('desgloseImpuestos: IVA + recargo → dos detalles que suman la cuota exacta', () => {
  const r = { base_imponible: 33.33, tipo_iva: 21, cuota_iva: 8.55,
    datos_json: { cfg_snapshot: { tipo_iva2: 5.2, nombre_impuesto: 'IVA', nombre_impuesto2: 'Recargo' } } };
  const [a, b] = ctx.desgloseImpuestos(r);
  approx(a.cuota, 7.0);        // 33.33 × 21 % = 6.9993 → 7.00
  approx(b.cuota, 1.55);       // resto: 8.55 − 7.00
  approx(a.cuota + b.cuota, 8.55, 1e-9);
  assert.strictEqual(b.nombre, 'Recargo');
});

test('desgloseImpuestos: rectificativa en negativo conserva el signo', () => {
  const [a] = ctx.desgloseImpuestos({ base_imponible: -50, tipo_iva: 21, cuota_iva: -10.5, datos_json: {} });
  approx(a.cuota, -10.5);
});

// ── precioCongelado ─────────────────────────────────────────────────────────
test('precioCongelado: respeta precioFinal guardado aunque cambie el margen', () => {
  ctx._cache.cfg = { costePorGramo: 0.05, costePorHora: 0.2, margen: 200 };
  ctx._cache.filamentos = []; ctx._cache.impresoras = [];
  approx(ctx.precioCongelado({ peso: 100, tiempoImpresion: 10, precioFinal: 8.1 }), 8.1);
});

test('precioCongelado: sin precioFinal calcula con la config actual', () => {
  ctx._cache.cfg = { costePorGramo: 0.05, costePorHora: 0.2, margen: 50 };
  approx(ctx.precioCongelado({ peso: 100, tiempoImpresion: 10, precioFinal: null }), 8.1);
});

// ── Lector de archivos del laminador (js/slicer.js) ─────────────────────────
test('parseTiempoTexto: formatos de PrusaSlicer, Bambu, Simplify3D y h:m:s', () => {
  assert.equal(ctx.parseTiempoTexto('1d 2h 3m 4s'), 93784);
  assert.equal(ctx.parseTiempoTexto('2h 5m'), 7500);
  assert.equal(ctx.parseTiempoTexto('1 hour 23 minutes'), 4980);
  assert.equal(ctx.parseTiempoTexto('1:02:03'), 3723);
  assert.equal(ctx.parseTiempoTexto(''), null);
});

test('normalizarMaterial: variantes del laminador → materiales de la app', () => {
  assert.equal(ctx.normalizarMaterial('PLA Basic'), 'PLA');
  assert.equal(ctx.normalizarMaterial('PLA+'), 'PLA+');
  assert.equal(ctx.normalizarMaterial('PETG-HF'), 'PETG');
  assert.equal(ctx.normalizarMaterial('PA-CF'), 'Nylon');
  assert.equal(ctx.normalizarMaterial('flex'), 'TPU');
  assert.equal(ctx.normalizarMaterial('PC'), 'Otro');
});

test('parseSlicerGcode: PrusaSlicer multimaterial', () => {
  const r = ctx.parseSlicerGcode([
    '; generated by PrusaSlicer 2.8.1+win64',
    'G1 X10 Y10',
    '; filament used [mm] = 5000.12, 1200.00',
    '; filament used [g] = 14.92, 3.58',
    '; estimated printing time (normal mode) = 1h 2m 3s',
    '; filament_colour = #FF8000;#000000',
    '; filament_type = PLA;PETG',
  ].join('\n'));
  assert.equal(r.segundos, 3723);
  assert.equal(r.laminador, 'PrusaSlicer');
  assert.equal(r.filamentos.length, 2);
  assert.equal(r.filamentos[0].gramos, 14.92);
  assert.equal(r.filamentos[0].material, 'PLA');
  assert.equal(r.filamentos[0].color, '#ff8000');
  assert.equal(r.filamentos[1].material, 'PETG');
});

test('parseSlicerGcode: metadatos de .bgcode (sin ";" y con "=")', () => {
  const r = ctx.parseSlicerGcode('GCDE\u0001\u0000filament used [g]=22.5\nestimated printing time (normal mode)=45m 10s\nfilament_type=PETG\n');
  approx(r.filamentos[0].gramos, 22.5);
  assert.equal(r.segundos, 2710);
  assert.equal(r.filamentos[0].material, 'PETG');
});

test('parseSlicerGcode: Bambu/Orca prefiere el tiempo total y descarta filamentos a 0', () => {
  const r = ctx.parseSlicerGcode([
    '; BambuStudio 01.09.07.52',
    '; model printing time: 1h 2m 3s; total estimated time: 1h 10m 3s',
    '; total filament weight [g] : 12.34,0.00',
    '; filament_type = PLA;PLA',
  ].join('\n'));
  assert.equal(r.segundos, 4203);
  assert.equal(r.filamentos.length, 1);
  approx(r.filamentos[0].gramos, 12.34);
});

test('parseSlicerGcode: Cura (metros → gramos con densidad del PLA)', () => {
  const r = ctx.parseSlicerGcode(';FLAVOR:Marlin\n;TIME:6666\n;Filament used: 2.27896m\n;Layer height: 0.2\n;Generated with Cura_SteamEngine 5.7.1');
  assert.equal(r.segundos, 6666);
  // 2.27896 m × π × 0.875² mm² × 1.24 g/cm³ ≈ 6.80 g
  approx(r.filamentos[0].gramos, 6.8, 0.01);
  assert.equal(r.laminador, 'Cura');
});

test('parseSlicerGcode: archivo sin datos → null', () => {
  assert.equal(ctx.parseSlicerGcode('G28\nG1 X0 Y0\n'), null);
});

test('parseSliceInfo: 3MF de Bambu con dos placas suma tiempo y gramos por filamento', () => {
  const xml = `<?xml version="1.0"?><config>
  <plate><metadata key="index" value="1"/><metadata key="prediction" value="3600"/><metadata key="weight" value="12.85"/>
    <filament id="1" type="PLA" color="#FFFFFFFF" used_m="4.31" used_g="10.00" /></plate>
  <plate><metadata key="index" value="2"/><metadata key="prediction" value="1800"/>
    <filament id="1" type="PLA" color="#FFFFFF" used_m="1" used_g="2.5" />
    <filament id="2" type="PETG" color="#00FF00" used_m="1" used_g="4" /></plate>
</config>`;
  const r = ctx.parseSliceInfo(xml);
  assert.equal(r.segundos, 5400);
  assert.equal(r.placas, 2);
  assert.equal(r.filamentos.length, 2);
  approx(r.filamentos[0].gramos, 12.5);
  assert.equal(r.filamentos[0].color, '#ffffff');
  assert.equal(r.filamentos[1].material, 'PETG');
});

test('parseSliceInfo: 3MF sin laminar → null', () => {
  assert.equal(ctx.parseSliceInfo('<config><plate><metadata key="index" value="1"/></plate></config>'), null);
});

test('nombreDesdeArchivo: quita extensiones dobles y guiones bajos', () => {
  assert.equal(ctx.nombreDesdeArchivo('Soporte_movil_PLA.gcode.3mf'), 'Soporte movil PLA');
  assert.equal(ctx.nombreDesdeArchivo('maceta.bgcode'), 'maceta');
});
