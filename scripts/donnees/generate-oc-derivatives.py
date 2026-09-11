#!/usr/bin/env python3
"""Generate published/derived visual assets for data/oc/astro-lor.

Converts raw sources into webp reference boards, comic pages, and 512x512 portraits.
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OC_DIR = ROOT / "data" / "oc" / "astro-lor"
SRC_DIR = OC_DIR / "source"

COMICS = [
    ("comic/page-1.webp", "bd-page-1.webp"),
    ("comic/page-2.webp", "bd-page-2.webp"),
    ("comic/page-3.webp", "bd-page-3.webp"),
]

SHEETS = [
    ("sheets/01-og-outfit-yellow.jpg", "planche-og-tenue-jaune.webp"),
    ("sheets/02-og-outfit-soccer.jpg", "planche-og-tenue-foot.webp"),
    ("sheets/03-og-anatomy.jpg", "planche-og-anatomie.webp"),
    ("sheets/04-og-outfit-hakuren.jpg", "planche-og-tenue-hakuren.webp"),
    ("sheets/05-og-expressions.jpg", "planche-og-expressions.webp"),
    ("sheets/06-go-outfit-casual.jpg", "planche-go-tenue-ville.webp"),
    ("sheets/07-go-outfit-soccer.jpg", "planche-go-tenue-foot.webp"),
    ("sheets/08-go-anatomy.jpg", "planche-go-anatomie.webp"),
    ("sheets/09-go-expressions.jpg", "planche-go-expressions.webp"),
]

PORTRAITS = [
    ("sheets/03-og-anatomy.jpg", "face-og.webp", (700, 150, 700 + 900, 150 + 900)),
    ("sheets/08-go-anatomy.jpg", "face-go.webp", (578, 46, 578 + 878, 46 + 878)),
]

def main():
    # 1. Comic pages
    for src_rel, dst_name in COMICS:
        src = SRC_DIR / src_rel
        dst = OC_DIR / dst_name
        if src.is_file():
            img = Image.open(src)
            img.save(dst, "WEBP", quality=90)
            print(f"Written {dst.name} ({dst.stat().st_size} bytes)")

    # 2. Sheets
    for src_rel, dst_name in SHEETS:
        src = SRC_DIR / src_rel
        dst = OC_DIR / dst_name
        if src.is_file():
            img = Image.open(src)
            img.save(dst, "WEBP", quality=85)
            print(f"Written {dst.name} ({dst.stat().st_size} bytes)")

    # 3. Portraits 512x512
    for src_rel, dst_name, crop_box in PORTRAITS:
        src = SRC_DIR / src_rel
        dst = OC_DIR / dst_name
        if src.is_file():
            img = Image.open(src)
            cropped = img.crop(crop_box)
            resized = cropped.resize((512, 512), Image.Resampling.LANCZOS)
            resized.save(dst, "WEBP", quality=92)
            print(f"Written {dst.name} 512x512 ({dst.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
