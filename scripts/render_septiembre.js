#!/usr/bin/env node
/**
 * Renderiza los reels y videos de septiembre con HyperFrames.
 * Expone los binarios estaticos de FFmpeg/FFprobe en el PATH del proceso.
 *
 * Uso:
 *   node scripts/render_septiembre.js            -> renderiza todos
 *   node scripts/render_septiembre.js reel-01    -> solo esa pieza
 */
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

let ffmpegBin, ffprobeBin;
try {
  ffmpegBin = require('ffmpeg-static');
  ffprobeBin = require('ffprobe-static').path;
} catch (err) {
  console.error('Faltan ffmpeg-static / ffprobe-static. Ejecuta: npm install');
  process.exit(1);
}
console.log(`FFmpeg: ${ffmpegBin}`);
console.log(`FFprobe: ${ffprobeBin}`);

const delimiter = process.platform === 'win32' ? ';' : ':';
process.env.PATH = `${path.dirname(ffmpegBin)}${delimiter}${path.dirname(ffprobeBin)}${delimiter}${process.env.PATH}`;

// H.264 + AAC es lo que exigen Instagram y Facebook.
const PIEZAS = [
  { dir: 'marketing/septiembre/reel-01',  out: 'marketing/septiembre/sep-reel-01-presupuesto.mp4' },
  { dir: 'marketing/septiembre/reel-02',  out: 'marketing/septiembre/sep-reel-02-verifactu.mp4' },
  { dir: 'marketing/septiembre/reel-03',  out: 'marketing/septiembre/sep-reel-03-filamento.mp4' },
  { dir: 'marketing/septiembre/reel-04',  out: 'marketing/septiembre/sep-reel-04-tracker.mp4' },
  { dir: 'marketing/septiembre/reel-05',  out: 'marketing/septiembre/sep-reel-05-mantenimiento.mp4' },
  { dir: 'marketing/septiembre/reel-06',  out: 'marketing/septiembre/sep-reel-06-cierre.mp4' },
  { dir: 'marketing/septiembre/video-01', out: 'marketing/septiembre/sep-video-01-tour.mp4' },
  { dir: 'marketing/septiembre/video-02', out: 'marketing/septiembre/sep-video-02-pedido-factura.mp4' }
];

const filtro = process.argv[2];
const lista = filtro ? PIEZAS.filter(p => p.dir.endsWith(filtro)) : PIEZAS;

if (!lista.length) {
  console.error(`No hay ninguna pieza que coincida con "${filtro}"`);
  process.exit(1);
}

lista.forEach((pieza, i) => {
  const absDir = path.join(ROOT, pieza.dir);
  const absOut = path.join(ROOT, pieza.out);
  console.log(`\n--- Renderizando ${i + 1}/${lista.length}: ${path.basename(absOut)} ---`);
  try {
    // --no-browser-gpu: con graficos integrados y 8 GB de RAM, la captura
    // acelerada por GPU tumba la pestana de Chrome a mitad del render
    // ("Target closed"). SwiftShader es mas lento pero termina.
    // --low-memory-mode y el protocol-timeout alto van en la misma linea.
    const cmd = `npx hyperframes render --output "${absOut}" --quality high --fps 30` +
                ` --no-browser-gpu --low-memory-mode --protocol-timeout 900000`;
    execSync(cmd, {
      cwd: absDir,
      stdio: 'inherit',
      env: process.env
    });
    console.log(`OK -> ${pieza.out}`);
  } catch (err) {
    console.error(`ERROR al renderizar ${pieza.out}: ${err.message}`);
    process.exit(1);
  }
});

console.log('\nRenderizado completado.');
