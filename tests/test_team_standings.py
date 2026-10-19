import unittest

from beachturnier import Tournament


class TeamStandingsTest(unittest.TestCase):
    def setUp(self):
        self.t = Tournament(bye_points=2)
        self.p = {n: self.t.add_player(n).id for n in ["Anna", "Ben", "Carla", "David", "Eva", "Felix"]}

    def team(self, a, b):
        return (self.p[a], self.p[b])

    def by_name(self):
        return {ts.name: ts for ts in self.t.team_standings()}

    def test_only_results_played_together(self):
        t = self.t
        # Runde 1: Anna/Ben schlagen Carla/David 2:1; Eva/Felix Freilos
        r1 = t.start_round([self.team("Anna", "Ben"), self.team("Carla", "David"), self.team("Eva", "Felix")])
        t.record_result(r1.matches[0].id, "21:18 17:21 15:12")
        winner_side = "a" if set(r1.matches[0].team_a) == set(self.team("Anna", "Ben")) else "b"
        if winner_side == "b":  # Resultat ist aus Sicht von team_a
            t.record_result(r1.matches[0].id, "18:21 21:17 12:15")
        # Runde 2: neue Kombinationen; Anna spielt mit Carla
        r2 = t.start_round([self.team("Anna", "Carla"), self.team("Ben", "Eva")])  # David, Felix pausieren
        m = next(x for x in r2.matches if set(self.team("Anna", "Carla")) in (set(x.team_a), set(x.team_b)))
        t.record_result(m.id, "2:0" if set(m.team_a) == set(self.team("Anna", "Carla")) else "0:2")

        teams = self.by_name()
        self.assertEqual(teams["Anna / Ben"].points, 2)
        self.assertEqual(teams["Anna / Ben"].matches, 1)
        self.assertEqual((teams["Anna / Ben"].sets_won, teams["Anna / Ben"].sets_lost), (2, 1))
        self.assertEqual(teams["Anna / Ben"].ball_diff, 2)
        self.assertEqual(teams["Carla / David"].points, 1)
        self.assertEqual(teams["Anna / Carla"].points, 3)
        # Freilos zählt nicht: Eva/Felix hat nie zusammen gespielt
        self.assertNotIn("Eva / Felix", teams)
        # Anna hat als Spielerin 2 + 3 Punkte, die Teams getrennt
        anna = next(s for s in t.standings() if s.name == "Anna")
        self.assertEqual(anna.points, 5)
        self.assertEqual(t.team_standings()[0].name, "Anna / Carla")

    def test_same_team_accumulates_regardless_of_order(self):
        t = self.t
        for _ in range(2):
            r = t.start_round([self.team("Ben", "Anna"), self.team("Carla", "David")])
            anna_ben_is_a = set(r.matches[0].team_a) == set(self.team("Anna", "Ben"))
            t.record_result(r.matches[0].id, "2:0" if anna_ben_is_a else "0:2")
        teams = self.by_name()
        self.assertEqual((teams["Anna / Ben"].points, teams["Anna / Ben"].matches), (6, 2))
        self.assertEqual(teams["Anna / Ben"].rank, 1)
        self.assertEqual(teams["Carla / David"].rank, 2)

    def test_open_matches_not_counted(self):
        self.t.start_round([self.team("Anna", "Ben"), self.team("Carla", "David")])
        self.assertEqual(self.t.team_standings(), [])


if __name__ == "__main__":
    unittest.main()
