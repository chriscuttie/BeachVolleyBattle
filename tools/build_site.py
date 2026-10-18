"""Baut die Webseite für GitHub Pages nach _site/ (Webdateien + Python-Paket)."""

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_site"

shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(ROOT / "web", OUT)
pkg = OUT / "beachturnier"
pkg.mkdir()
files = sorted(p.name for p in (ROOT / "beachturnier").glob("*.py") if p.name != "__main__.py")
for name in files:
    shutil.copy(ROOT / "beachturnier" / name, pkg / name)
(pkg / "files.json").write_text(json.dumps(files))
(OUT / ".nojekyll").write_text("")
print(f"Webseite gebaut: {OUT} ({len(files)} Python-Dateien)")
