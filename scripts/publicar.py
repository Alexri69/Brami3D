#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Publica en Facebook (Pagina: Feed, Reels e Historias) y/o Instagram (Feed, Reels
e Historias) usando la Graph API de Meta (v25.0).
Lee las credenciales de ../.env (no las imprime). Las imagenes y videos deben estar
en URLs publicas (Instagram lo exige); para eso usamos GitHub Pages (app.brami3d.app/m/...).

Uso:
  python scripts/publicar.py --target both --caption "texto" --images URL1 URL2 ...
  python scripts/publicar.py --target both --formato reel --caption "..." --video URL

Con `--incluir-story` (o desde `publicar_hoy.py`), publica ademas en las Historias
(Stories 24h) de Instagram y de la Pagina de Facebook.
"""
import os, json, time, argparse, urllib.parse, urllib.request, urllib.error

API = "https://graph.facebook.com/v25.0"


def load_env():
    """Carga credenciales desde ../.env (local) y/o variables de entorno (CI)."""
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
    for k in (
        "META_ACCESS_TOKEN",
        "META_APP_ID",
        "META_APP_SECRET",
        "META_AD_ACCOUNT_ID",
        "META_PAGE_ID",
        "META_IG_USER_ID",
    ):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


def post(path, data, headers=None):
    body = urllib.parse.urlencode(data).encode() if data is not None else b""
    url = path if path.startswith("http") else f"{API}/{path}"
    req = urllib.request.Request(url, data=body, method="POST", headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode())


def get(path, data):
    url = f"{API}/{path}?" + urllib.parse.urlencode(data)
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode())


def page_token(env):
    r = get("me/accounts", {"fields": "id,access_token", "access_token": env["META_ACCESS_TOKEN"]})
    for pg in r.get("data", []):
        if pg["id"] == env["META_PAGE_ID"]:
            return pg["access_token"]
    raise RuntimeError("No se encontro token de la Pagina en /me/accounts")


def _esperar_procesado(creation_id, tok, timeout=480):
    """IG procesa los contenedores de forma asincrona: esperamos a FINISHED."""
    for _ in range(max(1, timeout // 8)):
        st = get(creation_id, {"fields": "status_code", "access_token": tok})
        code = st.get("status_code")
        if code == "FINISHED":
            return
        if code == "ERROR":
            raise RuntimeError(f"Meta no pudo procesar el medio: {st}")
        time.sleep(8)
    raise RuntimeError("Timeout esperando a que Meta procese el medio")


def publish_ig(env, caption, images):
    ig = env["META_IG_USER_ID"]
    tok = env["META_ACCESS_TOKEN"]
    if len(images) == 1:
        cont = post(f"{ig}/media", {"image_url": images[0], "caption": caption, "access_token": tok})
        creation = cont["id"]
    else:
        child_ids = []
        for u in images:
            c = post(f"{ig}/media", {"image_url": u, "is_carousel_item": "true", "access_token": tok})
            child_ids.append(c["id"])
        cont = post(
            f"{ig}/media",
            {"media_type": "CAROUSEL", "children": ",".join(child_ids), "caption": caption, "access_token": tok},
        )
        creation = cont["id"]
    _esperar_procesado(creation, tok, timeout=180)
    pub = post(f"{ig}/media_publish", {"creation_id": creation, "access_token": tok})
    media_id = pub["id"]
    info = get(f"{media_id}", {"fields": "permalink", "access_token": tok})
    return media_id, info.get("permalink", "")


def publish_ig_story_image(env, image_url):
    """Publica una imagen en las Historias (Stories 24h) de Instagram."""
    ig = env["META_IG_USER_ID"]
    tok = env["META_ACCESS_TOKEN"]
    cont = post(f"{ig}/media", {"media_type": "STORIES", "image_url": image_url, "access_token": tok})
    _esperar_procesado(cont["id"], tok, timeout=180)
    pub = post(f"{ig}/media_publish", {"creation_id": cont["id"], "access_token": tok})
    return pub["id"]


def publish_ig_video(env, caption, video_url, kind="REELS"):
    """kind = 'REELS' (reel + feed) o 'STORIES' (historia 24h)."""
    ig = env["META_IG_USER_ID"]
    tok = env["META_ACCESS_TOKEN"]
    params = {"media_type": kind, "video_url": video_url, "access_token": tok}
    if kind == "REELS":
        params["caption"] = caption
        params["share_to_feed"] = "true"
    cont = post(f"{ig}/media", params)
    _esperar_procesado(cont["id"], tok)
    pub = post(f"{ig}/media_publish", {"creation_id": cont["id"], "access_token": tok})
    mid = pub["id"]
    link = ""
    try:
        link = get(mid, {"fields": "permalink", "access_token": tok}).get("permalink", "")
    except Exception:
        pass
    return mid, link


def publish_fb(env, caption, images):
    page = env["META_PAGE_ID"]
    ptok = page_token(env)
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


def publish_fb_story_image(env, image_url):
    """Publica una imagen en las Historias (Stories 24h) de la Pagina de Facebook."""
    page = env["META_PAGE_ID"]
    ptok = page_token(env)
    ph = post(f"{page}/photos", {"url": image_url, "published": "false", "access_token": ptok})
    r = post(f"{page}/photo_stories", {"photo_id": ph["id"], "access_token": ptok})
    return r.get("post_id") or r.get("id") or ph["id"]


def _esperar_fb_video(video_id, ptok, timeout=300):
    """Espera a que Facebook termine de procesar el video subido."""
    for _ in range(max(1, timeout // 6)):
        try:
            st = get(video_id, {"fields": "status", "access_token": ptok}).get("status", {})
            v_status = st.get("video_status")
            if v_status in ("ready", "published", "complete"):
                return
            if v_status == "error":
                raise RuntimeError(f"FB video error: {st}")
        except urllib.error.HTTPError:
            pass
        time.sleep(6)


def publish_fb_reel(env, caption, video_url):
    """Publica un Reel nativo en la Pagina de Facebook (/{page}/video_reels).
    Si el endpoint de Reels falla, hace fallback automatico a /{page}/videos."""
    page = env["META_PAGE_ID"]
    ptok = page_token(env)
    try:
        init = post(f"{page}/video_reels", {"upload_phase": "start", "access_token": ptok})
        vid = init["video_id"]
        upload_url = init["upload_url"]
        post(upload_url, None, headers={"Authorization": f"OAuth {ptok}", "file_url": video_url})
        _esperar_fb_video(vid, ptok, timeout=240)
        fin = post(
            f"{page}/video_reels",
            {
                "upload_phase": "finish",
                "video_id": vid,
                "video_state": "PUBLISHED",
                "description": caption,
                "access_token": ptok,
            },
        )
        return fin.get("post_id") or vid
    except Exception as e:
        print(f"   Aviso FB video_reels ({e}), subiendo como video de feed...")
        return publish_fb_video(env, caption, video_url)


def publish_fb_story_video(env, video_url):
    """Publica un video en las Historias (Stories 24h) de la Pagina de Facebook."""
    page = env["META_PAGE_ID"]
    ptok = page_token(env)
    init = post(f"{page}/video_stories", {"upload_phase": "start", "access_token": ptok})
    vid = init["video_id"]
    upload_url = init["upload_url"]
    post(upload_url, None, headers={"Authorization": f"OAuth {ptok}", "file_url": video_url})
    _esperar_fb_video(vid, ptok, timeout=240)
    fin = post(f"{page}/video_stories", {"upload_phase": "finish", "video_id": vid, "access_token": ptok})
    return fin.get("post_id") or vid


def publish_fb_video(env, caption, video_url):
    """Sube un video a la Pagina de Facebook (aparece en el feed)."""
    page = env["META_PAGE_ID"]
    ptok = page_token(env)
    r = post(f"{page}/videos", {"file_url": video_url, "description": caption, "access_token": ptok})
    return r.get("id")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["fb", "ig", "both"])
    ap.add_argument("--caption")
    ap.add_argument("--images", nargs="+")
    ap.add_argument("--video", help="URL publica de un video (mp4 H.264)")
    ap.add_argument(
        "--formato",
        choices=["reel", "story", "both", "feed"],
        default="both",
        help="para video: both (reel + story, por defecto), reel, story o feed",
    )
    ap.add_argument("--incluir-story", action="store_true", default=True, help="publicar tambien en Historias")
    ap.add_argument("--job", help="ruta a un JSON con {target, caption, images|video, formato}")
    a = ap.parse_args()
    if a.job:
        with open(a.job, "r", encoding="utf-8") as f:
            j = json.load(f)
        a.target = j.get("target", a.target)
        a.caption = j.get("caption", a.caption)
        a.images = j.get("images", a.images)
        a.video = j.get("video", a.video)
        a.formato = j.get("formato", a.formato)
    if not a.target or a.caption is None or not (a.images or a.video):
        ap.error("faltan target/caption y (images o video) — o usa --job")
    env = load_env()

    if a.video:
        do_reel = a.formato in ("reel", "both", "feed")
        do_story = a.formato in ("story", "both")
        if a.target in ("ig", "both"):
            if do_reel:
                mid, link = publish_ig_video(env, a.caption, a.video, "REELS")
                print(f"INSTAGRAM REELS OK -> media_id={mid}  {link}")
            if do_story:
                sid, _ = publish_ig_video(env, "", a.video, "STORIES")
                print(f"INSTAGRAM STORY OK -> media_id={sid}")
        if a.target in ("fb", "both"):
            if do_reel:
                vid = publish_fb_reel(env, a.caption, a.video)
                print(f"FACEBOOK REEL OK -> id={vid}")
            if do_story:
                try:
                    svid = publish_fb_story_video(env, a.video)
                    print(f"FACEBOOK STORY OK -> id={svid}")
                except Exception as e:
                    print(f"Aviso FACEBOOK STORY: {e}")
    else:
        if a.target in ("ig", "both"):
            mid, link = publish_ig(env, a.caption, a.images)
            print(f"INSTAGRAM FEED OK -> media_id={mid}  {link}")
            if a.incluir_story:
                try:
                    sid = publish_ig_story_image(env, a.images[0])
                    print(f"INSTAGRAM STORY OK -> media_id={sid}")
                except Exception as e:
                    print(f"Aviso INSTAGRAM STORY: {e}")
        if a.target in ("fb", "both"):
            pid, _ = publish_fb(env, a.caption, a.images)
            print(f"FACEBOOK FEED OK  -> post_id={pid}  https://www.facebook.com/{pid}")
            if a.incluir_story:
                try:
                    spid = publish_fb_story_image(env, a.images[0])
                    print(f"FACEBOOK STORY OK -> id={spid}")
                except Exception as e:
                    print(f"Aviso FACEBOOK STORY: {e}")


if __name__ == "__main__":
    main()
