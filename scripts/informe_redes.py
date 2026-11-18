#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Estudio y Control Semanal de Publicidad de Brami3D (Instagram + Facebook + GA4 + Cola).
Extrae en vivo de la Graph API de Meta:
  - Seguidores y evolucion de @brami3d.app (Instagram) y Pagina Brami3D (Facebook)
  - Rendimiento detallado de los ultimos Reels, Carruseles e Imagenes (alcance, likes,
    comentarios, guardados, compartidos y % de engagement)
  - Comparativa de formato (Alcance medio de Reels vs Carruseles vs Imagenes)
  - Estado de la cola de publicacion automatica (social/plan.json: publicados en la
    ultima semana y proximos lanzamientos programados)
  - Visitas web/PWA en los ultimos 7 dias (Google Analytics 4, si hay credenciales)

Uso:
  python scripts/informe_redes.py [--n 15] [--email alexri69@gmail.com] [--guardar-local]
"""
import os, sys, json, argparse, datetime, urllib.parse, urllib.request, urllib.error

API = "https://graph.facebook.com/v25.0"
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, ".."))
PLAN_PATH = os.path.join(REPO_ROOT, "social", "plan.json")
LOCAL_PUB_DIR = r"d:\Proyectos\Publicidad Brami3D"


def env(k, default=None):
    if os.environ.get(k):
        return os.environ[k]
    for root in (REPO_ROOT, r"C:\Users\alexr\Brami3D"):
        env_path = os.path.join(root, ".env")
        if os.path.exists(env_path):
            with open(env_path, encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith(k + "="):
                        return line.split("=", 1)[1].strip()
    return default


def get(path, params):
    url = f"{API}/{path}?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=45) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return {"error": json.loads(e.read().decode()).get("error", {})}
        except Exception:
            return {"error": {"message": str(e)}}
    except Exception as e:
        return {"error": {"message": str(e)}}


def obtener_metricas_ig(tok, ig_id, limit=15):
    acc = get(ig_id, {"fields": "username,followers_count,follows_count,media_count", "access_token": tok})
    foll = max(int(acc.get("followers_count", 0) or 1), 1)
    med = get(
        f"{ig_id}/media",
        {
            "fields": "id,caption,like_count,comments_count,media_type,media_product_type,timestamp,permalink",
            "limit": limit,
            "access_token": tok,
        },
    )
    posts = med.get("data", [])
    rows = []
    por_tipo = {"REELS": [], "CAROUSEL": [], "IMAGE": []}

    for p in posts:
        likes = int(p.get("like_count", 0) or 0)
        com = int(p.get("comments_count", 0) or 0)
        mtype = p.get("media_type", "")
        mptype = p.get("media_product_type", "")
        label_tipo = "REEL" if mptype == "REELS" or mtype == "VIDEO" else ("CARRUSEL" if "CAROUSEL" in mtype else "IMAGEN")

        reach = 0
        saved = 0
        shares = 0
        ins = get(f"{p['id']}/insights", {"metric": "reach,saved,shares", "access_token": tok})
        if "data" in ins:
            for m in ins["data"]:
                val = m.get("values", [{}])[0].get("value", 0) or 0
                if m.get("name") == "reach":
                    reach = int(val)
                elif m.get("name") == "saved":
                    saved = int(val)
                elif m.get("name") == "shares":
                    shares = int(val)
        else:
            ins_r = get(f"{p['id']}/insights", {"metric": "reach", "access_token": tok})
            if "data" in ins_r:
                try:
                    reach = int(ins_r["data"][0]["values"][0]["value"] or 0)
                except Exception:
                    pass

        interacciones = likes + com + saved + shares
        eng = interacciones / foll * 100.0
        fecha = (p.get("timestamp") or "")[:10]
        txt = (p.get("caption") or "(Sin texto)").replace("\n", " ")[:42]
        rows.append(
            {
                "fecha": fecha,
                "tipo": label_tipo,
                "likes": likes,
                "coment": com,
                "saved": saved,
                "shares": shares,
                "reach": reach,
                "eng": eng,
                "txt": txt,
                "link": p.get("permalink", ""),
            }
        )
        bucket = "REELS" if label_tipo == "REEL" else ("CAROUSEL" if label_tipo == "CARRUSEL" else "IMAGE")
        por_tipo[bucket].append(reach)

    return acc, rows, por_tipo


def obtener_metricas_fb(tok, page_id):
    return get(page_id, {"fields": "name,fan_count,followers_count,website", "access_token": tok})


def obtener_resumen_ga4():
    """Intenta leer los ultimos 7 dias de GA4 si existen las credenciales locales/CI."""
    prop = env("GA_PROPERTY_ID", "531047655")
    cred_path = env("GA_CREDENTIALS")
    if not cred_path:
        for root in (REPO_ROOT, r"C:\Users\alexr\Brami3D"):
            cand = os.path.join(root, "secretos", "ga-service-account.json")
            if os.path.exists(cand):
                cred_path = cand
                break
    if not cred_path or not os.path.exists(cred_path):
        return None
    try:
        from google.oauth2 import service_account
        import google.auth.transport.requests
        import requests

        creds = service_account.Credentials.from_service_account_file(
            cred_path, scopes=["https://www.googleapis.com/auth/analytics.readonly"]
        )
        creds.refresh(google.auth.transport.requests.Request())
        url = f"https://analyticsdata.googleapis.com/v1beta/properties/{prop}:runReport"
        r = requests.post(
            url,
            headers={"Authorization": "Bearer " + creds.token},
            json={
                "dateRanges": [{"startDate": "7daysAgo", "endDate": "today"}],
                "metrics": [
                    {"name": "activeUsers"},
                    {"name": "newUsers"},
                    {"name": "sessions"},
                    {"name": "screenPageViews"},
                ],
            },
            timeout=25,
        )
        if r.status_code != 200:
            return None
        data = r.json()
        if not data.get("rows"):
            return {"activeUsers": 0, "newUsers": 0, "sessions": 0, "views": 0}
        vals = [m.get("value", "0") for m in data["rows"][0].get("metricValues", [])]
        return {
            "activeUsers": int(vals[0]),
            "newUsers": int(vals[1]),
            "sessions": int(vals[2]),
            "views": int(vals[3]),
        }
    except Exception:
        return None


def enviar_email(to_addr, subject, md_text):
    import urllib.request

    key = env("RESEND_API_KEY")
    if not key:
        print("Aviso: falta RESEND_API_KEY, no se envia email.")
        return
    html = (
        "<div style='font-family:Segoe UI,system-ui,sans-serif;max-width:860px;margin:auto;"
        "background:#0F1216;color:#FFFFFF;padding:28px 32px;border-radius:12px;'>"
        "<h2 style='color:#1FA6C9;margin-top:0;'>Brami3D · Informe Semanal de Publicidad (IG + FB + Web)</h2>"
        "<pre style='font-family:Consolas,monospace;font-size:13px;line-height:1.5;color:#E2E8F0;"
        "white-space:pre-wrap;background:#171B21;padding:20px;border-radius:8px;border:1px solid #2A303A;'>"
        + md_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        + "</pre></div>"
    )
    payload = json.dumps(
        {
            "from": "Brami3D Marketing <hola@brami3d.app>",
            "to": [to_addr],
            "subject": subject,
            "text": md_text,
            "html": html,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        print(f"Email semanal enviado a {to_addr} (status {r.status}).")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=15, help="numero de publicaciones recientes a auditar")
    ap.add_argument("--email", help="enviar resumen semanal por email via Resend")
    ap.add_argument("--guardar-local", action="store_true", default=True, help="guardar informe en Publicidad Brami3D")
    a = ap.parse_args()

    tok = env("META_ACCESS_TOKEN")
    ig_id = env("META_IG_USER_ID", "17841442053876570")
    fb_id = env("META_PAGE_ID", "1153412231189064")
    hoy = datetime.date.today().isoformat()

    acc, rows, por_tipo = obtener_metricas_ig(tok, ig_id, a.n)
    fb = obtener_metricas_fb(tok, fb_id)
    ga = obtener_resumen_ga4()

    lines = []
    lines.append(f"# Estudio y Control Semanal de Publicidad — Brami3D ({hoy})")
    lines.append("")
    lines.append("## 1. Estado de las Cuentas (Instagram y Facebook)")
    lines.append(
        f"- **Instagram (@{acc.get('username', 'brami3d.app')}):** "
        f"**{acc.get('followers_count', 0)} seguidores** | "
        f"{acc.get('media_count', 0)} publicaciones totales"
    )
    lines.append(
        f"- **Página de Facebook ({fb.get('name', 'Brami3D')}):** "
        f"**{fb.get('followers_count', 0)} seguidores** ({fb.get('fan_count', 0)} me gusta)"
    )
    if ga is not None:
        lines.append(
            f"- **Tráfico Web/App (GA4 últimos 7 días):** "
            f"**{ga['activeUsers']} usuarios activos** ({ga['newUsers']} nuevos) · "
            f"{ga['sessions']} sesiones · {ga['views']} pantallas vistas"
        )
    lines.append("")

    # Comparativa por formato
    avg_reel = sum(por_tipo["REELS"]) / len(por_tipo["REELS"]) if por_tipo["REELS"] else 0
    avg_carr = sum(por_tipo["CAROUSEL"]) / len(por_tipo["CAROUSEL"]) if por_tipo["CAROUSEL"] else 0
    avg_img = sum(por_tipo["IMAGE"]) / len(por_tipo["IMAGE"]) if por_tipo["IMAGE"] else 0

    lines.append("## 2. Rendimiento por Formato (Alcance medio por pieza)")
    lines.append(f"- **Reels (Vídeo vertical):** **{avg_reel:.1f} cuentas alcanzadas** de media ({len(por_tipo['REELS'])} analizados)")
    lines.append(f"- **Carruseles:** **{avg_carr:.1f} cuentas alcanzadas** de media ({len(por_tipo['CAROUSEL'])} analizados)")
    lines.append(f"- **Imágenes individuales:** **{avg_img:.1f} cuentas alcanzadas** de media ({len(por_tipo['IMAGE'])} analizadas)")
    lines.append("")

    lines.append(f"## 3. Detalle de las Últimas {len(rows)} Publicaciones en Instagram")
    lines.append("")
    lines.append("| Fecha | Formato | Alcance | Likes | Coment. | Guardados | Compart. | Eng. % | Extracto |")
    lines.append("|---|---|---:|---:|---:|---:|---:|---:|---|")
    for r in rows:
        lines.append(
            f"| {r['fecha']} | {r['tipo']} | {r['reach']} | {r['likes']} | {r['coment']} | "
            f"{r['saved']} | {r['shares']} | {r['eng']:.1f}% | {r['txt']} |"
        )
    lines.append("")

    # Estado del calendario social/plan.json
    plan_file = PLAN_PATH if os.path.exists(PLAN_PATH) else r"C:\Users\alexr\Brami3D\social\plan.json"
    if os.path.exists(plan_file):
        plan = json.load(open(plan_file, encoding="utf-8"))
        pend = [p for p in plan if p.get("estado") == "pendiente"]
        pub_rec = [p for p in plan if p.get("estado") == "publicado"][-5:]
        lines.append("## 4. Control de la Cola de Publicación (`social/plan.json`)")
        lines.append(f"- **Publicaciones pendientes en cola:** **{len(pend)}**")
        if pend:
            lines.append("- **Próximas 4 publicaciones programadas (salen solas en Reel/Feed + Stories):**")
            for p in pend[:4]:
                extracto = (p.get("caption") or "").split("\n")[0][:65]
                lines.append(f"  - `{p['fecha']}` · **{p['tipo'].upper()}** (ID {p['id']}): {extracto}")
        if pub_rec:
            lines.append("- **Últimas publicaciones lanzadas por el sistema:**")
            for p in reversed(pub_rec):
                en = p.get("publicado_en") or {}
                ig_st = " + Story" if en.get("ig_story") else ""
                fb_st = " + Story" if en.get("fb_story") else ""
                lines.append(
                    f"  - `{p['fecha']}` · **{p['tipo'].upper()}** (ID {p['id']}) -> "
                    f"IG: {en.get('ig', '-')}{ig_st} | FB: {en.get('fb', '-')}{fb_st}"
                )
        lines.append("")

    # Recomendación automática basada en datos
    lines.append("## 5. Recomendaciones de la Semana")
    if rows:
        top_post = max(rows, key=lambda x: (x["reach"], x["likes"] + x["saved"] + x["shares"]))
        lines.append(
            f"- **Mejor pieza reciente:** `{top_post['fecha']}` ({top_post['tipo']}) con "
            f"**{top_post['reach']} de alcance** y {top_post['likes']} likes («{top_post['txt']}»)."
        )
    if avg_reel > max(avg_carr, avg_img) * 1.5:
        lines.append(
            "- **Conclusión de formato:** Los Reels están consiguiendo mucho más alcance que las imágenes estáticas. "
            "Mantener la prioridad de Reels con música y fotos reales en uso."
        )
    if len([p for p in (json.load(open(plan_file, encoding="utf-8")) if os.path.exists(plan_file) else []) if p.get("estado") == "pendiente"]) <= 3:
        lines.append("- ⚠️ **Alerta de cola:** Quedan 3 o menos publicaciones pendientes en `social/plan.json`. Conviene preparar la siguiente tanda.")
    else:
        lines.append("- ✅ **Estado de cola saludable:** El calendario automático tiene publicaciones listas para las próximas semanas.")

    report_md = "\n".join(lines)
    print(report_md)

    if a.guardar_local and os.path.exists(LOCAL_PUB_DIR):
        inf_dir = os.path.join(LOCAL_PUB_DIR, "informes")
        os.makedirs(inf_dir, exist_ok=True)
        out_path = os.path.join(inf_dir, f"informe-semanal-{hoy}.md")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(report_md + "\n")
        ultimo_path = os.path.join(LOCAL_PUB_DIR, "ULTIMO-INFORME-SEMANAL.md")
        with open(ultimo_path, "w", encoding="utf-8") as f:
            f.write(report_md + "\n")
        print(f"\n[Guardado en {out_path} y {ultimo_path}]")

    if a.email:
        enviar_email(a.email, f"Brami3D · Control Semanal de Publicidad ({hoy})", report_md)


if __name__ == "__main__":
    main()
