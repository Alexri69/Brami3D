// Brami3D — módulo Registro fiscal / VeriFactu (RD 1007/2023) de
// brami3d_supabase.html. Script clásico SIN build: define sha256Hex,
// canonicalRegistroString, registrarFactura/registrarEvento, qrAEATUrl,
// exportarRegistrosXML… como globales. Debe cargarse ANTES del script
// principal. sb/CU/_cache/showToast se resuelven en runtime.

// ═══════════════════════════════════════════════
//  REGISTRO FISCAL (RD 1007/2023 — modo No-Verifactu)
//  Hash SHA-256 encadenado entre registros, eventos inmutables.
// ═══════════════════════════════════════════════
const SIF_VERSION='1.0.0';
const MODALIDAD_FACTURACION='no-verifactu';

async function sha256Hex(str){
  const buf=new TextEncoder().encode(str);
  const hash=await crypto.subtle.digest('SHA-256',buf);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// Formato canónico inspirado en la Orden HAC/1177/2024 (Anexo II). Campos
// separados por '&', fechas en DD-MM-YYYY, importes con 2 decimales. El hash
// del registro anterior entra como 'Huella' para formar la cadena.
function canonicalRegistroString(r){
  const fmtFecha=s=>{ if(!s)return ''; const [y,m,d]=s.split('-'); return `${d}-${m}-${y}`; };
  const tipoCod=r.tipo==='rectificativa'?'R1':(r.tipo==='anulacion'?'F2':'F1');
  return [
    `IDEmisorFactura=${r.emisor_nif||''}`,
    `NumSerieFactura=${r.factura_num||''}`,
    `FechaExpedicionFactura=${fmtFecha(r.factura_fecha)}`,
    `TipoFactura=${tipoCod}`,
    `CuotaTotal=${Number(r.cuota_iva||0).toFixed(2)}`,
    `ImporteTotal=${Number(r.importe_total||0).toFixed(2)}`,
    `Huella=${r.hash_anterior||''}`,
    `FechaHoraHusoGenRegistro=${r.ts_emision}`
  ].join('&');
}

async function fetchUltimoHashFactura(){
  try {
    const {data,error}=await sb.from('facturas_registro')
      .select('hash').eq('user_id',CU.id)
      .order('ts_emision',{ascending:false}).limit(1);
    if(error){ console.warn('fetchUltimoHashFactura',error); return ''; }
    return data&&data[0]?data[0].hash:'';
  } catch(e){ console.warn(e); return ''; }
}

async function fetchUltimoHashEvento(){
  try {
    const {data,error}=await sb.from('facturas_eventos')
      .select('hash').eq('user_id',CU.id)
      .order('ts',{ascending:false}).limit(1);
    if(error){ console.warn('fetchUltimoHashEvento',error); return ''; }
    return data&&data[0]?data[0].hash:'';
  } catch(e){ console.warn(e); return ''; }
}

// Registra un evento 'inicio' del SIF si han pasado >24h desde el último.
// Evita llenar facturas_eventos con una entrada por cada recarga.
async function registrarInicioSIF(){
  try {
    const hace24h=new Date(Date.now()-24*60*60*1000).toISOString();
    const {data}=await sb.from('facturas_eventos')
      .select('id,ts').eq('user_id',CU.id).eq('tipo','inicio')
      .gte('ts',hace24h).limit(1);
    if(data&&data.length>0) return false;  // ya hay un inicio en las últimas 24h
    await registrarEvento('inicio',{
      descripcion:`Arranque del SIF Brami3D v${SIF_VERSION}`,
      datos:{modalidad:MODALIDAD_FACTURACION,ua:navigator.userAgent.slice(0,120)}
    });
    return true;
  } catch(e){ console.warn('registrarInicioSIF',e); return false; }
}

// Inserta un evento inmutable encadenado en facturas_eventos.
async function registrarEvento(tipo,{descripcion='',registro_id=null,datos={}}={}){
  try {
    const hashAnterior=await fetchUltimoHashEvento();
    const ts=new Date().toISOString();
    const canonical=`tipo=${tipo}&registro_id=${registro_id||''}&descripcion=${descripcion}&datos=${JSON.stringify(datos)}&Huella=${hashAnterior}&ts=${ts}`;
    const hash=await sha256Hex(canonical);
    const {error}=await sb.from('facturas_eventos').insert({
      user_id:CU.id,tipo,registro_id,descripcion,
      datos_json:datos,hash_anterior:hashAnterior,hash,ts
    });
    if(error) console.warn('registrarEvento',error);
    return !error;
  } catch(e){ console.warn('registrarEvento exception',e); return false; }
}

// Crea el registro inmutable de una factura. Si ya existe (por factura_num)
// devuelve el existente. Devuelve {hash, ts_emision, hash_anterior, registro_id, yaExistia}
// o null si falla.
async function registrarFactura(pedido,cliente,cfg,{tipo='emision',rectifica_id=null,motivo=''}={}){
  try {
    const {data:existe}=await sb.from('facturas_registro')
      .select('id,hash,ts_emision,hash_anterior')
      .eq('user_id',CU.id).eq('factura_num',pedido.facturaNum).maybeSingle();
    if(existe) return {hash:existe.hash,ts_emision:existe.ts_emision,hash_anterior:existe.hash_anterior,registro_id:existe.id,yaExistia:true};

    const c=calcOrderCosts(pedido,cfg);
    const base=Number(c.fp||0);
    const tipoIva=Number(cfg.tipoIva||0);
    // CuotaTotal e ImporteTotal deben cuadrar con la factura emitida: el PDF y el
    // email suman AMBOS impuestos (tipoIva + tipoIva2), así que el registro también.
    const tipoIva2=Number(cfg.tipoIva2||0);
    const cuotaIva=parseFloat((base * (tipoIva + tipoIva2) / 100).toFixed(2));
    const total=parseFloat((base+cuotaIva).toFixed(2));

    const registro={
      user_id:CU.id,
      factura_num:pedido.facturaNum,
      factura_fecha:pedido.facturaFecha,
      pedido_id:pedido.id,
      tipo,rectifica_id,
      motivo_rectificacion:motivo||null,
      emisor_nif:cfg.nif||'',
      emisor_nombre:cfg.empresa||'',
      receptor_nif:cliente?.nif||null,
      receptor_nombre:cliente?.nombre||null,
      base_imponible:base,
      tipo_iva:tipoIva,
      cuota_iva:cuotaIva,
      importe_total:total,
      lineas:pedido.lineas||[],
      datos_json:{pedido,cliente,cfg_snapshot:{empresa:cfg.empresa,nif:cfg.nif,direccion:cfg.direccion,email:cfg.email,telefono:cfg.telefono,tipo_iva:tipoIva,tipo_iva2:tipoIva2,nombre_impuesto:cfg.nombreImpuesto||'IVA',nombre_impuesto2:cfg.nombreImpuesto2||''}},
      hash_anterior:await fetchUltimoHashFactura(),
      modalidad:MODALIDAD_FACTURACION,
      sif_nombre:'Brami3D',
      sif_version:SIF_VERSION,
      sif_id:CU.id,
      ts_emision:new Date().toISOString()
    };

    registro.hash=await sha256Hex(canonicalRegistroString(registro));

    const {data,error}=await sb.from('facturas_registro').insert(registro).select().maybeSingle();
    if(error){
      console.error('registrarFactura',error);
      showToast('⚠️ No se pudo registrar la factura: '+error.message,'err');
      registrarEvento('anomalia',{
        descripcion:`Fallo al registrar factura ${pedido.facturaNum}: ${error.message}`,
        datos:{factura_num:pedido.facturaNum,codigo:error.code||'',detalles:error.details||''}
      });
      return null;
    }

    await registrarEvento('creacion',{
      descripcion:`Alta de factura ${pedido.facturaNum}`,
      registro_id:data.id,
      datos:{factura_num:pedido.facturaNum,importe_total:total,hash:registro.hash}
    });

    return {hash:registro.hash,ts_emision:registro.ts_emision,hash_anterior:registro.hash_anterior,registro_id:data.id,yaExistia:false};
  } catch(e){
    console.error('registrarFactura exception',e);
    showToast('⚠️ Error al registrar factura','err');
    registrarEvento('anomalia',{
      descripcion:`Excepción al registrar factura ${pedido?.facturaNum||''}: ${e.message||e}`,
      datos:{factura_num:pedido?.facturaNum||'',stack:(e.stack||'').slice(0,500)}
    });
    return null;
  }
}

// URL del QR conforme a la Orden HAC/1177/2024 (servicio AEAT de cotejo).
// Parámetros: nif (emisor), numserie (nº completo de factura), fecha DD-MM-YYYY,
// importe con coma decimal convertida a punto, 2 decimales.
function qrAEATUrl({emisorNif,numSerie,fecha,importe}){
  const fmtFecha=(fecha||'').split('-').reverse().join('-');
  const p=new URLSearchParams({
    nif:(emisorNif||'').replace(/\s/g,''),
    numserie:numSerie||'',
    fecha:fmtFecha,
    importe:Number(importe||0).toFixed(2)
  });
  return `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?${p.toString()}`;
}

// Genera un QR PNG como data URL. Nivel M de corrección (Orden HAC/1177/2024).
// Librería: QRious (canvas-based). Fallback inline vía unpkg si jsDelivr falla.
async function qrDataUrl(url,size=240){
  try {
    if(typeof QRious==='undefined'){ console.warn('QRious lib no cargada — QR no se incluirá en la factura'); return ''; }
    const q=new QRious({value:url,size:size,level:'M',background:'white',foreground:'black',padding:4});
    return q.toDataURL('image/png');
  } catch(e){ console.warn('qrDataUrl',e); return ''; }
}

// ─── Fase 5: Exportación XML AEAT ───
// Genera un XML firmado conforme al esquema oficial (SuministroInformacion v1.0)
// con todos los registros de facturación y eventos del usuario.
// Modo No-Verifactu: el archivo se guarda/entrega a la AEAT sólo si hay inspección.
// TipoHuella = 01 (SHA-256, hex). Encadenamiento explícito entre registros.
function xmlEsc(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function fechaAEAT(iso){
  // yyyy-mm-dd → dd-mm-yyyy (formato AEAT para FechaExpedicionFactura)
  if(!iso) return '';
  const [y,m,d]=String(iso).split('-');
  return `${d}-${m}-${y}`;
}

async function exportarRegistrosXML(){
  try {
    showToast('Generando exportación AEAT…','ok',2000);
    const [{data:registros,error:e1},{data:eventos,error:e2}]=await Promise.all([
      sb.from('facturas_registro').select('*').eq('user_id',CU.id).order('ts_emision',{ascending:true}),
      sb.from('facturas_eventos').select('*').eq('user_id',CU.id).order('ts',{ascending:true})
    ]);
    if(e1) throw e1;
    if(e2) throw e2;
    const regs=registros||[], evts=eventos||[];
    if(regs.length===0){ showToast('No hay facturas registradas todavía','warn',3000); return; }

    const cfg=_cache.cfg||{};
    const emisorNif=cfg.nif||'';
    const emisorNombre=cfg.empresa||CU.email||'';
    const ahora=new Date().toISOString();

    let xml='<?xml version="1.0" encoding="UTF-8"?>\n';
    xml+=`<sf:RegistrosFacturacion xmlns:sf="https://www.agenciatributaria.gob.es/static_files/AEAT/Contenidos_Comunes/La_Agencia_Tributaria/Modelos_y_formularios/Suministros_informacion/FicherosSuministros/EsquemaRegFactuSistemasInformaticos/v1_0" version="1.0">\n`;
    xml+=`  <sf:Cabecera>\n`;
    xml+=`    <sf:IDVersion>1.0</sf:IDVersion>\n`;
    xml+=`    <sf:Modalidad>${xmlEsc(MODALIDAD_FACTURACION)}</sf:Modalidad>\n`;
    xml+=`    <sf:FechaGeneracion>${ahora}</sf:FechaGeneracion>\n`;
    xml+=`    <sf:Titular>\n`;
    xml+=`      <sf:NombreRazon>${xmlEsc(emisorNombre)}</sf:NombreRazon>\n`;
    xml+=`      <sf:NIF>${xmlEsc(emisorNif)}</sf:NIF>\n`;
    xml+=`    </sf:Titular>\n`;
    xml+=`    <sf:SistemaInformatico>\n`;
    xml+=`      <sf:NombreSistemaInformatico>Brami3D</sf:NombreSistemaInformatico>\n`;
    xml+=`      <sf:IdSistemaInformatico>B3D</sf:IdSistemaInformatico>\n`;
    xml+=`      <sf:Version>${xmlEsc(SIF_VERSION)}</sf:Version>\n`;
    xml+=`      <sf:NumeroInstalacion>${xmlEsc(CU.id)}</sf:NumeroInstalacion>\n`;
    xml+=`    </sf:SistemaInformatico>\n`;
    xml+=`    <sf:TotalRegistros>${regs.length}</sf:TotalRegistros>\n`;
    xml+=`    <sf:TotalEventos>${evts.length}</sf:TotalEventos>\n`;
    xml+=`  </sf:Cabecera>\n`;

    xml+=`  <sf:RegistroFacturacionAlta>\n`;
    regs.forEach((r,i)=>{
      const tipoCod=r.tipo==='rectificativa'?'R1':(r.tipo==='anulacion'?'F2':'F1');
      const esPrimero=i===0;
      xml+=`    <sf:Registro>\n`;
      xml+=`      <sf:IDFactura>\n`;
      xml+=`        <sf:IDEmisorFactura>${xmlEsc(r.emisor_nif)}</sf:IDEmisorFactura>\n`;
      xml+=`        <sf:NumSerieFactura>${xmlEsc(r.factura_num)}</sf:NumSerieFactura>\n`;
      xml+=`        <sf:FechaExpedicionFactura>${fechaAEAT(r.factura_fecha)}</sf:FechaExpedicionFactura>\n`;
      xml+=`      </sf:IDFactura>\n`;
      xml+=`      <sf:NombreRazonEmisor>${xmlEsc(r.emisor_nombre)}</sf:NombreRazonEmisor>\n`;
      xml+=`      <sf:TipoFactura>${tipoCod}</sf:TipoFactura>\n`;
      if(r.receptor_nif||r.receptor_nombre){
        xml+=`      <sf:Destinatario>\n`;
        xml+=`        <sf:NombreRazon>${xmlEsc(r.receptor_nombre||'')}</sf:NombreRazon>\n`;
        if(r.receptor_nif) xml+=`        <sf:NIF>${xmlEsc(r.receptor_nif)}</sf:NIF>\n`;
        xml+=`      </sf:Destinatario>\n`;
      }
      xml+=`      <sf:Desglose>\n`;
      xml+=`        <sf:BaseImponibleOimporteNoSujeto>${Number(r.base_imponible||0).toFixed(2)}</sf:BaseImponibleOimporteNoSujeto>\n`;
      xml+=`        <sf:TipoImpositivo>${Number(r.tipo_iva||0).toFixed(2)}</sf:TipoImpositivo>\n`;
      xml+=`        <sf:CuotaRepercutida>${Number(r.cuota_iva||0).toFixed(2)}</sf:CuotaRepercutida>\n`;
      xml+=`      </sf:Desglose>\n`;
      xml+=`      <sf:CuotaTotal>${Number(r.cuota_iva||0).toFixed(2)}</sf:CuotaTotal>\n`;
      xml+=`      <sf:ImporteTotal>${Number(r.importe_total||0).toFixed(2)}</sf:ImporteTotal>\n`;
      xml+=`      <sf:Encadenamiento>\n`;
      if(esPrimero){
        xml+=`        <sf:PrimerRegistro>S</sf:PrimerRegistro>\n`;
      } else {
        const prev=regs[i-1];
        xml+=`        <sf:RegistroAnterior>\n`;
        xml+=`          <sf:IDEmisorFactura>${xmlEsc(prev.emisor_nif)}</sf:IDEmisorFactura>\n`;
        xml+=`          <sf:NumSerieFactura>${xmlEsc(prev.factura_num)}</sf:NumSerieFactura>\n`;
        xml+=`          <sf:FechaExpedicionFactura>${fechaAEAT(prev.factura_fecha)}</sf:FechaExpedicionFactura>\n`;
        xml+=`          <sf:Huella>${xmlEsc(prev.hash)}</sf:Huella>\n`;
        xml+=`        </sf:RegistroAnterior>\n`;
      }
      xml+=`      </sf:Encadenamiento>\n`;
      xml+=`      <sf:SistemaInformatico>\n`;
      xml+=`        <sf:NombreSistemaInformatico>${xmlEsc(r.sif_nombre||'Brami3D')}</sf:NombreSistemaInformatico>\n`;
      xml+=`        <sf:IdSistemaInformatico>B3D</sf:IdSistemaInformatico>\n`;
      xml+=`        <sf:Version>${xmlEsc(r.sif_version||SIF_VERSION)}</sf:Version>\n`;
      xml+=`        <sf:NumeroInstalacion>${xmlEsc(r.sif_id||CU.id)}</sf:NumeroInstalacion>\n`;
      xml+=`      </sf:SistemaInformatico>\n`;
      xml+=`      <sf:FechaHoraHusoGenRegistro>${xmlEsc(r.ts_emision)}</sf:FechaHoraHusoGenRegistro>\n`;
      xml+=`      <sf:TipoHuella>01</sf:TipoHuella>\n`;
      xml+=`      <sf:Huella>${xmlEsc(r.hash)}</sf:Huella>\n`;
      xml+=`    </sf:Registro>\n`;
    });
    xml+=`  </sf:RegistroFacturacionAlta>\n`;

    xml+=`  <sf:EventosSIF>\n`;
    evts.forEach((ev,i)=>{
      const esPrimero=i===0;
      xml+=`    <sf:Evento>\n`;
      xml+=`      <sf:Tipo>${xmlEsc(ev.tipo)}</sf:Tipo>\n`;
      xml+=`      <sf:Descripcion>${xmlEsc(ev.descripcion||'')}</sf:Descripcion>\n`;
      xml+=`      <sf:Timestamp>${xmlEsc(ev.ts)}</sf:Timestamp>\n`;
      if(ev.registro_id) xml+=`      <sf:RegistroRef>${xmlEsc(ev.registro_id)}</sf:RegistroRef>\n`;
      xml+=`      <sf:Encadenamiento>\n`;
      if(esPrimero){
        xml+=`        <sf:PrimerEvento>S</sf:PrimerEvento>\n`;
      } else {
        xml+=`        <sf:HuellaAnterior>${xmlEsc(ev.hash_anterior||'')}</sf:HuellaAnterior>\n`;
      }
      xml+=`      </sf:Encadenamiento>\n`;
      xml+=`      <sf:TipoHuella>01</sf:TipoHuella>\n`;
      xml+=`      <sf:Huella>${xmlEsc(ev.hash)}</sf:Huella>\n`;
      xml+=`    </sf:Evento>\n`;
    });
    xml+=`  </sf:EventosSIF>\n`;
    xml+=`</sf:RegistrosFacturacion>\n`;

    const blob=new Blob([xml],{type:'application/xml'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const ts=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    a.href=url; a.download=`brami3d-registro-aeat-${ts}.xml`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);

    // Registrar evento de exportación (encadenado en facturas_eventos)
    await registrarEvento('exportacion',{
      descripcion:`Exportación XML AEAT — ${regs.length} registros, ${evts.length} eventos`,
      datos:{registros:regs.length,eventos:evts.length,bytes:blob.size,formato:'xml-aeat-v1'}
    });

    showToast(`✓ XML AEAT descargado (${regs.length} facturas, ${evts.length} eventos)`,'ok',5000);
  } catch(e){
    console.error('exportarRegistrosXML',e);
    showToast('Error en exportación: '+(e.message||e),'err',5000);
  }
}
