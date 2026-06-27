#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Panel de metricas de Instagram (@brami3d.app). Muestra seguidores y, por cada
post reciente: likes, comentarios y % de engagement. Si el token tiene el
permiso instagram_manage_insights, anade tambien alcance (reach).

Lee credenciales del .env o de variables de entorno. No imprime el token.
Uso:  python scripts/metricas.py [--n 12]
"""
import os, json, argparse, urllib.parse, urllib.request, urllib.error

API = "https://graph.facebook.com/v25.0"

def env(k):
    if os.environ.get(k):
        return os.environ[k]
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "..", ".env"), encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.startswith(k + "="):
                return line.split("=", 1)[1].strip()
    return None

def get(path, params):
    url = f"{API}/{path}?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"error": json.loads(e.read().decode()).get("error", {})}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=12, help="numero de posts a analizar")
    a = ap.parse_args()
    tok = env("META_ACCESS_TOKEN"); ig = env("META_IG_USER_ID")

    acc = get(ig, {"fields": "username,followers_count,media_count", "access_token": tok})
    foll = acc.get("followers_count", 0) or 1
    print(f"CUENTA @{acc.get('username')}  |  {acc.get('followers_count')} seguidores  |  {acc.get('media_count')} publicaciones\n")

    med = get(f"{ig}/media", {
        "fields": "caption,like_count,comments_count,media_type,timestamp,permalink",
        "limit": a.n, "access_token": tok})
    posts = med.get("data", [])
    if not posts:
        print("Sin posts o error:", med.get("error")); return

    insights_ok = True
    print(f"{'fecha':<11} {'tipo':<9} {'likes':>5} {'coment':>6} {'engage':>7} {'reach':>6}  texto")
    print("-" * 100)
    tot_eng = 0
    for p in posts:
        likes = p.get("like_count", 0); com = p.get("comments_count", 0)
        eng = (likes + com) / foll * 100
        tot_eng += eng
        reach = "-"
        if insights_ok:
            ins = get(f"{p['id']}/insights", {"metric": "reach", "access_token": tok})
            if "error" in ins:
                insights_ok = False  # no hay permiso; dejamos de intentar
            else:
                try: reach = str(ins["data"][0]["values"][0]["value"])
                except Exception: reach = "?"
        fecha = p.get("timestamp", "")[:10]
        txt = (p.get("caption") or "").replace("\n", " ")[:38]
        print(f"{fecha:<11} {p.get('media_type','')[:9]:<9} {likes:>5} {com:>6} {eng:>6.1f}% {reach:>6}  {txt}")

    print("-" * 100)
    print(f"Engagement medio: {tot_eng/len(posts):.2f}% por post ({len(posts)} posts).")
    if not insights_ok:
        print("\n(Alcance/reach no disponible: falta el permiso instagram_manage_insights.)")

if __name__ == "__main__":
    main()
