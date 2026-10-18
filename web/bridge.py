"""Brücke zwischen Browser (app.js) und dem unveränderten Text-UI (beachturnier.cli).

Läuft in Pyodide. Die Turnierdatei liegt im virtuellen Dateisystem des Browsers;
app.js sichert sie nach jedem Befehl im localStorage.
"""

import io
import json
from pathlib import Path

from js import window

from beachturnier.cli import Shell
from beachturnier.storage import write_text_atomic
from beachturnier.textformat import loads
from beachturnier.tournament import TournamentError

PATH = Path("/home/pyodide/turnier.txt")
_shell = None


def _ask(question):
    return "j" if window.confirm(question) else "n"


def _capture(fn, *args):
    _shell.stdout = io.StringIO()
    fn(*args)
    return _shell.stdout.getvalue()


def start(text=None):
    """Mit gespeicherter Datei (oder leer) starten; gibt die Begrüssung zurück."""
    global _shell
    if text:
        write_text_atomic(PATH, text)
    elif PATH.exists():
        PATH.unlink()
    _shell = Shell(PATH, stdout=io.StringIO(), ask=_ask)
    return _capture(_shell.preloop)


def run(line):
    return _capture(_shell.onecmd, line)


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


def info():
    """Status und Rangliste als JSON für Anzeige und Highscore-Bildschirm."""
    try:
        t = loads(read_file())
    except TournamentError as e:
        return json.dumps({"error": str(e)})
    rnd = t.current_round
    return json.dumps({
        "name": t.name,
        "players": len(t.active_players()),
        "round": rnd.number if rnd else 0,
        "done": sum(m.finished for m in rnd.matches) if rnd else 0,
        "total": len(rnd.matches) if rnd else 0,
        "standings": [s.to_dict() for s in t.standings() if s.active or s.matches or s.byes],
    })
