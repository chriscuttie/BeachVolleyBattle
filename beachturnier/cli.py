"""Text-UI für den Turniertag.

Start:  python3 -m beachturnier turnier.txt

Die Turnierdatei ist die einzige Quelle der Wahrheit: Vor jedem Befehl wird sie
neu eingelesen, nach jedem ändernden Befehl gespeichert. Handkorrekturen im
Editor sind also jederzeit möglich, auch während das Programm läuft.
"""

from __future__ import annotations

import cmd
import functools
import re
import sys
from pathlib import Path
from typing import Callable, Optional

from .models import Match, Player, Round, TeamIds
from .scoring import ScoringError, match_points
from .storage import write_text_atomic
from .textformat import TextFormatError, dumps, loads
from .tournament import Tournament, TournamentError

HELP = """\
Befehle (Namen dürfen abgekürzt werden, solange eindeutig: "ann" = Anna)

  Spieler
    spieler Anna Ben Carla       Spieler erfassen (mit Leerzeichen im Namen: Komma
                                 als Trenner, z.B. "spieler Anna Lena, Ben")
    spieler                      Alle Spieler anzeigen
    abwesend Hugo / anwesend Hugo
    umbenennen Ana, Anna         Namen korrigieren (alt, neu)
    entfernen Hugo               Nur wenn noch nie gespielt (sonst: abwesend)

  Runde
    vorschlag                    Teams vorschlagen (ähnlich Starke zusammen)
    vorschlag gemischt           Stark mit schwach
    vorschlag zufall             Zufällig (gut für Runde 1)
    runde                        Letzten Vorschlag übernehmen und Runde starten
    runde Anna+Eva Ben+Carla     Eigene Teams (bei Namen mit Leerzeichen: Komma
                                 zwischen den Teams, z.B. "runde Anna Lena+Ben, ...")
    zeigen                       Aktuelle Runde anzeigen (zeigen 2 = Runde 2)
    tausch 1b 2a                 Teams tauschen: Court 1 Seite B <-> Court 2 Seite A
    tausch freilos 1a            Freilos-Team mit Court 1 Seite A tauschen
    verwerfen                    Aktuelle Runde löschen

  Resultate (aus Sicht des ersten Teams)
    res 1 21:18 17:21 15:12      Court 1, Ballpunkte pro Satz
    res 2 2:0                    Court 2, nur Sätze
    res 2 -                      Resultat löschen
    res r2c1 2:1                 Korrektur in einer früheren Runde (Runde 2, Court 1)

  Sonstiges
    tabelle                      Rangliste
    undo                         Letzten Befehl rückgängig machen
    name Sommer-Turnier          Turniername setzen
    datei                        Wo liegt die Turnierdatei?
    hilfe / ende
"""


class _Abort(Exception):
    """Befehl abgebrochen (z.B. Rückfrage verneint), nichts speichern."""


def _command(mutating: bool):
    """Datei laden -> Befehl ausführen -> bei Änderung speichern (+ undo merken)."""

    def deco(fn: Callable[["Shell", Tournament, str], None]):
        @functools.wraps(fn)
        def wrapper(self: "Shell", arg: str):
            try:
                raw = self.path.read_text(encoding="utf-8")
                t = loads(raw)
            except FileNotFoundError:
                self.out(f"Turnierdatei {self.path} fehlt.")
                return
            except TextFormatError as e:
                self.out("Fehler in der Turnierdatei – bitte im Editor korrigieren:", f"  {e}")
                return
            before = dumps(t)
            try:
                fn(self, t, arg.strip())
            except (TournamentError, ScoringError) as e:
                self.out(f"Fehler: {e}")
                return
            except _Abort:
                self.out("Abgebrochen.")
                return
            if mutating:
                after = dumps(t)
                if after != before:
                    write_text_atomic(self.path, after)
                    self.undo_stack.append((raw, after, fn.__name__[3:]))

        return wrapper

    return deco


