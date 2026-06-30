#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Campaña de reenganche: envía un email amable (vía Resend / Edge Function
enviar-doc) a usuarios que se registraron pero no usan la app. El correo sale
de hola@brami3d.app con responder-a brami3d@gmail.com (las respuestas llegan al
Gmail del dueño).

La DETECCIÓN de a quién enviar se hace aparte (consulta en Supabase los usuarios
sin pedidos); este script recibe la lista por --to y se encarga del envío.

Credenciales en ../.env: DEMO_USER / DEMO_PASS (cuenta para autenticar el envío).

Uso:
  python scripts/reenganche.py --to idella3d@gmail.com borja@hotmail.com
  python scripts/reenganche.py --to a@b.com --dry      (previsualiza, no envía)

Query para detectar usuarios sin pedidos (ejecutar en Supabase):
  SELECT u.email FROM auth.users u
  WHERE u.email NOT IN ('alexri69@gmail.com','brami3d@gmail.com','demo@brami3d.app')
    AND NOT EXISTS (SELECT 1 FROM public.pedidos p WHERE p.user_id = u.id);
"""
import os, sys, json, base64, argparse, urllib.request, urllib.error

# La consola de Windows (cp1252) revienta al imprimir emojis; forzamos UTF-8.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SUPA_URL = "https://uzgzfxizpoigzcnlunpr.supabase.co"
PUB = "sb_publishable_4gEjOV3kyfh8_I0f861iow__6b1ueIi"
REPLY_TO = "brami3d@gmail.com"
GUIA_PDF = "guia-brami3d.pdf"   # se adjunta al correo (está en la raíz del repo)

ASUNTO = "¿Te echamos una mano para empezar con Brami3D? \U0001f5a8️"
TEXTO = (
    "Hola \U0001f44b\n\n"
    "Soy Alexander, de Brami3D. Vi que hace un tiempo creaste tu cuenta en Brami3D "
    "—la app para gestionar tu taller de impresión 3D (pedidos, costes, presupuestos "
    "y facturas)— pero que todavía no has tenido ocasión de estrenarla.\n\n"
    "¿Hubo algo que no te encajó o que no viste cómo hacer? Me encantaría ayudarte: "
    "responde a este correo y te echo una mano personalmente, sin compromiso.\n\n"
    "Para ponértelo fácil, te adjunto una guía rápida para sacarle partido en 5 minutos.\n\n"
    "Y recuerda que tienes Pro gratis durante 30 días para probarlo todo sin límites.\n\n"
    "Un saludo,\nAlexander — Brami3D\nbrami3d.app"
)

def env(k):
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "..", ".env"), encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.startswith(k + "="):
                return line.split("=", 1)[1].strip()
    return None

def guia_base64():
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "..", GUIA_PDF), "rb") as f:
        return base64.b64encode(f.read()).decode()

def post(url, headers, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST")
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", nargs="+", required=True, help="emails destinatarios")
    ap.add_argument("--dry", action="store_true", help="previsualiza sin enviar")
    a = ap.parse_args()

    print(f"ASUNTO: {ASUNTO}\n{'-'*60}\n{TEXTO}\n{'-'*60}")
    print(f"Destinatarios ({len(a.to)}): {', '.join(a.to)}\n")
    if a.dry:
        print("[dry] No se envió nada.")
        return

    st, tok = post(f"{SUPA_URL}/auth/v1/token?grant_type=password",
                   {"apikey": PUB, "Content-Type": "application/json"},
                   {"email": env("DEMO_USER"), "password": env("DEMO_PASS")})
    access = tok.get("access_token")
    if not access:
        raise SystemExit(f"No se pudo iniciar sesión: {tok}")

    pdf_b64 = guia_base64()   # la guía se adjunta a cada correo

    for to in a.to:
        st, res = post(f"{SUPA_URL}/functions/v1/enviar-doc",
                       {"apikey": PUB, "Authorization": f"Bearer {PUB}",
                        "x-user-token": access, "Content-Type": "application/json"},
                       {"to": to, "subject": ASUNTO, "text": TEXTO,
                        "fromName": "Brami3D", "replyTo": REPLY_TO,
                        "filename": GUIA_PDF, "pdfBase64": pdf_b64})
        print(f"  {'ENVIADO' if res.get('ok') else 'FALLO  '} -> {to}"
              + (f"  (id {res['id']})" if res.get("ok") else f"  : {res.get('error')}"))

if __name__ == "__main__":
    main()
