"""Baut die Webseite für GitHub Pages nach _site/ (Webdateien + Python-Paket).

Zusätzlich entsteht avatars/index.json mit allen Bildern aus web/avatars/,
weil eine statische Webseite keine Ordner auflisten kann.
"""

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_site"
AVATAR_TYPES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(ROOT / "web", OUT)
pkg = OUT / "beachturnier"
pkg.mkdir()
files = sorted(p.name for p in (ROOT / "beachturnier").glob("*.py") if p.name != "__main__.py")
for name in files:
    shutil.copy(ROOT / "beachturnier" / name, pkg / name)
(pkg / "files.json").write_text(json.dumps(files))

avatars = OUT / "avatars"
avatars.mkdir(exist_ok=True)
images = sorted(p.name for p in avatars.iterdir() if p.suffix.lower() in AVATAR_TYPES)
(avatars / "index.json").write_text(json.dumps(images, ensure_ascii=False))

(OUT / ".nojekyll").write_text("")
print(f"Webseite gebaut: {OUT} ({len(files)} Python-Dateien, {len(images)} Avatare)")
