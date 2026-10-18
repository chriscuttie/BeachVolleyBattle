import unittest

from beachturnier import Tournament, TournamentError, load, save


def setup8(n=8):
    t = Tournament()
    p = [t.add_player(f"S{i + 1}").id for i in range(n)]
    rnd = t.start_round([(p[i], p[i + 1]) for i in range(0, n, 2)])
    return t, p, rnd


def pts(t, pid):
    return next(s.points for s in t.standings() if s.player_id == pid)


class OverrideTest(unittest.TestCase):
    def test_set_pairings_replaces_round(self):
        t, p, _ = setup8()
        rnd = t.set_pairings([((p[0], p[1]), (p[6], p[7])), ((p[2], p[3]), (p[4], p[5]))])
        self.assertTrue(rnd.manual)
        self.assertEqual(rnd.number, 1)
        self.assertEqual(len(t.rounds), 1)
        self.assertEqual([m.id for m in rnd.matches], ["R1-C1", "R1-C2"])
        self.assertEqual(rnd.matches[0].team_b, (p[6], p[7]))

    def test_new_teams_and_bye_and_resting(self):
        t, p, _ = setup8()
        rnd = t.set_pairings([((p[0], p[3]), (p[1], p[2]))], bye_team=(p[4], p[5]))
        self.assertEqual(rnd.bye_team, (p[4], p[5]))
        self.assertEqual(rnd.resting, [p[6], p[7]])

    def test_results_kept_for_unchanged_matches(self):
        t, p, rnd = setup8(12)
        keep = rnd.matches[1]
        t.record_result(keep.id, "21:10, 21:12")
        winner = keep.team_a[0]
        # gleiche Partie, aber Seiten vertauscht und auf anderem Court
        others = [m for m in rnd.matches if m is not keep]
        new = t.set_pairings([(others[0].team_a, others[1].team_a), (keep.team_b, keep.team_a),
                              (others[0].team_b, others[1].team_b)])
        moved = new.matches[1]
        self.assertEqual((moved.result.sets_a, moved.result.sets_b), (0, 2))
        self.assertEqual(moved.result.set_scores, [(10, 21), (12, 21)])
        self.assertEqual(pts(t, winner), 3)

    def test_losing_result_needs_force(self):
        t, p, rnd = setup8()
        t.record_result(rnd.matches[0].id, "2:0")
        a, b = rnd.matches[0].team_a, rnd.matches[0].team_b
        c, d = rnd.matches[1].team_a, rnd.matches[1].team_b
        with self.assertRaises(TournamentError):
            t.set_pairings([(a, c), (b, d)])
        self.assertIs(t.current_round, rnd)  # unverändert
        t.set_pairings([(a, c), (b, d)], force=True)
        self.assertFalse(any(m.finished for m in t.current_round.matches))

    def test_invalid_override(self):
        t, p, _ = setup8()
        with self.assertRaises(TournamentError):
            t.set_pairings([((p[0], p[1]), (p[1], p[2]))])
        with self.assertRaises(TournamentError):
            t.set_pairings([((p[0], p[1]),)])
        with self.assertRaises(TournamentError):
            t.set_pairings([])

    def test_swap_teams(self):
        t, p, rnd = setup8()
        m1, m2 = rnd.matches[0], rnd.matches[1]
        new = t.swap_teams(m1.id, "b", m2.id, "a")
        self.assertEqual(new.matches[0].team_b, m2.team_a)
        self.assertEqual(new.matches[1].team_a, m1.team_b)
        self.assertEqual(new.matches[0].team_a, m1.team_a)

    def test_swap_with_bye(self):
        t = Tournament()
        p = [t.add_player(f"S{i + 1}").id for i in range(6)]
        rnd = t.start_round([(p[0], p[1]), (p[2], p[3]), (p[4], p[5])])
        old_bye, m = rnd.bye_team, rnd.matches[0]
        new = t.swap_teams("bye", "", m.id, "a")
        self.assertEqual(new.bye_team, m.team_a)
        self.assertEqual(new.matches[0].team_a, old_bye)

    def test_manual_flag_persisted(self):
        import tempfile, os
        t, p, rnd = setup8()
        t.swap_teams(rnd.matches[0].id, "a", rnd.matches[0].id, "b")
        with tempfile.TemporaryDirectory() as d:
            save(t, os.path.join(d, "t.txt"))
            self.assertTrue(load(os.path.join(d, "t.txt")).current_round.manual)


if __name__ == "__main__":
    unittest.main()
