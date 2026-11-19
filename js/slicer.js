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
// Miniatura: PrusaSlicer, OrcaSlicer y Bambu Studio guardan una vista previa
// de la pieza dentro del archivo (base64 en el G-code, bloque binario en el
// .bgcode, PNG en el 3MF). Se devuelve como data URL; si no hay, null.
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

  // Bambu Studio: "; filament: 1,3" = ranuras del AMS usadas. Los gramos van
  // por filamento usado, pero colores y materiales por ranura.
  const usados=(campo(/^\s*;\s*filament:[ \t]*([\d, \t]+)$/im)||'').split(',').map(s=>parseInt(s)).filter(n=>n>0);
  const ranura=i=>usados.length===gramos.length&&colores.length>=Math.max(...usados)?usados[i]-1:i;
  const filamentos=gramos.map((x,i)=>({gramos:Math.round(x*100)/100,material:normalizarMaterial(mat(ranura(i))),color:hexColor(colores[ranura(i)])})).filter(f=>f.gramos>0);
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

// "; thumbnail begin 300x300 12345" … "; thumbnail end" (también
// thumbnail_PNG / thumbnail_JPG / thumbnail_QOI) → [{fmt, area, b64}].
function bloquesMiniaturaGcode(text){
  const re=/^;\s*thumbnail(?:_(PNG|JPG|QOI))?\s+begin\s+(\d+)x(\d+)[^\n]*\n([\s\S]*?)^;\s*thumbnail(?:_(?:PNG|JPG|QOI))?\s+end/gim;
  const out=[];
  for(const m of String(text||'').matchAll(re)){
    const b64=m[4].replace(/^;[ \t]?/gm,'').replace(/\s+/g,'');
    if(b64.length<64||!/^[A-Za-z0-9+/=]+$/.test(b64)) continue;
    out.push({fmt:(m[1]||'PNG').toUpperCase(),area:(+m[2])*(+m[3]),b64});
  }
  return out.sort((a,b)=>b.area-a.area);
}

// La miniatura PNG/JPG más grande como data URL (el navegador no pinta QOI).
function parseMiniaturaGcode(text){
  const m=bloquesMiniaturaGcode(text).find(x=>x.fmt!=='QOI');
  return m?`data:image/${m.fmt==='JPG'?'jpeg':'png'};base64,${m.b64}`:null;
}

// QOI («Quite OK Image», lo usa PrusaSlicer en la MK4/Core One) → píxeles RGBA.
function decodificarQOI(u8){
  if(!u8||u8.length<22||u8[0]!==0x71||u8[1]!==0x6f||u8[2]!==0x69||u8[3]!==0x66) return null;
  const w=((u8[4]<<24)|(u8[5]<<16)|(u8[6]<<8)|u8[7])>>>0, h=((u8[8]<<24)|(u8[9]<<16)|(u8[10]<<8)|u8[11])>>>0;
  if(!w||!h||w*h>4e6) return null;
  const px=new Uint8ClampedArray(w*h*4), idx=new Uint8Array(256), fin=u8.length-8;
  let r=0,g=0,b=0,a=255,p=14,run=0;
  for(let o=0;o<px.length;o+=4){
    if(run>0) run--;
    else if(p<fin){
      const b1=u8[p++];
      if(b1===0xfe){ r=u8[p++]; g=u8[p++]; b=u8[p++]; }
      else if(b1===0xff){ r=u8[p++]; g=u8[p++]; b=u8[p++]; a=u8[p++]; }
      else if((b1&0xc0)===0x00){ const i=b1*4; r=idx[i]; g=idx[i+1]; b=idx[i+2]; a=idx[i+3]; }
      else if((b1&0xc0)===0x40){ r=(r+((b1>>4)&3)-2)&255; g=(g+((b1>>2)&3)-2)&255; b=(b+(b1&3)-2)&255; }
      else if((b1&0xc0)===0x80){ const b2=u8[p++], vg=(b1&0x3f)-32; r=(r+vg-8+((b2>>4)&15))&255; g=(g+vg)&255; b=(b+vg-8+(b2&15))&255; }
      else run=b1&0x3f;
      const hi=((r*3+g*5+b*7+a*11)%64)*4; idx[hi]=r; idx[hi+1]=g; idx[hi+2]=b; idx[hi+3]=a;
    }
    px[o]=r; px[o+1]=g; px[o+2]=b; px[o+3]=a;
  }
  return {w,h,px};
}

