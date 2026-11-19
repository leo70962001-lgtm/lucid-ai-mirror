"""App 圖示：把 Gemini 畫的圖示原稿裁成各種尺寸。

用法：py -3 -I tools/icons-from-art.py [原稿，預設 tools/art/koto-icon.jpg]

原稿是 Gemini 產生的 1024×1024 圖：雪花石白的底、梅色的橢圓鏡框與四個取景角標、
鏡中一對莓果色的唇、右上一個空心小圓（Kagami Silk 配色）。這支程式做的事：
  1. 底色校成跟 App 一樣的 #F7F6F3（原稿略偏灰），接近底色的雜點清掉
  2. 找出圖案的範圍，裁成正方形，再依各種圖示的安全範圍縮放、置中
  3. 小尺寸先把線條加粗再縮小，不然 32px 時線會細到看不見

  icon-192.png / icon-512.png   一般圖示（圓角，圖案佔 66%）
  icon-maskable-512.png         Android 自適應圖示（滿版；圖案佔 56%，落在中間的安全圓內）
  apple-touch-icon.png          iOS 主畫面（180，不留透明 —— iOS 自己切圓角）
  favicon-32.png                分頁小圖示（線條加粗）
APK 的啟動圖示與啟動畫面（android-build/lucid-app/make_icons.py）是從這裡的檔案再做出來的。
需要：Pillow、numpy。"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', 'art', 'koto-icon.jpg')
OUT = os.path.join(ROOT, 'icons')
BG = (247, 246, 243)                       # --cream-0

im = Image.open(SRC).convert('RGB')
a = np.asarray(im).astype(np.int16)
h, w, _ = a.shape
corners = np.concatenate([a[:24, :24].reshape(-1, 3), a[:24, -24:].reshape(-1, 3), a[-24:, :24].reshape(-1, 3), a[-24:, -24:].reshape(-1, 3)])
bg0 = np.median(corners, axis=0)
a = np.clip(a + (np.array(BG) - bg0), 0, 255)              # 底色校正
diff = np.abs(a - np.array(BG)).sum(axis=2)
a[diff < 14] = BG                                          # 壓縮留下的雜點
ys, xs = np.where(diff > 60)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
side = max(x1 - x0, y1 - y0)
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
box = (int(round(cx - side / 2)), int(round(cy - side / 2)), int(round(cx + side / 2)), int(round(cy + side / 2)))
art = Image.fromarray(a.astype(np.uint8)).crop(box)        # 只有圖案的正方形
print('原稿 %dx%d，底色 %s → #f7f6f3，圖案 %dx%d' % (w, h, tuple(int(v) for v in bg0), x1 - x0, y1 - y0))


def render(size, k, round_r=0.0, thicken=0):
    """size：邊長；k：圖案佔畫布的比例；round_r：圓角比例（0 = 滿版）；thicken：線條加粗（原稿像素）"""
    src = art.filter(ImageFilter.MinFilter(thicken * 2 + 1)) if thicken else art
    S = size * 4                                            # 4 倍超取樣
    canvas = Image.new('RGB', (S, S), BG)
    n = int(round(S * k))
    canvas.paste(src.resize((n, n), Image.LANCZOS), ((S - n) // 2, (S - n) // 2))
    out = canvas.resize((size, size), Image.LANCZOS).convert('RGBA')
    if round_r > 0:
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * round_r), fill=255)
        out.putalpha(mask.resize((size, size), Image.LANCZOS))
    return out


os.makedirs(OUT, exist_ok=True)
for name, size, k, r, t in [('icon-512.png', 512, 0.66, 0.22, 0), ('icon-192.png', 192, 0.66, 0.22, 2),
                            ('icon-maskable-512.png', 512, 0.56, 0, 0), ('apple-touch-icon.png', 180, 0.68, 0, 2),
                            ('favicon-32.png', 32, 0.9, 0.2, 7)]:
    img = render(size, k, r, t)
    if name == 'apple-touch-icon.png':
        img = img.convert('RGB')
    img.save(os.path.join(OUT, name), optimize=True)
    print('icons/' + name, '%d×%d' % (size, size))
