// Beach Volley Arcade – Browser-Oberfläche für das Turnier-Backend.
// Python (Pyodide) führt den Code aus beachturnier/ aus (über web/bridge.py);
// die Turnierdatei bleibt die Quelle der Wahrheit und wird nach jeder Aktion
// im localStorage gesichert.

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
const STORE_FILE = "beachturnier.file";
const STORE_SOUND = "beachturnier.sound";

const $ = (sel) => document.querySelector(sel);
let bridge = null;
let S = null; // aktueller Zustand (bridge.state())
let fileDirty = false;

function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* privater Modus o.ä. */ }
}
function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

// ------------------------------------------------------------------ Sound

let audio = null;
let soundOn = recall(STORE_SOUND) !== "off";

function tone(freq, dur, when = 0, type = "square", vol = 0.05) {
  if (!soundOn || !audio) return;
  const t = audio.currentTime + when;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur);
}

const sfx = {
  blip: () => tone(880, 0.05),
  error: () => { tone(160, 0.18, 0, "sawtooth"); tone(110, 0.25, 0.15, "sawtooth"); },
  coin: () => { tone(988, 0.08); tone(1319, 0.35, 0.08); },
  start: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, i * 0.09)),
  fanfare: () => [784, 784, 784, 1047, 988, 1047].forEach((f, i) => tone(f, 0.14, i * 0.12)),
  birthday: () => {
    // [Frequenz, Dauer in Achteln] – "Happy Birthday" in 8 Bit
    const song = [
      [392, 1], [392, 1], [440, 2], [392, 2], [523, 2], [494, 4],
      [392, 1], [392, 1], [440, 2], [392, 2], [587, 2], [523, 4],
      [392, 1], [392, 1], [784, 2], [659, 2], [523, 2], [494, 2], [440, 4],
      [698, 1], [698, 1], [659, 2], [523, 2], [587, 2], [523, 6],
    ];
    let t = 0;
    for (const [freq, len] of song) {
      tone(freq, len * 0.16, t, "square", 0.045);
      tone(freq / 2, len * 0.16, t, "triangle", 0.05);
      t += len * 0.18;
    }
  },
};

// ------------------------------------------------------------------ Python laden

async function boot() {
  try {
    const py = await loadPyodide({ indexURL: PYODIDE_URL });
    const files = await (await fetch("beachturnier/files.json")).json();
    py.FS.mkdirTree("/home/pyodide/beachturnier");
    for (const name of files) {
      const src = await (await fetch("beachturnier/" + name)).text();
      py.FS.writeFile("/home/pyodide/beachturnier/" + name, src);
    }
    py.FS.writeFile("/home/pyodide/bridge.py", await (await fetch("bridge.py")).text());
    py.runPython("import sys; sys.path.insert(0, '/home/pyodide')");
    bridge = py.pyimport("bridge");
    $("#loading").textContent = "READY PLAYER ONE";
    $("#loading").classList.remove("blink");
    $("#start").hidden = false;
    $("#start").focus();
  } catch (err) {
    console.error(err);
    $("#loading").textContent = "TILT! " + (err.message || err);
  }
}

function startGame() {
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; }
  sfx.coin();
  bridge.start(recall(STORE_FILE) || null);
  $("#attract").hidden = true;
  $("#game").hidden = false;
  refresh();
  if (!S.error && S.players.length < 4) showTab("players");
}

// ------------------------------------------------------------------ Zustand & Aktionen

function refresh() {
  S = JSON.parse(bridge.state());
  store(STORE_FILE, bridge.read_file());
  renderHud();
  renderRound();
  renderPlayers();
  if (!$("#tab-scores").hidden) renderScores();
  $("#undo").disabled = !S.can_undo;
}

/** Aktion im Backend ausführen; Fehler/Erfolg als Toast, danach neu zeichnen. */
function act(name, args = {}, { quiet = false } = {}) {
  const res = JSON.parse(bridge.api(name, JSON.stringify(args)));
  if (!res.ok) {
    toast(res.error, "err");
    sfx.error();
  } else if (res.message && !quiet) {
    toast(res.message, "ok");
  }
  refresh();
  return res;
}

