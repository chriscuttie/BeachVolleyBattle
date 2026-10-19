import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class BuildSiteTest(unittest.TestCase):
    def test_site_contains_package_and_avatar_index(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "site"
            subprocess.run([sys.executable, str(ROOT / "tools" / "build_site.py"), str(out)],
                           check=True, capture_output=True)
            self.assertTrue((out / "index.html").exists())
            self.assertIn("tournament.py", json.loads((out / "beachturnier" / "files.json").read_text()))
            avatars = json.loads((out / "avatars" / "index.json").read_text())
            expected = sorted(p.name for p in (ROOT / "web" / "avatars").iterdir()
                              if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"})
            self.assertEqual(avatars, expected)


if __name__ == "__main__":
    unittest.main()
