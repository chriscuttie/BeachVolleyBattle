"""Brücke zwischen Browser-Oberfläche (app.js) und dem Turnier-Backend.

Läuft in Pyodide. Die Turnierdatei liegt im virtuellen Dateisystem des Browsers
und bleibt die einzige Quelle der Wahrheit: jede Aktion liest sie neu ein und
speichert sie danach; app.js sichert sie zusätzlich im localStorage.

app.js ruft api(name, json_args) auf und bekommt JSON zurück:
{"ok": true, "message": "..."} oder {"ok": false, "error": "..."}.
"""

import json
from pathlib import Path

from beachturnier.scoring import ScoringError, match_points
from beachturnier.storage import write_text_atomic
from beachturnier.textformat import dumps, loads
from beachturnier.tournament import Tournament, TournamentError

PATH = Path("/home/pyodide/turnier.txt")
_undo: list[tuple[str, str]] = []  # (Datei vorher, Datei nachher)


# ---------------------------------------------------------------------- Datei


def start(text=None):
    """Mit gespeicherter Datei (oder neuem Turnier) starten."""
    _undo.clear()
    write_text_atomic(PATH, text or dumps(Tournament()))


def read_file():
    return PATH.read_text(encoding="utf-8")


def write_file(text):
    """Von Hand bearbeitete Datei übernehmen. Gibt Fehlermeldung zurück ("" = ok)."""
    write_text_atomic(PATH, text)
    try:
        loads(text)
        return ""
    except TournamentError as e:
        return str(e)


# ---------------------------------------------------------------------- Zustand


def state():
    """Alles, was die Oberfläche anzeigt, als JSON."""
    try:
        t = loads(read_file())
    except TournamentError as e:
        return json.dumps({"error": str(e)})
    standings = t.standings()
    by_id = {s.player_id: s for s in standings}
    played = {p for r in t.rounds for p in _players_in(r)}
    rounds = []
    for rnd in t.rounds:
        before = {s.player_id: s.points for s in t.standings(before_round=rnd.number)}
        rounds.append({
            "number": rnd.number,
            "manual": rnd.manual,
            "finished": rnd.finished,
            "matches": [_match_json(m, before) for m in rnd.matches],
            "bye_team": list(rnd.bye_team) if rnd.bye_team else None,
            "resting": rnd.resting,
        })
    return json.dumps({
        "name": t.name,
        "bye_points": t.bye_points,
        "players": [
            {
                "id": p.id,
                "name": p.name,
                "active": p.active,
                "points": by_id[p.id].points,
                "rank": by_id[p.id].rank,
                "played": p.id in played,
            }
            for p in t.players.values()
        ],
        "rounds": rounds,
        "standings": [s.to_dict() for s in standings if s.active or s.matches or s.byes],
        "can_undo": bool(_undo),
    })


def _players_in(rnd):
    ids = set(rnd.sitting_out)
    for m in rnd.matches:
        ids.update(m.team_a + m.team_b)
    return ids


def _match_json(m, before):
    r = m.result
    return {
        "id": m.id,
        "court": m.court,
        "team_a": list(m.team_a),
        "team_b": list(m.team_b),
        "strength_a": before[m.team_a[0]] + before[m.team_a[1]],
        "strength_b": before[m.team_b[0]] + before[m.team_b[1]],
        "result": None if r is None else {
            "sets_a": r.sets_a,
            "sets_b": r.sets_b,
            "set_scores": r.set_scores,
            "points": match_points(r),
        },
    }


# ---------------------------------------------------------------------- Aktionen


def _mutate(fn):
    raw = read_file()
    try:
        t = loads(raw)
    except TournamentError as e:
        return {"ok": False, "error": f"Turnierdatei fehlerhaft (Tab DATEI): {e}"}
    before = dumps(t)
    try:
        message = fn(t)
        if not isinstance(message, str):  # z.B. Match/Round aus dem Backend
            message = ""
    except (TournamentError, ScoringError) as e:
        return {"ok": False, "error": str(e)}
    after = dumps(t)
    if after != before:
        write_text_atomic(PATH, after)
        _undo.append((raw, after))
    return {"ok": True, "message": message}


def add_players(names):
    def fn(t):
        added = [t.add_player(n).name for n in names if n.strip()]
        return f"{len(added)} Spieler hinzugefügt"
    return _mutate(fn)


def set_active(player_id, active):
    return _mutate(lambda t: t.set_active(player_id, active))


def rename_player(player_id, name):
    return _mutate(lambda t: t.rename_player(player_id, name))


def remove_player(player_id):
    return _mutate(lambda t: t.remove_player(player_id))


def set_name(name):
    def fn(t):
        if not name.strip():
            raise TournamentError("Name darf nicht leer sein")
        t.name = name.strip()
    return _mutate(fn)


def suggest(mode):
    """Team-Vorschlag (ändert nichts an der Datei)."""
    try:
        t = loads(read_file())
        if len(t.active_players()) < 4:
            raise TournamentError("Mindestens 4 aktive Spieler nötig")
        teams, resting = t.suggest_teams(mode=mode)
    except TournamentError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "teams": [list(x) for x in teams], "resting": resting}


def start_round(teams):
    def fn(t):
        rnd = t.start_round([tuple(x) for x in teams])
        return f"Runde {rnd.number} gestartet"
    return _mutate(fn)


def record_result(match_id, result):
    def fn(t):
        m = t.record_result(match_id, result)
        pa, pb = match_points(m.result)
        names = lambda team: " / ".join(t.players[p].name for p in team)
        winner, loser = (m.team_a, m.team_b) if pa > pb else (m.team_b, m.team_a)
        return f"{names(winner)} gewinnen {max(m.result.sets_a, m.result.sets_b)}:{min(m.result.sets_a, m.result.sets_b)}"
    return _mutate(fn)


def clear_result(match_id):
    return _mutate(lambda t: t.clear_result(match_id))


def swap_teams(match_a, side_a, match_b, side_b, force=False):
    return _mutate(lambda t: t.swap_teams(match_a, side_a, match_b, side_b, force=force))


def cancel_round():
    def fn(t):
        rnd = t.cancel_round(force=True)
        return f"Runde {rnd.number} gelöscht"
    return _mutate(fn)


def undo():
    if not _undo:
        return {"ok": False, "error": "Nichts rückgängig zu machen"}
    before, after = _undo[-1]
    if read_file() != after:
        _undo.clear()
        return {"ok": False, "error": "Die Datei wurde seither von Hand geändert – undo nicht möglich"}
    _undo.pop()
    write_text_atomic(PATH, before)
    return {"ok": True, "message": "Rückgängig gemacht"}


_API = {f.__name__: f for f in (
    add_players, set_active, rename_player, remove_player, set_name, suggest,
    start_round, record_result, clear_result, swap_teams, cancel_round, undo,
)}


def api(name, args_json="{}"):
    return json.dumps(_API[name](**json.loads(args_json)))