const currentRound = () => (S && S.rounds.length ? S.rounds[S.rounds.length - 1] : null);
const runningRound = () => { const r = currentRound(); return r && !r.finished ? r : null; };
const doneCount = (r) => r.matches.filter((m) => m.result).length;
const pname = (id) => (S.players.find((p) => p.id === id) || { name: "?" }).name;
const teamName = (team) => team.map(pname).join(" / ");
const activePlayers = () => S.players.filter((p) => p.active);

let toastTimer = null;
function toast(text, kind = "ok") {
  const t = $("#toast");
  t.textContent = text;
  t.className = "toast " + kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, kind === "err" ? 4500 : 2600);
}

/** Kleiner DOM-Helfer: el("div", {class: "x", onclick: fn}, "Text", kindElement) */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

function renderHud() {
  if (S.error) {
    $("#hud-round").textContent = "DATEI-FEHLER";
    return;
  }
  const r = currentRound();
  $("#hud-round").textContent = `ROUND ${r ? r.number : 0}`;
  $("#hud-courts").textContent = `COURTS ${r ? doneCount(r) : 0}/${r ? r.matches.length : 0}`;
  $("#hud-players").textContent = `PLAYERS ${S.error ? 0 : activePlayers().length}`;
}

// ------------------------------------------------------------------ 40! Jonas

const TRAINER_QUOTES = [
  "«DAS WAR ERST DAS AUFWÄRMEN!»",
  "«NO PAIN, NO GAIN!»",
  "«I'LL BE BACK … IN DER NÄCHSTEN RUNDE.»",
  "«40 IST DAS NEUE 20!»",
  "«ZEHN BURPEES. JETZT!»",
  "«HASTA LA VISTA, SATZBALL!»",
  "«SCHMERZ IST NUR SCHWÄCHE, DIE DEN KÖRPER VERLÄSST.»",
  "«YIPPIE-KI-YAY, BEACHVOLLEY!»",
  "«WER LANDET, VERLIERT. WER SPRINGT, GEWINNT.»",
  "«ADRIAAAN! … ÄH, NÄCHSTE RUNDE!»",
];

function quoteFor(n) {
  return TRAINER_QUOTES[(n * 7) % TRAINER_QUOTES.length];
}

function mountPosters() {
  const tpl = $("#poster-template");
  document.querySelectorAll(".poster-slot").forEach((slot) => slot.replaceChildren(tpl.content.cloneNode(true)));
}

// ------------------------------------------------------------------ RUNDE

let draft = null;    // Team-Entwurf für die nächste Runde: {teams: [[id,id],…], resting: [id]}
let picked = null;   // ausgewählter Spieler im Entwurf: {list: "teams"|"resting", i, k}
let swapPick = null; // ausgewähltes Team zum Tauschen: {match: id|"bye", side: "a"|"b"}
let openSets = null; // Partie, bei der gerade Satzresultate eingegeben werden

function renderRound() {
  const view = $("#round-view");
  view.replaceChildren();
  if (S.error) {
    view.append(el("p", { class: "empty" }, "TURNIERDATEI FEHLERHAFT – BITTE IM TAB DATEI KORRIGIEREN"),
      el("p", { class: "err-text" }, S.error));
    $("#history").hidden = true;
    return;
  }
  const running = runningRound();
  view.append(running ? courtsView(running) : setupView());
  renderHistory(running);
}

// ---- Nächste Runde einteilen

