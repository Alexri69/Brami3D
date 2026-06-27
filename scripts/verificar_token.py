#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Monitor de salud del token de Meta. Comprueba que el token sigue siendo valido
haciendo una llamada simple a /me. Si el token se rompio (cambio de contrasena,
permisos revocados, etc.), termina con error -> el workflow falla -> GitHub avisa.

Solo necesita META_ACCESS_TOKEN (de entorno o ../.env). No usa secretos extra.
"""
import os, json, urllib.request, urllib.error

def get_token():
    if os.environ.get("META_ACCESS_TOKEN"):
        return os.environ["META_ACCESS_TOKEN"]
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "..", ".env"), encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.startswith("META_ACCESS_TOKEN="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("No hay META_ACCESS_TOKEN")

def main():
    tok = get_token()
    url = f"https://graph.facebook.com/v25.0/me?fields=id,name&access_token={tok}"
    try:
        with urllib.request.urlopen(url) as r:
            d = json.load(r)
        print(f"Token VALIDO. Cuenta: {d.get('name')} ({d.get('id')})")
    except urllib.error.HTTPError as e:
        print("TOKEN ROTO o invalido. Respuesta de Meta:")
        print(e.read().decode())
        print("\n>>> Hay que regenerar el token en el Graph API Explorer y "
              "actualizar el secret META_ACCESS_TOKEN en GitHub.")
        raise SystemExit(1)

if __name__ == "__main__":
    main()
