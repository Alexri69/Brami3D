#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Encuesta a usuarios inactivos: envía un email breve (vía Resend / Edge Function
enviar-doc) a usuarios que se registraron pero NUNCA han usado la app (sin
pedidos), preguntándoles el porqué. El correo sale de hola@brami3d.app con
responder-a brami3d@gmail.com (las respuestas llegan al Gmail del dueño).

A diferencia de reenganche.py (que da la bienvenida y adjunta la guía), este
correo NO adjunta nada: solo pide feedback en una línea.

La DETECCIÓN de a quién enviar se hace aparte (consulta en Supabase los usuarios
sin pedidos); este script recibe la lista por --to y se encarga del envío.

Credenciales en ../.env: DEMO_USER / DEMO_PASS (cuenta para autenticar el envío).

Uso:
  python scripts/encuesta_inactivos.py --to a@b.com c@d.com
  python scripts/encuesta_inactivos.py --to a@b.com --dry      (previsualiza, no envía)

Query para detectar usuarios sin pedidos (ejecutar en Supabase):
  SELECT u.email FROM auth.users u
  WHERE u.email NOT IN ('alexri69@gmail.com','brami3d@gmail.com','demo@brami3d.app')
    AND NOT EXISTS (SELECT 1 FROM public.pedidos p WHERE p.user_id = u.id);
"""
import os, sys, json, argparse, urllib.request, urllib.error

# La consola de Windows (cp1252) revienta al imprimir emojis; forzamos UTF-8.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SUPA_URL = "https://uzgzfxizpoigzcnlunpr.supabase.co"
PUB = "sb_publishable_4gEjOV3kyfh8_I0f861iow__6b1ueIi"
REPLY_TO = "brami3d@gmail.com"

ASUNTO = "¿Qué te frenó con Brami3D? (cuéntamelo en 1 línea)"
TEXTO = (
    "Hola \U0001f44b\n\n"
    "Soy Alexander, de Brami3D. Vi que hace un tiempo creaste tu cuenta pero que "
    "al final no llegaste a usar la app para gestionar tu taller de impresión 3D "
    "(pedidos, costes, presupuestos y facturas).\n\n"
    "Te escribo con una pregunta muy directa y sin venderte nada: ¿qué te frenó? "
    "Cualquier respuesta me ayuda muchísimo a mejorarla. Por ejemplo:\n\n"
    "  • No vi cómo empezar / me pareció complicada\n"
    "  • Me faltaba alguna función que necesitaba\n"
    "  • No era lo que buscaba\n"
    "  • Simplemente no he tenido tiempo todavía\n\n"
    "Con que respondas a este correo en una sola línea me vale. Leo y contesto "
    "personalmente cada mensaje.\n\n"
    "Y si te apetece darle otra oportunidad, tienes Pro gratis 30 días y te ayudo "
    "a dejar tu taller montado en 5 minutos.\n\n"
    "Gracias de verdad,\nAlexander — Brami3D\nbrami3d.app"
)

def env(k):
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "..", ".env"), encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.startswith(k + "="):
                return line.split("=", 1)[1].strip()
    return None

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

    for to in a.to:
        st, res = post(f"{SUPA_URL}/functions/v1/enviar-doc",
                       {"apikey": PUB, "Authorization": f"Bearer {PUB}",
                        "x-user-token": access, "Content-Type": "application/json"},
                       {"to": to, "subject": ASUNTO, "text": TEXTO,
                        "fromName": "Brami3D", "replyTo": REPLY_TO})
        print(f"  {'ENVIADO' if res.get('ok') else 'FALLO  '} -> {to}"
              + (f"  (id {res['id']})" if res.get("ok") else f"  : {res.get('error')}"))

if __name__ == "__main__":
    main()