function qoiADataUrl(u8){
  const d=decodificarQOI(u8);
  if(!d||typeof document==='undefined') return null;
  const c=document.createElement('canvas'); c.width=d.w; c.height=d.h;
  c.getContext('2d').putImageData(new ImageData(d.px,d.w,d.h),0,0);
  return c.toDataURL('image/png');
}

function base64ABytes(b64){
  const bin=atob(b64), u8=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
  return u8;
}

// ── Vista previa dibujada a partir del G-code ─────
// Para los G-code sin miniatura (Bambu Studio no la guarda al exportar G-code).
// Recorre los movimientos que extruyen material, solo de las piezas (sin
// purga, torre de purga ni falda), y llama a cb(x1,y1,x2,y2,z,herramienta).
// Entiende G0/G1, arcos G2/G3, G90/G91, M82/M83, G92 y cambios de filamento
// (T<n>; en Bambu, M620 S<n>A).
function recorrerExtrusiones(text,cb){
  text=String(text||'');
  const marcaCapa=/^;\s*(CHANGE_LAYER|LAYER_CHANGE|LAYER:)/;
  let enPieza=!/^;\s*(CHANGE_LAYER|LAYER_CHANGE|LAYER:)/m.test(text), saltar=false;
  let x=0,y=0,z=0,e=0,absXY=true,absE=true,tool=0;
  const n=text.length;
  for(let i=0;i<n;){
    let j=text.indexOf('\n',i); if(j<0) j=n;
    let l=text.slice(i,j); i=j+1;
    let c0=l.charCodeAt(0);
    if(c0===32||c0===9){ l=l.trimStart(); c0=l.charCodeAt(0); }
    if(c0===59){ // ';'
      if(marcaCapa.test(l)) enPieza=true;
      else if(/^;\s*(FEATURE|TYPE):/i.test(l)) saltar=/prime|wipe|skirt|purge|custom|tower/i.test(l);
      continue;
    }
    const sc=l.indexOf(';'); if(sc>=0) l=l.slice(0,sc);
    if(c0===77){ // 'M'
      if(/^M82\b/.test(l)) absE=true;
      else if(/^M83\b/.test(l)) absE=false;
      else { const m=l.match(/^M620\s+S(\d+)A/); if(m) tool=+m[1]; }
      continue;
    }
    if(c0===84){ const m=l.match(/^T(\d+)/); if(m&&+m[1]<64) tool=+m[1]; continue; } // 'T'
    if(c0!==71) continue; // 'G'
    const tk=l.trim().split(/\s+/), g=parseInt(tk[0].slice(1));
    if(g===90){ absXY=true; continue; }
    if(g===91){ absXY=false; continue; }
    if(g!==92&&g>3) continue;
    const p={};
    for(let k=1;k<tk.length;k++){ const v=parseFloat(tk[k].slice(1)); if(!isNaN(v)) p[tk[k][0].toUpperCase()]=v; }
    if(g===92){ if(p.E!==undefined) e=p.E; continue; }
    const nx=p.X===undefined?x:(absXY?p.X:x+p.X), ny=p.Y===undefined?y:(absXY?p.Y:y+p.Y), nz=p.Z===undefined?z:(absXY?p.Z:z+p.Z);
    let ext=false;
    if(p.E!==undefined){ if(absE){ ext=p.E>e+1e-5; e=p.E; } else ext=p.E>0; }
    if(ext&&enPieza&&!saltar&&(nx!==x||ny!==y)){
      if((g===2||g===3)&&(p.I!==undefined||p.J!==undefined)){
        const cx=x+(p.I||0), cy=y+(p.J||0), r=Math.hypot(x-cx,y-cy);
        let a0=Math.atan2(y-cy,x-cx), a1=Math.atan2(ny-cy,nx-cx);
        if(g===2&&a1>=a0) a1-=2*Math.PI;
        if(g===3&&a1<=a0) a1+=2*Math.PI;
        const pasos=Math.min(48,Math.max(2,Math.ceil(Math.abs(a1-a0)*r)));
        let px=x, py=y;
        for(let s=1;s<=pasos;s++){
          const a=a0+(a1-a0)*s/pasos, qx=s===pasos?nx:cx+r*Math.cos(a), qy=s===pasos?ny:cy+r*Math.sin(a);
          cb(px,py,qx,qy,nz,tool); px=qx; py=qy;
        }
      } else cb(x,y,nx,ny,nz,tool);
    }
    x=nx; y=ny; z=nz;
  }
}

