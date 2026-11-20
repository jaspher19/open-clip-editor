"""Draw the Glow Card facecam frame (original art, deterministic): a rough cream edge with a warm orange-red glow
around a rounded webcam card, plus the card's rounded-corner mask. Geometry matches CARD in web/src/logic.mjs.

    .venv/Scripts/python.exe scripts/make-cam-card.py
"""
import pathlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'overlays'
W, H = 1080, 660                      # the frame covers the top of the 1080x1920 canvas
X, Y, CW, CH = 100, 48, 880, 544      # the webcam picture inside the card
BORDER, RADIUS = 16, 34


def rounded(size, box, radius, width=None, fill=255):
    im = Image.new('L', size, 0)
    d = ImageDraw.Draw(im)
    if width:
        d.rounded_rectangle(box, radius=radius, outline=fill, width=width)
    else:
        d.rounded_rectangle(box, radius=radius, fill=fill)
    return im


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(6)
    outer = (X - BORDER, Y - BORDER, X + CW - 1 + BORDER, Y + CH - 1 + BORDER)
    # Glow: a wide soft orange-red halo plus a tighter hot orange one.
    ring = rounded((W, H), outer, RADIUS + BORDER, width=10)
    wide = np.asarray(ring.filter(ImageFilter.GaussianBlur(26)), dtype=np.float32) / 255
    tight = np.asarray(ring.filter(ImageFilter.GaussianBlur(9)), dtype=np.float32) / 255
    a_wide, a_tight = np.clip(wide * 3.2, 0, .85), np.clip(tight * 3.0, 0, 1)
    red, orange = np.array([200, 40, 10], np.float32), np.array([255, 120, 30], np.float32)
    rgb = red * (1 - a_tight[..., None]) + orange * a_tight[..., None]
    alpha = np.maximum(a_wide, a_tight)
    # Rough cream edge: the border band with a ragged outer side (burnt-paper look).
    band = np.asarray(rounded((W, H), outer, RADIUS + BORDER), dtype=np.float32) / 255
    inner = np.asarray(rounded((W, H), (X, Y, X + CW - 1, Y + CH - 1), RADIUS), dtype=np.float32) / 255
    noise = Image.fromarray((rng.random((H // 6, W // 6)) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
    noise = np.asarray(noise.filter(ImageFilter.GaussianBlur(2)), dtype=np.float32) / 255
    grown = np.asarray(Image.fromarray((band * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7)), dtype=np.float32) / 255
    edge = np.clip(band + (grown - band) * (noise > .55), 0, 1) * (1 - inner)
    cream = np.array([255, 241, 196], np.float32) * (1 - .12 * noise[..., None])
    rgb = rgb * (1 - edge[..., None]) + cream * edge[..., None]
    alpha = np.maximum(alpha, edge) * (1 - inner)          # the picture shows through the middle
    frame = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
    Image.fromarray(frame, 'RGBA').save(OUT / 'cam-card-frame.png', optimize=True)
    # Mask for the webcam picture itself (rounded corners), slightly larger so no gap shows under the edge.
    rounded((CW, CH), (0, 0, CW - 1, CH - 1), RADIUS + 2).save(OUT / 'cam-card-mask.png', optimize=True)
    print('wrote', OUT / 'cam-card-frame.png', OUT / 'cam-card-mask.png')


if __name__ == '__main__':
    main()
