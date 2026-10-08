// ═══════════════════════════════════════════════
//  LECTOR DE ARCHIVOS DEL LAMINADOR (G-code / 3MF)
// ═══════════════════════════════════════════════
// Lee gramos, tiempo, material y color de lo que exportan PrusaSlicer,
// OrcaSlicer, Bambu Studio, Cura y Simplify3D, para rellenar la pieza del
// pedido sin teclear. Todo ocurre en el navegador: el archivo no se sube.
//
// Formatos:
//  - .gcode/.gco/.g  → comentarios de cabecera/pie (solo se leen ~3 MB: el
//    principio y el final, que es donde los laminadores dejan los datos).
//  - .bgcode (Prusa binario) → el bloque de metadatos va en texto plano.
//  - .3mf / .gcode.3mf (Bambu/Orca) → ZIP: Metadata/slice_info.config o, si
//    no está, los Metadata/plate_N.gcode. Un 3MF sin laminar no tiene datos.
// Las funciones parse* son puras (se prueban en scripts/test.js).

const DENSIDADES={PLA:1.24,'PLA+':1.24,PETG:1.27,ABS:1.04,ASA:1.07,TPU:1.21,Nylon:1.14,Resina:1.1,Otro:1.24};

function normalizarMaterial(s){
  const u=String(s||'').toUpperCase().trim();
  if(!u) return '';
  if(/^PLA ?(\+|PLUS|PRO)/.test(u)) return 'PLA+';
  if(/^PLA/.test(u)) return 'PLA';
  if(/^PET/.test(u)) return 'PETG';
  if(/^ABS/.test(u)) return 'ABS';
  if(/^ASA/.test(u)) return 'ASA';
  if(/^(TPU|TPE|FLEX)/.test(u)) return 'TPU';
  if(/^(PA|NYLON)/.test(u)) return 'Nylon';
  if(/RESIN/.test(u)) return 'Resina';
  return 'Otro';
}

function densidadMaterial(m){ return DENSIDADES[normalizarMaterial(m)]||1.24; }

// Metros de filamento → gramos (Cura solo da metros).
function gramosDesdeMetros(metros,material,diametro){
  const d=parseFloat(diametro)||1.75;
  const mm3=metros*1000*Math.PI*(d/2)*(d/2);
  return mm3/1000*densidadMaterial(material);
}

// "1d 2h 3m 4s", "2h 5m", "1 hour 23 minutes", "1:23:45" → segundos.
function parseTiempoTexto(s){
  s=String(s||'').toLowerCase();
  const hms=s.match(/^\s*(\d+):(\d\d?):(\d\d?)\s*$/);
  if(hms) return (+hms[1])*3600+(+hms[2])*60+(+hms[3]);
  const U={d:86400,h:3600,m:60,s:1};
  let tot=0,ok=false;
  for(const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(d|h|m|s)[a-z]*/g)){ tot+=parseFloat(m[1])*U[m[2]]; ok=true; }
  return ok?Math.round(tot):null;
}

