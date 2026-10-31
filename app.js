// Paper Trail: guess the player from his career path.
// Progress lives in localStorage and is written after every guess.

const KEY = "journeyman.v1"; // old name kept so saved scores carry over
const LIVES = 3;
const POINTS = { base: 100, wrong: 25, hint: 30, min: 10 };

const $ = id => document.getElementById(id);
const fold = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ø/g, "o").replace(/ı/g, "i").toLowerCase();

const POOLS = {
  football: FOOTBALL.map(toPlayer),
  basketball: BASKETBALL.map(toPlayer),
};
function toPlayer([name, country, position, career]) {
  return { id: fold(name), name, country, position, career };
}
// Everything the search can suggest: the pool plus decoy names.
const SEARCH = {};
for (const s of Object.keys(POOLS)) {
  const ids = new Set(POOLS[s].map(p => p.id));
  SEARCH[s] = POOLS[s].concat(DECOYS[s].map(name => ({ id: fold(name), name })).filter(p => !ids.has(p.id)));
}
const touch = matchMedia("(pointer: coarse)").matches;

// ---------- storage ----------
let db = load();
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { last: "", profiles: {} }; }
  catch { return { last: "", profiles: {} }; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
}
function profile(name) {
  const p = db.profiles[name] ||= {};
  for (const s of Object.keys(POOLS)) p[s] ||= { score: 0, played: 0, correct: 0, streak: 0, best: 0, seen: [], current: null };
  return p;
}

// ---------- home ----------
const nameInput = $("name");
nameInput.value = db.last || "";
nameInput.addEventListener("input", renderHome);

// "bemo" and "Bemo" are the same player.
function currentName() {
  const typed = nameInput.value.trim();
  return Object.keys(db.profiles).find(n => n.toLowerCase() === typed.toLowerCase()) || typed;
}

function renderHome() {
  const names = Object.keys(db.profiles);
  const typed = currentName();
  $("profiles").innerHTML = names.map(n =>
    `<button data-name="${esc(n)}" class="${n === typed ? "on" : ""}">${esc(n)}</button>`).join("");

  const p = typed && db.profiles[typed];
  for (const s of Object.keys(POOLS)) {
    const st = p && p[s];
    document.querySelector(`[data-sub="${s}"]`).textContent = st && st.played
      ? `${st.score} pts · ${st.correct} of ${st.played} right`
      : `${POOLS[s].length} players`;
  }

  renderBoard();
}

// ---------- shared leaderboard (Firestore REST, no SDK) ----------
// One row per player name per phone. The web key is public by design; the
// Firestore rules only allow well-formed score rows and no deletes.
const FS = "https://firestore.googleapis.com/v1/projects/paper-trail-bemo/databases/(default)/documents";
const FS_KEY = "AIzaSyCPPBlSuxRnHPndgxOl3BszR5ovMyLjssw";
const device = (() => {
  try {
    let d = localStorage.getItem("pt.device");
    if (!d) { d = Math.random().toString(36).slice(2, 10); localStorage.setItem("pt.device", d); }
    return d;
  } catch { return "nostore"; }
})();
const rowId = name => device + "-" + (fold(name).replace(/[^a-z0-9]+/g, "") || "x").slice(0, 40);
let board = null; // rows from the server, or null when offline

function pushScore(name) {
  const p = profile(name), f = p.football, b = p.basketball;
  if (!f.played && !b.played) return Promise.resolve();
  const int = n => ({ integerValue: String(n) });
  const fields = {
    name: { stringValue: name }, fb: int(f.score), bb: int(b.score), total: int(f.score + b.score),
    best: int(Math.max(f.best, b.best)), played: int(f.played + b.played), correct: int(f.correct + b.correct),
    updated: { timestampValue: new Date().toISOString() },
  };
  return fetch(`${FS}/scores/${rowId(name)}?key=${FS_KEY}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }),
  }).catch(() => {});
}

async function loadBoard() {
  try {
    const r = await fetch(`${FS}:runQuery?key=${FS_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "scores" }], orderBy: [{ field: { fieldPath: "total" }, direction: "DESCENDING" }], limit: 50 } }),
    });
    if (!r.ok) throw new Error(r.status);
    board = (await r.json()).filter(x => x.document).map(x => {
      const f = x.document.fields;
      return { id: x.document.name.split("/").pop(), n: f.name.stringValue, fb: +f.fb.integerValue, bb: +f.bb.integerValue, total: +f.total.integerValue };
    });
  } catch { board = null; }
  renderBoard();
}

