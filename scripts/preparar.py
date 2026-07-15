#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prepara el plan del mes para publicacion automatica:
  1) Copia todas las imagenes referenciadas en marketing/plan-mes.json a m/
     (carpeta servida por GitHub Pages -> URLs publicas que Instagram exige).
  2) Genera social/plan.json (versionado) con las imagenes como URLs publicas.

Uso:  python scripts/preparar.py
"""
import os, json, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN_IN = os.path.join(ROOT, "marketing", "plan-mes.json")
PLAN_OUT = os.path.join(ROOT, "social", "plan.json")
MDIR = os.path.join(ROOT, "m")
BASE = "https://brami3d.app/m/"

def main():
    plan = json.load(open(PLAN_IN, encoding="utf-8"))
    os.makedirs(MDIR, exist_ok=True)
    os.makedirs(os.path.dirname(PLAN_OUT), exist_ok=True)
    copiadas, out = 0, []
    for p in plan:
        urls = []
        for a in p.get("archivos", []):
            src = os.path.join(ROOT, a)
            if not os.path.exists(src):
                raise SystemExit(f"FALTA imagen: {a}")
            name = os.path.basename(a)
            shutil.copy2(src, os.path.join(MDIR, name))
            copiadas += 1
            urls.append(BASE + name)
        entry = {
            "id": p["id"], "fecha": p["fecha"], "redes": p["redes"],
            "tipo": p["tipo"], "imagenes": urls, "caption": p["caption"],
            "estado": p.get("estado", "pendiente"),
        }
        # Reels/video: copiamos el mp4 a m/ (IG exige URL publica; la sirve GitHub Pages)
        video = p.get("video")
        if video:
            vsrc = os.path.join(ROOT, video)
            if not os.path.exists(vsrc):
                raise SystemExit(f"FALTA video: {video}")
            vname = os.path.basename(video)
            shutil.copy2(vsrc, os.path.join(MDIR, vname))
            copiadas += 1
            entry["video"] = BASE + vname
        out.append(entry)
    json.dump(out, open(PLAN_OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"{copiadas} archivos copiados a m/  |  {len(out)} posts en social/plan.json")

if __name__ == "__main__":
    main()
