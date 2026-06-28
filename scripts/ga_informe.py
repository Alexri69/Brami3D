#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Informe de visitas de Brami3D (Google Analytics 4, propiedad G-C5P6F52QE3).
Consulta la GA4 Data API con una cuenta de servicio (solo lectura) y muestra:
usuarios, sesiones, vistas, evolucion por dia, paginas/secciones top,
dispositivos, paises y eventos clave del embudo (begin_checkout, pwa_installed...).

Requiere (una vez):  pip install google-auth requests
Credenciales: cuenta de servicio JSON en  secretos/ga-service-account.json
              (o ruta en la variable GA_CREDENTIALS del .env)
Property ID numerico de GA4 en  GA_PROPERTY_ID  (.env).  NO es el G-XXXX.

Uso:  python scripts/ga_informe.py [--dias 30]
"""
import os, sys, json, argparse, datetime

API = "https://analyticsdata.googleapis.com/v1beta"
SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")


def env(k, default=None):
    if os.environ.get(k):
        return os.environ[k]
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        with open(path, encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith(k + "="):
                    return line.split("=", 1)[1].strip()
    return default


def _die(msg):
    print("ERROR:", msg)
    sys.exit(1)


def get_token(cred_path):
    try:
        from google.oauth2 import service_account
        import google.auth.transport.requests
    except ImportError:
        _die("Falta la libreria. Ejecuta:  pip install google-auth requests")
    if not os.path.exists(cred_path):
        _die(f"No encuentro el JSON de la cuenta de servicio en: {cred_path}\n"
             "       Descargalo de Google Cloud y guardalo ahi (ver instrucciones).")
    creds = service_account.Credentials.from_service_account_file(cred_path, scopes=[SCOPE])
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def run_report(prop, token, body):
    import requests
    url = f"{API}/properties/{prop}:runReport"
    r = requests.post(url, headers={"Authorization": "Bearer " + token}, json=body, timeout=30)
    if r.status_code != 200:
        try:
            err = r.json().get("error", {}).get("message", r.text)
        except Exception:
            err = r.text
        _die(f"GA API {r.status_code}: {err}")
    return r.json()


def rows(rep):
    """Devuelve filas como (dims[list], metrics[list])."""
    out = []
    for row in rep.get("rows", []):
        dims = [d.get("value", "") for d in row.get("dimensionValues", [])]
        mets = [m.get("value", "") for m in row.get("metricValues", [])]
        out.append((dims, mets))
    return out


def fnum(s):
    try:
        return f"{int(float(s)):,}".replace(",", ".")
    except Exception:
        return s


def bar(val, mx, width=24):
    if mx <= 0:
        return ""
    n = int(round(val / mx * width))
    return "#" * n + "." * (width - n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=30, help="ventana de dias (default 30)")
    a = ap.parse_args()

    prop = env("GA_PROPERTY_ID")
    if not prop:
        _die("Falta GA_PROPERTY_ID en .env (el ID numerico de la propiedad GA4, NO el G-XXXX).")
    cred = env("GA_CREDENTIALS") or os.path.join(ROOT, "secretos", "ga-service-account.json")
    token = get_token(cred)

    dr = [{"startDate": f"{a.dias}daysAgo", "endDate": "today"}]
    H = "=" * 64

    # --- 1) Resumen ---
    rep = run_report(prop, token, {
        "dateRanges": dr,
        "metrics": [{"name": m} for m in
                    ["activeUsers", "newUsers", "sessions", "screenPageViews", "averageSessionDuration"]],
    })
    print("\n" + H)
    print(f"  INFORME DE VISITAS - Brami3D PWA   (ultimos {a.dias} dias)")
    print(f"  {datetime.date.today().isoformat()}")
    print(H)
    if rep.get("rows"):
        _, m = rows(rep)[0]
        dur = float(m[4] or 0)
        print(f"  Usuarios activos .......... {fnum(m[0])}")
        print(f"  Usuarios nuevos ........... {fnum(m[1])}")
        print(f"  Sesiones .................. {fnum(m[2])}")
        print(f"  Paginas/pantallas vistas .. {fnum(m[3])}")
        print(f"  Duracion media sesion ..... {int(dur // 60)}m {int(dur % 60)}s")
    else:
        print("  Sin datos en el periodo (¿nadie ha aceptado cookies todavia?).")
        print(H)
        return

    # --- 2) Evolucion por dia ---
    rep = run_report(prop, token, {
        "dateRanges": dr,
        "dimensions": [{"name": "date"}],
        "metrics": [{"name": "activeUsers"}, {"name": "screenPageViews"}],
        "orderBys": [{"dimension": {"dimensionName": "date"}}],
    })
    rr = rows(rep)
    if rr:
        mx = max((float(m[0] or 0) for _, m in rr), default=0)
        print("\n  USUARIOS POR DIA")
        print("  " + "-" * 56)
        for d, m in rr[-21:]:  # ultimas ~3 semanas para no saturar
            fecha = f"{d[0][6:8]}/{d[0][4:6]}"
            u = float(m[0] or 0)
            print(f"  {fecha}  {bar(u, mx)} {fnum(m[0]):>5}  ({fnum(m[1])} vistas)")

    # --- 3) Secciones / paginas top ---
    rep = run_report(prop, token, {
        "dateRanges": dr,
        "dimensions": [{"name": "pagePath"}],
        "metrics": [{"name": "screenPageViews"}, {"name": "activeUsers"}],
        "orderBys": [{"metric": {"metricName": "screenPageViews"}, "desc": True}],
        "limit": 12,
    })
    rr = rows(rep)
    if rr:
        print("\n  SECCIONES / PAGINAS MAS VISTAS")
        print(f"  {'ruta':<30} {'vistas':>8} {'usuarios':>9}")
        print("  " + "-" * 50)
        for d, m in rr:
            print(f"  {d[0][:30]:<30} {fnum(m[0]):>8} {fnum(m[1]):>9}")

    # --- 4) Dispositivos ---
    rep = run_report(prop, token, {
        "dateRanges": dr,
        "dimensions": [{"name": "deviceCategory"}],
        "metrics": [{"name": "activeUsers"}],
        "orderBys": [{"metric": {"metricName": "activeUsers"}, "desc": True}],
    })
    rr = rows(rep)
    if rr:
        print("\n  DISPOSITIVOS")
        for d, m in rr:
            print(f"  {d[0]:<12} {fnum(m[0]):>6}")

    # --- 5) Paises ---
    rep = run_report(prop, token, {
        "dateRanges": dr,
        "dimensions": [{"name": "country"}],
        "metrics": [{"name": "activeUsers"}],
        "orderBys": [{"metric": {"metricName": "activeUsers"}, "desc": True}],
        "limit": 8,
    })
    rr = rows(rep)
    if rr:
        print("\n  PAISES (top)")
        for d, m in rr:
            print(f"  {d[0]:<18} {fnum(m[0]):>6}")

    # --- 6) Eventos clave (embudo) ---
    rep = run_report(prop, token, {
        "dateRanges": dr,
        "dimensions": [{"name": "eventName"}],
        "metrics": [{"name": "eventCount"}],
        "orderBys": [{"metric": {"metricName": "eventCount"}, "desc": True}],
        "limit": 50,
    })
    interes = {"pwa_install_prompt": "Dialogo instalar PWA",
               "pwa_installed": "PWA instalada",
               "view_upgrade_modal": "Vio modal Pro",
               "begin_checkout": "Inicio checkout"}
    rr = {d[0]: m[0] for d, m in rows(rep)}
    print("\n  EMBUDO / EVENTOS CLAVE")
    print("  " + "-" * 40)
    for ev, label in interes.items():
        print(f"  {label:<24} {fnum(rr.get(ev, '0')):>6}")
    print(H + "\n")


if __name__ == "__main__":
    main()
