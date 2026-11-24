"""Arma un GIF por clip a partir de la salida de clips.mjs. Uso: python demo/mkclips.py <carpeta de clips> <carpeta de salida>"""
import json, os, sys
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
W, H = 1100, 619  # 16:9, el tamaño que ocupan en la presentación
os.makedirs(OUT, exist_ok=True)
for name in sorted(os.listdir(SRC)):
    mf = os.path.join(SRC, name, "manifest.json")
    if not os.path.exists(mf):
        continue
    frames = json.load(open(mf))
    imgs = [Image.open(os.path.join(SRC, name, x["f"])).convert("RGB").resize((W, H), Image.LANCZOS) for x in frames]
    # FASTOCTREE conserva los colores chicos (rojo, ámbar y verde del semáforo) que MEDIANCUT funde
    pal = [i.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE) for i in imgs]
    out = os.path.join(OUT, f"clip-{name}.gif")
    pal[0].save(out, save_all=True, append_images=pal[1:], duration=[x["ms"] for x in frames], loop=0, optimize=True)
    print(name, len(imgs), "cuadros", round(os.path.getsize(out) / 1e6, 1), "MB")
