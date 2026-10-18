"""Paarungsalgorithmen.

Sowohl die Paarung Team-gegen-Team als auch der optionale Team-Vorschlag
(Spieler-mit-Spieler) sind ein "Minimum Cost Perfect Matching": Jedes Element
wird genau einem anderen zugeordnet, sodass die Summe der Kosten minimal ist.

Bis EXACT_LIMIT Elemente wird exakt gelöst (Bitmasken-DP), darüber per
Swiss-Startpaarung + lokaler Verbesserung (Tausch zwischen zwei Paaren).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Callable, Sequence

EXACT_LIMIT = 24  # 24 Teams = 48 Spieler, exakt in < 0.5 s
_EPS = 1e-9


def min_cost_matching(n: int, cost: Callable[[int, int], float]) -> list[tuple[int, int]]:
    """Paart die Indizes 0..n-1 (n gerade) mit minimalen Gesamtkosten.

    Bei gleichen Kosten werden Paare bevorzugt, deren Indizes nahe beieinander
    liegen (die Reihenfolge der Indizes ist also die "Rangliste").
    """
    if n % 2:
        raise ValueError("Anzahl muss gerade sein")
    if n == 0:
        return []
    c = [[cost(i, j) if i != j else 0.0 for j in range(n)] for i in range(n)]
    pairs = _exact(n, c) if n <= EXACT_LIMIT else _local_search(n, c)
    return sorted((min(p), max(p)) for p in pairs)


def _exact(n: int, c: list[list[float]]) -> list[tuple[int, int]]:
    @lru_cache(maxsize=None)
    def solve(mask: int) -> tuple[float, tuple]:
        if mask == 0:
            return 0.0, ()
        i = (mask & -mask).bit_length() - 1
        rest = mask & ~(1 << i)
        best: tuple[float, tuple] | None = None
        j_bits = rest
        while j_bits:
            j = (j_bits & -j_bits).bit_length() - 1
            j_bits &= j_bits - 1
            sub_cost, sub_pairs = solve(rest & ~(1 << j))
            total = sub_cost + c[i][j]
            if best is None or total < best[0] - _EPS:
                best = (total, ((i, j),) + sub_pairs)
        return best  # type: ignore[return-value]

    result = list(solve((1 << n) - 1)[1])
    solve.cache_clear()
    return result


def _local_search(n: int, c: list[list[float]]) -> list[tuple[int, int]]:
    pairs = [(i, i + 1) for i in range(0, n, 2)]
    improved = True
    while improved:
        improved = False
        for x in range(len(pairs)):
            for y in range(x + 1, len(pairs)):
                a, b = pairs[x]
                d, e = pairs[y]
                current = c[a][b] + c[d][e]
                for (p, q), (r, s) in (((a, d), (b, e)), ((a, e), (b, d))):
                    if c[p][q] + c[r][s] < current - _EPS:
                        pairs[x], pairs[y] = (p, q), (r, s)
                        improved = True
                        break
    return pairs


def pick_sit_out(ranked: Sequence, previous_sit_outs: Callable[[object], int]):
    """Wählt bei ungerader Anzahl, wer aussetzt: wer bisher am seltensten
    ausgesetzt hat, bei Gleichstand der Rangletzte."""
    n = len(ranked)
    return min(range(n), key=lambda i: (previous_sit_outs(ranked[i]), n - i))
