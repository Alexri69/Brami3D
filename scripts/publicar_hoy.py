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
import os, json, time, argparse, datetime
import publicar  # reutiliza load_env / publish_ig / publish_fb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = os.path.join(ROOT, "social", "plan.json")

def hoy_madrid():
    # Europe/Madrid = UTC+1 (invierno) / UTC+2 (verano). Aproximamos con offset
    # de verano para julio (CEST, UTC+2); suficiente para una publicacion diaria.
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=2)).date()

def guardar(plan):
    json.dump(plan, open(PLAN, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def con_reintentos(fn, etiqueta, intentos=3, espera=20):
    """Reintenta ante errores transitorios de la API de Meta (backoff 20s/40s)."""
    for i in range(1, intentos + 1):
        try:
            return fn()
        except Exception as e:
            if i == intentos:
                raise
            print(f"   {etiqueta}: intento {i} fallo ({e}); reintento en {espera}s...")
            time.sleep(espera)
            espera *= 2

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
        cap = p["caption"]
        # Estado parcial por red: si en un intento anterior IG salio bien y FB
        # fallo, aqui solo se reintenta FB (antes se re-publicaba IG duplicado).
        res = p.get("publicado_en") or {}
        video = p.get("video")  # si existe -> reel/video; si no -> imagenes
        ok = True
        if video:
            print(f"-> Post {p['id']} ({p['fecha']}, {p['redes']}, reel/video)")
            if p["redes"] in ("ig", "both") and not res.get("ig"):
                try:
                    mid, link = con_reintentos(lambda: publicar.publish_ig_video(env, cap, video, "REELS"), "IG-reel")
                    res["ig"] = link or mid
                    p["publicado_en"] = res
                    guardar(plan)  # persistir en cuanto sale bien, por si lo siguiente falla
                    print(f"   IG reel OK  {link or mid}")
                except Exception as e:
                    ok = False; fallo = True
                    print(f"   ERROR post {p['id']} IG reel: {e}")
            if p["redes"] in ("fb", "both") and not res.get("fb"):
                try:
                    vid = con_reintentos(lambda: publicar.publish_fb_video(env, cap, video), "FB-video")
                    res["fb"] = vid
                    p["publicado_en"] = res
                    guardar(plan)
                    print(f"   FB video OK  {vid}")
                except Exception as e:
                    ok = False; fallo = True
                    print(f"   ERROR post {p['id']} FB video: {e}")
        else:
            imgs = p["imagenes"]
            print(f"-> Post {p['id']} ({p['fecha']}, {p['redes']}, {p['tipo']}, {len(imgs)} img)")
            if p["redes"] in ("ig", "both") and not res.get("ig"):
                try:
                    mid, link = con_reintentos(lambda: publicar.publish_ig(env, cap, imgs), "IG")
                    res["ig"] = link or mid
                    p["publicado_en"] = res
                    guardar(plan)  # persistir en cuanto sale bien, por si lo siguiente falla
                    print(f"   IG OK  {link or mid}")
                except Exception as e:
                    ok = False; fallo = True
                    print(f"   ERROR post {p['id']} IG: {e}")
            if p["redes"] in ("fb", "both") and not res.get("fb"):
                try:
                    pid, _ = con_reintentos(lambda: publicar.publish_fb(env, cap, imgs), "FB")
                    res["fb"] = pid
                    p["publicado_en"] = res
                    guardar(plan)
                    print(f"   FB OK  {pid}")
                except Exception as e:
                    ok = False; fallo = True
                    print(f"   ERROR post {p['id']} FB: {e}")
        if ok:
            p["estado"] = "publicado"
            p["publicado_at"] = datetime.datetime.utcnow().isoformat() + "Z"

    guardar(plan)
    if fallo:
        raise SystemExit("Hubo errores al publicar (ver arriba).")

if __name__ == "__main__":
    main()