function renderBoard() {
  const mine = id => id.startsWith(device + "-");
  // Offline: fall back to the scores saved on this phone.
  const rows = board || Object.keys(db.profiles).map(n => {
    const p = profile(n);
    return { id: rowId(n), n, fb: p.football.score, bb: p.basketball.score, total: p.football.score + p.basketball.score };
  }).filter(r => r.total > 0).sort((a, b) => b.total - a.total);
  $("board").hidden = rows.length === 0;
  $("board-title").textContent = board ? "Leaderboard" : "Scores on this phone";
  $("board-table").innerHTML = `<tr><th>#</th><th>Name</th><th>Football</th><th>Basketball</th><th>Total</th></tr>` +
    rows.map((r, i) => `<tr class="${mine(r.id) ? "me" : ""}"><td>${i + 1}</td><td>${esc(r.n)}</td><td>${r.fb}</td><td>${r.bb}</td><td>${r.total}</td></tr>`).join("");
}

// Upload whatever this phone already has (scores from before the leaderboard existed), then show the board.
async function syncAll() {
  await Promise.all(Object.keys(db.profiles).map(pushScore));
  loadBoard();
}

$("profiles").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  nameInput.value = b.dataset.name;
  renderHome();
});

document.querySelectorAll(".sport").forEach(b => b.addEventListener("click", () => {
  const name = currentName();
  if (!name) {
    nameInput.focus();
    nameInput.animate([{ transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "none" }], 240);
    return;
  }
  db.last = name;
  profile(name);
  save();
  startGame(name, b.dataset.sport);
}));

// ---------- game ----------
let G = null; // { name, sport, stats, player, round }

// The game screen is exactly as tall as what's visible, so the phone keyboard
// pushes the guess box up instead of covering it.
function fitViewport() {
  const h = window.visualViewport ? visualViewport.height : innerHeight;
  document.documentElement.style.setProperty("--vh", h + "px");
  if (G) scrollTo(0, 0);
}
window.visualViewport?.addEventListener("resize", fitViewport);
addEventListener("resize", fitViewport);

function startGame(name, sport) {
  const stats = profile(name)[sport];
  G = { name, sport, stats };
  document.body.className = sport;
  $("home").hidden = true;
  $("game").hidden = false;
  // Resume an unfinished round so a refresh can't skip a player.
  if (stats.current && POOLS[sport].some(p => p.id === stats.current.id)) loadRound();
  else nextRound();
}

function nextRound() {
  const pool = POOLS[G.sport];
  let fresh = pool.filter(p => !G.stats.seen.includes(p.id));
  if (!fresh.length) { G.stats.seen = []; fresh = pool; }
  const pick = fresh[Math.floor(Math.random() * fresh.length)];
  G.stats.current = { id: pick.id, wrong: [], hint: false, done: false };
  save();
  loadRound();
}

function loadRound() {
  const cur = G.stats.current;
  G.player = POOLS[G.sport].find(p => p.id === cur.id);
  G.round = cur;
  renderStats();
  renderGrid();
  renderAnswer();
  if (cur.done) showResult();
  else {
    $("result").hidden = true;
    $("answer").hidden = false;
    // On phones the keyboard would cover the clubs, so wait for a tap.
    if (!touch) setTimeout(() => input.focus(), 50);
  }
  $("grid").parentElement.scrollTop = 0;
}

