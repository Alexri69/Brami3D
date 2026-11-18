#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Publica los posts de social/plan.json cuya fecha sea HOY (o anterior) y sigan
'pendiente'. Pensado para correr a diario en GitHub Actions y/o desde local.
Publica cada pieza tanto en REELS/FEED como en HISTORIAS (Stories 24h) de
Instagram y Facebook.

Uso:  python scripts/publicar_hoy.py            (publica los de hoy)
      python scripts/publicar_hoy.py --id 16    (fuerza un post concreto)
"""
import os, json, time, argparse, datetime
import publicar

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAN = os.path.join(ROOT, "social", "plan.json")


def hoy_es():
    # Hora de Canarias (UTC+0 en invierno) / Espana (UTC+1 en invierno).
    # Usamos UTC+0 para que el cron de las 17:00 UTC coincida siempre con el dia natural.
    return datetime.datetime.now(datetime.timezone.utc).date()


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
    hoy = hoy_es()

    pend = []
    for p in plan:
        if p["estado"] != "pendiente":
            continue
        if a.id is not None:
            if p["id"] == a.id:
                pend.append(p)
        else:
            if datetime.date.fromisoformat(p["fecha"]) <= hoy:
                pend.append(p)

    if not pend:
        print(f"Nada que publicar (hoy={hoy}).")
        return

    fallo = False
    for p in pend:
        cap = p["caption"]
        res = p.get("publicado_en") or {}
        video = p.get("video")
        ok = True

        if video:
            print(f"-> Post {p['id']} ({p['fecha']}, {p['redes']}, REEL + STORY)")
            if p["redes"] in ("ig", "both"):
                if not res.get("ig"):
                    try:
                        mid, link = con_reintentos(
                            lambda: publicar.publish_ig_video(env, cap, video, "REELS"), "IG-reel"
                        )
                        res["ig"] = link or mid
                        p["publicado_en"] = res
                        guardar(plan)
                        print(f"   IG reel OK   {link or mid}")
                    except Exception as e:
                        ok = False
                        fallo = True
                        print(f"   ERROR post {p['id']} IG reel: {e}")
                if not res.get("ig_story"):
                    try:
                        sid, _ = con_reintentos(
                            lambda: publicar.publish_ig_video(env, "", video, "STORIES"), "IG-story"
                        )
                        res["ig_story"] = sid
                        p["publicado_en"] = res
                        guardar(plan)
                        print(f"   IG story OK  {sid}")
                    except Exception as e:
                        print(f"   Aviso IG story post {p['id']}: {e}")

            if p["redes"] in ("fb", "both"):
                if not res.get("fb"):
                    try:
                        vid = con_reintentos(lambda: publicar.publish_fb_reel(env, cap, video), "FB-reel")
                        res["fb"] = vid
                        p["publicado_en"] = res
                        guardar(plan)
                        print(f"   FB reel OK   {vid}")
                    except Exception as e:
                        ok = False
                        fallo = True
                        print(f"   ERROR post {p['id']} FB reel: {e}")
                if not res.get("fb_story"):
                    try:
                        svid = con_reintentos(lambda: publicar.publish_fb_story_video(env, video), "FB-story")
                        res["fb_story"] = svid
                        p["publicado_en"] = res
                        guardar(plan)
                        print(f"   FB story OK  {svid}")
                    except Exception as e:
                        print(f"   Aviso FB story post {p['id']}: {e}")
        else:
            imgs = p["imagenes"]
            print(f"-> Post {p['id']} ({p['fecha']}, {p['redes']}, {p['tipo']} + STORY, {len(imgs)} img)")
            if p["redes"] in ("ig", "both"):
                if not res.get("ig"):
                    try:
                        mid, link = con_reintentos(lambda: publicar.publish_ig(env, cap, imgs), "IG-feed")
                        res["ig"] = link or mid
                        p["publicado_en"] = res
                        guardar(plan)
                        print(f"   IG feed OK   {link or mid}")
                    except Exception as e:
                        ok = False
                        fallo = True
                        print(f"   ERROR post {p['id']} IG feed: {e}")
                if not res.get("ig_story"):
                    try:
                        sid = con_reintentos(lambda: publicar.publish_ig_story_image(env, imgs[0]), "IG-story")
                        res["ig_story"] = sid
                        p["publicado_en"] = res
                        guardar(plan)
                        print(f"   IG story OK  {sid}")
                    except Exception as e:
                        print(f"   Aviso IG story post {p['id']}: {e}")

            if p["redes"] in ("fb", "both"):
                if not res.get("fb"):
                    try:
                        pid, _ = con_reintentos(lambda: publicar.publish_fb(env, cap, imgs), "FB-feed")
                        res["fb"] = pid
                        p["publicado_en"] = res
                        guardar(plan)
                        print(f"   FB feed OK   {pid}")
                    except Exception as e:
                        ok = False
                        fallo = True
                        print(f"   ERROR post {p['id']} FB feed: {e}")
                if not res.get("fb_story"):
                    try:
                        spid = con_reintentos(lambda: publicar.publish_fb_story_image(env, imgs[0]), "FB-story")
                        res["fb_story"] = spid
                        p["publicado_en"] = res
                        guardar(plan)
                        print(f"   FB story OK  {spid}")
                    except Exception as e:
                        print(f"   Aviso FB story post {p['id']}: {e}")

        if ok:
            p["estado"] = "publicado"
            p["publicado_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

    guardar(plan)
    if fallo:
        raise SystemExit("Hubo errores al publicar (ver arriba).")


if __name__ == "__main__":
    main()
