"""圖創區縮圖：python gallery_thumb.py 原圖 縮圖.jpg（長邊 480px、JPEG）"""
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src)
im.load()
im = im.convert("RGB")
im.thumbnail((480, 480))
im.save(dst, "JPEG", quality=82, optimize=True)
