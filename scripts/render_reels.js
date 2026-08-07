#!/usr/bin/env node
/**
 * Script para renderizar los 3 reels de Brami3D usando HyperFrames.
 * Resuelve y expone los binarios estáticos de FFmpeg y FFprobe.
 */
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// 1. Obtener las rutas de los binarios estáticos
let ffmpegBin, ffprobeBin;
try {
  ffmpegBin = require('ffmpeg-static');
  ffprobeBin = require('ffprobe-static').path;
  console.log(`FFmpeg estático encontrado en: ${ffmpegBin}`);
  console.log(`FFprobe estático encontrado en: ${ffprobeBin}`);
} catch (err) {
  console.error('Error al cargar ffmpeg-static o ffprobe-static. Asegúrate de que estén instalados.');
  process.exit(1);
}

const ffmpegDir = path.dirname(ffmpegBin);
const ffprobeDir = path.dirname(ffprobeBin);

// 2. Inyectar los directorios en el PATH para este proceso y sus hijos
const delimiter = process.platform === 'win32' ? ';' : ':';
process.env.PATH = `${ffmpegDir}${delimiter}${ffprobeDir}${delimiter}${process.env.PATH}`;

// Configurar variables de codificación H.264 que espera Instagram/Facebook
// H.264 + AAC es el estándar.
const REELS = [
  {
    dir: 'marketing/agosto/reel-01',
    out: 'marketing/agosto/ago-reel-01-calculadora.mp4'
  },
  {
    dir: 'marketing/agosto/reel-02',
    out: 'marketing/agosto/ago-reel-02-movil.mp4'
  },
  {
    dir: 'marketing/agosto/reel-03',
    out: 'marketing/agosto/ago-reel-03-antes-despues.mp4'
  }
];

// 3. Renderizar cada Reel
REELS.forEach((reel, index) => {
  const absoluteDir = path.join(ROOT, reel.dir);
  const absoluteOut = path.join(ROOT, reel.out);
  console.log(`\n--- Renderizando Reel ${index + 1}/${REELS.length}: ${path.basename(absoluteOut)} ---`);
  
  // Ejecutamos npx hyperframes render
  const cmd = `npx hyperframes render --output "${absoluteOut}" --quality high --fps 30`;
  console.log(`Ejecutando: ${cmd} en ${reel.dir}`);
  
  try {
    execSync(cmd, {
      cwd: absoluteDir,
      stdio: 'inherit',
      env: process.env
    });
    console.log(`✔ Reel renderizado con éxito: ${reel.out}`);
  } catch (err) {
    console.error(`❌ Error al renderizar ${reel.out}:`, err.message);
    process.exit(1);
  }
});

console.log('\n🎉 ¡Renderizado de todos los reels completado con éxito!');
