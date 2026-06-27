#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Publica en Facebook (Pagina) y/o Instagram usando la Graph API de Meta.
Lee las credenciales de ../.env (no las imprime). Las imagenes deben estar
en URLs publicas (Instagram lo exige); para eso usamos GitHub Pages (brami3d.app/m/...).

Uso:
  python scripts/publicar.py --target fb   --caption "texto" --images URL1 URL2 ...
  python scripts/publicar.py --target ig   --caption "texto" --images URL1 URL2 ...
  python scripts/publicar.py --target both --caption "texto" --images URL1 URL2 ...

Una sola imagen = post simple. Varias = carrusel (IG) / post multi-foto (FB).
"""
import os, json, argparse, urllib.parse, urllib.request

API = "https://graph.facebook.com/v25.0"

def load_env():
    """Carga credenciales desde ../.env (local) y/o variables de entorno (CI).
    Las variables de entorno tienen prioridad (asi funciona en GitHub Actions)."""
    here = os.path.dirname(os.path.abspath(__file__))
    env = {}
    env_path = os.path.join(here, "..", ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    for k in ("META_ACCESS_TOKEN", "META_APP_ID", "META_APP_SECRET",
              "META_AD_ACCOUNT_ID", "META_PAGE_ID", "META_IG_USER_ID"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env

def post(path, data):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(f"{API}/{path}", data=body, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode())

def get(path, data):
    url = f"{API}/{path}?" + urllib.parse.urlencode(data)
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode())

def page_token(env):
    r = get("me/accounts", {"fields": "id,access_token", "access_token": env["META_ACCESS_TOKEN"]})
    for pg in r.get("data", []):
        if pg["id"] == env["META_PAGE_ID"]:
            return pg["access_token"]
    raise RuntimeError("No se encontro token de la Pagina en /me/accounts")

def publish_ig(env, caption, images):
    ig = env["META_IG_USER_ID"]; tok = env["META_ACCESS_TOKEN"]
    if len(images) == 1:
        cont = post(f"{ig}/media", {"image_url": images[0], "caption": caption, "access_token": tok})
        creation = cont["id"]
    else:
        child_ids = []
        for u in images:
            c = post(f"{ig}/media", {"image_url": u, "is_carousel_item": "true", "access_token": tok})
            child_ids.append(c["id"])
        cont = post(f"{ig}/media", {"media_type": "CAROUSEL", "children": ",".join(child_ids),
                                    "caption": caption, "access_token": tok})
        creation = cont["id"]
    pub = post(f"{ig}/media_publish", {"creation_id": creation, "access_token": tok})
    media_id = pub["id"]
    info = get(f"{media_id}", {"fields": "permalink", "access_token": tok})
    return media_id, info.get("permalink", "")

def publish_fb(env, caption, images):
    page = env["META_PAGE_ID"]; ptok = page_token(env)
    if len(images) == 1:
        r = post(f"{page}/photos", {"url": images[0], "caption": caption, "access_token": ptok})
        return r.get("post_id") or r.get("id"), ""
    media = []
    for u in images:
        ph = post(f"{page}/photos", {"url": u, "published": "false", "access_token": ptok})
        media.append(ph["id"])
    data = {"message": caption, "access_token": ptok}
    for i, fbid in enumerate(media):
        data[f"attached_media[{i}]"] = json.dumps({"media_fbid": fbid})
    r = post(f"{page}/feed", data)
    return r.get("id"), ""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["fb", "ig", "both"])
    ap.add_argument("--caption")
    ap.add_argument("--images", nargs="+")
    ap.add_argument("--job", help="ruta a un JSON con {target, caption, images}")
    a = ap.parse_args()
    if a.job:
        with open(a.job, "r", encoding="utf-8") as f:
            j = json.load(f)
        a.target, a.caption, a.images = j["target"], j["caption"], j["images"]
    if not (a.target and a.caption and a.images):
        ap.error("faltan target/caption/images (o usa --job)")
    env = load_env()
    if a.target in ("ig", "both"):
        mid, link = publish_ig(env, a.caption, a.images)
        print(f"INSTAGRAM OK -> media_id={mid}  {link}")
    if a.target in ("fb", "both"):
        pid, _ = publish_fb(env, a.caption, a.images)
        print(f"FACEBOOK OK  -> post_id={pid}  https://www.facebook.com/{pid}")

if __name__ == "__main__":
    main()
