#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Comprueba que los crons de Supabase (recordatorios, reenganche) siguen vivos.

Cada cron, al terminar bien, upserta su latido en la tabla cron_heartbeat
(sql/022). Este script (workflow verificar-crons.yml, martes) comprueba que
los latidos son recientes; si alguno falta o esta rancio, sale con error y
GitHub avisa por email al owner.

La tabla es de lectura publica (solo nombres + timestamps), asi que basta la
clave publishable: no hay que meter secretos nuevos en GitHub.

Uso:  python scripts/verificar_crons.py
"""
import json
import sys
import datetime
import urllib.request

SUPA_URL = "https://uzgzfxizpoigzcnlunpr.supabase.co"
SUPA_KEY = "sb_publishable_4gEjOV3kyfh8_I0f861iow__6b1ueIi"

# Cron -> maximo de dias entre latidos (ambos corren los lunes; margen de 8).
ESPERADOS = {"recordatorios": 8, "reenganche": 8}


def main():
    req = urllib.request.Request(
        f"{SUPA_URL}/rest/v1/cron_heartbeat?select=nombre,ultimo,resultado",
        headers={"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"},
    )
    rows = json.load(urllib.request.urlopen(req))
    por_nombre = {r["nombre"]: r for r in rows}
    ahora = datetime.datetime.now(datetime.timezone.utc)

    fallos = []
    for nombre, max_dias in ESPERADOS.items():
        r = por_nombre.get(nombre)
        if not r:
            fallos.append(f"{nombre}: sin ningun latido registrado (¿cron caido o sql/022 sin aplicar?)")
            continue
        ultimo = datetime.datetime.fromisoformat(r["ultimo"].replace("Z", "+00:00"))
        edad = ahora - ultimo
        if edad > datetime.timedelta(days=max_dias):
            fallos.append(f"{nombre}: ultimo latido hace {edad.days} dias ({r['ultimo']}) — limite {max_dias}")
        else:
            print(f"OK  {nombre}: latido de hace {edad.days}d ({r['ultimo']}) resultado={r.get('resultado')}")

    if fallos:
        print("\nCRONS CAIDOS O SIN LATIDO:")
        for f in fallos:
            print(" -", f)
        sys.exit(1)
    print("\nTodos los crons tienen latido reciente.")


if __name__ == "__main__":
    main()
