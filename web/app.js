// Beach Volley Arcade – Browser-Oberfläche für das Python-Text-UI.
// Python (Pyodide) führt den unveränderten Code aus beachturnier/ aus;
// die Turnierdatei wird nach jedem Befehl im localStorage gesichert.

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
const STORE_FILE = "beachturnier.file";
const STORE_SOUND = "beachturnier.sound";

const $ = (sel) => document.querySelector(sel);
let bridge = null;
let fileDirty = false;
const history = [];
let historyPos = 0;

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
  $("#attract").hidden = true;
  $("#game").hidden = false;
  print(bridge.start(recall(STORE_FILE) || null));
  persist();
  $("#cmd").focus();
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

const BIRTHDAY_ART = `
      )    )    )    )
     (    (    (    (
     _|____|____|____|_
    |~~~~~~~~~~~~~~~~~~|
    | BIRTHDAY  BATTLE |
   _|__________________|_
  |~~~~~~~~~~~~~~~~~~~~~~|
  |   COACH JONAS  *40*  |
  |______________________|

  ██╗  ██╗ ██████╗
  ██║  ██║██╔═████╗
  ███████║██║██╔██║
  ╚════██║████╔╝██║
       ██║╚██████╔╝
       ╚═╝ ╚═════╝

  ★ 40 JAHRE. 0 PAUSEN. ★
  LET THE BIRTHDAY BATTLE BEGIN!`;

function trainerSays() {
  const quote = TRAINER_QUOTES[Math.floor(Math.random() * TRAINER_QUOTES.length)];
  print(`COACH JONAS (40): ${quote}`, "jonas");
}

function mountPosters() {
  const tpl = $("#poster-template");
  document.querySelectorAll(".poster-slot").forEach((slot) => slot.replaceChildren(tpl.content.cloneNode(true)));
}

// ------------------------------------------------------------------ Terminal

const LINE_CLASSES = [
  [/^(Fehler|Unbekannter Befehl|TILT)/, "err"],
  [/^(Achtung|Abgebrochen)|nicht eindeutig/, "warn"],
  [/^===|Rangliste|^Vorschlag:|^Befehle/, "head"],
  [/^Court \d|^Freilos:|^Pause:/, "court"],
  [/gewinnt|komplett|erfasst|Rückgängig|angelegt|GAME OVER/, "ok"],
  [/^\(Zahl|^Sp=|^ Rg /, "dim"],
];

function print(text, cls) {
  const log = $("#log");
  for (const line of text.replace(/\n$/, "").split("\n")) {
    const div = document.createElement("div");
    div.textContent = line || " ";
    const found = cls || (LINE_CLASSES.find(([re]) => re.test(line)) || [])[1];
    if (found) div.className = found;
    log.appendChild(div);
  }
  while (log.childElementCount > 1500) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

function run(line) {
  line = line.trim();
  if (!line || !bridge) return;
  history.push(line);
  historyPos = history.length;
  print("> " + line, "echo");
  if (/^(jonas|coach|40|geburtstag|birthday battle)$/i.test(line)) {
    print(BIRTHDAY_ART, "jonas");
    sfx.birthday();
    return;
  }
  if (/^(ende|exit|quit)$/i.test(line)) {
    print("GAME OVER – alles gespeichert. INSERT COIN TO CONTINUE.");
    sfx.fanfare();
    return;
  }
  const out = bridge.run(line);
  print(out);
  persist();
  if (/^Fehler|^Unbekannter/m.test(out)) sfx.error();
  else if (/komplett/.test(out)) { sfx.fanfare(); trainerSays(); }
  else if (/^=== Runde/m.test(out) && /^runde/i.test(line)) sfx.start();
  else sfx.blip();
  if (!$("#tab-scores").hidden) renderScores();
}

function persist() {
  store(STORE_FILE, bridge.read_file());
  renderHud();
}

function info() {
  return JSON.parse(bridge.info());
}

function renderHud() {
  const i = info();
  if (i.error) {
    $("#hud-round").textContent = "DATEI-FEHLER";
    return;
  }
  $("#hud-round").textContent = `ROUND ${i.round}`;
  $("#hud-courts").textContent = `COURTS ${i.done}/${i.total}`;
  $("#hud-players").textContent = `PLAYERS ${i.players}`;
}

// ------------------------------------------------------------------ Highscore

const ORDINAL = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? "ST" : n % 10 === 2 && n % 100 !== 12 ? "ND"
  : n % 10 === 3 && n % 100 !== 13 ? "RD" : "TH");
const RANK_COLORS = ["var(--yellow)", "var(--orange)", "var(--magenta)", "var(--cyan)", "var(--green)"];

function renderScores() {
  const i = info();
  const box = $("#scores");
  box.replaceChildren();
  if (i.error) {
    box.innerHTML = '<p class="empty">DATEI-FEHLER – SIEHE TAB DATEI</p>';
    return;
  }
  $("#scores-sub").textContent = i.round
    ? `${i.name.toUpperCase()} · ROUND ${i.round} · ${i.done}/${i.total} COURTS`
    : i.name.toUpperCase();
  if (!i.standings.length) {
    box.innerHTML = '<p class="empty">NO PLAYERS YET – INSERT PLAYERS</p>';
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
  row(["RANK", "NAME", "PTS", "W-L", "BH"], "header");
  i.standings.forEach((s) => {
    row(
      [ORDINAL(s.rank), s.name.toUpperCase(), String(s.points).padStart(3, "0"),
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
  persist();
  const msg = $("#file-msg");
  msg.className = "file-msg " + (err ? "err" : "ok");
  msg.textContent = err ? "FEHLER: " + err : "GESPEICHERT ✓";
  err ? sfx.error() : sfx.coin();
}

function download() {
  const text = bridge.read_file();
  const name = (info().name || "turnier").toLowerCase().replace(/[^a-z0-9äöü]+/g, "-").replace(/^-|-$/g, "");
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
  print(bridge.start(null));
  persist();
  loadFileTab();
}

// ------------------------------------------------------------------ Tabs

function showTab(name) {
  if (fileDirty && !$("#tab-file").hidden && name !== "file") {
    if (confirm("Änderungen an der Datei speichern?")) saveFileTab();
    else fileDirty = false;
  }
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  for (const tab of ["terminal", "scores", "file", "jonas"]) $("#tab-" + tab).hidden = tab !== name;
  if (name === "scores") renderScores();
  if (name === "file") loadFileTab();
  if (name === "jonas") sfx.birthday();
  if (name === "terminal") $("#cmd").focus();
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
$("#prompt").addEventListener("submit", (e) => {
  e.preventDefault();
  run($("#cmd").value);
  $("#cmd").value = "";
});
$("#cmd").addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" && historyPos > 0) {
    $("#cmd").value = history[--historyPos];
    e.preventDefault();
  } else if (e.key === "ArrowDown") {
    historyPos = Math.min(history.length, historyPos + 1);
    $("#cmd").value = history[historyPos] || "";
    e.preventDefault();
  }
});
document.querySelectorAll(".key[data-cmd]").forEach((b) => b.addEventListener("click", () => run(b.dataset.cmd)));
document.querySelectorAll(".key[data-fill]").forEach((b) => b.addEventListener("click", () => {
  $("#cmd").value = b.dataset.fill;
  $("#cmd").focus();
}));
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
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