function setupView() {
  const box = el("div", { class: "setup" });
  const last = currentRound();
  const next = last ? last.number + 1 : 1;
  if (last) {
    box.append(el("div", { class: "complete" },
      el("p", { class: "complete-title blink-slow" }, `ROUND ${last.number} COMPLETE!`),
      el("p", { class: "quote" }, `COACH JONAS (40): ${quoteFor(last.number)}`)));
  }
  if (activePlayers().length < 4) {
    box.append(el("p", { class: "empty" }, "INSERT PLAYERS – MINDESTENS 4 AKTIVE SPIELER"),
      el("button", { class: "key", onclick: () => showTab("players") }, "ZU DEN SPIELERN"));
    return box;
  }
  box.append(el("h3", { class: "view-title" }, `ROUND ${next} · TEAMS`));
  const modes = [["random", "ZUFALL"], ["similar", "ÄHNLICH"], ["balanced", "GEMISCHT"], ["manual", "SELBST"]];
  box.append(el("div", { class: "keys modes" },
    modes.map(([mode, label]) => el("button", {
      class: "key" + (draft && draft.mode === mode ? " key-on" : ""),
      onclick: () => makeDraft(mode),
    }, label))));
  if (!draft || !draftValid()) makeDraft(next === 1 ? "random" : "similar", true);
  if (!draft) return box;

  box.append(el("p", { class: "hint" }, draft.mode === "manual"
    ? "Tippe zwei Spieler ohne Team an: sie werden ein Team. Spieler im Team antippen und dann einen anderen: "
      + "die beiden tauschen. ✕ löst ein Team auf. Die Gegner bestimmt das System beim Start."
    : "Tippe zwei Spieler an, um sie zu tauschen. ✕ löst ein Team auf. Die Gegner bestimmt das System beim Start."));
  const grid = el("div", { class: "draft" });
  draft.teams.forEach((team, i) => {
    grid.append(el("div", { class: "draft-team" },
      el("div", { class: "draft-head" },
        el("span", { class: "label" }, `TEAM ${i + 1}`),
        el("button", { class: "swap", title: "Team auflösen", onclick: () => dissolveTeam(i) }, "✕")),
      el("div", { class: "chips" }, team.map((id, k) => chip(id, "teams", i, k)))));
  });
  box.append(grid);
  if (draft.resting.length) {
    box.append(el("div", { class: "draft-team resting" },
      el("span", { class: "label" }, `OHNE TEAM · PAUSIERT (+${S.bye_points})`),
      el("div", { class: "chips" }, draft.resting.map((id, k) => chip(id, "resting", k, null)))));
  }
  if (draft.teams.length % 2) {
    box.append(el("p", { class: "hint" }, "Ungerade Anzahl Teams: ein Team bekommt ein Freilos."));
  }
  box.append(el("button", {
    class: "btn btn-go",
    disabled: draft.teams.length < 2,
    onclick: () => {
      const n = draft.resting.length;
      if (n > 1 && !confirm(`${n} Spieler ohne Team pausieren diese Runde (+${S.bye_points} Punkte). Trotzdem starten?`)) return;
      const res = act("start_round", { teams: draft.teams });
      if (res.ok) { draft = null; sfx.start(); }
    },
  }, draft.teams.length < 2 ? "MINDESTENS 2 TEAMS BILDEN" : `▶ ROUND ${next} STARTEN`));
  return box;
}

function dissolveTeam(i) {
  draft.resting.push(...draft.teams[i]);
  draft.teams.splice(i, 1);
  picked = null;
  sfx.blip();
  renderRound();
}

function makeDraft(mode, silent = false) {
  if (mode === "manual") {
    // Alle aktiven Spieler (nach Rang) ohne Team – der Turnierleiter teilt selbst ein
    const ids = [...activePlayers()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).map((p) => p.id);
    draft = { mode, teams: [], resting: ids };
    picked = null;
    if (!silent) { sfx.blip(); renderRound(); }
    return;
  }
  const res = JSON.parse(bridge.api("suggest", JSON.stringify({ mode })));
  if (!res.ok) {
    if (!silent) { toast(res.error, "err"); sfx.error(); }
    draft = null;
    return;
  }
  draft = { mode, teams: res.teams, resting: res.resting };
  picked = null;
  if (!silent) { sfx.blip(); renderRound(); }
}

/** Entwurf passt nicht mehr, wenn sich die aktiven Spieler geändert haben. */
function draftValid() {
  const ids = [...draft.teams.flat(), ...draft.resting].sort().join();
  return ids === activePlayers().map((p) => p.id).sort().join();
}

function chip(id, list, i, k) {
  const isPicked = picked && picked.list === list && picked.i === i && picked.k === k;
  return el("button", {
    class: "chip" + (isPicked ? " picked" : "") + (list === "resting" ? " chip-rest" : ""),
    onclick: () => {
      if (!picked) {
        picked = { list, i, k };
      } else if (picked.list === "resting" && list === "resting" && picked.i !== i) {
        // Zwei Spieler ohne Team -> neues Team
        const a = draft.resting[picked.i];
        const b = draft.resting[i];
        draft.resting = draft.resting.filter((_, idx) => idx !== picked.i && idx !== i);
        draft.teams.push([a, b]);
        picked = null;
      } else {
        const get = (p) => (p.list === "teams" ? draft.teams[p.i][p.k] : draft.resting[p.i]);
        const set = (p, v) => { if (p.list === "teams") draft.teams[p.i][p.k] = v; else draft.resting[p.i] = v; };
        const a = get(picked);
        const b = get({ list, i, k });
        set(picked, b);
        set({ list, i, k }, a);
        picked = null;
      }
      sfx.blip();
      renderRound();
    },
  }, pname(id));
}

