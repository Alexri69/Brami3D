#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Publica los posts de social/plan.json cuya fecha sea HOY (o anterior) y sigan
'pendiente'. Pensado para correr a diario en GitHub Actions. Marca cada post
publicado (estado + media id) y reescribe social/plan.json para que el Action
lo commitee (idempotente: no republica lo ya hecho).

Zona horaria de referencia: Europe/Madrid.
Uso:  python scripts/publicar_hoy.py            (publica los de hoy)
      python scripts/publicar_hoy.py --id 6     (fuerza un post concreto, para probar)
"""
import os, json, argparse, datetime
import publicar  # reutiliza load_env / publish_ig / publish_fb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = os.path.join(ROOT, "social", "plan.json")

def hoy_madrid():
    # Europe/Madrid = UTC+1 (invierno) / UTC+2 (verano). Aproximamos con offset
    # de verano para julio (CEST, UTC+2); suficiente para una publicacion diaria.
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=2)).date()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", type=int, help="publica solo este id (prueba manual)")
    a = ap.parse_args()
    env = publicar.load_env()
    plan = json.load(open(PLAN, encoding="utf-8"))
    hoy = hoy_madrid()

    pend = []
    for p in plan:
        if p["estado"] != "pendiente":
            continue
        if a.id is not None:
            if p["id"] == a.id: pend.append(p)
        else:
            if datetime.date.fromisoformat(p["fecha"]) <= hoy:
                pend.append(p)

    if not pend:
        print(f"Nada que publicar (hoy={hoy}).")
        return

    fallo = False
    for p in pend:
        cap, imgs = p["caption"], p["imagenes"]
        print(f"-> Post {p['id']} ({p['fecha']}, {p['redes']}, {p['tipo']}, {len(imgs)} img)")
        try:
            res = {}
            if p["redes"] in ("ig", "both"):
                mid, link = publicar.publish_ig(env, cap, imgs)
                res["ig"] = link or mid
                print(f"   IG OK  {link or mid}")
            if p["redes"] in ("fb", "both"):
                pid, _ = publicar.publish_fb(env, cap, imgs)
                res["fb"] = pid
                print(f"   FB OK  {pid}")
            p["estado"] = "publicado"
            p["publicado_en"] = res
            p["publicado_at"] = datetime.datetime.utcnow().isoformat() + "Z"
        except Exception as e:
            fallo = True
            print(f"   ERROR post {p['id']}: {e}")

    json.dump(plan, open(PLAN, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    if fallo:
        raise SystemExit("Hubo errores al publicar (ver arriba).")

if __name__ == "__main__":
    main()