function renderStats() {
  $("g-pts").textContent = `${G.stats.score} pts · run ${G.stats.streak}`;
  const total = POOLS[G.sport].length;
  const n = Math.min(G.stats.seen.length + (G.round.done ? 0 : 1), total);
  $("g-count").textContent = `${G.player.career.length} clubs · ${n}/${total}`;
}

function renderGrid() {
  $("grid").innerHTML = G.player.career.map(([club, from, to, loan], i) => {
    const t = team(club);
    return `<li class="cell ${loan ? "loan" : ""}" style="animation-delay:${i * 35}ms">
      <span class="n">${i + 1}</span>
      ${t.logo ? `<img src="${t.logo}" alt="">` : badge(t)}
      <span class="nm">${esc(t.name)}</span>
      <span class="y">${years(from, to)}</span>
    </li>`;
  }).join("");
  const h = $("hint");
  h.hidden = !G.round.hint;
  h.textContent = `${G.player.country} · ${G.player.position}`;
}

// '05–07, '16, '25–
function years(from, to) {
  const yy = y => "'" + String(y).slice(2);
  if (to === null) return `${yy(from)}–`;
  if (from === to) return yy(from);
  return `${yy(from)}–${String(to).slice(2)}`;
}

function team(club) {
  if (G.sport === "basketball") {
    const t = LOGOS.basketball[club];
    return { name: t.name, logo: t.logo, colors: t.colors };
  }
  return { name: club, logo: LOGOS.football[club], colors: null };
}