// ---- Laufende Runde: Courts und Resultate

function courtsView(rnd) {
  const box = el("div", { class: "courts" });
  box.append(el("h3", { class: "view-title" },
    `ROUND ${rnd.number}${rnd.manual ? " (ANGEPASST)" : ""} · ${doneCount(rnd)}/${rnd.matches.length} COURTS`));
  box.append(el("p", { class: "hint" },
    "Sieger antippen: 2:0 oder 2:1. ⇄ bei zwei Teams = Teams tauschen. (Zahl) = Teampunkte vor der Runde."));
  rnd.matches.forEach((m) => box.append(matchCard(m, true)));
  if (rnd.bye_team) {
    box.append(el("div", { class: "card bye" },
      el("span", { class: "label" }, `FREILOS (+${S.bye_points})`),
      el("span", { class: "team-name" }, teamName(rnd.bye_team)),
      swapButton("bye", "")));
  }
  if (rnd.resting.length) {
    box.append(el("div", { class: "card bye" },
      el("span", { class: "label" }, `PAUSE (+${S.bye_points})`),
      el("span", { class: "team-name" }, rnd.resting.map(pname).join(", "))));
  }
  box.append(el("div", { class: "keys" },
    el("button", {
      class: "key key-warn",
      onclick: () => {
        const msg = doneCount(rnd)
          ? `Runde ${rnd.number} hat schon ${doneCount(rnd)} Resultat(e). Wirklich löschen?`
          : `Runde ${rnd.number} löschen und Teams neu einteilen?`;
        if (confirm(msg)) act("cancel_round");
      },
    }, "RUNDE VERWERFEN")));
  return box;
}

function matchCard(m, current) {
  const r = m.result;
  const side = (team, strength, letter) => {
    const won = r && (letter === "a" ? r.sets_a > r.sets_b : r.sets_b > r.sets_a);
    const lost = r && !won;
    return el("div", { class: "side" + (won ? " won" : "") + (lost ? " lost" : "") },
      el("div", { class: "team-line" },
        el("span", { class: "team-name" }, teamName(team)),
        current ? el("span", { class: "strength" }, `(${strength})`) : null,
        current ? swapButton(m.id, letter) : null),
      r ? null : el("div", { class: "win-keys" },
        el("button", { class: "key key-win", onclick: () => record(m, letter === "a" ? "2:0" : "0:2") }, "2:0"),
        el("button", { class: "key key-win", onclick: () => record(m, letter === "a" ? "2:1" : "1:2") }, "2:1")));
  };
  const card = el("div", { class: "card match" + (r ? " done" : "") },
    el("div", { class: "card-head" },
      el("span", { class: "label" }, current ? `COURT ${m.court}` : m.id.replace("-", " · ")),
      r ? el("span", { class: "result" }, resultText(r)) : null),
    el("div", { class: "sides" },
      side(m.team_a, m.strength_a, "a"),
      el("span", { class: "vs" }, "VS"),
      side(m.team_b, m.strength_b, "b")));
  if (openSets === m.id) {
    const input = el("input", { type: "text", class: "sets-input", inputmode: "numeric",
      placeholder: "21:18 17:21 15:12 (aus Sicht links)", value: r && r.set_scores ? resultText(r) : "" });
    const form = el("form", { class: "add-row", onsubmit: (e) => { e.preventDefault(); record(m, input.value); } },
      input, el("button", { class: "key", type: "submit" }, "OK"));
    card.append(form);
    setTimeout(() => input.focus(), 0);
  }
  card.append(el("div", { class: "card-actions" },
    el("button", { class: "link", onclick: () => { openSets = openSets === m.id ? null : m.id; renderRound(); } },
      "SATZRESULTATE"),
    r ? el("button", { class: "link", onclick: () => act("clear_result", { match_id: m.id }) }, "RESULTAT LÖSCHEN") : null));
  return card;
}

function resultText(r) {
  return r.set_scores ? r.set_scores.map(([a, b]) => `${a}:${b}`).join("  ") : `${r.sets_a}:${r.sets_b}`;
}

