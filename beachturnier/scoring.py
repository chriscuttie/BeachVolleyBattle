"""Auswertung von Partien: Validierung und Punktevergabe."""

from __future__ import annotations

import re
from typing import Iterable, Sequence

from .models import Result

# (Sätze A, Sätze B) -> (Punkte A, Punkte B)
MATCH_POINTS: dict[tuple[int, int], tuple[int, int]] = {
    (2, 0): (3, 0),
    (2, 1): (2, 1),
    (1, 2): (1, 2),
    (0, 2): (0, 3),
}


class ScoringError(ValueError):
    pass


def result_from_sets_won(sets_a: int, sets_b: int) -> Result:
    """Ergebnis nur mit Satzstand, z.B. 2:1 (ohne Ballpunkte)."""
    if (sets_a, sets_b) not in MATCH_POINTS:
        raise ScoringError(f"Ungültiger Satzstand {sets_a}:{sets_b} (erlaubt: 2:0, 2:1, 1:2, 0:2)")
    return Result(sets_a, sets_b)


def result_from_set_scores(set_scores: Iterable[Sequence[int]]) -> Result:
    """Ergebnis aus Ballpunkten pro Satz, z.B. [(21, 18), (17, 21), (15, 12)]."""
    scores: list[tuple[int, int]] = []
    sets_a = sets_b = 0
    for raw in set_scores:
        if len(raw) != 2:
            raise ScoringError(f"Satz {raw!r} muss genau zwei Werte haben")
        a, b = raw
        if not (isinstance(a, int) and isinstance(b, int)) or a < 0 or b < 0:
            raise ScoringError(f"Satz {raw!r}: Punkte müssen ganze Zahlen >= 0 sein")
        if a == b:
            raise ScoringError(f"Satz {a}:{b} hat keinen Sieger")
        if sets_a == 2 or sets_b == 2:
            raise ScoringError("Nach zwei gewonnenen Sätzen ist die Partie entschieden")
        if a > b:
            sets_a += 1
        else:
            sets_b += 1
        scores.append((a, b))
    if max(sets_a, sets_b) != 2:
        raise ScoringError("Partie ist nicht entschieden (ein Team braucht 2 Satzgewinne)")
    return Result(sets_a, sets_b, scores)


def parse_result(text: str) -> Result:
    """Text-Eingabe parsen.

    "2:1"                  -> nur Satzstand
    "21:18, 17:21, 15:12"  -> Ballpunkte pro Satz
    """
    parts = [p for p in re.split(r"[,;\s]+", text.strip()) if p]
    pairs = []
    for p in parts:
        m = re.fullmatch(r"(\d+)[:\-](\d+)", p)
        if not m:
            raise ScoringError(f"Kann {p!r} nicht lesen (Format z.B. 21:18)")
        pairs.append((int(m.group(1)), int(m.group(2))))
    if len(pairs) == 1 and max(pairs[0]) <= 2:
        return result_from_sets_won(*pairs[0])
    return result_from_set_scores(pairs)


def match_points(result: Result) -> tuple[int, int]:
    return MATCH_POINTS[(result.sets_a, result.sets_b)]
