import io
import tempfile
import unittest
from pathlib import Path

from beachturnier import load
from beachturnier.cli import Shell

NAMES = "Anna, Ben, Carla, David, Eva, Felix, Gina, Hugo, Anna Lena"


class CliTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "turnier.txt"
        self.answers = []
        self.shell = Shell(self.path, stdout=io.StringIO(), ask=lambda q: self.answers.pop(0))
        self.shell.stdout = io.StringIO()
        self.shell.preloop()

    def tearDown(self):
        self.dir.cleanup()

    def run_cmd(self, line):
        self.shell.stdout = io.StringIO()
        self.shell.onecmd(line)
        return self.shell.stdout.getvalue()

    def t(self):
        return load(self.path)

    def start(self):
        self.run_cmd("spieler " + NAMES)
        self.run_cmd("abwesend anna lena")
        return self.run_cmd("runde Anna+Ben Carla+David Eva+Felix Gina+Hugo")

    def test_full_round(self):
        out = self.start()
        self.assertIn("Court 1:", out)
        self.assertIn("Court 2:", out)
        out = self.run_cmd("res 1 21:18 17:21 15:12")
        self.assertIn("gewinnt 2:1", out)
        self.assertIn("noch offen Court 2", out)
        out = self.run_cmd("res 2 0:2")
        self.assertIn("komplett", out)
        out = self.run_cmd("tabelle")
        self.assertIn("Rangliste nach Runde 1", out)
        self.assertNotIn("Anna Lena", out)  # abwesend und nie gespielt
        self.assertEqual(sum(s.points for s in self.t().standings()), 2 * (2 + 1) + 2 * (0 + 3))

    def test_team_table(self):
        self.start()
        self.run_cmd("res 1 2:0")
        out = self.run_cmd("tabelle teams")
        self.assertIn("Team-Wertung", out)
        self.assertEqual(out.count(" / "), 2)  # nur Court 1 hat ein Resultat
        self.assertIn("Fehler", self.run_cmd("tabelle quatsch"))

    def test_abbreviations_and_ambiguity(self):
        self.run_cmd("spieler " + NAMES)
        self.assertIn("nicht eindeutig", self.run_cmd("abwesend ann"))
        self.run_cmd("abwesend anna l")
        self.assertFalse(next(p for p in self.t().players.values() if p.name == "Anna Lena").active)
        self.assertIn("Kein Spieler", self.run_cmd("abwesend Zorro"))
        self.run_cmd("anwesend anna lena")
        self.run_cmd("abwesend ben carla")
        active = {p.name: p.active for p in self.t().players.values()}
        self.assertEqual((active["Anna Lena"], active["Ben"], active["Carla"]), (True, False, False))

    def test_suggestion_then_round(self):
        self.run_cmd("spieler " + NAMES)
        out = self.run_cmd("vorschlag zufall")
        self.assertIn("Pause:", out)  # 9 Spieler
        out = self.run_cmd("runde")
        self.assertIn("=== Runde 1 ===", out)
        self.assertNotIn("Freilos:", out)  # 9 Spieler -> 4 Teams + 1 Pause
        self.assertEqual(len(self.t().rounds), 1)

    def test_error_does_not_save(self):
        self.start()
        before = self.path.read_text()
        self.assertIn("Fehler", self.run_cmd("res 1 21:21"))
        self.assertIn("Fehler", self.run_cmd("res 7 2:0"))
        self.assertIn("Fehler", self.run_cmd("runde Anna+Ben Carla+David"))  # Runde läuft
        self.assertEqual(self.path.read_text(), before)

    def test_undo(self):
        self.start()
        self.run_cmd("res 1 2:0")
        self.assertIn("Rückgängig", self.run_cmd("undo"))
        self.assertIsNone(self.t().rounds[0].matches[0].result)
        self.run_cmd("undo")  # Runde starten rückgängig
        self.assertEqual(self.t().rounds, [])

    def test_hand_edit_is_picked_up_and_blocks_undo(self):
        self.start()
        self.run_cmd("res 1 2:0")
        text = self.path.read_text().replace("2:0", "0:2")
        self.path.write_text(text + "# von Hand\n")
        out = self.run_cmd("zeigen")
        self.assertIn("0:2", out)
        self.assertIn("von Hand geändert", self.run_cmd("undo"))
        self.assertEqual(self.t().rounds[0].matches[0].result.sets_b, 2)

    def test_broken_file_reports_line(self):
        self.start()
        self.path.write_text(self.path.read_text().replace("Ben", "Bne", 1))
        out = self.run_cmd("tabelle")
        self.assertIn("Fehler in der Turnierdatei", out)
        self.assertIn("Zeile", out)

    def test_swap_with_confirmation(self):
        self.start()
        self.run_cmd("res 1 2:0")
        self.answers = ["n"]
        self.assertIn("Abgebrochen", self.run_cmd("tausch 1a 2a"))
        self.answers = ["j"]
        out = self.run_cmd("tausch 1a 2a")
        self.assertIn("manuell", out)
        self.assertTrue(self.t().current_round.manual)

    def test_correct_older_round(self):
        self.start()
        self.run_cmd("res 1 2:0")
        self.run_cmd("res 2 2:0")
        self.run_cmd("runde Anna+Carla Ben+David Eva+Gina Felix+Hugo")
        self.run_cmd("res r1c1 0:2")
        self.assertEqual(self.t().rounds[0].matches[0].result.sets_b, 2)

    def test_discard_round(self):
        self.start()
        self.run_cmd("res 1 2:0")
        self.answers = ["j"]
        self.assertIn("gelöscht", self.run_cmd("verwerfen"))
        self.assertEqual(self.t().rounds, [])

    def test_empty_line_does_not_repeat(self):
        self.start()
        self.run_cmd("res 1 2:0")
        self.shell.lastcmd = "res 1 0:2"
        self.run_cmd("")
        self.assertEqual(self.t().rounds[0].matches[0].result.sets_a, 2)

    def test_pairing_edited_in_file_is_used(self):
        self.start()
        text = self.path.read_text()
        rnd = self.t().current_round
        self.assertIn("court 1:", text)  # Paarung steht sofort in der Datei
        # Von Hand: Court 1 komplett neu schreiben (andere Teams)
        lines = [l for l in text.splitlines() if l.strip().startswith("court 1:")]
        text = text.replace(lines[0], "  court 1:  Anna / Hugo  vs  Ben / Gina  -")
        lines = [l for l in text.splitlines() if l.strip().startswith("court 2:")]
        text = text.replace(lines[0], "  court 2:  Carla / Eva  vs  David / Felix  -")
        self.path.write_text(text)
        out = self.run_cmd("zeigen")
        self.assertIn("Anna / Hugo", out)
        self.run_cmd("res 1 2:0")
        points = {s.name: s.points for s in self.t().standings()}
        self.assertEqual((points["Anna"], points["Hugo"], points["Ben"]), (3, 3, 0))

    def test_warning_for_unassigned_player(self):
        self.start()
        text = self.path.read_text().replace("Gina / Hugo", "Gina / Anna Lena")
        self.path.write_text(text.replace("Anna Lena (abwesend)", "Anna Lena"))
        out = self.run_cmd("zeigen")
        self.assertIn("Hugo", out.split("Achtung")[1])


if __name__ == "__main__":
    unittest.main()