function record(m, result) {
  const wasRunning = runningRound();
  const res = act("record_result", { match_id: m.id, result });
  if (!res.ok) return;
  openSets = null;
  const r = currentRound();
  if (wasRunning && r.number === wasRunning.number && r.finished) {
    sfx.fanfare();
    toast(`ROUND ${r.number} COMPLETE! ${quoteFor(r.number)}`, "jonas");
  } else {
    sfx.coin();
  }
}

function swapButton(match, side) {
  const isPicked = swapPick && swapPick.match === match && swapPick.side === side;
  return el("button", {
    class: "swap" + (isPicked ? " picked" : ""),
    title: "Team tauschen",
    onclick: () => {
      if (!swapPick) {
        swapPick = { match, side };
        toast("Jetzt das zweite Team antippen (⇄)", "ok");
        renderRound();
        return;
      }
      const first = swapPick;
      swapPick = null;
      if (first.match === match && first.side === side) { renderRound(); return; }
      const rnd = runningRound();
      const touched = rnd.matches.filter((x) => (x.id === first.match || x.id === match) && x.result);
      if (touched.length && !confirm("Betroffene Partien haben schon Resultate, die verloren gehen. Weiter?")) {
        renderRound();
        return;
      }
      const res = act("swap_teams", { match_a: first.match, side_a: first.side, match_b: match, side_b: side,
        force: touched.length > 0 }, { quiet: true });
      if (res.ok) { toast("Teams getauscht", "ok"); sfx.blip(); }
    },
  }, "⇄");
}

// ---- Frühere Runden (Korrekturen)

function renderHistory(running) {
  const past = S.rounds.filter((r) => r !== running).reverse();
  const box = $("#history");
  box.hidden = past.length === 0;
  const list = $("#history-list");
  list.replaceChildren();
  for (const rnd of past) {
    list.append(el("h4", { class: "history-title" }, `ROUND ${rnd.number}${rnd.manual ? " (ANGEPASST)" : ""}`));
    rnd.matches.forEach((m) => list.append(matchCard(m, false)));
    const out = [rnd.bye_team ? `Freilos: ${teamName(rnd.bye_team)}` : null,
      rnd.resting.length ? `Pause: ${rnd.resting.map(pname).join(", ")}` : null].filter(Boolean);
    if (out.length) list.append(el("p", { class: "hint" }, out.join(" · ")));
  }
}

// ------------------------------------------------------------------ SPIELER

function renderPlayers() {
  const list = $("#player-list");
  list.replaceChildren();
  if (S.error) return;
  const active = activePlayers().length;
  $("#player-count").textContent =
    `${active} AKTIV · ${S.players.length - active} ABWESEND · SORTIERT NACH RANG`;
  if (document.activeElement !== $("#tournament-name")) $("#tournament-name").value = S.name;
  if (!S.players.length) {
    list.append(el("p", { class: "empty" }, "NO PLAYERS YET – OBEN NAMEN EINGEBEN"));
    return;
  }
  const players = [...S.players].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  for (const p of players) {
    list.append(el("div", { class: "player" + (p.active ? "" : " absent") },
      el("span", { class: "rank" }, `${p.rank}.`),
      el("span", { class: "pname" }, p.name),
      el("span", { class: "pts" }, `${p.points} P`),
      el("button", {
        class: "key key-small " + (p.active ? "key-here" : "key-away"),
        title: p.active ? "Als abwesend markieren" : "Wieder dabei",
        onclick: () => { act("set_active", { player_id: p.id, active: !p.active }, { quiet: true }); draft = null; sfx.blip(); },
      }, p.active ? "DA" : "WEG"),
      el("button", {
        class: "key key-small",
        title: "Umbenennen",
        onclick: () => {
          const name = prompt("Neuer Name:", p.name);
          if (name && name.trim() !== p.name) act("rename_player", { player_id: p.id, name });
        },
      }, "✎"),
      el("button", {
        class: "key key-small key-warn",
        title: "Entfernen",
        onclick: () => {
          if (p.played) {
            toast(`${p.name} hat schon gespielt – stattdessen auf WEG setzen`, "err");
            sfx.error();
          } else if (confirm(`${p.name} entfernen?`)) {
            act("remove_player", { player_id: p.id });
            draft = null;
          }
        },
      }, "✕")));
  }
}

