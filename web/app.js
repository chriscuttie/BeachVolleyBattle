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

/** Rauschen (Schlag/Explosion) wie beim NES-Rauschkanal. */
function noise(dur, when = 0, vol = 0.09) {
  if (!soundOn || !audio) return;
  const t = audio.currentTime + when;
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * dur), audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = audio.createBufferSource();
  const gain = audio.createGain();
  src.buffer = buffer;
  gain.gain.setValueAtTime(vol, t);
  src.connect(gain).connect(audio.destination);
  src.start(t);
}

const sfx = {
  blip: () => tone(880, 0.05),
  error: () => { tone(160, 0.18, 0, "sawtooth"); tone(110, 0.25, 0.15, "sawtooth"); },
  coin: () => { tone(988, 0.08); tone(1319, 0.35, 0.08); },
  start: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, i * 0.09)),
  fanfare: () => [784, 784, 784, 1047, 988, 1047].forEach((f, i) => tone(f, 0.14, i * 0.12)),
  fight: () => { [196, 262, 392, 523].forEach((f, i) => tone(f, 0.09, i * 0.07, "square", 0.06)); noise(0.25, 0.32); },
  punch: () => { noise(0.14, 0, 0.12); tone(110, 0.16, 0, "triangle", 0.12); tone(70, 0.22, 0.04, "square", 0.05); },
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
  loadAvatars();
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
  $("#hud-courts").textContent = `${r ? doneCount(r) : 0}/${r ? r.matches.length : 0}`;
  $("#hud-bar").style.width = r && r.matches.length ? `${(100 * doneCount(r)) / r.matches.length}%` : "0%";
  $("#hud-players").textContent = `PLAYERS ${S.error ? 0 : activePlayers().length}`;
}

// ------------------------------------------------------------------ Ansagen (ROUND 1 … FIGHT!)

let announceQueue = Promise.resolve();
function announce(...words) {
  announceQueue = announceQueue.then(async () => {
    const box = $("#announce");
    for (const word of words) {
      box.textContent = word;
      box.hidden = false;
      box.classList.remove("go");
      void box.offsetWidth;
      box.classList.add("go");
      await new Promise((r) => setTimeout(r, 900));
    }
    box.hidden = true;
  });
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
      if (res.ok) { draft = null; sfx.fight(); announce(`ROUND ${next}`, "FIGHT!"); }
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
  }, avatar(pname(id), "avatar-xs"), pname(id));
}

// ---- Laufende Runde: Courts und Resultate

