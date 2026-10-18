import tempfile
import unittest
from pathlib import Path

from beachturnier import Tournament, TournamentError, load, save


def make(n_players=8, **kw):
    t = Tournament(**kw)
    ids = [t.add_player(f"Spieler {i + 1}").id for i in range(n_players)]
    return t, ids


def by_id(t):
    return {s.player_id: s for s in t.standings()}


class TournamentTest(unittest.TestCase):
    def test_points_per_player(self):
        t, p = make(4)
        rnd = t.start_round([(p[0], p[1]), (p[2], p[3])])
        self.assertEqual(len(rnd.matches), 1)
        m = rnd.matches[0]
        t.record_result(m.id, "21:18, 17:21, 15:12")
        s = by_id(t)
        for pid in m.team_a:
            self.assertEqual((s[pid].points, s[pid].wins, s[pid].ball_diff), (2, 1, 2))
        for pid in m.team_b:
            self.assertEqual((s[pid].points, s[pid].losses), (1, 1))

    def test_correction(self):
        t, p = make(4)
        m = t.start_round([(p[0], p[1]), (p[2], p[3])]).matches[0]
        t.record_result(m.id, (2, 1))
        t.record_result(m.id, (0, 2))
        self.assertEqual(by_id(t)[m.team_b[0]].points, 3)

    def test_round_must_be_finished(self):
        t, p = make(4)
        t.start_round([(p[0], p[1]), (p[2], p[3])])
        with self.assertRaises(TournamentError):
            t.start_round([(p[0], p[2]), (p[1], p[3])])

    def test_invalid_teams(self):
        t, p = make(4)
        with self.assertRaises(TournamentError):
            t.start_round([(p[0], p[1]), (p[1], p[2])])
        with self.assertRaises(TournamentError):
            t.start_round([(p[0], p[1]), ("xx", p[2])])
        t.set_active(p[3], False)
        with self.assertRaises(TournamentError):
            t.start_round([(p[0], p[1]), (p[2], p[3])])

    def test_swiss_best_vs_best(self):
        t, p = make(8)
        r1 = t.start_round([(p[0], p[1]), (p[2], p[3]), (p[4], p[5]), (p[6], p[7])])
        for m in r1.matches:
            t.record_result(m.id, "2:0")
        winners = [pid for m in r1.matches for pid in m.team_a]
        losers = [pid for m in r1.matches for pid in m.team_b]
        # Neue Teams: Sieger mit Siegern gemischt, Verlierer mit Verlierern gemischt
        r2 = t.start_round([
            (winners[0], winners[2]), (winners[1], winners[3]),
            (losers[0], losers[2]), (losers[1], losers[3]),
        ])
        top = r2.matches[0]
        self.assertEqual(top.court, 1)
        self.assertEqual(set(top.team_a + top.team_b), set(winners))
        self.assertEqual(set(r2.matches[1].team_a + r2.matches[1].team_b), set(losers))

    def test_rematch_avoided(self):
        t, p = make(8)
        r1 = t.start_round([(p[0], p[1]), (p[2], p[3]), (p[4], p[5]), (p[6], p[7])])
        for m in r1.matches:
            t.record_result(m.id, "2:1")
        # Gleiche Teams nochmals: Score-gleiche Teams, aber alte Gegner sollen nicht wieder kommen
        old = {frozenset((m.team_a, m.team_b)) for m in r1.matches}
        r2 = t.start_round([(p[0], p[1]), (p[2], p[3]), (p[4], p[5]), (p[6], p[7])])
        for m in r2.matches:
            self.assertNotIn(frozenset((m.team_a, m.team_b)), old)

    def test_bye_and_resting(self):
        t, p = make(7, bye_points=2)
        rnd = t.start_round([(p[0], p[1]), (p[2], p[3]), (p[4], p[5])])
        self.assertEqual(len(rnd.matches), 1)
        self.assertIsNotNone(rnd.bye_team)
        self.assertEqual(rnd.resting, [p[6]])
        s = by_id(t)
        for pid in list(rnd.bye_team) + [p[6]]:
            self.assertEqual((s[pid].points, s[pid].byes), (2, 1))

    def test_bye_rotates(self):
        t, p = make(6)
        teams = [(p[0], p[1]), (p[2], p[3]), (p[4], p[5])]
        byes = []
        for _ in range(3):
            rnd = t.start_round(teams)
            byes.append(rnd.bye_team)
            for m in rnd.matches:
                t.record_result(m.id, "2:0")
        self.assertEqual(len(set(byes)), 3)

    def test_inactive_not_resting(self):
        t, p = make(5)
        t.set_active(p[4], False)
        rnd = t.start_round([(p[0], p[1]), (p[2], p[3])])
        self.assertEqual(rnd.resting, [])
        self.assertEqual(by_id(t)[p[4]].points, 0)

    def test_suggest_teams_avoids_repeat_partners(self):
        t, p = make(8)
        partners = set()
        for _ in range(3):
            teams, resting = t.suggest_teams()
            self.assertEqual(resting, [])
            for team in teams:
                self.assertNotIn(frozenset(team), partners)
                partners.add(frozenset(team))
            for m in t.start_round(teams).matches:
                t.record_result(m.id, "2:1")

    def test_suggest_teams_odd(self):
        t, p = make(5)
        teams, resting = t.suggest_teams(mode="balanced")
        self.assertEqual(len(teams), 2)
        self.assertEqual(len(resting), 1)

    def test_cancel_round(self):
        t, p = make(4)
        m = t.start_round([(p[0], p[1]), (p[2], p[3])]).matches[0]
        t.record_result(m.id, "2:0")
        with self.assertRaises(TournamentError):
            t.cancel_round()
        t.cancel_round(force=True)
        self.assertEqual(t.rounds, [])

    def test_remove_player(self):
        t, p = make(5)
        t.remove_player(p[4])
        t.start_round([(p[0], p[1]), (p[2], p[3])])
        with self.assertRaises(TournamentError):
            t.remove_player(p[0])

    def test_persistence_roundtrip(self):
        t, p = make(6)
        rnd = t.start_round([(p[0], p[1]), (p[2], p[3]), (p[4], p[5])])
        t.record_result(rnd.matches[0].id, "21:19, 21:17")
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "turnier.txt"
            save(t, path)
            t2 = load(path)
        self.assertEqual(t2.to_dict(), t.to_dict())
        self.assertEqual([s.to_dict() for s in t2.standings()], [s.to_dict() for s in t.standings()])
        self.assertEqual(t2.add_player("Neu").id, "p7")


if __name__ == "__main__":
    unittest.main()