class Shell(cmd.Cmd):
    prompt = "> "

    def __init__(self, path, stdin=None, stdout=None, ask: Optional[Callable[[str], str]] = None):
        super().__init__(stdin=stdin, stdout=stdout)
        if stdin is not None:
            self.use_rawinput = False
        self.path = Path(path)
        self.ask = ask or input
        self.undo_stack: list[tuple[str, str, str]] = []  # (Datei vorher, nachher, Befehl)
        self.suggestion: Optional[list[TeamIds]] = None

    # ------------------------------------------------------------------ Grundgerüst

    def out(self, *lines: str) -> None:
        for line in lines:
            print(line, file=self.stdout)

    def preloop(self) -> None:
        if not self.path.exists():
            write_text_atomic(self.path, dumps(Tournament()))
            self.out(f"Neue Turnierdatei angelegt: {self.path.resolve()}")
        self.out("Beachturnier – 'hilfe' zeigt alle Befehle.")
        self.do_status("")

    def emptyline(self) -> bool:  # Standard wäre: letzten Befehl wiederholen – gefährlich
        return False

    def default(self, line: str) -> None:
        self.out(f"Unbekannter Befehl: {line.split()[0]!r} – 'hilfe' zeigt alle Befehle.")

    def do_hilfe(self, arg: str) -> None:
        self.out(HELP)

    do_help = do_hilfe

    def do_ende(self, arg: str) -> bool:
        self.out("Tschüss! Alles ist gespeichert.")
        return True

    do_exit = do_quit = do_EOF = do_ende

    def do_datei(self, arg: str) -> None:
        self.out(f"Turnierdatei: {self.path.resolve()}",
                 "Darf jederzeit im Editor geändert werden (nur nicht gleichzeitig hier tippen).")

    def completedefault(self, text, line, begidx, endidx):
        try:
            names = [p.name for p in loads(self.path.read_text(encoding="utf-8")).players.values()]
        except (OSError, TournamentError):
            return []
        return [n for n in names if n.lower().startswith(text.lower())]

    # ------------------------------------------------------------------ Spieler

    @_command(mutating=True)
    def do_spieler(self, t: Tournament, arg: str) -> None:
        if not arg:
            self._list_players(t)
            return
        added = [t.add_player(n).name for n in _split_list(arg)]
        self.out(f"{len(added)} Spieler erfasst: {', '.join(added)}  (total {len(t.active_players())} aktiv)")

    def _list_players(self, t: Tournament) -> None:
        if not t.players:
            self.out("Noch keine Spieler. Erfassen mit: spieler Anna Ben Carla ...")
            return
        active = [p.name for p in t.players.values() if p.active]
        absent = [p.name for p in t.players.values() if not p.active]
        self.out(f"Aktiv ({len(active)}): {', '.join(active)}")
        if absent:
            self.out(f"Abwesend ({len(absent)}): {', '.join(absent)}")

    @_command(mutating=True)
    def do_abwesend(self, t: Tournament, arg: str) -> None:
        for p in _find_players(t, arg):
            t.set_active(p.id, False)
            self.out(f"{p.name} ist abwesend (bekommt keine Punkte, wird nicht eingeteilt).")

    @_command(mutating=True)
    def do_anwesend(self, t: Tournament, arg: str) -> None:
        for p in _find_players(t, arg):
            t.set_active(p.id, True)
            self.out(f"{p.name} ist wieder dabei.")

    @_command(mutating=True)
    def do_umbenennen(self, t: Tournament, arg: str) -> None:
        parts = [x.strip() for x in arg.split(",")]
        if len(parts) != 2:
            raise TournamentError("Format: umbenennen alter Name, neuer Name")
        p = _find_player(t, parts[0])
        old = p.name
        t.rename_player(p.id, parts[1])
        self.out(f"{old} heisst jetzt {p.name}.")

    @_command(mutating=True)
    def do_entfernen(self, t: Tournament, arg: str) -> None:
        p = _find_player(t, arg)
        t.remove_player(p.id)
        self.out(f"{p.name} entfernt.")

    @_command(mutating=True)
    def do_name(self, t: Tournament, arg: str) -> None:
        if not arg:
            raise TournamentError("Format: name Turniername")
        t.name = arg
        self.out(f"Turniername: {arg}")

    # ------------------------------------------------------------------ Runden

    @_command(mutating=False)
    def do_vorschlag(self, t: Tournament, arg: str) -> None:
        modes = {"": "similar", "ähnlich": "similar", "gemischt": "balanced", "zufall": "random"}
        if arg.lower() not in modes:
            raise TournamentError("vorschlag, vorschlag gemischt oder vorschlag zufall")
        if len(t.active_players()) < 4:
            raise TournamentError("Mindestens 4 aktive Spieler nötig")
        teams, resting = t.suggest_teams(mode=modes[arg.lower()])
        self.suggestion = teams
        self.out("Vorschlag:", "  " + "   ".join(_team_name(t, x, "+") for x in teams))
        if resting:
            self.out(f"  Pause: {', '.join(t.players[p].name for p in resting)}")
        if len(teams) % 2:
            self.out("  (ungerade Anzahl Teams: ein Team bekommt ein Freilos)")
        self.out("Übernehmen mit 'runde' – oder eigene Teams: runde Anna+Ben Carla+David ...")

    @_command(mutating=True)
    def do_runde(self, t: Tournament, arg: str) -> None:
        if arg:
            teams = [_parse_team(t, x) for x in _split_list(arg)]
        elif self.suggestion:
            teams = self.suggestion
        else:
            raise TournamentError("Erst 'vorschlag' oder Teams angeben: runde Anna+Ben Carla+David ...")
        rnd = t.start_round(teams)
        self.suggestion = None
        self._show_round(t, rnd)

    @_command(mutating=False)
    def do_zeigen(self, t: Tournament, arg: str) -> None:
        if not t.rounds:
            self.out("Noch keine Runde gestartet.")
            return
        if arg:
            if not arg.isdigit() or not 1 <= int(arg) <= len(t.rounds):
                raise TournamentError(f"Runde {arg} gibt es nicht (1–{len(t.rounds)})")
            self._show_round(t, t.rounds[int(arg) - 1])
        else:
            self._show_round(t, t.rounds[-1])

    @_command(mutating=True)
    def do_tausch(self, t: Tournament, arg: str) -> None:
        refs = arg.lower().split()
        if len(refs) != 2:
            raise TournamentError("Format: tausch 1b 2a  oder  tausch freilos 1a")
        rnd = _current(t)
        parsed = [_slot(rnd, r) for r in refs]
        new = t.swap_teams(*parsed[0], *parsed[1], force=self._force_if_results(rnd))
        self._show_round(t, new)

    @_command(mutating=True)
    def do_verwerfen(self, t: Tournament, arg: str) -> None:
        rnd = _current(t)
        done = sum(m.finished for m in rnd.matches)
        if done and not self._confirm(f"Runde {rnd.number} hat schon {done} Resultat(e). Wirklich löschen?"):
            raise _Abort
        t.cancel_round(force=True)
        self.out(f"Runde {rnd.number} gelöscht.")

    def _force_if_results(self, rnd: Round) -> bool:
        if any(m.finished for m in rnd.matches):
            if not self._confirm("Betroffene Partien haben schon Resultate, die verloren gehen könnten. Weiter?"):
                raise _Abort
            return True
        return False

    def _confirm(self, question: str) -> bool:
        return self.ask(f"{question} (j/n) ").strip().lower() in ("j", "ja", "y")

    # ------------------------------------------------------------------ Resultate

    @_command(mutating=True)
    def do_res(self, t: Tournament, arg: str) -> None:
        parts = arg.split(None, 1)
        if len(parts) != 2:
            raise TournamentError("Format: res <court> <resultat>, z.B. res 1 21:18 17:21 15:12")
        match = _find_match(t, parts[0])
        if parts[1].strip() == "-":
            t.clear_result(match.id)
            self.out(f"Resultat von {match.id} gelöscht.")
            return
        t.record_result(match.id, parts[1])
        r = match.result
        points = match_points(r)
        a, b = _team_name(t, match.team_a), _team_name(t, match.team_b)
        winner, loser = (a, b) if r.sets_a > r.sets_b else (b, a)
        sets = f"{max(r.sets_a, r.sets_b)}:{min(r.sets_a, r.sets_b)}"
        self.out(f"{match.id}: {winner} gewinnt {sets} gegen {loser}   "
                 f"(+{max(points)} / +{min(points)} Punkte)")
        rnd = t.current_round
        open_courts = [str(m.court) for m in rnd.matches if not m.finished]
        if open_courts:
            self.out(f"Runde {rnd.number}: noch offen Court {', '.join(open_courts)}")
        elif match in rnd.matches:
            self.out(f"Runde {rnd.number} ist komplett. Weiter mit 'tabelle' und 'vorschlag'.")

    do_resultat = do_res

    # ------------------------------------------------------------------ Anzeige

    @_command(mutating=False)
    def do_tabelle(self, t: Tournament, arg: str) -> None:
        rnd = t.current_round
        if rnd is None:
            title = "Rangliste (noch keine Runde)"
        elif rnd.finished:
            title = f"Rangliste nach Runde {rnd.number}"
        else:
            done = sum(m.finished for m in rnd.matches)
            title = f"Rangliste – Runde {rnd.number} läuft ({done}/{len(rnd.matches)} Resultate)"
        standings = [s for s in t.standings() if s.active or s.matches or s.byes]
        w = max([len(s.name) for s in standings] + [4])
        self.out(f"{t.name} – {title}", "")
        self.out(f" Rg  {'Name':<{w}}  Pkt  Sp   S  N  FL  Sätze  Bälle  Buchh")
        for s in standings:
            name = s.name + ("*" if not s.active else "")
            self.out(
                f"{s.rank:>3}. {name:<{w}}  {s.points:>3}  {s.matches:>2}  {s.wins:>2} {s.losses:>2}"
                f"  {s.byes:>2}  {s.set_diff:>+5}  {s.ball_diff:>+5}  {s.buchholz:>5}"
            )
        self.out("", "Sp=Spiele S/N=Siege/Niederlagen FL=Freilos/Pause Buchh=Punkte der Gegner"
                 + ("  *=abwesend" if any(not s.active for s in standings) else ""))

    @_command(mutating=False)
    def do_status(self, t: Tournament, arg: str) -> None:
        self.out(f"Turnier: {t.name}  –  {len(t.active_players())} aktive Spieler  –  Datei: {self.path}")
        rnd = t.current_round
        if rnd is None:
            self.out("Noch keine Runde. Spieler erfassen, dann 'vorschlag' und 'runde'.")
        elif rnd.finished:
            self.out(f"Runde {rnd.number} ist abgeschlossen. Nächste Runde mit 'vorschlag'.")
        else:
            self._show_round(t, rnd)

    def _show_round(self, t: Tournament, rnd: Round) -> None:
        before = {s.player_id: s.points for s in t.standings(before_round=rnd.number)}
        strength = lambda team: before[team[0]] + before[team[1]]
        names_a = [_team_name(t, m.team_a) for m in rnd.matches]
        names_b = [_team_name(t, m.team_b) for m in rnd.matches]
        wa, wb = max(map(len, names_a)), max(map(len, names_b))
        title = f"=== Runde {rnd.number}" + (" (manuell angepasst)" if rnd.manual else "") + " ==="
        self.out(title)
        for m, a, b in zip(rnd.matches, names_a, names_b):
            result = _result_text(m) if m.finished else "offen"
            self.out(
                f"Court {m.court}:  {a:<{wa}} ({strength(m.team_a):>2})  vs  "
                f"{b:<{wb}} ({strength(m.team_b):>2})   {result}"
            )
        if rnd.bye_team:
            self.out(f"Freilos:  {_team_name(t, rnd.bye_team)}  (+{t.bye_points} Punkte)")
        if rnd.resting:
            names = ", ".join(t.players[p].name for p in rnd.resting)
            self.out(f"Pause:    {names}  (+{t.bye_points} Punkte)")
        self.out("(Zahl in Klammern = Teampunkte vor der Runde)")
        if rnd is t.current_round:
            in_round = set(rnd.sitting_out) | {p for m in rnd.matches for p in m.team_a + m.team_b}
            missing = [p.name for p in t.active_players() if p.id not in in_round]
            if missing:
                self.out(f"Achtung: {', '.join(missing)} ist in dieser Runde nirgends eingeteilt "
                         "(bekommt keine Punkte). In der Datei unter 'pause:' eintragen oder 'abwesend'.")

    # ------------------------------------------------------------------ undo

    def do_undo(self, arg: str) -> None:
        if not self.undo_stack:
            self.out("Nichts rückgängig zu machen.")
            return
        before, after, command = self.undo_stack[-1]
        try:
            current = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            current = None
        if current != after:
            self.out("Die Datei wurde seither von Hand geändert – undo ist nicht möglich.",
                     "Bitte direkt in der Datei korrigieren.")
            self.undo_stack.clear()
            return
        self.undo_stack.pop()
        write_text_atomic(self.path, before)
        self.out(f"Rückgängig gemacht: {command}")


