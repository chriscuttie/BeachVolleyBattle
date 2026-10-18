import itertools
import random
import unittest

from beachturnier import pairing


def brute_force(n, cost):
    def rec(items):
        if not items:
            yield 0.0, []
            return
        a, rest = items[0], items[1:]
        for k, b in enumerate(rest):
            for c, pairs in rec(rest[:k] + rest[k + 1 :]):
                yield c + cost(a, b), [(a, b)] + pairs

    return min(c for c, _ in rec(list(range(n))))


class PairingTest(unittest.TestCase):
    def test_exact_matches_brute_force(self):
        rng = random.Random(1)
        for n in (2, 4, 6, 8):
            m = {(i, j): rng.randint(0, 50) for i, j in itertools.combinations(range(n), 2)}
            cost = lambda i, j: m[(min(i, j), max(i, j))]
            pairs = pairing.min_cost_matching(n, cost)
            self.assertEqual(sum(cost(i, j) for i, j in pairs), brute_force(n, cost))

    def test_tie_prefers_neighbours(self):
        self.assertEqual(pairing.min_cost_matching(6, lambda i, j: 0 + 1e-4 * abs(i - j)),
                         [(0, 1), (2, 3), (4, 5)])

    def test_large_uses_local_search(self):
        n = 40
        pairs = pairing.min_cost_matching(n, lambda i, j: (i - j) ** 2)
        self.assertEqual(pairs, [(i, i + 1) for i in range(0, n, 2)])
        self.assertEqual(sorted(x for p in pairs for x in p), list(range(n)))


if __name__ == "__main__":
    unittest.main()