function courtsView(rnd) {
  const box = el("div", { class: "courts" });
  box.append(el("h3", { class: "view-title" },
    `ROUND ${rnd.number}${rnd.manual ? " (ANGEPASST)" : ""} · ${doneCount(rnd)}/${rnd.matches.length} COURTS`));
  box.append(el("p", { class: "hint" },
    "Sieger antippen: 2:0 oder 2:1. ⇄ bei zwei Teams = Teams tauschen. (Zahl) = Teampunkte vor der Runde."));
  box.append(el("button", { class: "key key-show", onclick: openShow }, "▶ SHOW · VOLLBILD FÜR ZUSCHAUER"));
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
        team.map((id) => avatar(pname(id), "avatar-xs")),
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
  const m2 = r.matches.find((x) => x.id === m.id) || S.rounds.flatMap((x) => x.matches).find((x) => x.id === m.id);
  const perfect = m2 && m2.result && Math.min(m2.result.sets_a, m2.result.sets_b) === 0;
  sfx.punch();
  if (wasRunning && r.number === wasRunning.number && r.finished) {
    announce(perfect ? "PERFECT!" : "K.O.!", `ROUND ${r.number} CLEAR!`);
    setTimeout(() => sfx.fanfare(), 900);
    toast(`ROUND ${r.number} COMPLETE! ${quoteFor(r.number)}`, "jonas");
  } else {
    announce(perfect ? "PERFECT!" : "K.O.!");
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
      avatar(p.name, "avatar-sm"),
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

// ------------------------------------------------------------------ Avatare

// Bilder liegen in web/avatars/, Dateiname = Spielername (z.B. "Anna Lena.jpg").
// avatars/index.json listet sie (erzeugt von tools/build_site.py).
const AVATARS = {}; // normalisierter Name -> URL
const AVATAR_PX = 72; // Fotos werden auf 72x72 Pixel verkleinert -> Retro-Pixel-Look

const normName = (name) => name.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

async function loadAvatars() {
  try {
    const files = await (await fetch("avatars/index.json", { cache: "no-cache" })).json();
    for (const file of files) {
      AVATARS[normName(file.replace(/\.[^.]+$/, ""))] = "avatars/" + encodeURIComponent(file);
    }
  } catch { /* keine Avatare -> erzeugte Pixel-Gesichter */ }
}

function hashString(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

/** Avatar als Canvas: Foto (verpixelt, quadratisch zugeschnitten) oder erzeugtes Pixel-Gesicht. */
function avatar(name, size = "") {
  const canvas = el("canvas", { class: `avatar ${size}`, width: AVATAR_PX, height: AVATAR_PX, "aria-label": name });
  const ctx2 = canvas.getContext("2d");
  pixelFace(ctx2, name);
  const url = AVATARS[normName(name)];
  if (url) {
    const img = new Image();
    img.onload = () => {
      // Porträts: quadratischer Ausschnitt, eher oben (Gesicht), nicht mittig
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2;
      const sy = Math.max(0, (img.height - s) * 0.2);
      ctx2.imageSmoothingQuality = "high";
      ctx2.drawImage(img, sx, sy, s, s, 0, 0, AVATAR_PX, AVATAR_PX);
    };
    img.src = url;
  }
  return canvas;
}

/** Erzeugtes Pixel-Gesicht (12x12), Farben aus dem Namen abgeleitet – für Spieler ohne Bild. */
function pixelFace(c, name) {
  const h = hashString(name);
  const pick = (list, shift) => list[(h >>> shift) % list.length];
  const bg = pick(["#2d6cdf", "#b5111a", "#3a2a58", "#1f6a4a", "#8a5a10", "#5a2a6a"], 0);
  const skin = pick(["#fce0a8", "#fcb8a0", "#e4a46c", "#ac7c00", "#fca044"], 3);
  const hair = pick(["#000000", "#503000", "#ac7c00", "#a81000", "#7c7c7c", "#f8b800"], 6);
  const shirt = pick(["#e9e6f2", "#1a1420", "#f2c14e", "#2c2a33", "#e0262f"], 9);
  const long = (h >>> 12) & 1;
  const map = [
    "............",
    "...HHHHHH...",
    "..HHHHHHHH..",
    "..HSSSSSSH..",
    "..SSESSESS..",
    "..SSSSSSSS..",
    "..SSSMMSSS..",
    "...SSSSSS...",
    long ? "..HSSSSSSH.." : "....SSSS....",
    ".TTTTTTTTTT.",
    "TTTTTTTTTTTT",
    "TTTTTTTTTTTT",
  ];
  const colors = { H: hair, S: skin, E: "#000000", M: "#a81000", T: shirt };
  const cell = AVATAR_PX / 12;
  c.fillStyle = bg;
  c.fillRect(0, 0, AVATAR_PX, AVATAR_PX);
  map.forEach((row, y) => [...row].forEach((ch, x) => {
    if (colors[ch]) {
      c.fillStyle = colors[ch];
      c.fillRect(x * cell, y * cell, cell, cell);
    }
  }));
}

// ------------------------------------------------------------------ SHOW (Vollbild-Diashow)

const SHOW_SECONDS = 10;
let showTimer = null;
let showCurrent = null; // Schlüssel der angezeigten Folie
let wakeLock = null;
let showSlideStart = 0;
let showTick = null;

/** Countdown oben in der Mitte: Sekunden bis zur nächsten Partie. */
function updateShowTimers() {
  const left = Math.max(0, Math.ceil(SHOW_SECONDS - (Date.now() - showSlideStart) / 1000));
  document.querySelectorAll("#show [data-timer]").forEach((t) => { t.textContent = String(left).padStart(2, "0"); });
}

function openShow() {
  const box = $("#show");
  box.hidden = false;
  document.body.classList.add("show-on");
  if (box.requestFullscreen) box.requestFullscreen().catch(() => { /* z.B. iPhone: Overlay reicht */ });
  try { navigator.wakeLock?.request("screen").then((l) => { wakeLock = l; }).catch(() => {}); } catch { /* egal */ }
  showCurrent = null;
  showNext();
  clearInterval(showTimer);
  showTimer = setInterval(showNext, SHOW_SECONDS * 1000);
  clearInterval(showTick);
  showTick = setInterval(updateShowTimers, 250);
  sfx.start();
}

function closeShow() {
  clearInterval(showTimer);
  clearInterval(showTick);
  showTimer = null;
  $("#show").hidden = true;
  $("#show-stage").replaceChildren();
  document.body.classList.remove("show-on");
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

/** Folien: jede laufende Partie (ohne Resultat); sonst Zwischenstand. */
function showSlides() {
  if (!S || S.error) return [{ key: "empty", render: () => showMessage("INSERT COIN", "KEINE TURNIERDATEN") }];
  const rnd = runningRound();
  const open = rnd ? rnd.matches.filter((m) => !m.result) : [];
  if (open.length) {
    return open.map((m, i) => ({ key: m.id, cls: "slide-vs", render: () => matchSlide(rnd, m, i + 1, open.length) }));
  }
  return [{ key: "scores", cls: "slide-scores", render: () => scoresSlide() }];
}

function showNext() {
  if (bridge) S = JSON.parse(bridge.state()); // immer den aktuellen Stand anzeigen
  const slides = showSlides();
  const pos = slides.findIndex((s) => s.key === showCurrent);
  const slide = slides[(pos + 1) % slides.length];
  const stage = $("#show-stage");
  const old = [...stage.children];
  const node = el("div", { class: `slide ${slide.cls || ""}` }, slide.render());
  showSlideStart = Date.now();
  stage.append(node);
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add("in")));
  old.forEach((o) => {
    o.classList.remove("in");
    setTimeout(() => o.remove(), 1200);
  });
  showCurrent = slide.key;
  // Fortschrittsbalken neu starten
  const bar = $("#show-progress");
  bar.style.animation = "none";
  void bar.offsetWidth;
  bar.style.animation = `show-progress ${SHOW_SECONDS}s linear forwards`;
}

function showTeam(team, strength) {
  return el("div", { class: "show-team" },
    el("div", { class: "show-avatars" }, team.map((id) => avatar(pname(id)))),
    el("div", { class: "show-names" }, team.map((id) => el("span", {}, pname(id).toUpperCase()))),
    el("div", { class: "show-strength" }, `${strength} PTS`));
}

function fightSide(team, side) {
  return el("div", { class: `fh-side ${side}` },
    el("div", { class: "fh-name" }, team.map(pname).join(" & ").toUpperCase()),
    el("div", { class: "bar" }, el("div", { class: "bar-fill full" })));
}

function matchSlide(rnd, m, n, total) {
  return [
    el("div", { class: "fight-hud" },
      fightSide(m.team_a, "left"),
      el("div", { class: "fh-timer", "data-timer": "" }, String(SHOW_SECONDS)),
      fightSide(m.team_b, "right")),
    el("div", { class: "show-match" },
      showTeam(m.team_a, m.strength_a),
      el("div", { class: "show-vs" }, "VS"),
      showTeam(m.team_b, m.strength_b)),
    el("div", { class: "show-foot" }, `ROUND ${rnd.number} · COURT ${m.court} · ${n}/${total}`),
    el("div", { class: "show-live" }, "FIGHT!"),
  ];
}

function scoresSlide() {
  const last = currentRound();
  const top = S.standings.slice(0, 5);
  return [
    el("div", { class: "show-head" },
      el("span", {}, last ? `ROUND ${last.number}` : S.name.toUpperCase()),
      el("span", { class: "show-court" }, last ? "COMPLETE!" : "GET READY"),
      el("span", {}, "")),
    el("div", { class: "show-title" }, "HIGH SCORES"),
    el("div", { class: "show-scores" }, top.map((s) => el("div", { class: "show-score-row" },
      el("span", { class: "show-rank" }, ORDINAL(s.rank)),
      avatar(s.name),
      el("span", { class: "show-score-name" }, s.name.toUpperCase()),
      el("span", { class: "show-score-pts" }, String(s.points).padStart(3, "0"))))),
    last ? el("div", { class: "show-live show-quote" }, `COACH JONAS: ${quoteFor(last.number)}`) : null,
  ];
}

function showMessage(title, sub) {
  return [el("div", { class: "show-title" }, title), el("div", { class: "show-live" }, sub)];
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

// ------------------------------------------------------------------ Pixel-Szene (16-Bit-Arena: Strand bei Nacht)

const scene = $("#scene");
const ctx = scene.getContext("2d");
const W = scene.width; // 256
const H = scene.height; // 128
const HORIZON = 70; // Unterkante Skyline / Beginn Meer
const GROUND = 100; // Beginn Sand

// Kämpfer (schaut nach rechts): k Umriss, H/h Haar, B/b Stirnband, S/s Haut, T/t Oberteil, P/p Hose, G Handschuh, W Gurt/Schuh
const FIGHTER = [
  "......kkkk......",
  ".....kHHHHk.....",
  "....kHHHHHHk....",
  "..bbkBBBBBBk....",
  ".b..kSSSSSSk....",
  "....kSSSkSSk....",
  "....kSSSSSsk....",
  ".....ksSSsk.....",
  "......kSSk......",
  "...kkkTTTTkkk...",
  "..kSSTTTTTTSSkk.",
  ".kSSkTTTTTTkSSGk",
  ".kSkkTTtTTTkkkGk",
  "kGGk.kTTtTTk..k.",
  "kGGk.kTTTTTk....",
  ".kk..kkWWWkk....",
  ".....kPPPPPk....",
  "....kPPPkPPPk...",
  "....kPPk.kPPk...",
  "...kPPk...kPPk..",
  "...kPpk...kPpk..",
  "..kPPk.....kPPk.",
  "..kPpk.....kPpk.",
  "..kSSk.....kSSk.",
  ".kWWWk....kWWWk.",
  ".kkkkk....kkkkk.",
];
const P1 = { k: "#0a0610", H: "#1a1420", B: "#e0262f", b: "#7a0d14", S: "#f2b98a", s: "#b97650", T: "#e9e6f2",
  t: "#9e9ab4", P: "#2d50a0", p: "#18285e", G: "#e0262f", W: "#f2c14e" };
const P2 = { k: "#0a0610", H: "#b0201a", B: "#f2c14e", b: "#8a5a10", S: "#d79a6a", s: "#9a5e36", T: "#2c2a33",
  t: "#15141a", P: "#7a0d14", p: "#3d050b", G: "#2d6cdf", W: "#e9e6f2" };
const PLANE_FONT = {
  A: [".#.", "#.#", "###", "#.#", "#.#"], B: ["##.", "#.#", "##.", "#.#", "##."], D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"], H: ["#.#", "#.#", "###", "#.#", "#.#"], I: ["###", ".#.", ".#.", ".#.", "###"],
  L: ["#..", "#..", "#..", "#..", "###"], R: ["##.", "#.#", "##.", "#.#", "#.#"], T: ["###", ".#.", ".#.", ".#.", ".#."],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."], 4: ["#.#", "#.#", "###", "..#", "..#"], 0: ["###", "#.#", "#.#", "#.#", "###"],
  " ": ["...", "...", "...", "...", "..."],
};

function px(x, y, color, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function sprite(rows, x, y, colors, flip = false) {
  const palette = typeof colors === "string" ? { "#": colors } : colors;
  rows.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      const color = palette[ch];
      if (color) px(flip ? x + row.length - 1 - dx : x + dx, y + dy, color);
    });
  });
}

