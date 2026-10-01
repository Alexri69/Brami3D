#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Renderiza piezas de redes en HTML (uno o varios <div class="slide"> de 1080x1350)
a PNG con Chrome headless y las corta por slides con PIL.

  pieza.html con 1 slide  -> pieza.png
  pieza.html con N slides -> pieza-slide-1.png ... pieza-slide-N.png

Uso:
  python scripts/render_slides.py marketing/octubre            (todas las .html de la carpeta)
  python scripts/render_slides.py marketing/octubre/oct-02.html (solo una)

Falla si algun HTML conserva un placeholder sin sustituir (${...}), para no
repetir el carrusel sin estilos de julio.
"""
import os, re, sys, glob, subprocess, tempfile
from PIL import Image

W, H = 1080, 1350
CHROMES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
]


def chrome():
    for c in CHROMES:
        if os.path.exists(c):
            return c
    raise SystemExit("No encuentro Chrome/Edge")


# Marca en el <body> los slides cuyo contenido invade la franja del pie (marca).
CHECK_JS = """<script>addEventListener('load',()=>{const bad=[];
document.querySelectorAll('.slide').forEach((s,i)=>{const lim=s.getBoundingClientRect().top+s.offsetHeight-110;
s.querySelectorAll('*').forEach(e=>{if(e.closest('.marca')||e.closest('.swipe'))return;
if(e.getBoundingClientRect().bottom>lim+1)bad.push(i+1);});});
document.body.setAttribute('data-desborde',[...new Set(bad)].join(','));});</script>"""


def comprobar_desborde(html_path, src, tmp):
    """Renderiza una copia con CHECK_JS (en la misma carpeta, por las rutas relativas)."""
    copia = os.path.join(os.path.dirname(os.path.abspath(html_path)), "_check_tmp.html")
    open(copia, "w", encoding="utf-8").write(src.replace("</body>", CHECK_JS + "</body>"))
    try:
        dom = subprocess.run([
            chrome(), "--headless=new", "--disable-gpu", "--virtual-time-budget=3000",
            f"--user-data-dir={os.path.join(tmp, 'perfil-check')}",
            f"--window-size={W},{H}", "--dump-dom",
            "file:///" + copia.replace("\\", "/"),
        ], check=True, capture_output=True, timeout=120).stdout.decode("utf-8", "replace")
    finally:
        os.remove(copia)
    m = re.search(r'data-desborde="([^"]*)"', dom)
    if m is None:
        raise SystemExit(f"{html_path}: no se pudo comprobar el desborde")
    if m.group(1):
        raise SystemExit(f"{html_path}: el contenido pisa el pie en slide(s) {m.group(1)}")


def render(html_path):
    src = open(html_path, encoding="utf-8").read()
    if re.search(r"\$\{[A-Z_]+\}", src):
        raise SystemExit(f"{html_path}: placeholder sin sustituir")
    n = len(re.findall(r'class="slide[ "]', src))
    if n == 0:
        raise SystemExit(f"{html_path}: no tiene ningun .slide")
    base = os.path.splitext(html_path)[0]
    with tempfile.TemporaryDirectory() as tmp:
        comprobar_desborde(html_path, src, tmp)
        shot = os.path.join(tmp, "shot.png")
        subprocess.run([
            chrome(), "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--force-device-scale-factor=1", "--virtual-time-budget=3000",
            f"--user-data-dir={os.path.join(tmp, 'perfil')}",
            f"--window-size={W},{H * n}", f"--screenshot={shot}",
            "file:///" + os.path.abspath(html_path).replace("\\", "/"),
        ], check=True, capture_output=True, timeout=120)
        img = Image.open(shot).convert("RGB")
        if img.size != (W, H * n):
            raise SystemExit(f"{html_path}: captura de {img.size}, esperaba {(W, H * n)}")
        outs = [f"{base}.png"] if n == 1 else [f"{base}-slide-{i + 1}.png" for i in range(n)]
        for i, out in enumerate(outs):
            img.crop((0, H * i, W, H * (i + 1))).save(out, optimize=True)
    print(f"OK {os.path.basename(html_path)} -> {n} PNG")
    return outs


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    target = sys.argv[1]
    files = sorted(f for f in glob.glob(os.path.join(target, "*.html")) if not os.path.basename(f).startswith("_")) if os.path.isdir(target) else [target]
    for f in files:
        render(f)


if __name__ == "__main__":
    main()
