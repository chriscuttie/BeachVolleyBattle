"""Datenmodell. Alles ist JSON-serialisierbar (to_dict/from_dict)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

TeamIds = tuple[str, str]


@dataclass
class Player:
    id: str
    name: str
    active: bool = True  # inaktive Spieler (abwesend) werden nicht als "pausierend" gewertet

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "active": self.active}

    @classmethod
    def from_dict(cls, d: dict) -> "Player":
        return cls(id=d["id"], name=d["name"], active=d.get("active", True))


@dataclass
class Result:
    """Ergebnis einer Partie aus Sicht von Team A.

    sets_a/sets_b: gewonnene Sätze (2:0, 2:1, 1:2, 0:2).
    set_scores: optional die Ballpunkte pro Satz, z.B. [(21, 18), (17, 21), (15, 12)].
    """

    sets_a: int
    sets_b: int
    set_scores: Optional[list[tuple[int, int]]] = None

    @property
    def balls_a(self) -> int:
        return sum(a for a, _ in self.set_scores) if self.set_scores else 0

    @property
    def balls_b(self) -> int:
        return sum(b for _, b in self.set_scores) if self.set_scores else 0

    def to_dict(self) -> dict:
        return {
            "sets_a": self.sets_a,
            "sets_b": self.sets_b,
            "set_scores": [list(s) for s in self.set_scores] if self.set_scores else None,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Result":
        scores = d.get("set_scores")
        return cls(
            sets_a=d["sets_a"],
            sets_b=d["sets_b"],
            set_scores=[tuple(s) for s in scores] if scores else None,
        )


@dataclass
class Match:
    id: str
    court: int
    team_a: TeamIds
    team_b: TeamIds
    result: Optional[Result] = None

    @property
    def finished(self) -> bool:
        return self.result is not None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "court": self.court,
            "team_a": list(self.team_a),
            "team_b": list(self.team_b),
            "result": self.result.to_dict() if self.result else None,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Match":
        return cls(
            id=d["id"],
            court=d["court"],
            team_a=tuple(d["team_a"]),
            team_b=tuple(d["team_b"]),
            result=Result.from_dict(d["result"]) if d.get("result") else None,
        )


@dataclass
class Round:
    number: int
    matches: list[Match]
    bye_team: Optional[TeamIds] = None  # Team ohne Gegner (ungerade Anzahl Teams)
    resting: list[str] = field(default_factory=list)  # aktive Spieler ohne Team
    manual: bool = False  # Paarungen von Hand übersteuert

    @property
    def finished(self) -> bool:
        return all(m.finished for m in self.matches)

    @property
    def sitting_out(self) -> list[str]:
        """Alle Spieler, die in dieser Runde ein Freilos bekommen."""
        return list(self.bye_team or ()) + list(self.resting)

    def to_dict(self) -> dict:
        return {
            "number": self.number,
            "matches": [m.to_dict() for m in self.matches],
            "bye_team": list(self.bye_team) if self.bye_team else None,
            "resting": list(self.resting),
            "manual": self.manual,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Round":
        return cls(
            number=d["number"],
            matches=[Match.from_dict(m) for m in d["matches"]],
            bye_team=tuple(d["bye_team"]) if d.get("bye_team") else None,
            resting=list(d.get("resting", [])),
            manual=d.get("manual", False),
        )