function addPlayers(e) {
  e.preventDefault();
  const input = $("#player-name");
  const names = input.value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  if (!names.length) return;
  const res = act("add_players", { names });
  if (res.ok) {
    input.value = "";
    draft = null;
    sfx.coin();
  }
  input.focus();
}

// ------------------------------------------------------------------ Highscore

const ORDINAL = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? "ST" : n % 10 === 2 && n % 100 !== 12 ? "ND"
  : n % 10 === 3 && n % 100 !== 13 ? "RD" : "TH");
const RANK_COLORS = ["var(--yellow)", "var(--orange)", "var(--magenta)", "var(--cyan)", "var(--green)"];

let scoreMode = "player"; // "player" oder "team"

function renderScores() {
  const i = S;
  document.querySelectorAll(".score-modes .key").forEach((b) => b.classList.toggle("key-on", b.dataset.mode === scoreMode));
  const box = $("#scores");
  box.replaceChildren();
  if (i.error) {
    box.innerHTML = '<p class="empty">DATEI-FEHLER – SIEHE TAB DATEI</p>';
    return;
  }
  const cur = currentRound();
  $("#scores-sub").textContent = (cur
    ? `${i.name.toUpperCase()} · ROUND ${cur.number} · ${doneCount(cur)}/${cur.matches.length} COURTS`
    : i.name.toUpperCase()) + (scoreMode === "team" ? " · NUR ZUSAMMEN GESPIELTE PARTIEN" : "");
  const list = scoreMode === "team" ? i.team_standings : i.standings;
  if (!list.length) {
    box.innerHTML = scoreMode === "team"
      ? '<p class="empty">NO TEAMS YET – ERST NACH DEM ERSTEN RESULTAT</p>'
      : '<p class="empty">NO PLAYERS YET – INSERT PLAYERS</p>';
    return;
  }
  const row = (cells, cls, color) => {
    const div = document.createElement("div");
    div.className = "row " + (cls || "");
    if (color) div.style.color = color;
    cells.forEach((c, k) => {
      const span = document.createElement("span");
      span.textContent = c;
      if (k === 1) span.className = "name";
      div.appendChild(span);
    });
    box.appendChild(div);
  };
  const signed = (n) => (n > 0 ? `+${n}` : String(n));
  if (scoreMode === "team") {
    row(["#", "TEAM", "PTS", "SP", "W-L", "SETS"], "header");
    list.forEach((s) => row(
      [ORDINAL(s.rank), s.name.toUpperCase(), String(s.points).padStart(3, "0"), String(s.matches),
       `${s.wins}-${s.losses}`, signed(s.set_diff)],
      "",
      RANK_COLORS[(s.rank - 1) % RANK_COLORS.length],
    ));
    return;
  }
  row(["#", "NAME", "PTS", "SP", "W-L", "BH"], "header");
  list.forEach((s) => {
    row(
      [ORDINAL(s.rank), s.name.toUpperCase(), String(s.points).padStart(3, "0"), String(s.matches),
       `${s.wins}-${s.losses}`, String(s.buchholz)],
      "",
      RANK_COLORS[(s.rank - 1) % RANK_COLORS.length],
    );
  });
}

// ------------------------------------------------------------------ Datei

function loadFileTab() {
  $("#file").value = bridge.read_file();
  fileDirty = false;
  $("#file-msg").textContent = "";
}

function saveFileTab() {
  const err = bridge.write_file($("#file").value);
  fileDirty = false;
  draft = null;
  refresh();
  const msg = $("#file-msg");
  msg.className = "file-msg " + (err ? "err" : "ok");
  msg.textContent = err ? "FEHLER: " + err : "GESPEICHERT ✓";
  err ? sfx.error() : sfx.coin();
}

function download() {
  const text = bridge.read_file();
  const name = (S.name || "turnier").toLowerCase().replace(/[^a-z0-9äöü]+/g, "-").replace(/^-|-$/g, "");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: (name || "turnier") + ".txt" });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function upload(file) {
  const reader = new FileReader();
  reader.onload = () => {
    $("#file").value = reader.result;
    saveFileTab();
  };
  reader.readAsText(file, "utf-8");
}

function newTournament() {
  if (!confirm("Neues Turnier starten? Die aktuelle Datei wird gelöscht (vorher DOWNLOAD als Backup!).")) return;
  bridge.start(null);
  draft = null;
  refresh();
  loadFileTab();
  toast("Neues Turnier angelegt", "ok");
}