function text3x5(str, x, y, color) {
  [...str].forEach((ch, k) => sprite(PLANE_FONT[ch] || PLANE_FONT[" "], x + k * 4, y, color));
}

// Feste Zufallswerte (Skyline, Fenster, Publikum) – sieht bei jedem Laden gleich aus
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedRand = seeded(40);
const BUILDINGS = [];
for (let x = 0; x < W;) {
  const w = 14 + Math.floor(seedRand() * 22);
  const h = 14 + Math.floor(seedRand() * 34);
  const windows = [];
  for (let wy = HORIZON - h + 4; wy < HORIZON - 3; wy += 5) {
    for (let wx = x + 3; wx < x + w - 3; wx += 4) {
      if (seedRand() < 0.38) windows.push([wx, wy, seedRand() < 0.15]);
    }
  }
  BUILDINGS.push({ x, w, h, shade: seedRand() < 0.5 ? "#1a1230" : "#140d26", windows });
  x += w + (seedRand() < 0.3 ? 2 : 0);
}
const SIGN_BUILDING = BUILDINGS.reduce((a, b) => (b.x > 120 && b.x < 200 && b.h > a.h ? b : a), { h: 0 });
const STARS = Array.from({ length: 40 }, () => [Math.floor(seedRand() * W), Math.floor(seedRand() * 40), seedRand()]);
const CROWD = Array.from({ length: 34 }, (_, i) => ({ x: 4 + i * 7.5 + seedRand() * 3, h: seedRand(), arm: seedRand() < 0.35, tone: seedRand() }));

