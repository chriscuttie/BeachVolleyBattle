import tempfile
import unittest
from pathlib import Path

from beachturnier import TextFormatError, Tournament, TournamentError, dumps, load, loads, save

HANDWRITTEN = """
# von Hand geschrieben, unordentlich formatiert
Turnier: Notfall-Turnier
FREILOS-PUNKTE: 2

Spieler:
Anna, Ben, Carla
  David
Eva
Felix (abwesend)

Runde 1:
court 2: eva+anna vs david / BEN  0:2      # Kommentar am Zeilenende
  court 1:  Anna Lena / Carla vs X / Y
"""


def pts(t):
    return {s.name: s.points for s in t.standings()}


class TextFormatTest(unittest.TestCase):
    def test_roundtrip_is_stable(self):
        t = Tournament("Test")
        p = [t.add_player(n).id for n in ["Anna Lena", "Ben", "Carla", "David", "Eva", "Fritz", "Gabi"]]
        t.set_active(p[6], False)
        rnd = t.start_round([(p[0], p[1]), (p[2], p[3]), (p[4], p[5])])
        t.record_result(rnd.matches[0].id, "21:18, 17:21, 15:12")
        t.swap_teams(rnd.matches[0].id, "a", rnd.matches[0].id, "b")
        text = dumps(t)
        t2 = loads(text)
        self.assertEqual(t2.to_dict(), t.to_dict())
        self.assertEqual(dumps(t2), text)
        self.assertIn("runde 1 (manuell):", text)
        self.assertIn("Gabi (abwesend)", text)

    def test_handwritten_file(self):
        text = HANDWRITTEN.replace("Anna Lena / Carla vs X / Y", "Carla / Felix vs Anna Lena / Gabi")
        text = text.replace("Spieler:", "Spieler:\nAnna Lena\nGabi")
        t = loads(text)
        self.assertEqual(t.name, "Notfall-Turnier")
        self.assertFalse(next(p for p in t.players.values() if p.name == "Felix").active)
        rnd = t.rounds[0]
        self.assertEqual([m.court for m in rnd.matches], [1, 2])
        self.assertIsNone(rnd.matches[0].result)  # offen
        self.assertEqual(pts(t)["David"], 3)
        self.assertEqual(pts(t)["Eva"], 0)

    def test_hand_edit_changes_standings(self):
        t = Tournament()
        p = [t.add_player(n).id for n in "ABCD"]
        rnd = t.start_round([(p[0], p[1]), (p[2], p[3])])
        t.record_result(rnd.matches[0].id, "2:0")
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "turnier.txt"
            save(t, path)
            path.write_text(path.read_text().replace("  2:0", "  1:2"), encoding="utf-8")
            t2 = load(path)
        self.assertEqual(pts(t2)["A"], 1)
        self.assertEqual(pts(t2)["C"], 2)

    def test_hand_written_next_round_then_program_continues(self):
        t = loads("spieler: \nA\nB\nC\nD\nrunde 1:\ncourt 1: A/B vs C/D 2:1\n"
                  "runde 2:\ncourt 1: A/C vs B/D 21:10 21:10\n")
        rnd = t.start_round([(t.players["p1"].id, "p4"), ("p2", "p3")])
        self.assertEqual(rnd.number, 3)

    def errors(self, text):
        with self.assertRaises(TextFormatError) as cm:
            loads(text)
        return cm.exception

    def test_error_messages_with_line_numbers(self):
        base = "spieler:\nAnna\nBen\nCarla\nDavid\nrunde 1:\n"
        e = self.errors(base + "court 1: Anna / Ben vs Carla / Dvid 2:0\n")
        self.assertEqual(e.line_no, 7)
        self.assertIn("Dvid", str(e))
        self.assertIn("unbekannt", str(e))
        self.assertIn("mehrfach", str(self.errors(base + "court 1: Anna / Ben vs Carla / Anna\n")))
        self.assertIn("Resultat", str(self.errors(base + "court 1: Anna / Ben vs Carla / David 21:21 2:0\n")))
        self.assertIn("doppelt", str(self.errors(base + "court 1: Anna/Ben vs Carla/David\ncourt 1: Anna/Carla vs Ben/David\n")))
        self.assertIn("vs", str(self.errors(base + "court 1: Anna / Ben gegen Carla / David\n")))
        self.assertIn("Runde 1", str(self.errors(base.replace("runde 1", "runde 2") + "court 1: x\n")))
        self.assertIn("verstanden", str(self.errors(base + "irgendwas\n")))
        self.assertIn("existiert", str(self.errors("spieler:\nAnna\nanna\n")))

    def test_bye_and_pause(self):
        t = loads("spieler:\nA\nB\nC\nD\nE\nF\nG\nrunde 1:\ncourt 1: A/B vs C/D 2:0\n"
                  "freilos: E / F\npause: G\n")
        self.assertEqual(pts(t), {"A": 3, "B": 3, "E": 2, "F": 2, "G": 2, "C": 0, "D": 0})

    def test_forbidden_names(self):
        t = Tournament()
        for bad in ("Anna/Ben", "A:B", "Hans # x", "Paul (jun)", "Peter vs Paul"):
            with self.subTest(bad=bad), self.assertRaises(TournamentError):
                t.add_player(bad)
        self.assertEqual(t.add_player("  Anna   Lena ").name, "Anna Lena")


if __name__ == "__main__":
    unittest.main()