# ---------------------------------------------------------------------- Helfer


def _split_list(arg: str) -> list[str]:
    """Mit Komma, falls vorhanden (Namen mit Leerzeichen), sonst an Leerzeichen trennen."""
    items = arg.split(",") if "," in arg else arg.split()
    return [x.strip() for x in items if x.strip()]


def _find_players(t: Tournament, arg: str) -> list[Player]:
    """Mehrere Namen; ohne Komma wird zuerst der ganze Text als ein Name probiert
    ("anna lena" = Anna Lena), erst dann an Leerzeichen getrennt."""
    if "," not in arg:
        try:
            return [_find_player(t, arg)]
        except TournamentError:
            if len(arg.split()) == 1:
                raise
    return [_find_player(t, name) for name in _split_list(arg)]


def _find_player(t: Tournament, text: str) -> Player:
    key = " ".join(text.split()).lower()
    if not key:
        raise TournamentError("Name fehlt")
    players = list(t.players.values())
    exact = [p for p in players if p.name.lower() == key]
    if exact:
        return exact[0]
    candidates = [p for p in players if p.name.lower().startswith(key)]
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        raise TournamentError(f"Kein Spieler '{text}' (Liste mit: spieler)")
    raise TournamentError(f"'{text}' ist nicht eindeutig: {', '.join(p.name for p in candidates)}")


