"""Generate SamOffice app icon (white 'S' on brand tile) as a multi-size .ico."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "build", "windows", "icon.ico")


def make(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Brand tile: rounded square with gradient feel (solid brand color)
    pad = int(size * 0.06)
    tile = (pad, pad, size - pad, size - pad)
    brand = (37, 99, 235, 255)  # #2563EB
    d.rounded_rectangle(tile, radius=int(size * 0.18), fill=brand)

    # White 'S'
    font = None
    for path in [
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/calibri.ttf",
    ]:
        if os.path.exists(path):
            font = ImageFont.truetype(path, int(size * 0.66))
            break
    if font is None:
        font = ImageFont.load_default()

    ch = "S"
    bbox = d.textbbox((0, 0), ch, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1]
    d.text((x, y), ch, fill=(255, 255, 255, 255), font=font)
    return img


sizes = [16, 24, 32, 48, 64, 128, 256]
imgs = [make(s) for s in sizes]
os.makedirs(os.path.dirname(OUT), exist_ok=True)
imgs[0].save(OUT, sizes=[(s, s) for s in sizes], format="ICO")
print("wrote", os.path.abspath(OUT))