const BADGE_COLORS = ["#2D5DA8", "#B23A3A", "#1F7A5A", "#6B4AA0", "#C2852B", "#2C2F36", "#0E7C86"];
function badge(t) {
  const words = t.name.replace(/\b(FC|SC|CF|AC|AS|Al)\b/g, "").split(/[\s-]+/).filter(Boolean);
  const init = (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
  let [bg, ring] = t.colors || [];
  if (!bg) {
    let h = 0; for (const c of t.name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    bg = BADGE_COLORS[h % BADGE_COLORS.length];
  }
  return `<span class="badge" style="background:${bg};${ring ? `border-color:${ring}` : ""}">${esc(init)}</span>`;
}

function renderAnswer() {
  const left = LIVES - G.round.wrong.length;
  $("dots").innerHTML = Array.from({ length: LIVES }, (_, i) => `<i class="${i < left ? "" : "x"}"></i>`).join("");
  $("wrong").innerHTML = G.round.wrong.length
    ? "not " + G.round.wrong.map(id => `<s>${esc(lastName(byId(id).name))}</s>`).join("")
    : `${left} guesses`;
  $("btn-hint").disabled = G.round.hint;
  input.value = "";
  closeChips();
}

const byId = id => SEARCH[G.sport].find(p => p.id === id);
const lastName = n => n.split(" ").length > 1 ? n.split(" ").slice(1).join(" ") : n;

function shake() {
  const f = $("guess-form");
  f.classList.remove("shake");
  void f.offsetWidth;
  f.classList.add("shake");
}

function guess(p) {
  if (!G || G.round.done) return;
  if (p.id === G.player.id) return finish(true);
  if (G.round.wrong.includes(p.id)) return;
  G.round.wrong.push(p.id);
  save();
  if (G.round.wrong.length >= LIVES) return finish(false);
  renderAnswer();
  shake();
}

function finish(won) {
  const r = G.round, s = G.stats;
  r.done = true;
  r.won = won;
  r.points = won ? Math.max(POINTS.min, POINTS.base - r.wrong.length * POINTS.wrong - (r.hint ? POINTS.hint : 0)) : 0;
  s.played++;
  s.seen.push(G.player.id);
  if (won) { s.correct++; s.score += r.points; s.streak++; s.best = Math.max(s.best, s.streak); }
  else s.streak = 0;
  save();
  pushScore(G.name);
  input.blur();
  renderStats();
  showResult();
}

function showResult() {
  const r = G.round;
  $("answer").hidden = true;
  $("result").hidden = false;
  $("hint").hidden = true;
  const v = $("verdict");
  v.className = "verdict" + (r.won ? "" : " bad");
  v.textContent = r.won ? `Correct, +${r.points} points` : "Out of guesses. It was";
  $("reveal").textContent = G.player.name;
  $("reveal-meta").textContent = `${G.player.country} · ${G.player.position}` +
    (G.stats.streak > 1 ? ` · ${G.stats.streak} in a row` : "");
}

$("btn-next").addEventListener("click", nextRound);
$("btn-hint").addEventListener("click", () => {
  G.round.hint = true;
  save();
  renderGrid();
  $("btn-hint").disabled = true;
});
$("btn-skip").addEventListener("click", () => finish(false));
$("back").addEventListener("click", () => {
  G = null;
  input.blur();
  document.body.className = "";
  $("game").hidden = true;
  $("home").hidden = false;
  renderHome();
  loadBoard();
});

// ---------- guessing: one row of suggestion buttons ----------
const input = $("guess"), chips = $("chips");
let hits = [];

input.addEventListener("input", () => {
  const q = fold(input.value.trim());
  if (!q) return closeChips();
  hits = SEARCH[G.sport]
    .filter(p => !G.round.wrong.includes(p.id))
    .map(p => ({ p, rank: rank(p.id, q) }))
    .filter(x => x.rank < 9)
    .sort((a, b) => a.rank - b.rank || a.p.name.localeCompare(b.p.name))
    .slice(0, 8)
    .map(x => x.p);
  chips.hidden = false;
  chips.scrollLeft = 0;
  chips.innerHTML = hits.length
    ? hits.map((p, i) => `<button type="button" class="chip" data-i="${i}">${mark(p.name, q)}</button>`).join("")
    : `<span class="none">No player by that name</span>`;
});

function rank(name, q) {
  if (name.startsWith(q)) return 0;
  const words = name.split(/[\s.'-]+/);
  if (words.some(w => w.startsWith(q))) return 1;
  if (q.includes(" ") && name.includes(q)) return 2;
  const bare = s => s.replace(/[.'-]/g, "");
  if (bare(name).split(" ").some(w => w.startsWith(bare(q)))) return 3;
  return 9;
}

function mark(name, q) {
  const f = fold(name);
  let at = f.startsWith(q) ? 0 : -1;
  if (at < 0) { const m = f.search(new RegExp("(^|[\\s.'-])" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); if (m >= 0) at = m + (m === 0 ? 0 : 1); }
  if (at < 0) at = f.indexOf(q);
  if (at < 0) return esc(name);
  return esc(name.slice(0, at)) + "<b>" + esc(name.slice(at, at + q.length)) + "</b>" + esc(name.slice(at + q.length));
}

// Tapping a suggestion guesses it. preventDefault on pointerdown keeps the keyboard up.
chips.addEventListener("pointerdown", e => {
  const b = e.target.closest(".chip");
  if (!b) return;
  e.preventDefault();
  const p = hits[+b.dataset.i];
  closeChips();
  guess(p);
});
// GUESS and Enter take the first suggestion.
$("guess-form").addEventListener("submit", e => {
  e.preventDefault();
  if (!hits.length) { shake(); input.focus(); return; }
  const p = hits[0];
  closeChips();
  guess(p);
});
$("guess-form").querySelector(".go").addEventListener("pointerdown", e => {
  if (document.activeElement === input) e.preventDefault();
});

// While typing on a phone the keyboard takes half the screen: drop the title and club names.
input.addEventListener("focus", () => { if (touch) document.body.classList.add("typing"); });
input.addEventListener("blur", () => document.body.classList.remove("typing"));

function closeChips() { chips.hidden = true; hits = []; }

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }

fitViewport();
renderHome();
syncAll();
