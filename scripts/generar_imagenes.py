#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera 40 imágenes PNG para marketing/agosto/ con estilo de marca premium para Brami3D.
"""
import os
import urllib.request
from PIL import Image, ImageDraw, ImageFont

# Dimensiones
WIDTH = 1080
HEIGHT = 1350
MARGIN = 90

# Paleta de colores
COLOR_BG_START = (7, 14, 28)      # #070e1c
COLOR_BG_END = (19, 37, 64)       # #132540
COLOR_TEXT_PRIMARY = "#ffffff"     # #ffffff
COLOR_TEXT_SECONDARY = "#94a3b8"   # #94a3b8
COLOR_ACCENT = "#3b82f6"           # #3b82f6 (azul marca)
COLOR_POSITIVE = "#34d399"         # #34d399 (verde)
COLOR_NEGATIVE = "#f87171"         # #f87171 (rojo)
COLOR_WARNING = "#fbbf24"          # #fbbf24 (ámbar)
COLOR_CARD_BG = (15, 23, 42, 230)  # #0f172a (semi-transparente)

# Directorio de salida
OUTPUT_DIR = "marketing/agosto"
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs("marketing/agosto/fonts", exist_ok=True)

# Descargar fuentes si no existen
FONT_BOLD_PATH = "marketing/agosto/fonts/Montserrat-Bold.ttf"
FONT_REGULAR_PATH = "marketing/agosto/fonts/Montserrat-Regular.ttf"

def download_fonts():
    fonts = {
        FONT_BOLD_PATH: "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat-Bold.ttf",
        FONT_REGULAR_PATH: "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat-Regular.ttf"
    }
    for path, url in fonts.items():
        if not os.path.exists(path):
            try:
                print(f"Descargando fuente desde {url}...")
                urllib.request.urlretrieve(url, path)
            except Exception as e:
                print(f"Error al descargar {path}, usando fuente del sistema: {e}")

download_fonts()

# Cargar fuentes o usar fallbacks de Windows/system
def load_font(weight="regular", size=32):
    if weight == "bold":
        if os.path.exists(FONT_BOLD_PATH):
            return ImageFont.truetype(FONT_BOLD_PATH, size)
        for f in ["segoeuib.ttf", "arialbd.ttf", "HelveticaNeue-Bold.otf"]:
            try: return ImageFont.truetype(f, size)
            except: pass
    else:
        if os.path.exists(FONT_REGULAR_PATH):
            return ImageFont.truetype(FONT_REGULAR_PATH, size)
        for f in ["segoeui.ttf", "arial.ttf", "HelveticaNeue.otf"]:
            try: return ImageFont.truetype(f, size)
            except: pass
    return ImageFont.load_default()

# Cargar fuente de emojis
def load_emoji_font(size=64):
    for f in ["seguiemj.ttf", "AppleColorEmoji.ttf"]:
        try: return ImageFont.truetype(f, size)
        except: pass
    return load_font("regular", size)

# Configuración de fuentes
f_title_large = load_font("bold", 72)
f_title_medium = load_font("bold", 48)
f_body_large = load_font("regular", 42)
f_body_medium = load_font("regular", 36)
f_small = load_font("regular", 28)
f_brand = load_font("bold", 28)
f_emoji = load_emoji_font(72)

def draw_background():
    # 1. Crear degradado lineal suave vertical
    base = Image.new("RGB", (1, HEIGHT), COLOR_BG_START)
    draw_g = ImageDraw.Draw(base)
    for y in range(HEIGHT):
        # Interpolación lineal de colores
        ratio = y / HEIGHT
        r = int(COLOR_BG_START[0] + (COLOR_BG_END[0] - COLOR_BG_START[0]) * ratio)
        g = int(COLOR_BG_START[1] + (COLOR_BG_END[1] - COLOR_BG_START[1]) * ratio)
        b = int(COLOR_BG_START[2] + (COLOR_BG_END[2] - COLOR_BG_START[2]) * ratio)
        draw_g.point((0, y), fill=(r, g, b))
    
    img = base.resize((WIDTH, HEIGHT))
    draw = ImageDraw.Draw(img, "RGBA")
    
    # 2. Dibujar cuadrícula técnica (grid) con azul de baja opacidad
    grid_size = 54
    grid_color = (59, 130, 246, 12)  # #3b82f6 con muy baja opacidad (alrededor de 5%)
    for x in range(0, WIDTH, grid_size):
        draw.line([(x, 0), (x, HEIGHT)], fill=grid_color, width=1)
    for y in range(0, HEIGHT, grid_size):
        draw.line([(0, y), (WIDTH, y)], fill=grid_color, width=1)
        
    return img, draw

def wrap_text(text, font, max_width, draw):
    words = text.split(' ')
    lines = []
    current_line = []
    for word in words:
        test_line = ' '.join(current_line + [word])
        bbox = draw.textbbox((0, 0), test_line, font=font)
        w = bbox[2] - bbox[0]
        if w <= max_width:
            current_line.append(word)
        else:
            lines.append(' '.join(current_line))
            current_line = [word]
    if current_line:
        lines.append(' '.join(current_line))
    return lines

def draw_branding_and_pagination(draw, slide_num=None, total_slides=None, is_closing=False):
    # Marca Brami3D
    draw.text((MARGIN, HEIGHT - MARGIN), "Brami3D", fill=COLOR_TEXT_SECONDARY, font=f_brand)
    
    # Paginación si procede
    if slide_num and total_slides:
        page_str = f"{slide_num}/{total_slides}"
        bbox = draw.textbbox((0, 0), page_str, font=f_small)
        w = bbox[2] - bbox[0]
        draw.text((WIDTH - MARGIN - w, MARGIN), page_str, fill=COLOR_TEXT_SECONDARY, font=f_small)
        
    # Enlace brami3d.app
    if is_closing:
        bbox = draw.textbbox((0, 0), "brami3d.app", font=f_brand)
        w = bbox[2] - bbox[0]
        draw.text((WIDTH - MARGIN - w, HEIGHT - MARGIN), "brami3d.app", fill=COLOR_ACCENT, font=f_brand)

def draw_cover(filename, title, emoji, accent_words=None, accent_color=COLOR_NEGATIVE, total_slides=None):
    img, draw = draw_background()
    draw_branding_and_pagination(draw, 1, total_slides)
    
    # Dibujar gran emoji flotando en el medio arriba
    draw.text((WIDTH // 2, 280), emoji, fill="#fff", font=f_emoji, anchor="mm")
    
    # Título grande centrado
    y_text = 460
    lines = wrap_text(title, f_title_large, WIDTH - MARGIN * 2, draw)
    for line in lines:
        # Dibujar por palabras para resaltar el color de acento
        words = line.split(" ")
        current_x = MARGIN
        for word in words:
            word_to_draw = word + " "
            color = COLOR_TEXT_PRIMARY
            if accent_words:
                cleaned_word = word.strip("¿?¡!.,\"()")
                if any(aw.lower() in cleaned_word.lower() for aw in accent_words):
                    color = accent_color
            draw.text((current_x, y_text), word_to_draw, fill=color, font=f_title_large)
            bbox = draw.textbbox((0, 0), word_to_draw, font=f_title_large)
            current_x += (bbox[2] - bbox[0])
        y_text += 100
        
    # Pista desliza →
    draw.text((WIDTH - MARGIN, HEIGHT - MARGIN), "desliza →", fill=COLOR_ACCENT, font=f_small, anchor="rd")
    
    img.save(os.path.join(OUTPUT_DIR, filename), "PNG")
    print(f"Generado: {filename}")

def draw_content_slide(filename, title, subtitle, box_text, slide_num, total_slides, icon=None):
    img, draw = draw_background()
    draw_branding_and_pagination(draw, slide_num, total_slides)
    
    # Icono y título de la diapositiva
    y_pos = MARGIN + 40
    if icon:
        draw.text((MARGIN, y_pos + 10), icon, font=f_title_medium)
        title_x = MARGIN + 80
    else:
        title_x = MARGIN
        
    draw.text((title_x, y_pos), title, fill=COLOR_TEXT_PRIMARY, font=f_title_medium)
    y_pos += 80
    
    # Subtítulo (texto explicativo corto)
    lines_sub = wrap_text(subtitle, f_body_large, WIDTH - MARGIN * 2, draw)
    for line in lines_sub:
        draw.text((MARGIN, y_pos), line, fill=COLOR_TEXT_PRIMARY, font=f_body_large)
        y_pos += 60
        
    y_pos += 40
    
    # Caja de detalles/contenido (tarjeta Bento)
    if box_text:
        card_y1 = y_pos
        lines_box = wrap_text(box_text, f_body_medium, WIDTH - MARGIN * 2 - 80, draw)
        card_h = len(lines_box) * 52 + 80
        card_y2 = card_y1 + card_h
        
        # Fondo tarjeta redondeado
        draw.rounded_rectangle([MARGIN, card_y1, WIDTH - MARGIN, card_y2], radius=24, fill=COLOR_CARD_BG, outline=COLOR_ACCENT, width=2)
        
        # Texto dentro de la tarjeta
        tx_y = card_y1 + 40
        for line in lines_box:
            draw.text((MARGIN + 40, tx_y), line, fill=COLOR_TEXT_SECONDARY, font=f_body_medium)
            tx_y += 52
            
    img.save(os.path.join(OUTPUT_DIR, filename), "PNG")
    print(f"Generado: {filename}")

def draw_closing_slide(filename, title, subtitle, accent_words=None, accent_color=COLOR_ACCENT, slide_num=None, total_slides=None):
    img, draw = draw_background()
    draw_branding_and_pagination(draw, slide_num, total_slides, is_closing=True)
    
    # Logo Brami3D en el centro
    logo_size = 140
    logo_x = WIDTH // 2
    logo_y = 280
    # Dibujar un bonito badge de logo
    draw.rounded_rectangle([logo_x - logo_size//2, logo_y - logo_size//2, logo_x + logo_size//2, logo_y + logo_size//2], radius=32, fill=COLOR_ACCENT)
    draw.text((logo_x, logo_y), "B3D", fill="#ffffff", font=load_font("bold", 54), anchor="mm")
    
    # Título grande
    y_pos = 450
    lines = wrap_text(title, f_title_large, WIDTH - MARGIN * 2, draw)
    for line in lines:
        words = line.split(" ")
        current_x = MARGIN
        for word in words:
            word_to_draw = word + " "
            color = COLOR_TEXT_PRIMARY
            if accent_words:
                cleaned_word = word.strip("¿?¡!.,\"()")
                if any(aw.lower() in cleaned_word.lower() for aw in accent_words):
                    color = accent_color
            draw.text((current_x, y_pos), word_to_draw, fill=color, font=f_title_large)
            bbox = draw.textbbox((0, 0), word_to_draw, font=f_title_large)
            current_x += (bbox[2] - bbox[0])
        y_pos += 100
        
    y_pos += 40
    
    # Subtítulo / Detalles finales
    lines_sub = wrap_text(subtitle, f_body_large, WIDTH - MARGIN * 2, draw)
    for line in lines_sub:
        draw.text((MARGIN, y_pos), line, fill=COLOR_TEXT_SECONDARY, font=f_body_large)
        y_pos += 60
        
    # Botón/Enlace central destacado
    btn_y = y_pos + 60
    btn_w = 640
    btn_h = 100
    btn_x1 = (WIDTH - btn_w) // 2
    btn_x2 = btn_x1 + btn_w
    
    draw.rounded_rectangle([btn_x1, btn_y, btn_x2, btn_y + btn_h], radius=20, fill=COLOR_ACCENT)
    draw.text((WIDTH // 2, btn_y + btn_h // 2), "Comienza gratis hoy", fill="#ffffff", font=load_font("bold", 36), anchor="mm")
    
    img.save(os.path.join(OUTPUT_DIR, filename), "PNG")
    print(f"Generado: {filename}")

def draw_encuesta_post(filename, title, options):
    img, draw = draw_background()
    draw_branding_and_pagination(draw)
    
    # Título arriba centrado
    y_pos = MARGIN + 40
    lines = wrap_text(title, f_title_large, WIDTH - MARGIN * 2, draw)
    for line in lines:
        draw.text((WIDTH // 2, y_pos), line, fill=COLOR_TEXT_PRIMARY, font=f_title_large, anchor="ma")
        y_pos += 90
        
    y_pos += 50
    
    # 4 opciones estilo tarjetas
    card_h = 130
    gap = 35
    letters = ["A", "B", "C", "D"]
    for i, (emoji, opt_title, opt_desc) in enumerate(options):
        c_y1 = y_pos + i * (card_h + gap)
        c_y2 = c_y1 + card_h
        
        # Dibujar tarjeta de fondo
        draw.rounded_rectangle([MARGIN, c_y1, WIDTH - MARGIN, c_y2], radius=20, fill=COLOR_CARD_BG, outline=COLOR_ACCENT, width=2)
        
        # Dibujar Círculo de Opción (A, B, C, D) en lugar de Emoji
        letter = letters[i] if i < len(letters) else ""
        badge_x = MARGIN + 65
        badge_y = c_y1 + card_h // 2
        draw.ellipse([badge_x - 32, badge_y - 32, badge_x + 32, badge_y + 32], fill=COLOR_ACCENT)
        draw.text((badge_x, badge_y), letter, fill="#ffffff", font=load_font("bold", 34), anchor="mm")
        
        # Dibujar Título de Opción
        draw.text((MARGIN + 150, c_y1 + card_h // 2 - 20), opt_title, fill=COLOR_TEXT_PRIMARY, font=load_font("bold", 36), anchor="lm")
        
        # Dibujar Descripción
        draw.text((MARGIN + 150, c_y1 + card_h // 2 + 22), opt_desc, fill=COLOR_TEXT_SECONDARY, font=f_small, anchor="lm")
        
    img.save(os.path.join(OUTPUT_DIR, filename), "PNG")
    print(f"Generado: {filename}")

def draw_comparison_post(filename, title, left_title, left_points, right_title, right_points):
    img, draw = draw_background()
    draw_branding_and_pagination(draw)
    
    # Título grande arriba
    y_pos = MARGIN + 40
    lines = wrap_text(title, f_title_large, WIDTH - MARGIN * 2, draw)
    for line in lines:
        draw.text((WIDTH // 2, y_pos), line, fill=COLOR_TEXT_PRIMARY, font=f_title_large, anchor="ma")
        y_pos += 95
        
    y_pos += 50
    
    # Dos columnas
    col_w = (WIDTH - MARGIN * 2 - 40) // 2
    col1_x1 = MARGIN
    col1_x2 = col1_x1 + col_w
    col2_x1 = col1_x2 + 40
    col2_x2 = col2_x1 + col_w
    
    # Columna izquierda (ROJA / incorrecto)
    card_h = 580
    draw.rounded_rectangle([col1_x1, y_pos, col1_x2, y_pos + card_h], radius=24, fill=COLOR_CARD_BG, outline=COLOR_NEGATIVE, width=3)
    
    f_col_title = load_font("bold", 30)
    left_title_lines = wrap_text(left_title, f_col_title, col_w - 40, draw)
    title_y1 = y_pos + 40
    for line in left_title_lines:
        draw.text((col1_x1 + col_w // 2, title_y1), line, fill=COLOR_NEGATIVE, font=f_col_title, anchor="ma")
        title_y1 += 38
        
    # Columna derecha (VERDE / correcto)
    draw.rounded_rectangle([col2_x1, y_pos, col2_x2, y_pos + card_h], radius=24, fill=COLOR_CARD_BG, outline=COLOR_POSITIVE, width=3)
    
    right_title_lines = wrap_text(right_title, f_col_title, col_w - 40, draw)
    title_y2 = y_pos + 40
    for line in right_title_lines:
        draw.text((col2_x1 + col_w // 2, title_y2), line, fill=COLOR_POSITIVE, font=f_col_title, anchor="ma")
        title_y2 += 38
        
    # Ajustamos el inicio de los puntos para que empiece debajo del título
    max_title_y = max(title_y1, title_y2) + 20
    
    c1_y = max_title_y
    for p in left_points:
        lines_p = wrap_text(p, f_body_medium, col_w - 60, draw)
        for line in lines_p:
            draw.text((col1_x1 + 30, c1_y), line, fill=COLOR_TEXT_SECONDARY, font=f_body_medium)
            c1_y += 48
        c1_y += 15
        
    c2_y = max_title_y
    for p in right_points:
        lines_p = wrap_text(p, f_body_medium, col_w - 60, draw)
        for line in lines_p:
            draw.text((col2_x1 + 30, c2_y), line, fill=COLOR_TEXT_PRIMARY, font=f_body_medium)
            c2_y += 48
        c2_y += 15
        
    # Flecha o conector al centro
    draw.text((WIDTH // 2, y_pos + card_h // 2), "VS", fill=COLOR_ACCENT, font=load_font("bold", 44), anchor="mm")
    
    img.save(os.path.join(OUTPUT_DIR, filename), "PNG")
    print(f"Generado: {filename}")

def draw_stock_post(filename, title, notification_text):
    img, draw = draw_background()
    draw_branding_and_pagination(draw)
    
    # Título arriba
    y_pos = MARGIN + 40
    lines = wrap_text(title, f_title_large, WIDTH - MARGIN * 2, draw)
    for line in lines:
        draw.text((WIDTH // 2, y_pos), line, fill=COLOR_TEXT_PRIMARY, font=f_title_large, anchor="ma")
        y_pos += 90
        
    # Bobina de filamento estilizada (vector simple en el centro)
    center_x = WIDTH // 2
    center_y = HEIGHT // 2 + 50
    
    # Dibujar bobina de filamento
    draw.ellipse([center_x - 160, center_y - 160, center_x + 160, center_y + 160], fill=COLOR_BG_END, outline=COLOR_TEXT_SECONDARY, width=6)
    draw.ellipse([center_x - 60, center_y - 60, center_x + 60, center_y + 60], fill=COLOR_BG_START, outline=COLOR_TEXT_SECONDARY, width=6)
    
    # Hilos de filamento (círculos concéntricos de baja opacidad)
    for r in range(70, 150, 12):
        draw.ellipse([center_x - r, center_y - r, center_x + r, center_y + r], outline=(59, 130, 246, 60), width=3)
        
    # Alerta tipo popup en ámbar
    popup_w = 480
    popup_h = 110
    popup_x1 = center_x - popup_w // 2
    popup_y1 = center_y + 180
    
    draw.rounded_rectangle([popup_x1, popup_y1, popup_x1 + popup_w, popup_y1 + popup_h], radius=20, fill=COLOR_CARD_BG, outline=COLOR_WARNING, width=3)
    draw.text((center_x, popup_y1 + popup_h // 2), notification_text, fill=COLOR_WARNING, font=load_font("bold", 38), anchor="mm")
    
    img.save(os.path.join(OUTPUT_DIR, filename), "PNG")
    print(f"Generado: {filename}")

def draw_descuento_post(filename, title, text_desc):
    img, draw = draw_background()
    draw_branding_and_pagination(draw)
    
    # Título grande arriba
    y_pos = MARGIN + 40
    lines = wrap_text(title, f_title_large, WIDTH - MARGIN * 2, draw)
    for line in lines:
        draw.text((WIDTH // 2, y_pos), line, fill=COLOR_TEXT_PRIMARY, font=f_title_large, anchor="ma")
        y_pos += 90
        
    # Gráfica en el centro
    g_x1 = MARGIN + 50
    g_y1 = y_pos + 50
    g_x2 = WIDTH - MARGIN - 50
    g_y2 = HEIGHT - MARGIN - 220
    
    # Ejes
    draw.line([(g_x1, g_y2), (g_x2, g_y2)], fill=COLOR_TEXT_SECONDARY, width=4) # X
    draw.line([(g_x1, g_y1), (g_x1, g_y2)], fill=COLOR_TEXT_SECONDARY, width=4) # Y
    
    # Curva de precio bajando (línea azul)
    points = [
        (g_x1 + 40, g_y1 + 50),
        (g_x1 + 180, g_y1 + 120),
        (g_x1 + 350, g_y2 - 120),
        (g_x2 - 40, g_y2 - 60)
    ]
    draw.line(points, fill=COLOR_ACCENT, width=6)
    
    # Línea horizontal roja ("tu coste real")
    coste_y = g_y2 - 150
    draw.line([(g_x1, coste_y), (g_x2, coste_y)], fill=COLOR_NEGATIVE, width=4)
    draw.text((g_x2 - 10, coste_y - 20), "tu coste real", fill=COLOR_NEGATIVE, font=load_font("bold", 28), anchor="rd")
    
    # Texto de advertencia
    y_text = g_y2 + 40
    lines_desc = wrap_text(text_desc, f_body_large, WIDTH - MARGIN * 2, draw)
    for line in lines_desc:
        draw.text((WIDTH // 2, y_text), line, fill=COLOR_TEXT_PRIMARY, font=f_body_large, anchor="ma")
        y_text += 56
        
    img.save(os.path.join(OUTPUT_DIR, filename), "PNG")
    print(f"Generado: {filename}")


# -------------------------------------------------------------------------
# GENERACIÓN DE POSTS
# -------------------------------------------------------------------------

# Post 1 - Carrusel 5 gastos ocultos (6 slides)
print("\n--- Generando Post 1 (Carrusel 5 gastos ocultos) ---")
draw_cover("ago-carrusel-01-slide-1.png", "5 GASTOS OCULTOS que están matando tu margen", "💸", ["GASTOS OCULTOS"], COLOR_NEGATIVE, 6)
draw_content_slide("ago-carrusel-01-slide-2.png", "La luz", "Una impresión de 10 h consume más de lo que crees.", "La electricidad no es despreciable. Una máquina de 200W funcionando de continuo supone un coste directo que debes computar en cada estimación de pieza.", 2, 6)
draw_content_slide("ago-carrusel-01-slide-3.png", "Desgaste", "Boquillas, correas y mantenimiento también cuestan dinero.", "Las boquillas de latón o acero, las correas, los ventiladores y el fusor tienen vida útil limitada. Ese coste de amortización y sustitución debe ir al precio.", 3, 6)
draw_content_slide("ago-carrusel-01-slide-4.png", "Reimpresiones", "Cada fallo es material + tiempo perdido.", "Si 1 de cada 10 impresiones falla (warping, mala adhesión, nudos en bobina), el coste del material tirado y el tiempo de máquina deben ser cubiertos por las piezas exitosas.", 4, 6)
draw_content_slide("ago-carrusel-01-slide-5.png", "Purga y soportes", "Material que tiras en cada pieza.", "El laminador calcula el peso de tu pieza final, pero olvida los soportes, la falda (skirt) y el filamento purgado al cambiar de bobina. Eso también es coste real.", 5, 6)
draw_closing_slide("ago-carrusel-01-slide-6.png", "Brami3D calcula el coste REAL por ti", "Mide con precisión exacta todos tus costes para rentabilizar de verdad tu taller.", ["coste REAL"], COLOR_ACCENT, 6, 6)

# Post 2 - Encuesta cuentas (1 slide)
print("\n--- Generando Post 2 (Encuesta) ---")
draw_encuesta_post("ago-post-02-encuesta.png", "¿Cómo llevas las cuentas de tu taller?", [
    ("📊", "Excel", "Fórmulas complejas y control manual"),
    ("📒", "Libreta", "Apuntes rápidos con riesgo de pérdida"),
    ("🧠", "De cabeza", "A ojo, sin datos reales de beneficio"),
    ("📱", "Una app", "Gestión automatizada con Brami3D")
])

# Post 3 - Carrusel Presupuestos en 2 min (5 slides)
print("\n--- Generando Post 3 (Presupuesto) ---")
draw_cover("ago-carrusel-03-slide-1.png", "Presupuesto PROFESIONAL en 2 minutos", "⏱️", ["PROFESIONAL"], COLOR_ACCENT, 5)
draw_content_slide("ago-carrusel-03-slide-2.png", "1 · Eliges cliente y piezas", "El coste se calcula solo.", "Brami3D recupera automáticamente la tarifa del cliente, los costes del filamento y el consumo de la impresora asignada. Sin cálculos repetitivos.", 2, 5)
draw_content_slide("ago-carrusel-03-slide-3.png", "2 · Añades tu margen", "Y listo: PDF con tu marca.", "Ajustas tu margen de beneficio o mano de obra, y Brami3D maqueta un PDF limpio, profesional y listo para enviar en segundos.", 3, 5)
draw_content_slide("ago-carrusel-03-slide-4.png", "3 · Envías un enlace", "El cliente lo acepta sin llamadas.", "El cliente recibe un enlace interactivo donde puede ver los detalles, aceptar el presupuesto online y subir el justificante de pago.", 4, 5)
draw_closing_slide("ago-carrusel-03-slide-5.png", "Menos WhatsApp, más pedidos cerrados", "Digitaliza tu taller y proyecta una imagen 100% profesional que inspira confianza.", ["pedidos cerrados"], COLOR_ACCENT, 5, 5)

# Post 4 - Tip filamento (1 slide)
print("\n--- Generando Post 4 (Tip filamento) ---")
draw_comparison_post("ago-post-04-filamento.png", "El precio del carrete NO es tu coste",
                     "Solo material", ["Regalas tu luz.", "Regalas tu tiempo.", "Pierdes dinero en cada impresión."],
                     "Material + luz + desgaste + tu tiempo", ["Cobras amortización.", "Cubres consumo eléctrico.", "Valoras tu hora de trabajo."])

# Post 5 - Carrusel ¿Da beneficio? (6 slides)
print("\n--- Generando Post 5 (¿Da beneficio?) ---")
draw_cover("ago-carrusel-05-slide-1.png", "¿Este pedido te dio BENEFICIO de verdad?", "🤔", ["BENEFICIO"], COLOR_POSITIVE, 6)
draw_content_slide("ago-carrusel-05-slide-2.png", "Ingreso", "Lo que cobras al cliente.", "El precio final facturado. Representa la entrada bruta de dinero pero no la realidad de tu bolsillo.", 2, 6)
draw_content_slide("ago-carrusel-05-slide-3.png", "− Material + luz + desgaste", "Gastos operativos fijos.", "El coste de filamento consumido (con mermas), la luz real según consumo de máquina y la amortización del equipo.", 3, 6)
draw_content_slide("ago-carrusel-05-slide-4.png", "− Tu tiempo", "Diseño, post-proceso y gestión.", "El tiempo invertido en preparar el archivo, retirar soportes, empaquetar y comunicarte con el cliente. Valora tu hora.", 4, 6)
draw_content_slide("ago-carrusel-05-slide-5.png", "= Beneficio REAL", "Si sale en rojo, sube la tarifa", "El dinero neto que queda libre para ti. Si tras descontar todo el resultado es negativo, estás perdiendo dinero trabajando.", 5, 6)
draw_closing_slide("ago-carrusel-05-slide-6.png", "Brami3D te lo muestra pedido a pedido", "Conoce la rentabilidad exacta de cada trabajo antes de pulsar el botón de imprimir.", ["pedido a pedido"], COLOR_ACCENT, 6, 6)

# Post 6 - Dolor de cabeza (1 slide)
print("\n--- Generando Post 6 (Dolor) ---")
draw_encuesta_post("ago-post-06-dolor.png", "¿Cuál es tu mayor dolor de cabeza?", [
    ("💶", "Precios", "Saber cuánto cobrar sin pillarte los dedos"),
    ("📦", "Stock", "Quedarte sin filamento a mitad de trabajo"),
    ("🧾", "Facturas", "Llevar la contabilidad y cumplir normas"),
    ("⏰", "Cobros", "Perseguir a clientes despistados para cobrar")
])

# Post 7 - Carrusel Facturar sin miedo (6 slides)
print("\n--- Generando Post 7 (Facturar) ---")
draw_cover("ago-carrusel-07-slide-1.png", "Facturar sin miedo (aunque odies los papeles)", "🧾", ["Facturar sin miedo"], COLOR_ACCENT, 6)
draw_content_slide("ago-carrusel-07-slide-2.png", "Numeración legal y automática", "Sin saltos ni líos.", "Las series de facturas se crean automáticamente en orden cronológico e inalterable, tal como exige la Agencia Tributaria.", 2, 6)
draw_content_slide("ago-carrusel-07-slide-3.png", "VeriFactu", "Registro fiscal encadenado. Cumples la norma.", "Brami3D genera los registros fiscales firmados digitalmente listos para cumplir con la nueva ley VeriFactu de inmediato.", 3, 6)
draw_content_slide("ago-carrusel-07-slide-4.png", "¿Un error? Rectificativa en 2 clics.", "Corrige de forma legal.", "Ya no tendrás que borrar facturas. Genera la rectificativa o anulación correspondiente de forma totalmente limpia y guiada.", 4, 6)
draw_content_slide("ago-carrusel-07-slide-5.png", "Export trimestral para tu gestor", "En un botón.", "Descarga todas tus facturas e ingresos del trimestre en un archivo Excel/CSV perfectamente formateado para enviar a tu gestoría.", 5, 6)
draw_closing_slide("ago-carrusel-07-slide-6.png", "Tú imprime; de lo legal se encarga Brami3D", "Evita multas y dolores de cabeza automatizando toda la facturación de tu taller.", ["se encarga Brami3D"], COLOR_ACCENT, 6, 6)

# Post 8 - Tip stock (1 slide)
print("\n--- Generando Post 8 (Stock) ---")
draw_stock_post("ago-post-08-stock.png", "No te quedes sin filamento a mitad de impresión", "Te quedan 180 g")

# Post 9 - Carrusel Deja el Excel (7 slides)
print("\n--- Generando Post 9 (Deja el Excel) ---")
draw_cover("ago-carrusel-09-slide-1.png", "5 señales de que debes dejar el Excel", "📊", ["dejar el Excel"], COLOR_WARNING, 7)
draw_content_slide("ago-carrusel-09-slide-2.png", "1 · Copias los mismos datos una y otra vez.", "Pérdida de tiempo manual.", "Copiar datos de filamento a presupuesto, y luego a factura, genera errores tipográficos y te quita horas valiosas de taller.", 2, 7)
draw_content_slide("ago-carrusel-09-slide-3.png", "2 · No sabes qué pedido te dio beneficio.", "Falta de claridad real.", "Ves la facturación acumulada, pero no sabes si un pedido complejo ha cubierto de verdad su desgaste y tiempo invertido.", 3, 7)
draw_content_slide("ago-carrusel-09-slide-4.png", "3 · Buscas presupuestos antiguos y no aparecen.", "Caos organizativo.", "Presupuestos guardados en PDF por carpetas o perdidos en chats de WhatsApp. Tardas más en buscar que en redactar uno nuevo.", 4, 7)
draw_content_slide("ago-carrusel-09-slide-5.png", "4 · Haces facturas a mano (y con miedo).", "Riesgo fiscal continuo.", "Cálculos de IVA e IRPF a mano en Word. Riesgo de errores de numeración correlativa y duplicados no permitidos por ley.", 5, 7)
draw_content_slide("ago-carrusel-09-slide-6.png", "5 · No lo puedes mirar desde el móvil.", "Taller no accesible.", "Intentar abrir un Excel complejo con el móvil mientras hablas con un cliente es una pesadilla de usabilidad.", 6, 7)
draw_closing_slide("ago-carrusel-09-slide-7.png", "Brami3D hace todo eso por ti", "Da el salto a una gestión moderna y automatizada diseñada por y para makers.", ["Brami3D"], COLOR_ACCENT, 7, 7)

# Post 10 - Tip descuentos (1 slide)
print("\n--- Generando Post 10 (Tip descuentos) ---")
draw_descuento_post("ago-post-10-descuento.png", "Descuentos por volumen SÍ, pero con límites", "Descuento por volumen SÍ, pero nunca por debajo de tu coste real.")

# Post 11 - Carrusel Cierre de mes (5 slides)
print("\n--- Generando Post 11 (Cierre de mes) ---")
draw_cover("ago-carrusel-11-slide-1.png", "Tu taller 3D, bajo control", "🚀", ["bajo control"], COLOR_ACCENT, 5)
draw_content_slide("ago-carrusel-11-slide-2.png", "Pedidos, clientes y presupuestos en un sitio.", "Todo organizado en la nube.", "Accede desde el móvil o el ordenador. Registra el estado de tus piezas y mantén informados a tus clientes automáticamente.", 2, 5)
draw_content_slide("ago-carrusel-11-slide-3.png", "Sabes qué ganas en cada trabajo.", "Rentabilidad bajo lupa.", "Sin aproximaciones a ojo. Brami3D analiza tus bobinas y luz para darte el margen exacto de beneficio en tiempo real.", 3, 5)
draw_content_slide("ago-carrusel-11-slide-4.png", "Facturas legales sin dolores de cabeza.", "Cumplimiento 100% VeriFactu.", "Genera y envía facturas que cumplen con la ley de forma transparente y sin necesidad de gestores para las facturas básicas.", 4, 5)
draw_closing_slide("ago-carrusel-11-slide-5.png", "30 días Pro GRATIS · sin tarjeta", "Prueba la versión Pro gratis sin compromiso de tarjeta. Configura tu taller en 5 minutos.", ["30 días Pro GRATIS"], COLOR_ACCENT, 5, 5)

print("\n--- ¡Generación de imágenes finalizada con éxito! ---")
