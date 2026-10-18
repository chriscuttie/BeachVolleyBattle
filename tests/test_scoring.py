import unittest

from beachturnier.models import Result
from beachturnier.scoring import ScoringError, match_points, parse_result, result_from_set_scores


class ScoringTest(unittest.TestCase):
    def test_points(self):
        self.assertEqual(match_points(Result(2, 0)), (3, 0))
        self.assertEqual(match_points(Result(2, 1)), (2, 1))
        self.assertEqual(match_points(Result(1, 2)), (1, 2))
        self.assertEqual(match_points(Result(0, 2)), (0, 3))

    def test_parse_sets_won(self):
        r = parse_result("2:1")
        self.assertEqual((r.sets_a, r.sets_b, r.set_scores), (2, 1, None))

    def test_parse_set_scores(self):
        r = parse_result("21:18, 17:21, 15:12")
        self.assertEqual((r.sets_a, r.sets_b), (2, 1))
        self.assertEqual((r.balls_a, r.balls_b), (53, 51))

    def test_invalid(self):
        for bad in ("1:1", "3:0", "21:21, 21:10", "21:10", "21:10, 21:10, 21:10", "abc"):
            with self.subTest(bad=bad), self.assertRaises(ScoringError):
                parse_result(bad)
        with self.assertRaises(ScoringError):
            result_from_set_scores([(21, -1), (21, 10)])


if __name__ == "__main__":
    unittest.main()