// ------------------------------------------------------------------ Tabs

const TABS = ["round", "players", "scores", "file", "jonas"];

function showTab(name) {
  if (fileDirty && !$("#tab-file").hidden && name !== "file") {
    if (confirm("Änderungen an der Datei speichern?")) saveFileTab();
    else fileDirty = false;
  }
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  for (const tab of TABS) $("#tab-" + tab).hidden = tab !== name;
  swapPick = null;
  picked = null;
  if (name === "round") renderRound();
  if (name === "scores") renderScores();
  if (name === "file") loadFileTab();
  if (name === "jonas") sfx.birthday();
  if (name === "players" && S && !S.players.length) $("#player-name").focus();
  sfx.blip();
}

// ------------------------------------------------------------------ Pixel-Szene

const scene = $("#scene");
const ctx = scene.getContext("2d");
const W = scene.width;
const H = scene.height;
const HORIZON = 24;
const PALM = [
  "..##.....##..",
  ".#..##.##..#.",
  "#.....#.....#",
  "......#......",
  ".....#.......",
  ".....#.......",
  "....#........",
  "....#........",
  "....#........",
  "...#.........",
  "...#.........",
  "..###........",
];
const PLAYER = [".#.", "###", ".#.", "#.#"];
const PLANE = [
  "#.......",
  "##..##..",
  "########",
  ".##..##.",
];
// 3x5-Pixelschrift für das Banner
const FONT = {
  H: ["#.#", "#.#", "###", "#.#", "#.#"], A: [".#.", "#.#", "###", "#.#", "#.#"],
  P: ["##.", "#.#", "##.", "#..", "#.."], Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  J: ["..#", "..#", "..#", "#.#", ".#."], O: [".#.", "#.#", "#.#", "#.#", ".#."],
  N: ["#.#", "###", "###", "#.#", "#.#"], S: [".##", "#..", ".#.", "..#", "##."],
  4: ["#.#", "#.#", "###", "..#", "..#"], 0: ["###", "#.#", "#.#", "#.#", "###"],
  B: ["##.", "#.#", "##.", "#.#", "##."], I: ["###", ".#.", ".#.", ".#.", "###"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"], T: ["###", ".#.", ".#.", ".#.", ".#."],
  D: ["##.", "#.#", "#.#", "#.#", "##."], L: ["#..", "#..", "#..", "#..", "###"],
  E: ["###", "#..", "##.", "#..", "###"],
  "!": [".#.", ".#.", ".#.", "...", ".#."], " ": ["...", "...", "...", "...", "..."],
};
const BANNER = "BIRTHDAY BATTLE 40!";

function px(x, y, color, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function sprite(rows, x, y, color, flip = false) {
  rows.forEach((row, dy) => {
    [...row].forEach((c, dx) => {
      if (c === "#") px(flip ? x + row.length - 1 - dx : x + dx, y + dy, color);
    });
  });
}

function drawScene(time) {
  // Himmel
  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
  sky.addColorStop(0, "#14062b");
  sky.addColorStop(1, "#7a1a6e");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, HORIZON);
  // Sterne
  for (let k = 0; k < 14; k++) {
    if ((k * 7 + Math.floor(time / 600)) % 5) px((k * 37) % W, (k * 13) % 12, "#c9b8ff");
  }
  // Sonne mit Streifen
  const cx = W / 2;
  const cy = HORIZON - 2;
  for (let y = cy - 12; y < HORIZON; y++) {
    const half = Math.floor(Math.sqrt(Math.max(0, 144 - (y - cy) ** 2)));
    if (y > cy - 5 && (y - cy) % 3 === 0) continue;
    const t = (y - (cy - 12)) / 14;
    const color = t < 0.4 ? "#ffe23b" : t < 0.7 ? "#ff8a1f" : "#ff2fd6";
    px(cx - half, y, color, half * 2, 1);
  }
  // Meer
  for (let y = HORIZON; y < HORIZON + 4; y++) {
    px(0, y, y % 2 ? "#1b3a8a" : "#2453b8", W, 1);
  }
  for (let k = 0; k < 6; k++) {
    const x = (k * 17 + time / 120) % W;
    px(x, HORIZON + 1 + (k % 3), "#ff8ad8", 3, 1);
  }
  // Sand mit Synthwave-Gitter
  px(0, HORIZON + 4, "#3a1450", W, H - HORIZON - 4);
  ctx.fillStyle = "#ff2fd6";
  for (let k = -8; k <= 8; k++) {
    for (let y = HORIZON + 4; y < H; y++) {
      const x = cx + k * 3 * ((y - HORIZON) / 4);
      if (x >= 0 && x < W) ctx.fillRect(Math.round(x), y, 1, 1);
    }
  }
  const scroll = (time / 300) % 1;
  for (let k = 0; k < 6; k++) {
    const y = HORIZON + 4 + (k + scroll) ** 1.6;
    if (y < H) px(0, y, "#ff2fd6", W, 1);
  }
  // Flugzeug mit Geburtstagsbanner
  const bannerW = BANNER.length * 4 + 3;
  const span = W + bannerW + 20;
  const bx0 = W - ((time / 60) % (span + 40));
  if (bx0 > -bannerW - 14) {
    sprite(PLANE, bx0 - 1, 4, "#c9c9c9", true);
    px(bx0 + 7, 6, "#e9e3ff", 4, 1);
    px(bx0 + 11, 2, "#ffe23b", bannerW, 9);
    [...BANNER].forEach((ch, k) => sprite(FONT[ch] || FONT[" "], bx0 + 13 + k * 4, 4, "#ff2fd6"));
  }
  // Palmen
  sprite(PALM, 3, HORIZON - 4, "#0a0414");
  sprite(PALM, W - 16, HORIZON - 4, "#0a0414", true);
  // Netz
  px(cx, HORIZON - 3, "#e9e3ff", 1, 12);
  for (let x = cx - 0; x <= cx; x++) {
    for (let y = HORIZON - 3; y < HORIZON + 2; y += 2) px(x, y, "#ffffff");
  }
  // Spieler
  const baseY = HORIZON + 6;
  const hop = (phase) => (Math.sin(phase) > 0.85 ? -1 : 0);
  const t = (time / 1600) % 2;
  sprite(PLAYER, cx - 20, baseY + hop(time / 200), "#2ff3ff");
  sprite(PLAYER, cx - 12, baseY + 2 + hop(time / 230 + 1), "#2ff3ff");
  sprite(PLAYER, cx + 10, baseY + hop(time / 210 + 2), "#ffe23b");
  sprite(PLAYER, cx + 18, baseY + 2 + hop(time / 240 + 3), "#ffe23b");
  // Ball: Bogen von links nach rechts und zurück
  const p = t < 1 ? t : 2 - t;
  const bx = cx - 18 + p * 36;
  const by = baseY - 2 - Math.sin(p * Math.PI) * 18;
  px(bx, by, "#ffffff", 2, 2);
  px(bx, baseY + 4, "rgba(0,0,0,.4)", 2, 1);
}

function animate(time) {
  drawScene(time);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) requestAnimationFrame(animate);
}

