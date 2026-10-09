"""Turns assets/logo.png into icon.ico (used by build_exe.bat when assets/icon.ico does not exist)."""
import os, sys
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, "assets", "logo.png")
dst = os.path.join(here, "icon.ico")
if not os.path.exists(src):
    print("No assets/logo.png found - skipping icon.")
    sys.exit(0)

img = Image.open(src).convert("RGBA")
side = max(img.size)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
square.save(dst, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("Created icon.ico")
