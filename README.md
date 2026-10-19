# Beachturnier – Schweizer System mit wechselnden Teams

Backend (reines Python ≥ 3.10, keine Abhängigkeiten) für ein Beachvolleyball-Turnier:

- **Punkte pro Spieler**: Sieg 2:0 = 3, Sieg 2:1 = 2, Niederlage 1:2 = 1, Niederlage 0:2 = 0.
  Beide Spieler eines Teams bekommen die Punkte des Teams.
- **Teams wechseln jede Runde** und werden vom Turnierleiter festgelegt
  (optional mit Vorschlag vom System).
- **Paarung nach Schweizer System**: Teamstärke = Summe der Spielerpunkte.
  Starke Teams spielen gegen starke, schwache gegen schwache. Court 1 = stärkste Partie.
- **Beliebig viele Runden**: Es gibt kein festes Ende, man startet einfach die nächste Runde.

## Am Turniertag: Text-UI

```
python3 turnier.py sommer.txt        # Windows: py turnier.py sommer.txt
```

Ohne Dateinamen wird `turnier.txt` verwendet. Gibt es die Datei noch nicht, wird sie angelegt.
`hilfe` zeigt alle Befehle. Namen dürfen abgekürzt werden, solange sie eindeutig sind.

```
> spieler Anna, Ben, Carla, David, Eva, Felix, Gina, Hugo, Anna Lena
> vorschlag zufall                   # Runde 1; danach: vorschlag / vorschlag gemischt
> runde                              # Vorschlag übernehmen – oder: runde Anna+Ben Carla+David ...
=== Runde 1 ===
Court 1:  Anna / Carla ( 0)  vs  Anna Lena / Ben ( 0)   offen
Court 2:  David / Gina ( 0)  vs  Eva / Felix     ( 0)   offen
Pause:    Hugo  (+2 Punkte)
> res 1 21:18 17:21 15:12            # oder nur Sätze: res 1 2:1
> res 2 0:2
> tabelle                            # -> Screenshot in den Chat
> tausch 1b 2a                       # Paarung übersteuern
> abwesend hugo / anwesend hugo
> res r1c2 2:0                       # Korrektur einer früheren Runde
> undo                               # letzten Befehl rückgängig
```

- Vor **jedem** Befehl wird die Turnierdatei neu gelesen, nach jedem ändernden Befehl gespeichert.
  Handkorrekturen im Editor werden also sofort übernommen.
- Fehlerhafte Eingaben ändern nichts. Ist die Datei von Hand kaputt editiert, meldet das
  Programm die Zeile und arbeitet erst weiter, wenn sie korrigiert ist.
- `undo` funktioniert nur, solange die Datei seither nicht von Hand geändert wurde.
- Vor dem Überschreiben von Resultaten (`tausch`, `verwerfen`) fragt das Programm nach.

## Arcade-Version im Browser (GitHub Pages)

