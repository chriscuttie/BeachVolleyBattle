"""Beispiel-Ablauf: 10 Spieler, 3 Runden, mit Team-Vorschlag und Speichern."""

import random

from beachturnier import Tournament, save

t = Tournament(name="Sommer-Beachturnier")
for name in ["Anna", "Ben", "Carla", "David", "Eva", "Felix", "Gina", "Hugo", "Ida", "Jonas"]:
    t.add_player(name)

rng = random.Random(42)
name = lambda pid: t.players[pid].name

for _ in range(3):
    teams, resting = t.suggest_teams()  # oder eigene Teams: [("p1", "p4"), ...]
    rnd = t.start_round(teams)
    print(f"\n=== Runde {rnd.number} ===")
    for m in rnd.matches:
        result = rng.choice(["21:15, 21:18", "21:19, 18:21, 15:13", "17:21, 21:16, 12:15", "2:0", "0:2"])
        t.record_result(m.id, result)
        print(f"Court {m.court}: {name(m.team_a[0])}/{name(m.team_a[1])} vs "
              f"{name(m.team_b[0])}/{name(m.team_b[1])}  ->  {result}")
    if rnd.sitting_out:
        print("Freilos:", ", ".join(name(p) for p in rnd.sitting_out))

print("\n=== Rangliste ===")
print(f"{'#':>2}  {'Name':<8} {'Pkt':>3} {'Sp':>3} {'Buchh':>5} {'Sätze':>6} {'Bälle':>6}")
for s in t.standings():
    print(f"{s.rank:>2}. {s.name:<8} {s.points:>3} {s.matches:>3} {s.buchholz:>5} "
          f"{s.set_diff:>+6} {s.ball_diff:>+6}")

save(t, "turnier.txt")
