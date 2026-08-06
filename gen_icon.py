from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "build", "windows", "icon.ico")
BG = (79, 70, 229)        # #4f46e5 indigo (matches frontend favicon)
FG = (255, 255, 255)
SIZES = [16, 24, 32, 48, 64, 128, 256]

font_path = r"C:\Windows\Fonts\arialbd.ttf"   # Arial Bold -> crisp, thick strokes

def make(size, font_path):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # background rounded rect with small inset
    inset = max(0, int(size * 0.06))
    d.rounded_rectangle(
        [inset, inset, size - inset, size - inset],
        radius=max(1, int(size * 0.18)),
        fill=BG,
    )
    # font: ~64% of canvas for small icons, a bit larger for big ones
    fs = int(size * 0.70) if size <= 64 else int(size * 0.66)
    fnt = ImageFont.truetype(font_path, fs)
    text = "S"
    bbox = d.textbbox((0, 0), text, font=fnt)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    # nudge vertically a touch higher because capital letters sit low in the em box
    y = (size - th) / 2 - bbox[1] - size * 0.02
    d.text((x, y), text, font=fnt, fill=FG)
    return img

imgs = [make(s, font_path) for s in SIZES]
os.makedirs(os.path.dirname(OUT), exist_ok=True)
imgs[0].save(OUT, sizes=[(s, s) for s in SIZES], append_images=imgs[1:])
print("written", OUT, os.path.getsize(OUT), "bytes")
