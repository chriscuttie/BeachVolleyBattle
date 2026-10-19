"""Turnierlogik: Spieler, Runden, Ergebnisse, Rangliste, Paarungen.

Der Punktestand wird nie gespeichert, sondern immer aus den Runden neu
berechnet. Korrekturen alter Ergebnisse wirken sich deshalb sofort auf die
Rangliste aus (bereits erstellte Paarungen bleiben aber unverändert).
"""

from __future__ import annotations

import random
from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence, Union

from . import pairing
from .models import Match, Player, Result, Round, TeamIds
from .scoring import match_points, parse_result, result_from_set_scores, result_from_sets_won

ResultInput = Union[Result, str, Sequence[int], Sequence[Sequence[int]]]


# Diese Zeichen braucht das Textformat als Trennzeichen (siehe textformat.py)
_NAME_FORBIDDEN = "/+:,#()"


class TournamentError(ValueError):
    pass


@dataclass
class Standing:
    rank: int
    player_id: str
    name: str
    active: bool
    points: int = 0
    matches: int = 0
    wins: int = 0
    losses: int = 0
    sets_won: int = 0
    sets_lost: int = 0
    balls_won: int = 0
    balls_lost: int = 0
    byes: int = 0  # Runden ohne Spiel (Freilos-Team oder pausiert)
    buchholz: int = 0  # Summe der aktuellen Punkte aller bisherigen Gegner

    @property
    def set_diff(self) -> int:
        return self.sets_won - self.sets_lost

    @property
    def ball_diff(self) -> int:
        return self.balls_won - self.balls_lost

    def sort_key(self) -> tuple:
        return (-self.points, -self.buchholz, -self.set_diff, -self.ball_diff, self.name.lower())

    def to_dict(self) -> dict:
        return {
            "rank": self.rank,
            "player_id": self.player_id,
            "name": self.name,
            "active": self.active,
            "points": self.points,
            "matches": self.matches,
            "wins": self.wins,
            "losses": self.losses,
            "sets_won": self.sets_won,
            "sets_lost": self.sets_lost,
            "set_diff": self.set_diff,
            "balls_won": self.balls_won,
            "balls_lost": self.balls_lost,
            "ball_diff": self.ball_diff,
            "byes": self.byes,
            "buchholz": self.buchholz,
        }


@dataclass
class TeamStanding:
    """Wertung einer Team-Kombination: nur Partien, die genau diese zwei Spieler
    zusammen gespielt haben (ohne Freilos-/Pausenpunkte)."""

    rank: int
    player_ids: TeamIds
    name: str
    points: int = 0
    matches: int = 0
    wins: int = 0
    losses: int = 0
    sets_won: int = 0
    sets_lost: int = 0
    balls_won: int = 0
    balls_lost: int = 0

    @property
    def set_diff(self) -> int:
        return self.sets_won - self.sets_lost

    @property
    def ball_diff(self) -> int:
        return self.balls_won - self.balls_lost

    def sort_key(self) -> tuple:
        return (-self.points, -self.set_diff, -self.ball_diff, self.matches, self.name.lower())

    def to_dict(self) -> dict:
        return {
            "rank": self.rank,
            "player_ids": list(self.player_ids),
            "name": self.name,
            "points": self.points,
            "matches": self.matches,
            "wins": self.wins,
            "losses": self.losses,
            "sets_won": self.sets_won,
            "sets_lost": self.sets_lost,
            "set_diff": self.set_diff,
            "balls_won": self.balls_won,
            "balls_lost": self.balls_lost,
            "ball_diff": self.ball_diff,
        }


@dataclass
class _History:
    """Wer hat mit/gegen wen gespielt (über alle abgeschlossenen Partien)."""

    opponents: Counter = field(default_factory=Counter)  # frozenset({p, q}) -> Anzahl
    partners: Counter = field(default_factory=Counter)  # frozenset({p, q}) -> Anzahl

    def times_opposed(self, team_a: Iterable[str], team_b: Iterable[str]) -> int:
        return sum(self.opponents[frozenset((p, q))] for p in team_a for q in team_b)