// Color del filamento sombreado por altura (t: 0 abajo → 1 arriba). Los
// filamentos muy oscuros se aclaran para que se vea el relieve.
function colorSombreado(hex,t){
  const m=String(hex||'').match(/#?([0-9a-f]{6})/i);
  const v=m?m[1]:'8a94a6';
  let r=parseInt(v.slice(0,2),16), g=parseInt(v.slice(2,4),16), b=parseInt(v.slice(4,6),16);
  const luma=0.299*r+0.587*g+0.114*b;
  if(luma<70){ const k=0.12+0.4*t; r+=(255-r)*k; g+=(255-g)*k; b+=(255-b)*k; }
  else { const k=0.58+0.42*t; r*=k; g*=k; b*=k; }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

// Dibuja la vista desde arriba en un canvas → data URL PNG (o null).
function vistaPreviaGcode(text){
  if(typeof document==='undefined') return null;
  const colores=((String(text).match(/^\s*;\s*filament_colou?r\s*[=:]\s*(.+)$/im)||[])[1]||'').split(/[;,]/).map(s=>s.trim());
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity,zMax=0,cuenta=0;
  recorrerExtrusiones(text,(ax,ay,bx,by,z)=>{
    if(ax<x0)x0=ax; if(bx<x0)x0=bx; if(ax>x1)x1=ax; if(bx>x1)x1=bx;
    if(ay<y0)y0=ay; if(by<y0)y0=by; if(ay>y1)y1=ay; if(by>y1)y1=by;
    if(z>zMax)zMax=z; cuenta++;
  });
  if(cuenta<20||!(x1>x0)||!(y1>y0)) return null;
  const W=800, H=600, pad=36, esc=Math.min((W-2*pad)/(x1-x0),(H-2*pad)/(y1-y0));
  const ox=(W-(x1-x0)*esc)/2, oy=(H-(y1-y0)*esc)/2;
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const ctx=c.getContext('2d');
  const fondo=ctx.createRadialGradient(W/2,H*0.4,40,W/2,H/2,W*0.7);
  fondo.addColorStop(0,'#f5f7fb'); fondo.addColorStop(1,'#d9e0ea');
  ctx.fillStyle=fondo; ctx.fillRect(0,0,W,H);
  ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth=Math.max(1,0.42*esc);
  const X=v=>ox+(v-x0)*esc, Y=v=>H-oy-(v-y0)*esc; // el eje Y del G-code va hacia arriba
  let clave=null;
  recorrerExtrusiones(text,(ax,ay,bx,by,z,t)=>{
    const nivel=zMax>0?Math.round(z/zMax*10):10, k=t+'|'+nivel;
    if(k!==clave){ if(clave!==null) ctx.stroke(); ctx.strokeStyle=colorSombreado(colores[t],nivel/10); ctx.beginPath(); clave=k; }
    ctx.moveTo(X(ax),Y(ay)); ctx.lineTo(X(bx),Y(by));
  });
  if(clave!==null) ctx.stroke();
  return c.toDataURL('image/jpeg',0.88); // fondo opaco: JPG pesa mucho menos que PNG
}

// G-code → miniatura: PNG/JPG si hay; si solo hay QOI, se convierte a PNG.
function miniaturaGcode(text){
  const directa=parseMiniaturaGcode(text);
  if(directa) return directa;
  const q=bloquesMiniaturaGcode(text).find(x=>x.fmt==='QOI');
  return q?qoiADataUrl(base64ABytes(q.b64)):null;
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

function blobADataUrl(blob){
  return new Promise((ok,ko)=>{ const fr=new FileReader(); fr.onload=()=>ok(fr.result); fr.onerror=ko; fr.readAsDataURL(blob); });
}

// .bgcode (Prusa binario): cabecera "GCDE" + bloques. Las miniaturas son el
// tipo 5 (parámetros: formato 0 PNG / 1 JPG / 2 QOI, ancho, alto), sin comprimir.
async function miniaturaBgcode(blob){
  const v=new DataView(await blob.slice(0,Math.min(blob.size,4*1024*1024)).arrayBuffer());
  if(v.byteLength<10||v.getUint32(0,true)!==0x45444347) return null;
  const ck=v.getUint16(8,true)?4:0;
  let p=10, mejor=null, qoi=null;
  while(p+8<=v.byteLength){
    const tipo=v.getUint16(p,true), comp=v.getUint16(p+2,true);
    const cab=comp?12:8;
    if(p+cab>v.byteLength) break;
    const tam=comp?v.getUint32(p+8,true):v.getUint32(p+4,true);
    const datos=p+cab+(tipo===5?6:2);
    if(tipo===1) break; // empieza el G-code: ya no hay más miniaturas
    if(tipo===5&&!comp&&datos+tam<=v.byteLength){
      const fmt=v.getUint16(p+cab,true), area=v.getUint16(p+cab+2,true)*v.getUint16(p+cab+4,true);
      if(fmt<2&&(!mejor||area>mejor.area)) mejor={area,blob:new Blob([new Uint8Array(v.buffer,datos,tam)],{type:fmt===1?'image/jpeg':'image/png'})};
      if(fmt===2&&(!qoi||area>qoi.area)) qoi={area,u8:new Uint8Array(v.buffer,datos,tam)};
    }
    p=datos+tam+ck;
  }
  if(mejor) return blobADataUrl(mejor.blob);
  return qoi?qoiADataUrl(qoi.u8):null;
}

// 3MF: Bambu/Orca dejan Metadata/plate_1.png; PrusaSlicer, Metadata/thumbnail.png.
async function miniatura3mf(file,ents){
  const png=ents.filter(e=>/^Metadata\/[^/]+\.png$/i.test(e.nombre));
  const e=png.find(x=>/\/plate_\d+\.png$/i.test(x.nombre))
    ||png.find(x=>/\/thumbnail\.png$/i.test(x.nombre))
    ||png.find(x=>!/(small|pick|top|no_light)/i.test(x.nombre));
  if(!e) return null;
  return blobADataUrl(new Blob([await zipLeer(file,e)],{type:'image/png'}));
}

async function leer3mf(file){
  if(typeof DecompressionStream==='undefined') throw errLaminador('browser');
  const ents=await zipEntradas(file);
  const mini=await miniatura3mf(file,ents).catch(()=>null);
  let r;
  // Un proyecto sin laminar (p. ej. bajado de MakerWorld) no trae gramos ni
  // tiempo, pero sí la imagen: se adjunta al error para aprovecharla.
  try{ r=await leer3mfDatos(file,ents); }
  catch(e){ e.miniatura=mini; throw e; }
  r.miniatura=mini;
  return r;
}

async function leer3mfDatos(file,ents){
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

// Punto de entrada: File → {segundos, filamentos:[{gramos,material,color}], placas, laminador, miniatura}
async function leerArchivoLaminador(file){
  const ext=((String(file.name||'').match(/\.([a-z0-9]+)$/i)||[])[1]||'').toLowerCase();
  if(['stl','obj','step','stp','amf'].includes(ext)) throw errLaminador('model');
  const magia=new Uint8Array(await file.slice(0,4).arrayBuffer());
  const esZip=magia[0]===0x50&&magia[1]===0x4b&&magia[2]===3&&magia[3]===4;
  if(ext==='3mf'||esZip) return leer3mf(file);
  const texto=await leerCabezaYCola(file);
  const r=parseSlicerGcode(texto);
  if(!r) throw errLaminador('nodata');
  const esBgcode=magia[0]===0x47&&magia[1]===0x43&&magia[2]===0x44&&magia[3]===0x45;
  try{ r.miniatura=esBgcode?await miniaturaBgcode(file):miniaturaGcode(texto); }catch(_){ r.miniatura=null; }
  // Sin miniatura (p. ej. Bambu Studio): se puede dibujar una vista desde los
  // recorridos. Se deja para después porque obliga a leer el archivo entero.
  if(!r.miniatura&&!esBgcode&&file.size<=250*1024*1024){
    r.generarVista=async()=>{
      try{
        const todo=file.size<=3*1024*1024?texto:new TextDecoder('latin1').decode(await file.arrayBuffer());
        await new Promise(ok=>setTimeout(ok,30)); // deja pintar el aviso antes del cálculo
        return vistaPreviaGcode(todo);
      }catch(_){ return null; }
    };
  }
  return r;
}