function hexColor(s){
  const m=String(s||'').match(/#?([0-9a-f]{6})/i);
  return m?'#'+m[1].toLowerCase():'';
}

function nombreDesdeArchivo(n){
  return String(n||'').replace(/\.(gcode\.3mf|gcode|gco|g|bgcode|3mf)$/i,'').replace(/[_]+/g,' ').trim().slice(0,80);
}

function detectarLaminador(text){
  const m=String(text||'').slice(0,20000).match(/(PrusaSlicer|SuperSlicer|OrcaSlicer|Bambu ?Studio|Cura|Simplify3D|ideaMaker|Creality ?Print|ElegooSlicer|AnycubicSlicer)/i);
  return m?m[1]:null;
}

// Texto de un G-code (o los metadatos de un .bgcode) → datos de impresión.
function parseSlicerGcode(text){
  // Bytes de control (cabeceras del .bgcode, \r de Windows) → saltos de línea
  text=String(text||'').replace(/[\x00-\x08\x0b-\x1f]/g,'\n');
  const campo=re=>{ const m=text.match(re); return m?m[1].trim():null; };
  const nums=s=>String(s).split(/[,;]/).map(x=>parseFloat(x.trim())).filter(x=>!isNaN(x));
  const lista=s=>s?s.split(/[;,]/).map(x=>x.trim().replace(/^"|"$/g,'')):[];
  const hay=a=>a.some(x=>x>0);

  const materiales=lista(campo(/^\s*;?\s*filament_type\s*[=:]\s*(.+)$/im));
  const colores=lista(campo(/^\s*;?\s*filament_colou?r\s*[=:]\s*(.+)$/im));
  const diam=campo(/^\s*;?\s*filament_diameter\s*[=:]\s*([\d.]+)/im);
  const mat=i=>materiales[i]||materiales[0]||'';

  let gramos=[], g;
  // PrusaSlicer / OrcaSlicer / Bambu (por filamento)
  if((g=campo(/^\s*;?\s*filament used \[g\]\s*[=:]\s*(.+)$/im))) gramos=nums(g);
  // Bambu / Orca (cabecera, total)
  if(!hay(gramos)&&(g=campo(/^\s*;?\s*total filament weight \[g\]\s*[=:]\s*(.+)$/im))) gramos=nums(g);
  // PrusaSlicer sin densidad configurada: volumen
  if(!hay(gramos)&&(g=campo(/^\s*;?\s*filament used \[cm3\]\s*[=:]\s*(.+)$/im))) gramos=nums(g).map((v,i)=>v*densidadMaterial(mat(i)));
  // Simplify3D
  if(!hay(gramos)&&(g=campo(/^\s*;\s*Plastic weights?:\s*([\d.]+)\s*g/im))) gramos=[parseFloat(g)];
  // Cura (UltiMaker, flavor Griffin): volumen en mm³ por extrusor
  if(!hay(gramos)){
    const vols=[...text.matchAll(/^;EXTRUDER_TRAIN\.(\d+)\.MATERIAL\.VOLUME_USED:\s*([\d.]+)/gim)];
    if(vols.length) gramos=vols.map(m=>parseFloat(m[2])/1000*densidadMaterial(mat(+m[1])));
  }
  // Cura (Marlin): metros
  if(!hay(gramos)&&(g=campo(/^\s*;\s*Filament used:\s*(.+)$/im))) gramos=nums(g.replace(/m/gi,'')).map((v,i)=>gramosDesdeMetros(v,mat(i),diam));

  let segundos=null, tt;
  if((tt=campo(/total estimated time\s*[=:]\s*([^;\n]+)/i))) segundos=parseTiempoTexto(tt);
  if(!segundos&&(tt=campo(/^\s*;?\s*estimated printing time \(normal mode\)\s*[=:]\s*(.+)$/im))) segundos=parseTiempoTexto(tt);
  if(!segundos&&(tt=campo(/^;(?:PRINT\.)?TIME:\s*(\d+)/im))) segundos=parseInt(tt);
  if(!segundos&&(tt=campo(/^\s*;\s*Build time:\s*(.+)$/im))) segundos=parseTiempoTexto(tt);

  const filamentos=gramos.map((x,i)=>({gramos:Math.round(x*100)/100,material:normalizarMaterial(mat(i)),color:hexColor(colores[i])})).filter(f=>f.gramos>0);
  if(!filamentos.length&&!segundos) return null;
  return {segundos:segundos||null,filamentos,placas:1,laminador:detectarLaminador(text)};
}

// Metadata/slice_info.config de un 3MF de Bambu Studio / OrcaSlicer.
// Si hay varias placas, suma tiempo y gramos (por filamento).
function parseSliceInfo(xml){
  const placas=String(xml||'').split(/<plate\b/i).slice(1);
  const porId={}; let seg=0, n=0;
  for(const p of placas){
    const pred=p.match(/key="prediction"\s+value="([\d.]+)"/i);
    const fils=[...p.matchAll(/<filament\b([^>]*)>/gi)];
    if(!pred&&!fils.length) continue;
    n++; seg+=pred?parseFloat(pred[1]):0;
    for(const f of fils){
      const attr=k=>{ const m=f[1].match(new RegExp('\\b'+k+'="([^"]*)"','i')); return m?m[1]:''; };
      const id=attr('id')||String(Object.keys(porId).length+1);
      if(!porId[id]) porId[id]={gramos:0,material:normalizarMaterial(attr('type')),color:hexColor(attr('color'))};
      porId[id].gramos+=parseFloat(attr('used_g'))||0;
    }
  }
  const filamentos=Object.values(porId).filter(f=>f.gramos>0).map(f=>({gramos:Math.round(f.gramos*100)/100,material:f.material,color:f.color}));
  if(!n||(!seg&&!filamentos.length)) return null;
  return {segundos:Math.round(seg)||null,filamentos,placas:n,laminador:null};
}

// Varias placas (G-code dentro de un 3MF) → un solo resultado sumado.
function sumarResultados(lista){
  lista=lista.filter(Boolean);
  if(!lista.length) return null;
  const fils=[];
  lista.forEach(r=>r.filamentos.forEach((f,i)=>{
    if(!fils[i]) fils[i]={...f,gramos:0};
    fils[i].gramos=Math.round((fils[i].gramos+f.gramos)*100)/100;
  }));
  return {
    segundos:lista.reduce((s,r)=>s+(r.segundos||0),0)||null,
    filamentos:fils.filter(Boolean),
    placas:lista.length,
    laminador:lista[0].laminador
  };
}

// ── Lectura en el navegador ─────────────────────
function errLaminador(code){ const e=new Error(code); e.code=code; return e; }

async function leerCabezaYCola(blob){
  const dec=new TextDecoder('latin1');
  const MB=1024*1024;
  if(blob.size<=3*MB) return dec.decode(await blob.arrayBuffer());
  const cab=dec.decode(await blob.slice(0,MB).arrayBuffer());
  const cola=dec.decode(await blob.slice(blob.size-2*MB).arrayBuffer());
  return cab+'\n'+cola;
}

// Lector ZIP mínimo (un 3MF es un ZIP): solo lee las entradas que hacen falta.
async function zipEntradas(blob){
  const tam=Math.min(blob.size,65557);
  const v=new DataView(await blob.slice(blob.size-tam).arrayBuffer());
  let p=-1;
  for(let i=tam-22;i>=0;i--){ if(v.getUint32(i,true)===0x06054b50){ p=i; break; } }
  if(p<0) throw errLaminador('nodata');
  const cdTam=v.getUint32(p+12,true), cdIni=v.getUint32(p+16,true);
  if(cdIni===0xFFFFFFFF) throw errLaminador('nodata');
  const cd=new DataView(await blob.slice(cdIni,cdIni+cdTam).arrayBuffer());
  const dec=new TextDecoder(), out=[];
  for(let i=0;i+46<=cd.byteLength&&cd.getUint32(i,true)===0x02014b50;){
    const nl=cd.getUint16(i+28,true), xl=cd.getUint16(i+30,true), cl=cd.getUint16(i+32,true);
    out.push({
      nombre:dec.decode(new Uint8Array(cd.buffer,i+46,nl)),
      metodo:cd.getUint16(i+10,true),
      comp:cd.getUint32(i+20,true),
      off:cd.getUint32(i+42,true)
    });
    i+=46+nl+xl+cl;
  }
  return out;
}

async function zipLeer(blob,e){
  const lh=new DataView(await blob.slice(e.off,e.off+30).arrayBuffer());
  const ini=e.off+30+lh.getUint16(26,true)+lh.getUint16(28,true);
  const datos=blob.slice(ini,ini+e.comp);
  if(e.metodo===0) return new Uint8Array(await datos.arrayBuffer());
  if(e.metodo!==8) throw errLaminador('nodata');
  return new Uint8Array(await new Response(datos.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}

async function leer3mf(file){
  if(typeof DecompressionStream==='undefined') throw errLaminador('browser');
  const ents=await zipEntradas(file);
  const info=ents.find(e=>/(^|\/)slice_info\.config$/i.test(e.nombre));
  if(info){
    const r=parseSliceInfo(new TextDecoder().decode(await zipLeer(file,info)));
    if(r) return r;
  }
  const gcodes=ents.filter(e=>/\.gcode$/i.test(e.nombre));
  if(gcodes.length){
    const res=[];
    for(const e of gcodes){
      const txt=new TextDecoder('latin1').decode(await zipLeer(file,e));
      res.push(parseSlicerGcode(txt.length>3e6?txt.slice(0,1e6)+'\n'+txt.slice(-2e6):txt));
    }
    const r=sumarResultados(res);
    if(r) return r;
  }
  throw errLaminador('unsliced');
}

// Punto de entrada: File → {segundos, filamentos:[{gramos,material,color}], placas, laminador}
async function leerArchivoLaminador(file){
  const ext=((String(file.name||'').match(/\.([a-z0-9]+)$/i)||[])[1]||'').toLowerCase();
  if(['stl','obj','step','stp','amf'].includes(ext)) throw errLaminador('model');
  const magia=new Uint8Array(await file.slice(0,4).arrayBuffer());
  const esZip=magia[0]===0x50&&magia[1]===0x4b&&magia[2]===3&&magia[3]===4;
  const r=(ext==='3mf'||esZip)?await leer3mf(file):parseSlicerGcode(await leerCabezaYCola(file));
  if(!r) throw errLaminador('nodata');
  return r;
}
