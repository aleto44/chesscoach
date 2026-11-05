# Draws the app icon (a knight on a dark rounded square) to assets/icon.png. Regenerate every
# platform size from it with `npx tauri icon assets/icon.png`.
import sys
from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
BG = (36, 34, 31, 255)      # --panel (dark)
KNIGHT = (111, 191, 138, 255)  # --accent (dark)

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=200, fill=BG)
font = ImageFont.truetype("C:/Windows/Fonts/seguisym.ttf", 760)
glyph = "\u265e"
l, t, r, b = d.textbbox((0, 0), glyph, font=font)
d.text(((SIZE - (r - l)) / 2 - l, (SIZE - (b - t)) / 2 - t), glyph, font=font, fill=KNIGHT)
img.save(sys.argv[1] if len(sys.argv) > 1 else "assets/icon.png")
