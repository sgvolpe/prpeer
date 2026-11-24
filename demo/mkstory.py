import sys
from PIL import Image, ImageDraw, ImageFont

SRC, OUT = sys.argv[1], sys.argv[2]
import os
LANG = os.environ.get('LANG_UI', 'es')  # idioma de los subtítulos; la interfaz de las capturas se elige con LANG_UI en shoot.mjs
CAPS = {
    'es': [
        'Llega un PR: 8 archivos, +220 −4. ¿Por dónde empezás?',
        'refunds.py es riesgoso: lo usan 2 archivos y no tiene tests.',
        'gateway.py lo usa revenue.py, un archivo que nadie tocó.',
        'Acercás y ves el código que cambió, sin salir del mapa.',
        'A nivel módulo: payments y orders concentran el riesgo.',
    ],
    'en': [
        'A PR arrives: 8 files, +220 −4. Where do you start?',
        'refunds.py is risky: 2 files use it and it has no tests.',
        'revenue.py uses gateway.py, a file nobody touched.',
        'Zoom in and see the code that changed, without leaving the map.',
        'At module level: payments and orders concentrate the risk.',
    ],
}[LANG]
scenes = list(zip(['01-vista-general', '02-semaforo', '03-vinculados', '04-zoom-codigo', '05-modulos'], CAPS))
font = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 30)
GW, GH, BAR = 1280, 720, 72

def with_caption(img, text):
    c = Image.new("RGB", (GW, GH + BAR), (15, 20, 27))
    c.paste(img.resize((GW, GH), Image.LANCZOS), (0, 0))
    d = ImageDraw.Draw(c)
    d.rectangle([0, GH, 10, GH + BAR], fill=(240, 160, 48))
    d.text((32, GH + 17), text, font=font, fill=(232, 236, 242))
    return c

frames, durs = [], []
imgs = []
for name, cap in scenes:
    png = Image.open(f"{SRC}/{name}.png").convert("RGB")
    png.save(f"{OUT}/{name}.jpg", quality=88, optimize=True)  # still for the slide
    imgs.append(with_caption(png, cap))
for i, im in enumerate(imgs):
    frames.append(im); durs.append(3200)
    if i + 1 < len(imgs):
        for k in (1, 2, 3):
            frames.append(Image.blend(im, imgs[i + 1], k / 4)); durs.append(90)
pal = [f.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE) for f in frames]
pal[0].save(f"{OUT}/demo-historia.gif", save_all=True, append_images=pal[1:], duration=durs, loop=0, optimize=True)
print(len(frames), "frames")