// ------------------------------------------------------------------ Events

$("#start").addEventListener("click", startGame);
document.querySelectorAll(".score-modes .key").forEach((b) => b.addEventListener("click", () => {
  scoreMode = b.dataset.mode;
  renderScores();
  sfx.blip();
}));
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
$("#add-player").addEventListener("submit", addPlayers);
$("#rename-tournament").addEventListener("submit", (e) => {
  e.preventDefault();
  act("set_name", { name: $("#tournament-name").value });
  $("#tournament-name").blur();
});
$("#undo").addEventListener("click", () => {
  const res = act("undo");
  if (res.ok) { draft = null; sfx.blip(); }
});
$("#file").addEventListener("input", () => { fileDirty = true; });
$("#file-save").addEventListener("click", saveFileTab);
$("#file-download").addEventListener("click", download);
$("#file-upload").addEventListener("change", (e) => e.target.files[0] && upload(e.target.files[0]));
$("#file-new").addEventListener("click", newTournament);
$("#sound").textContent = "SOUND: " + (soundOn ? "ON" : "OFF");
$("#sound").addEventListener("click", () => {
  soundOn = !soundOn;
  store(STORE_SOUND, soundOn ? "on" : "off");
  $("#sound").textContent = "SOUND: " + (soundOn ? "ON" : "OFF");
  sfx.blip();
});

mountPosters();
requestAnimationFrame(animate);
boot();
