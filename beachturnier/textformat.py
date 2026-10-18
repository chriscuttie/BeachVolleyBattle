"""Textformat der Turnierdatei – die einzige Quelle der Wahrheit.

Die Datei ist so aufgebaut, dass man sie im Notfall von Hand lesen, korrigieren
oder sogar ganz ohne Programm weiterführen kann:

    turnier: Sommer-Beachturnier
    freilos-punkte: 2

    spieler:
      Anna
      Ben
      Hugo (abwesend)

    runde 1:
      court 1:  Anna / Ben     vs  Carla / David    21:18 17:21 15:12
      court 2:  Eva / Felix    vs  Gina / Hugo      2:0
      freilos:  Ida / Jonas
      pause:    Kurt

- Resultat aus Sicht des ersten Teams: Ballpunkte pro Satz oder nur Sätze ("2:1").
  "-" oder nichts = noch offen.
- Teams mit "/" oder "+" trennen, Gegner mit "vs".
- "freilos" = Team ohne Gegner, "pause" = Spieler ohne Team. Beide bekommen die
  Freilos-Punkte; wer hier nicht steht, bekommt für die Runde nichts.
- "#" leitet einen Kommentar ein. Einrückung und Gross-/Kleinschreibung der
  Schlüsselwörter sind egal.
"""

from __future__ import annotations

import re
from typing import Optional

from .models import Match, Round, TeamIds
from .scoring import ScoringError, parse_result
from .tournament import Tournament, TournamentError

HEADER = """\
# Beachturnier – diese Datei ist die einzige Quelle der Wahrheit.
# Sie darf von Hand bearbeitet werden; das Programm liest sie vor jeder Aktion neu.
# Achtung: eigene Kommentare (#) gehen beim nächsten Speichern durch das Programm verloren.
#
# Resultat aus Sicht des ersten Teams: "21:18 17:21 15:12" oder nur Sätze "2:1"; "-" = offen.
# freilos = Team ohne Gegner, pause = Spieler ohne Team (beide bekommen die Freilos-Punkte).
"""

_SETTINGS = {
    "freilos-punkte": ("bye_points", int),
    "rematch-strafe": ("rematch_penalty", float),
    "partner-strafe": ("partner_penalty", float),
}
_ROUND_RE = re.compile(r"runde\s+(\d+)\s*(\(\s*manuell\s*\))?\s*:", re.I)
_COURT_RE = re.compile(r"court\s+(\d+)\s*:(.*)", re.I)
_KEY_RE = re.compile(r"([a-zäöü\-]+)\s*:(.*)", re.I)
_RESULT_TAIL_RE = re.compile(r"^(.*?)\s*((?:\d+\s*:\s*\d+[\s,;]*)+|-)?$")


class TextFormatError(TournamentError):
    def __init__(self, line_no: int, line: str, message: str):
        super().__init__(f"Zeile {line_no}: {message}\n    {line.strip()}")
        self.line_no = line_no


# ---------------------------------------------------------------------- schreiben


def dumps(t: Tournament) -> str:
    name = lambda pid: t.players[pid].name
    team = lambda ids: f"{name(ids[0])} / {name(ids[1])}"

    out = [HEADER, f"turnier: {t.name}"]
    out.append(f"freilos-punkte: {t.bye_points}")
    out.append(f"rematch-strafe: {_num(t.rematch_penalty)}")
    out.append(f"partner-strafe: {_num(t.partner_penalty)}")

    out += ["", "spieler:"]
    for p in t.players.values():
        out.append(f"  {p.name}" + ("" if p.active else " (abwesend)"))

    for rnd in t.rounds:
        out += ["", f"runde {rnd.number}" + (" (manuell)" if rnd.manual else "") + ":"]
        width_a = max((len(team(m.team_a)) for m in rnd.matches), default=0)
        width_b = max((len(team(m.team_b)) for m in rnd.matches), default=0)
        for m in sorted(rnd.matches, key=lambda m: m.court):
            line = (
                f"  court {m.court}:  {team(m.team_a):<{width_a}}  vs  "
                f"{team(m.team_b):<{width_b}}  {_result_text(m)}"
            )
            out.append(line)
        if rnd.bye_team:
            out.append(f"  freilos:  {team(rnd.bye_team)}")
        if rnd.resting:
            out.append(f"  pause:    {', '.join(name(p) for p in rnd.resting)}")
    return "\n".join(out) + "\n"


def _result_text(m: Match) -> str:
    r = m.result
    if r is None:
        return "-"
    if r.set_scores:
        return " ".join(f"{a}:{b}" for a, b in r.set_scores)
    return f"{r.sets_a}:{r.sets_b}"


