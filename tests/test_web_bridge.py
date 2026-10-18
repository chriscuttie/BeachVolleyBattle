"""Tests für web/bridge.py (die Schnittstelle der Browser-Oberfläche), ohne Browser."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "web"))
import bridge  # noqa: E402


def api(action, **kwargs):
    return json.loads(bridge.api(action, json.dumps(kwargs)))


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        bridge.PATH = Path(self.dir.name) / "turnier.txt"
        bridge.start(None)

    def tearDown(self):
        self.dir.cleanup()

    def state(self):
        return json.loads(bridge.state())

    def start4(self):
        api("add_players", names=["A", "B", "C", "D"])
        return api("start_round", teams=[["p1", "p2"], ["p3", "p4"]])

    def test_every_action_returns_json(self):
        self.assertTrue(self.start4()["ok"])
        for name, kwargs in [
            ("record_result", {"match_id": "R1-C1", "result": "21:18 17:21 15:12"}),
            ("clear_result", {"match_id": "R1-C1"}),
            ("swap_teams", {"match_a": "R1-C1", "side_a": "a", "match_b": "R1-C1", "side_b": "b"}),
            ("set_active", {"player_id": "p1", "active": True}),
            ("rename_player", {"player_id": "p1", "name": "Anna"}),
            ("set_name", {"name": "Cup"}),
            ("undo", {}),
            ("cancel_round", {}),
            ("remove_player", {"player_id": "p4"}),
        ]:
            with self.subTest(name=name):
                self.assertTrue(api(name, **kwargs)["ok"])

    def test_errors_are_reported(self):
        self.start4()
        self.assertFalse(api("record_result", match_id="R1-C1", result="21:21")["ok"])
        self.assertFalse(api("remove_player", player_id="p1")["ok"])  # hat schon gespielt
        self.assertFalse(api("add_players", names=["A"])["ok"])  # existiert schon

    def test_state_and_round_flow(self):
        self.start4()
        api("record_result", match_id="R1-C1", result="2:1")
        s = self.state()
        self.assertTrue(s["rounds"][0]["finished"])
        self.assertEqual(s["rounds"][0]["matches"][0]["result"]["points"], [2, 1])
        self.assertEqual({p["name"]: p["points"] for p in s["players"]}, {"A": 2, "B": 2, "C": 1, "D": 1})
        sug = api("suggest", mode="similar")
        self.assertEqual(len(sug["teams"]), 2)
        self.assertTrue(api("start_round", teams=sug["teams"])["ok"])
        s = self.state()
        self.assertEqual(s["rounds"][1]["matches"][0]["strength_a"] + s["rounds"][1]["matches"][0]["strength_b"], 6)

    def test_correct_older_round(self):
        self.start4()
        api("record_result", match_id="R1-C1", result="2:0")
        api("start_round", teams=[["p1", "p3"], ["p2", "p4"]])
        self.assertTrue(api("clear_result", match_id="R1-C1")["ok"])
        self.assertIsNone(self.state()["rounds"][0]["matches"][0]["result"])

    def test_undo_blocked_after_hand_edit(self):
        self.start4()
        api("record_result", match_id="R1-C1", result="2:0")
        bridge.write_file(bridge.read_file() + "\n# von Hand\n")
        self.assertFalse(api("undo")["ok"])

    def test_broken_file(self):
        self.assertTrue(bridge.write_file("spieler:\nA\nrunde 1:\ncourt 1: A / X vs Y / Z\n"))
        self.assertIn("error", self.state())
        self.assertFalse(api("add_players", names=["B"])["ok"])


if __name__ == "__main__":
    unittest.main()