class Tournament:
    def __init__(
        self,
        name: str = "Beachturnier",
        bye_points: int = 2,
        rematch_penalty: float = 10.0,
        partner_penalty: float = 100.0,
    ):
        """
        bye_points: Punkte für Spieler, die eine Runde aussetzen müssen
            (Freilos-Team bei ungerader Teamzahl oder aktiver Spieler ohne Team).
        rematch_penalty: Strafkosten pro früherer Begegnung zweier Spieler als
            Gegner. Zum Vergleich: Punktdifferenz d zwischen zwei Teams kostet d².
        partner_penalty: Strafkosten für wiederholte Partner (nur Team-Vorschlag).
        """
        self.name = name
        self.bye_points = bye_points
        self.rematch_penalty = rematch_penalty
        self.partner_penalty = partner_penalty
        self.players: dict[str, Player] = {}
        self.rounds: list[Round] = []
        self._next_player_no = 1

    # ------------------------------------------------------------------ Spieler

    def add_player(self, name: str) -> Player:
        name = self._check_name(name)
        player = Player(id=f"p{self._next_player_no}", name=name)
        self._next_player_no += 1
        self.players[player.id] = player
        return player

    def rename_player(self, player_id: str, name: str) -> None:
        player = self._player(player_id)
        player.name = self._check_name(name, ignore=player_id)

    def _check_name(self, name: str, ignore: Optional[str] = None) -> str:
        name = " ".join(name.split())
        if not name:
            raise TournamentError("Name darf nicht leer sein")
        bad = set(name) & set(_NAME_FORBIDDEN)
        if bad or "vs" in name.lower().split():
            shown = "".join(sorted(bad)) or "vs"
            raise TournamentError(f"Name {name!r} enthält unerlaubte Zeichen ({shown})")
        if any(p.name.lower() == name.lower() for pid, p in self.players.items() if pid != ignore):
            raise TournamentError(f"Spieler {name!r} existiert bereits")
        return name

    def set_active(self, player_id: str, active: bool) -> None:
        """Abwesende Spieler deaktivieren: sie bekommen kein Freilos und keine Punkte."""
        self._player(player_id).active = active

    def remove_player(self, player_id: str) -> None:
        """Nur möglich, solange der Spieler in keiner Runde vorkommt (sonst deaktivieren)."""
        self._player(player_id)
        if any(player_id in self._players_in_round(r) for r in self.rounds):
            raise TournamentError("Spieler hat bereits gespielt – bitte deaktivieren statt löschen")
        del self.players[player_id]

    def active_players(self) -> list[Player]:
        return [p for p in self.players.values() if p.active]

    # ------------------------------------------------------------------ Runden

    @property
    def current_round(self) -> Optional[Round]:
        return self.rounds[-1] if self.rounds else None

    def start_round(self, teams: Sequence[Sequence[str]]) -> Round:
        """Neue Runde mit den vom Turnierleiter festgelegten Teams starten.

        Das System paart die Teams nach Schweizer System (Teams mit ähnlicher
        Punktzahl gegeneinander, Wiederholungsbegegnungen werden vermieden)
        und weist die Courts zu (Court 1 = stärkste Partie).
        """
        if self.current_round and not self.current_round.finished:
            raise TournamentError(f"Runde {self.current_round.number} ist noch nicht abgeschlossen")
        team_list = self._validate_teams(teams)
        if len(team_list) < 2:
            raise TournamentError("Mindestens zwei Teams nötig")

        standings = {s.player_id: s for s in self.standings()}
        history = self._history()

        def strength(team: TeamIds) -> tuple:
            a, b = standings[team[0]], standings[team[1]]
            return (
                a.points + b.points,
                a.buchholz + b.buchholz,
                a.set_diff + b.set_diff,
                a.ball_diff + b.ball_diff,
            )

        # Stabile Sortierung: bei Gleichstand (z.B. Runde 1) bleibt die Eingabereihenfolge
        ranked = sorted(team_list, key=strength, reverse=True)

        bye_team: Optional[TeamIds] = None
        if len(ranked) % 2:
            idx = pairing.pick_sit_out(ranked, lambda t: standings[t[0]].byes + standings[t[1]].byes)
            bye_team = ranked.pop(idx)

        points = [strength(t)[0] for t in ranked]

        def cost(i: int, j: int) -> float:
            return (
                (points[i] - points[j]) ** 2
                + self.rematch_penalty * history.times_opposed(ranked[i], ranked[j])
                + 1e-4 * abs(i - j)  # Tie-Break: in der Rangliste benachbarte Teams bevorzugen
            )

        pairs = pairing.min_cost_matching(len(ranked), cost)  # nach bestem Team sortiert
        number = len(self.rounds) + 1
        rnd = self._build_round(number, [(ranked[i], ranked[j]) for i, j in pairs], bye_team)
        self.rounds.append(rnd)
        return rnd

    def set_pairings(
        self,
        pairings: Sequence[Sequence[Sequence[str]]],
        bye_team: Optional[Sequence[str]] = None,
        force: bool = False,
    ) -> Round:
        """Paarungen der aktuellen Runde von Hand übersteuern.

        pairings: Liste von (team_a, team_b) in Court-Reihenfolge, z.B.
            [(("p1", "p2"), ("p3", "p4")), (("p5", "p6"), ("p7", "p8"))].
            Die Teams dürfen dabei auch neu zusammengesetzt werden.
        bye_team: optional ein Team mit Freilos.

        Partien, die unverändert bleiben (gleiche zwei Teams), behalten ihr
        Ergebnis – auch wenn sie den Court wechseln. Würde ein bereits
        eingetragenes Ergebnis wegfallen, ist force=True nötig.
        """
        rnd = self.current_round
        if rnd is None:
            raise TournamentError("Es gibt keine Runde")
        for pair in pairings:
            if len(pair) != 2:
                raise TournamentError(f"Paarung {pair!r} muss genau zwei Teams haben")
        flat = [team for pair in pairings for team in pair] + ([bye_team] if bye_team else [])
        teams = self._validate_teams(flat)
        if not pairings:
            raise TournamentError("Mindestens eine Partie nötig")
        new_pairs = [(teams[2 * k], teams[2 * k + 1]) for k in range(len(pairings))]
        new = self._build_round(rnd.number, new_pairs, teams[-1] if bye_team else None)

        old_results = {_matchup_key(m): m for m in rnd.matches if m.result}
        for m in new.matches:
            old = old_results.pop(_matchup_key(m), None)
            if old:
                same_side = frozenset(old.team_a) == frozenset(m.team_a)
                r = old.result
                m.result = r if same_side else Result(r.sets_b, r.sets_a, _flip(r.set_scores))
        if old_results and not force:
            lost = ", ".join(m.id for m in old_results.values())
            raise TournamentError(f"Ergebnisse von {lost} würden verloren gehen – force=True verwenden")

        new.manual = True
        self.rounds[-1] = new
        return new

    def swap_teams(self, match_a: str, side_a: str, match_b: str, side_b: str, force: bool = False) -> Round:
        """Zwei Teams der aktuellen Runde tauschen (z.B. für Drag & Drop im UI).

        match_*: Partie-ID oder "bye" für das Freilos-Team; side_*: "a" oder "b"
        (bei "bye" ignoriert).
        """
        rnd = self.current_round
        if rnd is None:
            raise TournamentError("Es gibt keine Runde")
        slots = [[m.team_a, m.team_b] for m in rnd.matches]
        bye = [rnd.bye_team]
        ids = [m.id for m in rnd.matches]

        def ref(match_id: str, side: str) -> tuple[list, int]:
            if match_id == "bye":
                if rnd.bye_team is None:
                    raise TournamentError("Diese Runde hat kein Freilos-Team")
                return bye, 0
            if side not in ("a", "b"):
                raise TournamentError("side muss 'a' oder 'b' sein")
            if match_id not in ids:
                raise TournamentError(f"Partie {match_id!r} gehört nicht zur aktuellen Runde")
            return slots[ids.index(match_id)], 0 if side == "a" else 1

        (la, ia), (lb, ib) = ref(match_a, side_a), ref(match_b, side_b)
        la[ia], lb[ib] = lb[ib], la[ia]
        for a, b in slots:
            if frozenset(a) == frozenset(b):
                raise TournamentError("Ein Team kann nicht gegen sich selbst spielen")
        return self.set_pairings([tuple(s) for s in slots], bye[0], force=force)

    def cancel_round(self, force: bool = False) -> Round:
        """Letzte Runde verwerfen (z.B. um die Teams neu festzulegen)."""
        rnd = self.current_round
        if rnd is None:
            raise TournamentError("Es gibt keine Runde")
        if not force and any(m.finished for m in rnd.matches):
            raise TournamentError("Runde hat bereits Ergebnisse – mit force=True trotzdem verwerfen")
        return self.rounds.pop()

    def record_result(self, match_id: str, result: ResultInput) -> Match:
        """Ergebnis eintragen oder korrigieren (aus Sicht von team_a).

        Akzeptiert: Result, "2:1", "21:18, 17:21, 15:12", (2, 1),
        [(21, 18), (17, 21), (15, 12)].
        """
        match = self.match(match_id)
        match.result = _to_result(result)
        return match

    def clear_result(self, match_id: str) -> Match:
        match = self.match(match_id)
        match.result = None
        return match

    def match(self, match_id: str) -> Match:
        for rnd in self.rounds:
            for m in rnd.matches:
                if m.id == match_id:
                    return m
        raise TournamentError(f"Partie {match_id!r} existiert nicht")

    # ------------------------------------------------------------------ Auswertung

    def standings(self, before_round: Optional[int] = None) -> list[Standing]:
        """Rangliste. before_round=N: Stand vor Runde N (nur Runden 1..N-1)."""
        rounds = self.rounds if before_round is None else self.rounds[: max(before_round - 1, 0)]
        stats = {
            pid: Standing(rank=0, player_id=pid, name=p.name, active=p.active)
            for pid, p in self.players.items()
        }
        opponents_of: dict[str, list[str]] = {pid: [] for pid in self.players}

        for rnd in rounds:
            for pid in rnd.sitting_out:
                if pid in stats:
                    stats[pid].byes += 1
                    stats[pid].points += self.bye_points
            for m in rnd.matches:
                if not m.result:
                    continue
                r = m.result
                pts_a, pts_b = match_points(r)
                for team, opp, pts, s_won, s_lost, b_won, b_lost in (
                    (m.team_a, m.team_b, pts_a, r.sets_a, r.sets_b, r.balls_a, r.balls_b),
                    (m.team_b, m.team_a, pts_b, r.sets_b, r.sets_a, r.balls_b, r.balls_a),
                ):
                    for pid in team:
                        s = stats[pid]
                        s.points += pts
                        s.matches += 1
                        s.wins += s_won > s_lost
                        s.losses += s_won < s_lost
                        s.sets_won += s_won
                        s.sets_lost += s_lost
                        s.balls_won += b_won
                        s.balls_lost += b_lost
                        opponents_of[pid].extend(opp)

        for pid, opps in opponents_of.items():
            stats[pid].buchholz = sum(stats[o].points for o in opps if o in stats)

        ordered = sorted(stats.values(), key=Standing.sort_key)
        for i, s in enumerate(ordered):
            # Gleicher Rang bei komplett identischen Wertungen
            same = i > 0 and s.sort_key()[:-1] == ordered[i - 1].sort_key()[:-1]
            s.rank = ordered[i - 1].rank if same else i + 1
        return ordered

    def team_standings(self) -> list[TeamStanding]:
        """Rangliste der Team-Kombinationen, die mindestens eine Partie mit
        Resultat zusammen gespielt haben (Reihenfolge der Spieler egal)."""
        teams: dict[frozenset, TeamStanding] = {}
        for rnd in self.rounds:
            for m in rnd.matches:
                if not m.result:
                    continue
                r = m.result
                pts_a, pts_b = match_points(r)
                for team, pts, s_won, s_lost, b_won, b_lost in (
                    (m.team_a, pts_a, r.sets_a, r.sets_b, r.balls_a, r.balls_b),
                    (m.team_b, pts_b, r.sets_b, r.sets_a, r.balls_b, r.balls_a),
                ):
                    key = frozenset(team)
                    if key not in teams:
                        ids = tuple(sorted(team, key=lambda pid: self.players[pid].name.lower()))
                        name = " / ".join(self.players[pid].name for pid in ids)
                        teams[key] = TeamStanding(rank=0, player_ids=ids, name=name)
                    ts = teams[key]
                    ts.points += pts
                    ts.matches += 1
                    ts.wins += s_won > s_lost
                    ts.losses += s_won < s_lost
                    ts.sets_won += s_won
                    ts.sets_lost += s_lost
                    ts.balls_won += b_won
                    ts.balls_lost += b_lost

        ordered = sorted(teams.values(), key=TeamStanding.sort_key)
        for i, ts in enumerate(ordered):
            same = i > 0 and ts.sort_key()[:-1] == ordered[i - 1].sort_key()[:-1]
            ts.rank = ordered[i - 1].rank if same else i + 1
        return ordered

    def suggest_teams(
        self,
        player_ids: Optional[Sequence[str]] = None,
        mode: str = "similar",
        seed: Optional[int] = None,
    ) -> tuple[list[TeamIds], list[str]]:
        """Optionaler Vorschlag für die Teams der nächsten Runde.

        mode="similar":  Spieler mit ähnlichem Rang zusammen (1+2, 3+4, ...)
        mode="balanced": Stark mit schwach (1+n, 2+(n-1), ...)
        mode="random":   Zufällig (z.B. für Runde 1), optional mit seed
        Wiederholte Partner werden vermieden. Bei ungerader Anzahl pausiert
        der Spieler, der bisher am seltensten ausgesetzt hat (bei Gleichstand der Rangletzte).
        Rückgabe: (teams, pausierende Spieler).
        """
        if mode not in ("similar", "balanced", "random"):
            raise TournamentError("mode muss 'similar', 'balanced' oder 'random' sein")
        ids = set(player_ids) if player_ids is not None else {p.id for p in self.active_players()}
        for pid in ids:
            self._player(pid)
        ranked = [s for s in self.standings() if s.player_id in ids]
        resting: list[str] = []
        if len(ranked) % 2:
            idx = pairing.pick_sit_out(ranked, lambda s: s.byes)
            resting.append(ranked.pop(idx).player_id)
        if mode == "random":
            random.Random(seed).shuffle(ranked)

        history = self._history()
        n = len(ranked)

        def cost(i: int, j: int) -> float:
            rank_cost = (i + j - (n - 1)) ** 2 if mode == "balanced" else (i - j) ** 2
            repeats = history.partners[frozenset((ranked[i].player_id, ranked[j].player_id))]
            return rank_cost + self.partner_penalty * repeats

        teams = [
            (ranked[i].player_id, ranked[j].player_id) for i, j in pairing.min_cost_matching(n, cost)
        ]
        return teams, resting

    # ------------------------------------------------------------------ Serialisierung

    def to_dict(self) -> dict:
        return {
            "version": 1,
            "name": self.name,
            "settings": {
                "bye_points": self.bye_points,
                "rematch_penalty": self.rematch_penalty,
                "partner_penalty": self.partner_penalty,
            },
            "next_player_no": self._next_player_no,
            "players": [p.to_dict() for p in self.players.values()],
            "rounds": [r.to_dict() for r in self.rounds],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Tournament":
        t = cls(name=d["name"], **d.get("settings", {}))
        t.players = {p["id"]: Player.from_dict(p) for p in d["players"]}
        t.rounds = [Round.from_dict(r) for r in d["rounds"]]
        t._next_player_no = d.get("next_player_no", len(t.players) + 1)
        return t

    # ------------------------------------------------------------------ intern

    def _player(self, player_id: str) -> Player:
        try:
            return self.players[player_id]
        except KeyError:
            raise TournamentError(f"Spieler {player_id!r} existiert nicht") from None

    def _validate_teams(self, teams: Sequence[Sequence[str]]) -> list[TeamIds]:
        seen: set[str] = set()
        result: list[TeamIds] = []
        for team in teams:
            if len(team) != 2:
                raise TournamentError(f"Team {list(team)} muss genau 2 Spieler haben")
            for pid in team:
                player = self._player(pid)
                if not player.active:
                    raise TournamentError(f"{player.name} ist nicht aktiv")
                if pid in seen:
                    raise TournamentError(f"{player.name} ist in mehreren Teams")
                seen.add(pid)
            result.append((team[0], team[1]))
        return result

    def _history(self) -> _History:
        h = _History()
        for rnd in self.rounds:
            for m in rnd.matches:
                if not m.result:
                    continue
                for team in (m.team_a, m.team_b):
                    h.partners[frozenset(team)] += 1
                for p in m.team_a:
                    for q in m.team_b:
                        h.opponents[frozenset((p, q))] += 1
        return h

    def _build_round(
        self, number: int, pairs: Sequence[tuple[TeamIds, TeamIds]], bye_team: Optional[TeamIds]
    ) -> Round:
        matches = [
            Match(id=f"R{number}-C{court}", court=court, team_a=a, team_b=b)
            for court, (a, b) in enumerate(pairs, start=1)
        ]
        in_teams = {p for a, b in pairs for p in a + b} | set(bye_team or ())
        resting = [p.id for p in self.active_players() if p.id not in in_teams]
        return Round(number=number, matches=matches, bye_team=bye_team, resting=resting)

    @staticmethod
    def _players_in_round(rnd: Round) -> set[str]:
        ids = set(rnd.sitting_out)
        for m in rnd.matches:
            ids.update(m.team_a)
            ids.update(m.team_b)
        return ids


def _matchup_key(m: Match) -> frozenset:
    return frozenset((frozenset(m.team_a), frozenset(m.team_b)))


def _flip(set_scores: Optional[list[tuple[int, int]]]) -> Optional[list[tuple[int, int]]]:
    return [(b, a) for a, b in set_scores] if set_scores else None


def _to_result(value: ResultInput) -> Result:
    if isinstance(value, Result):
        if value.set_scores:
            return result_from_set_scores(value.set_scores)
        return result_from_sets_won(value.sets_a, value.sets_b)
    if isinstance(value, str):
        return parse_result(value)
    items = list(value)
    if len(items) == 2 and all(isinstance(x, int) for x in items):
        return result_from_sets_won(items[0], items[1])
    return result_from_set_scores(items)