def _num(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else str(x)


# ---------------------------------------------------------------------- lesen


def loads(text: str) -> Tournament:
    name = "Beachturnier"
    settings: dict = {}
    players: list[tuple[str, bool, int, str]] = []  # (name, aktiv, zeile, rohtext)
    rounds: list[dict] = []
    section: Optional[str] = None

    for line_no, raw in enumerate(text.splitlines(), start=1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        err = lambda msg: TextFormatError(line_no, raw, msg)

        if m := _ROUND_RE.fullmatch(line):
            number = int(m.group(1))
            if number != len(rounds) + 1:
                raise err(f"Runde {number} erwartet, aber Runde {len(rounds) + 1} wäre die nächste")
            rounds.append(
                {"number": number, "manual": bool(m.group(2)), "matches": [], "bye": None,
                 "resting": None, "line_no": line_no, "raw": raw}
            )
            section = "runde"
            continue
        if line.lower() == "spieler:":
            section = "spieler"
            continue
        if m := _COURT_RE.fullmatch(line):
            if section != "runde":
                raise err("'court' gehört unter eine 'runde N:'-Zeile")
            rounds[-1]["matches"].append((int(m.group(1)), m.group(2), line_no, raw))
            continue
        if m := _KEY_RE.fullmatch(line):
            key, value = m.group(1).lower(), m.group(2).strip()
            if key == "turnier":
                name = value
                continue
            if key in _SETTINGS:
                attr, conv = _SETTINGS[key]
                try:
                    settings[attr] = conv(value)
                except ValueError:
                    raise err(f"'{value}' ist keine Zahl") from None
                continue
            if key in ("freilos", "pause"):
                if section != "runde":
                    raise err(f"'{key}' gehört unter eine 'runde N:'-Zeile")
                slot = "bye" if key == "freilos" else "resting"
                if rounds[-1][slot] is not None:
                    raise err(f"'{key}' kommt in dieser Runde doppelt vor")
                rounds[-1][slot] = (value, line_no, raw)
                continue
            raise err(f"Unbekanntes Schlüsselwort '{key}'")
        if section == "spieler":
            for entry in line.split(","):
                entry = entry.strip()
                active = True
                if m := re.fullmatch(r"(.*?)\s*\(\s*abwesend\s*\)", entry, re.I):
                    entry, active = m.group(1), False
                if entry:
                    players.append((entry, active, line_no, raw))
            continue
        raise TextFormatError(line_no, raw, "Zeile nicht verstanden")

    t = Tournament(name=name, **settings)
    by_name: dict[str, str] = {}
    for p_name, active, line_no, raw in players:
        try:
            player = t.add_player(p_name)
        except TournamentError as e:
            raise TextFormatError(line_no, raw, str(e)) from None
        player.active = active
        by_name[player.name.lower()] = player.id

    for r in rounds:
        t.rounds.append(_build_round(r, by_name))
    return t


def _build_round(r: dict, by_name: dict[str, str]) -> Round:
    used: set[str] = set()

    def player(text: str, line_no: int, raw: str) -> str:
        key = " ".join(text.split()).lower()
        if key not in by_name:
            raise TextFormatError(
                line_no, raw, f"Spieler '{text.strip()}' unbekannt (Tippfehler? sonst unter 'spieler:' eintragen)"
            )
        pid = by_name[key]
        if pid in used:
            raise TextFormatError(line_no, raw, f"'{text.strip()}' kommt in Runde {r['number']} mehrfach vor")
        used.add(pid)
        return pid

    def team(text: str, line_no: int, raw: str) -> TeamIds:
        parts = re.split(r"[/+]", text)
        if len(parts) != 2 or not all(p.strip() for p in parts):
            raise TextFormatError(line_no, raw, f"Team '{text.strip()}' muss 'Name / Name' sein")
        return player(parts[0], line_no, raw), player(parts[1], line_no, raw)

    matches: list[Match] = []
    for court, body, line_no, raw in r["matches"]:
        sides = re.split(r"\s+vs\.?\s+", body.strip(), flags=re.I)
        if len(sides) != 2:
            raise TextFormatError(line_no, raw, "Erwartet: 'Name / Name  vs  Name / Name  Resultat'")
        tail = _RESULT_TAIL_RE.match(sides[1].strip())
        team_b_text, result_text = tail.group(1), (tail.group(2) or "").strip()
        if any(m.court == court for m in matches):
            raise TextFormatError(line_no, raw, f"Court {court} ist in dieser Runde doppelt belegt")
        match = Match(
            id=f"R{r['number']}-C{court}",
            court=court,
            team_a=team(sides[0], line_no, raw),
            team_b=team(team_b_text, line_no, raw),
        )
        if result_text and result_text != "-":
            try:
                match.result = parse_result(result_text)
            except ScoringError as e:
                raise TextFormatError(line_no, raw, f"Resultat ungültig: {e}") from None
        matches.append(match)

    if not matches:
        raise TextFormatError(r["line_no"], r["raw"], f"Runde {r['number']} hat keine Partie")

    bye = team(*r["bye"]) if r["bye"] else None
    resting: list[str] = []
    if r["resting"]:
        value, line_no, raw = r["resting"]
        resting = [player(n, line_no, raw) for n in value.split(",") if n.strip()]

    return Round(
        number=r["number"],
        matches=sorted(matches, key=lambda m: m.court),
        bye_team=bye,
        resting=resting,
        manual=r["manual"],
    )