function lerpColor(a, b, t) {
  const pa = a.match(/\w\w/g).map((v) => parseInt(v, 16));
  const pb = b.match(/\w\w/g).map((v) => parseInt(v, 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

function drawScene(time) {
  // Nachthimmel: Verlauf in Stufen (16-Bit-Banding)
  const stops = ["#07051a", "#1a0f3a", "#3a1650", "#6a1f4e"];
  for (let y = 0; y < HORIZON; y += 3) {
    const t = Math.floor((y / HORIZON) * 12) / 12;
    const seg = Math.min(2, Math.floor(t * 3));
    px(0, y, lerpColor(stops[seg], stops[seg + 1], t * 3 - seg), W, 3);
  }
  for (const [sx, sy, ph] of STARS) {
    if (Math.sin(time / 500 + ph * 20) > -0.3) px(sx, sy, ph > 0.8 ? "#ffffff" : "#9c8fc8");
  }
  // Mond
  for (let dy = -11; dy <= 11; dy++) {
    const half = Math.floor(Math.sqrt(121 - dy * dy));
    px(36 - half, 22 + dy, dy < -3 ? "#fff6d8" : "#f2e2b0", half * 2 + 1, 1);
  }
  px(30, 18, "#d9c690", 4, 3); px(40, 26, "#d9c690", 3, 3); px(34, 28, "#d9c690", 2, 2);

  // Skyline mit Fenstern
  for (const b of BUILDINGS) {
    px(b.x, HORIZON - b.h, b.shade, b.w, b.h);
    px(b.x, HORIZON - b.h, "#2a1d45", b.w, 1);
    for (const [wx, wy, flick] of b.windows) {
      const on = !flick || Math.sin(time / 300 + wx * 3.1 + wy) > -0.2;
      if (on) px(wx, wy, (wx + wy) % 3 ? "#ffcf5a" : "#ff9a3c", 2, 2);
    }
  }
  // Neonschild auf dem höchsten Haus
  if (SIGN_BUILDING.h) {
    const label = "BIRTHDAY BATTLE 40";
    const sw = label.length * 4 + 5;
    const sx = Math.max(2, Math.min(W - sw - 2, SIGN_BUILDING.x + SIGN_BUILDING.w / 2 - sw / 2));
    const sy = HORIZON - SIGN_BUILDING.h - 13;
    px(sx + 4, sy + 11, "#2a1d45", 1, 2); px(sx + sw - 5, sy + 11, "#2a1d45", 1, 2);
    px(sx, sy, "#120a1c", sw, 11);
    const flicker = Math.sin(time / 90) > 0.93 || Math.sin(time / 1700) > 0.985;
    if (!flicker) {
      ctx.globalAlpha = 0.35;
      px(sx - 2, sy - 2, "#ff2f8e", sw + 4, 15);
      ctx.globalAlpha = 1;
    }
    px(sx, sy, "#ff2f8e", sw, 1); px(sx, sy + 10, "#ff2f8e", sw, 1);
    px(sx, sy, "#ff2f8e", 1, 11); px(sx + sw - 1, sy, "#ff2f8e", 1, 11);
    text3x5(label, sx + 3, sy + 3, flicker ? "#5a1838" : (Math.floor(time / 600) % 2 ? "#ffd1ea" : "#ff7ac0"));
  }

  // Meer mit Mondspiegelung
  for (let y = HORIZON; y < HORIZON + 10; y += 2) px(0, y, y % 4 ? "#0c1240" : "#121a55", W, 2);
  for (let k = 0; k < 7; k++) {
    const wob = Math.sin(time / 300 + k) * 3;
    px(30 + wob - k, HORIZON + 1 + k, "#f2e2b0", 8 + k, 1);
  }

  // Publikum (Silhouetten) hinter dem Maschendrahtzaun
  const fenceTop = HORIZON + 8;
  px(0, fenceTop, "#0b0712", W, GROUND - fenceTop);
  for (const c of CROWD) {
    const jump = Math.sin(time / 170 + c.x) > 0.55 ? -2 : 0;
    const top = fenceTop + 6 + Math.floor(c.h * 4) + jump;
    const body = c.tone > 0.5 ? "#231833" : "#1b1229";
    px(c.x, top + 4, body, 6, GROUND - top - 4);
    px(c.x + 1, top, c.tone > 0.7 ? "#3a2a48" : "#2c2040", 4, 4);
    if (c.arm) px(c.x + (c.tone > 0.5 ? -1 : 6), top - 3 + jump, body, 1, 7);
  }
  // Zaun
  for (let y = fenceTop; y < GROUND; y++) {
    for (let x = (y % 4); x < W; x += 4) {
      if ((x + y) % 8 === 0 || (x - y + 800) % 8 === 0) px(x, y, "#5a5870");
    }
  }
  px(0, fenceTop, "#8a88a0", W, 1);
  for (let x = 6; x < W; x += 40) px(x, fenceTop, "#6a6880", 2, GROUND - fenceTop);

  // Sand bei Nacht mit Lichtkegeln der Laternen
  for (let y = GROUND; y < H; y++) {
    const t = (y - GROUND) / (H - GROUND);
    px(0, y, lerpColor("#4a3638", "#7a5a48", t), W, 1);
  }
  for (const lx of [40, 216]) {
    for (let y = GROUND; y < H; y++) {
      const half = Math.floor(10 + (y - GROUND) * 1.4);
      ctx.globalAlpha = 0.22 + 0.14 * ((y - GROUND) / (H - GROUND));
      px(lx - half, y, "#ffcf7a", half * 2, 1);
    }
    ctx.globalAlpha = 1;
  }
  for (let y = GROUND + 2; y < H; y += 4) {
    for (let x = (y * 5) % 9; x < W; x += 9) px(x, y, "#2a1e24");
  }
  // Laternen
  for (const lx of [40, 216]) {
    px(lx - 1, 48, "#2a2836", 2, GROUND - 46);
    px(lx - 5, 46, "#3a3848", 10, 3);
    px(lx - 3, 49, "#fff1b0", 6, 2);
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = "#ffcf7a";
    ctx.beginPath();
    ctx.moveTo(lx - 3, 50); ctx.lineTo(lx + 3, 50); ctx.lineTo(lx + 26, GROUND + 6); ctx.lineTo(lx - 26, GROUND + 6);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Brennende Ölfässer
  for (const bx of [6, W - 20]) {
    px(bx, 104, "#0a0610", 14, 20);
    px(bx + 1, 105, "#6a3218", 12, 18);
    px(bx + 1, 105, "#8a4a24", 3, 18);
    px(bx + 1, 109, "#3a1a0c", 12, 2); px(bx + 1, 117, "#3a1a0c", 12, 2);
    for (let fx = 0; fx < 12; fx++) {
      const h = 4 + Math.floor((Math.sin(time / 70 + fx * 1.9 + bx) + 1) * 4 + (fx % 3));
      px(bx + 1 + fx, 104 - h, "#d81920", 1, h);
      px(bx + 1 + fx, 104 - h + 2, "#ff6a12", 1, Math.max(0, h - 2));
      if (fx > 2 && fx < 10) px(bx + 1 + fx, 104 - h + 4, "#ffd23f", 1, Math.max(0, h - 4));
    }
    ctx.globalAlpha = 0.14;
    px(bx - 10, 92, "#ff6a12", 34, 34);
    ctx.globalAlpha = 1;
  }

  // Netz
  const cx = W / 2;
  px(cx - 1, 84, "#c8c6d8", 2, 40);
  px(cx - 1, 84, "#f3efe6", 2, 2);
  for (let y = 86; y < 100; y += 2) px(cx - 1, y, "#5a5870", 2, 1);
  px(cx - 1, 100, "#f3efe6", 2, 1);

  // Kämpfer: wippen in Kampfhaltung
  const baseY = H - 28;
  const bob = (phase) => (Math.floor(time / 240 + phase) % 2 ? 1 : 0);
  px(cx - 66, H - 3, "rgba(0,0,0,.45)", 16, 2);
  px(cx + 50, H - 3, "rgba(0,0,0,.45)", 16, 2);
  sprite(FIGHTER, cx - 66, baseY + bob(0), P1);
  sprite(FIGHTER, cx + 50, baseY + bob(1), P2, true);

  // Ball: Bogen über das Netz
  const t = (time / 1600) % 2;
  const p = t < 1 ? t : 2 - t;
  const ballX = cx - 46 + p * 92;
  const ballY = baseY + 6 - Math.sin(p * Math.PI) * 44;
  px(ballX - 2, ballY - 1, "#0a0610", 6, 4); px(ballX - 1, ballY - 2, "#0a0610", 4, 6);
  px(ballX - 1, ballY - 1, "#f3efe6", 4, 4);
  px(ballX, ballY - 1, "#f2c14e", 1, 4);
  px(ballX - 1, H - 4, "rgba(0,0,0,.35)", 4, 1);

  // Vignette
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.62);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function animate(time) {
  drawScene(time);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) requestAnimationFrame(animate);
}

// ------------------------------------------------------------------ Events

$("#start").addEventListener("click", startGame);
$("#show-open").addEventListener("click", openShow);
$("#show-close").addEventListener("click", closeShow);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#show").hidden) closeShow(); });
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && !$("#show").hidden) closeShow(); });
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