def _parse_team(t: Tournament, text: str) -> TeamIds:
    parts = re.split(r"[+/]", text)
    if len(parts) != 2:
        raise TournamentError(f"Team '{text}' bitte als Name+Name schreiben")
    return _find_player(t, parts[0]).id, _find_player(t, parts[1]).id


def _team_name(t: Tournament, team: TeamIds, sep: str = " / ") -> str:
    return sep.join(t.players[p].name for p in team)


def _current(t: Tournament) -> Round:
    if t.current_round is None:
        raise TournamentError("Es läuft keine Runde")
    return t.current_round


def _find_match(t: Tournament, ref: str) -> Match:
    if m := re.fullmatch(r"r(\d+)-?c(\d+)", ref.lower()):
        return t.match(f"R{m.group(1)}-C{m.group(2)}")
    if not ref.isdigit():
        raise TournamentError(f"'{ref}' ist keine Court-Nummer (oder z.B. r2c1 für Runde 2, Court 1)")
    rnd = _current(t)
    for match in rnd.matches:
        if match.court == int(ref):
            return match
    raise TournamentError(f"Court {ref} gibt es in Runde {rnd.number} nicht")


def _slot(rnd: Round, ref: str) -> tuple[str, str]:
    if ref in ("freilos", "fl"):
        return "bye", ""
    m = re.fullmatch(r"(\d+)([ab])", ref)
    if not m:
        raise TournamentError(f"'{ref}' verstehe ich nicht – z.B. 1a, 2b oder freilos")
    for match in rnd.matches:
        if match.court == int(m.group(1)):
            return match.id, m.group(2)
    raise TournamentError(f"Court {m.group(1)} gibt es in Runde {rnd.number} nicht")


def _result_text(m: Match) -> str:
    r = m.result
    if r.set_scores:
        return " ".join(f"{a}:{b}" for a, b in r.set_scores)
    return f"{r.sets_a}:{r.sets_b}"


def main(argv: Optional[list[str]] = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    path = argv[0] if argv else "turnier.txt"
    try:
        Shell(path).cmdloop()
    except KeyboardInterrupt:
        print("\nAbgebrochen – alles bis zum letzten Befehl ist gespeichert.")