`web/` enthält eine Webseite im Stil eines 80er-Jahre-Spielautomaten (Neon, CRT-Scanlines,
Pixel-Szene, 8-Bit-Sounds, Highscore-Tabelle). Darin läuft **derselbe Python-Code** via
[Pyodide](https://pyodide.org) direkt im Browser – kein Server nötig, funktioniert auch auf dem Handy.

- **RUNDE**: Teams per Knopf vorschlagen lassen (Zufall / ähnlich / gemischt) oder mit
  **SELBST** von Hand bilden (zwei Spieler ohne Team antippen = neues Team, ✕ löst ein Team auf),
  Spieler durch Antippen tauschen, Runde starten. Die Gegner bestimmt immer das System. Danach pro Court den Sieger antippen (2:0 oder 2:1) oder
  Satzresultate eingeben; Teams mit ⇄ tauschen; frühere Runden unten korrigieren.
- **SPIELER**: hinzufügen (mehrere mit Komma), DA/WEG (abwesend), umbenennen, entfernen.
- **HI-SCORE**: die Rangliste im Arcade-Look – ideal für den Screenshot in den Chat.
  Umschaltbar: **PLAYER** (Einzelwertung) oder **TEAM** (siehe „Team-Wertung“ unten).
- **DATEI**: die Turnierdatei, direkt bearbeitbar, mit Download/Upload.

**SHOW-Modus** (Knopf „▶ SHOW“ in der laufenden Runde oder unten auf jeder Seite): Vollbild für
einen Laptop/Bildschirm am Spielfeldrand. Zeigt jede noch laufende Partie mit Avataren, blendet
alle 10 Sekunden zur nächsten über und läuft im Kreis; fertige Partien fallen automatisch weg.
Sind alle Partien fertig, erscheint „ROUND COMPLETE“ mit den Top 5. Beenden mit ✕ oder Esc.
Der Bildschirm bleibt dabei an (sofern der Browser das unterstützt).

**Avatare**: Bilder in den Ordner `web/avatars/` legen, Dateiname = Spielername wie im System,
z.B. `Anna.jpg` oder `Anna Lena.png` (Gross-/Kleinschreibung egal; jpg, png, webp, gif).
Ideal sind quadratische Porträts, mind. ca. 200×200 Pixel, Gesicht eher im oberen Teil.
Die Bilder werden bewusst leicht verpixelt angezeigt (Arcade-Look). Wer kein Bild hat, bekommt
automatisch ein Pixel-Gesicht. Die mitgelieferten Bilder (Anna, Ben, Carla, David, Eva, Felix,
Gina, Hugo) sind **Platzhalter** – einfach löschen oder ersetzen.

Die Turnierdatei liegt im `localStorage` des Browsers, also **nur auf diesem Gerät**.
Backup über DATEI › DOWNLOAD; mit UPLOAD lässt sie sich auf einem anderen Gerät oder im
Text-UI auf dem Laptop weiterverwenden (gleiches Format).

Beim ersten Öffnen lädt der Browser Python (~10 MB, danach im Cache).

**Lokal ausprobieren:**

```
python3 tools/build_site.py
python3 -m http.server -d _site 8000     # dann http://localhost:8000 öffnen
```

**Veröffentlichen:** Der Workflow `.github/workflows/pages.yml` führt bei jedem Push auf `main`
die Tests aus und veröffentlicht danach die Seite. Einmalig im Repository auf GitHub:
*Settings › Pages › Build and deployment › Source: GitHub Actions*.

## Programmierschnittstelle (Python)

```python
from beachturnier import Tournament, save, load

t = Tournament("Sommer-Beachturnier", bye_points=2)
anna = t.add_player("Anna"); ben = t.add_player("Ben")          # -> ids p1, p2, ...

# vor jeder Runde: Teams festlegen (oder t.suggest_teams() verwenden)
rnd = t.start_round([("p1", "p2"), ("p3", "p4"), ("p5", "p6"), ("p7", "p8")])
for m in rnd.matches:
    print(m.id, m.court, m.team_a, m.team_b)                      # z.B. "R1-C1"

# nach jeder Partie: Ergebnis aus Sicht von team_a
t.record_result("R1-C1", "21:18, 17:21, 15:12")   # Ballpunkte pro Satz
t.record_result("R1-C2", "2:0")                    # oder nur Satzstand
t.record_result("R1-C2", (0, 2))                   # Korrektur: einfach neu eintragen

t.standings()          # Rangliste (Liste von Standing, .to_dict() für JSON)
save(t, "turnier.txt"); t = load("turnier.txt")   # siehe "Turnierdatei"
```

Die nächste Runde kann erst gestartet werden, wenn alle Partien der aktuellen Runde ein Ergebnis haben.
`python3 example.py` zeigt einen kompletten Durchlauf.

## Turnierdatei – die einzige Quelle der Wahrheit

Alles steht in **einer Textdatei** (z.B. `turnier.txt`): Spieler, Einstellungen, alle Runden
und Resultate. Punkte und Rangliste werden nie gespeichert, sondern immer daraus berechnet.
Die Datei kann jederzeit von Hand korrigiert werden – oder im Notfall ganz ohne Programm
weitergeführt werden (Stift-und-Papier-tauglich).

```
turnier: Sommer-Beachturnier
freilos-punkte: 2

spieler:
  Anna
  Ben
  Hugo (abwesend)
  ...

runde 1:
  court 1:  Anna / Ben     vs  Carla / David    21:18 17:21 15:12
  court 2:  Eva / Felix    vs  Gina / Hugo      2:0
  court 3:  Ida / Jonas    vs  Kurt / Lea       -
  freilos:  Mia / Nico
  pause:    Otto
```

- Resultat aus Sicht des **ersten** Teams: Ballpunkte pro Satz oder nur Sätze (`2:1`). `-` = offen.
- Teams mit `/` oder `+`, Gegner mit `vs`. Spieler unter `spieler:` einzeln oder mit Komma.
- `freilos` = Team ohne Gegner, `pause` = Spieler ohne Team; beide bekommen die Freilos-Punkte.
  Wer in einer Runde nirgends steht, bekommt für diese Runde nichts.
- Sobald das Programm eine Runde paart, steht sie mit `-` (offen) in der Datei. Die Paarungen
  dürfen dort direkt geändert werden (Teams, Gegner, Courts, `freilos`, `pause`); das Programm
  verwendet beim nächsten Befehl die Datei-Version. Wer aktiv ist, aber in der aktuellen Runde
  nirgends steht, wird bei `zeigen` mit „Achtung“ gemeldet.
- `(manuell)` hinter `runde N` markiert von Hand übersteuerte Paarungen (nur Info).
- Gross-/Kleinschreibung und Einrückung sind egal, `#` leitet einen Kommentar ein.
  Eigene Kommentare gehen aber beim nächsten Speichern durch das Programm verloren.
- Namen dürfen Leerzeichen enthalten, aber keines von `/ + : , # ( )` und nicht das Wort `vs`.
- Tippfehler werden beim Laden mit Zeilennummer gemeldet, z.B.
  `Zeile 17: Spieler 'Dvid' unbekannt (Tippfehler? sonst unter 'spieler:' eintragen)`.
- Geschrieben wird atomar: die Datei ist auch bei Absturz oder leerem Akku nie halb geschrieben.

**Wichtig für das spätere Text-UI**: Das Programm liest die Datei vor jedem Befehl neu ein und
speichert danach. So gehen Handkorrekturen nicht verloren, auch wenn das Programm läuft
(nur nicht gleichzeitig im Editor und im Programm ändern).

## Regeln im Detail

**Team-Wertung** (HI-SCORE › TEAM, im Text-UI `tabelle teams`): nur Team-Kombinationen, die
wirklich zusammen gespielt haben, und nur die Partien, die sie zusammen gespielt haben
(ohne Freilos-/Pausenpunkte). Reihenfolge: Punkte → Satzdifferenz → Ballpunktdifferenz →
weniger Spiele. Teams, die öfter zusammen gespielt haben, sammeln entsprechend mehr Punkte.

**Rangliste** (in dieser Reihenfolge): Punkte → Buchholz (Summe der aktuellen Punkte
aller bisherigen Gegner) → Satzdifferenz → Ballpunktdifferenz.

**Paarung**: Gesucht wird die Paarung mit den geringsten Gesamtkosten, wobei pro Partie gilt:
`Kosten = (Punktdifferenz der Teams)² + rematch_penalty × frühere Begegnungen als Gegner`.
„Frühere Begegnungen“ zählt auf Spielerebene: Haben A und X schon gegeneinander gespielt,
kostet es Strafe, wenn das Team von A wieder auf das Team von X trifft. Bis 24 Teams
(48 Spieler) wird exakt optimiert, darüber mit einer schnellen Näherung.
Bei Gleichstand (z.B. in Runde 1) wird die Reihenfolge der eingegebenen Teams verwendet.

**Aussetzen**:
- Ungerade Anzahl Teams → ein Team bekommt ein Freilos (das Team, das bisher am wenigsten
  ausgesetzt hat; bei Gleichstand das schwächste).
- Aktive Spieler, die in keinem Team eingeteilt sind, setzen ebenfalls aus.
- Beide Fälle geben `bye_points` Punkte (Standard: 2, einstellbar, z.B. 0 oder 3).
- Abwesende Spieler mit `t.set_active(pid, False)` deaktivieren – sie bekommen nichts.
  Spät ankommende Spieler können jederzeit mit `add_player` dazukommen (Start mit 0 Punkten).

**Team-Vorschlag** `t.suggest_teams(mode="similar" | "balanced")`:
`similar` = ähnliche Ränge zusammen (1+2, 3+4, …), `balanced` = stark mit schwach (1+n, …).
Wiederholte Partner werden vermieden. Gibt `(teams, pausierende_spieler)` zurück.

**Paarungen von Hand übersteuern** (immer die aktuelle Runde):

```python
# Komplett neu festlegen (Court-Reihenfolge; Teams dürfen auch neu gemischt werden)
t.set_pairings([(("p1", "p2"), ("p7", "p8")), (("p3", "p4"), ("p5", "p6"))],
               bye_team=None)

# Oder zwei Teams tauschen (z.B. Drag & Drop im UI); "bye" = Freilos-Team
t.swap_teams("R2-C1", "b", "R2-C3", "a")
t.swap_teams("bye", "", "R2-C2", "a")
```

Partien, die dabei unverändert bleiben (gleiche zwei Teams), behalten ihr Ergebnis, auch wenn sie
den Court wechseln. Würde ein bereits eingetragenes Ergebnis wegfallen, verweigert das System die
Änderung, ausser man gibt `force=True` an. Wer in keiner Partie und nicht im Freilos-Team steht,
setzt aus (bekommt `bye_points`). Übersteuerte Runden sind mit `round.manual = True` markiert.

**Korrekturen**: Ergebnisse jeder Runde können jederzeit überschrieben (`record_result`) oder
gelöscht (`clear_result`) werden; die Rangliste wird immer aus allen Ergebnissen neu berechnet.
`cancel_round()` verwirft die letzte Runde (z.B. um die Teams neu einzuteilen).

## Struktur

| Datei | Inhalt |
|---|---|
| `beachturnier/models.py` | Datenklassen Player, Match, Result, Round (JSON-serialisierbar) |
| `beachturnier/scoring.py` | Ergebnis-Validierung, Text-Parser, Punktetabelle |
| `beachturnier/pairing.py` | Minimum-Cost-Matching (exakt + Näherung), Freilos-Auswahl |
| `beachturnier/tournament.py` | `Tournament`: die zentrale API für ein späteres UI |
| `beachturnier/textformat.py` | Textformat der Turnierdatei (lesen/schreiben, Fehlermeldungen mit Zeilennummer) |
| `beachturnier/cli.py` | Text-UI (Start: `python3 turnier.py`) |
| `web/` | Arcade-Webseite (HTML/CSS/JS + `bridge.py` als Schnittstelle zum Python-Backend) |
| `web/avatars/` | Avatar-Bilder (Dateiname = Spielername) |
| `tools/build_site.py` | Baut die Webseite nach `_site/` (inkl. Avatar-Liste) |
| `beachturnier/storage.py` | Turnierdatei atomar speichern/laden |

Tests: `python3 -m unittest discover -s tests`
