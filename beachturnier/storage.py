"""Speichern/Laden der Turnierdatei (Textformat, siehe textformat.py).

Es wird atomar geschrieben (erst temporäre Datei, dann umbenennen), damit die
Datei auch bei Absturz oder leerem Akku nie halb geschrieben ist.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Union

from .textformat import dumps, loads
from .tournament import Tournament


def save(tournament: Tournament, path: Union[str, Path]) -> None:
    write_text_atomic(path, dumps(tournament))


def write_text_atomic(path: Union[str, Path], text: str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise


def load(path: Union[str, Path]) -> Tournament:
    with open(path, encoding="utf-8") as f:
        return loads(f.read())
