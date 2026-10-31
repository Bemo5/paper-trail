// Paper Trail: guess the player from his career path.
// Progress lives in localStorage and is written after every guess.

// The name is split in two: the second half is drawn in the accent colour.
const BRAND = ["PAPER ", "TRAIL"];
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
// Everything the search box can suggest: the pool plus decoy names.
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
      ? `${st.score} PTS · ${st.correct}/${st.played} RIGHT · RUN ${st.streak}`
      : `${POOLS[s].length} PLAYERS`;
  }

  const rows = names.map(n => {
    const p = profile(n);
    return { n, fb: p.football.score, bb: p.basketball.score, best: Math.max(p.football.best, p.basketball.best) };
  }).sort((a, b) => (b.fb + b.bb) - (a.fb + a.bb));
  $("board").hidden = rows.length === 0;
  $("board-table").innerHTML = `<tr><th>NAME</th><th>FOOTBALL</th><th>BASKETBALL</th><th>BEST RUN</th></tr>` +
    rows.map(r => `<tr><td>${esc(r.n)}</td><td>${r.fb}</td><td>${r.bb}</td><td>${r.best}</td></tr>`).join("");
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

function startGame(name, sport) {
  const stats = profile(name)[sport];
  G = { name, sport, stats };
  document.body.className = sport;
  $("home").hidden = true;
  $("game").hidden = false;
  $("g-player").textContent = name;
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
  renderPath();
  renderAnswer();
  if (cur.done) showResult();
  else {
    $("result").hidden = true;
    $("answer").hidden = false;
    // On phones the keyboard would cover the clubs, so wait for a tap.
    if (!touch) setTimeout(() => $("guess").focus(), 50);
  }
  scrollTo(0, 0);
}

function renderStats() {
  $("g-score").textContent = G.stats.score;
  $("g-streak").textContent = G.stats.streak;
  const total = POOLS[G.sport].length;
  $("g-count").innerHTML = `PLAYER ${Math.min(G.stats.seen.length + (G.round.done ? 0 : 1), total)}/${total}<br>${G.player.career.length} MOVES`;
  $("ticker").textContent = ticker();
}

function renderPath() {
  const { career } = G.player;
  $("path").innerHTML = career.map(([club, from, to, loan], i) => {
    const t = team(club);
    const yrs = to === null ? `${from}–` : from === to ? `${from}` : `${from}–${to}`;
    return `<li class="row" style="animation-delay:${i * 60}ms">
      <span class="n">${i + 1}</span>
      ${t.logo ? `<img src="${t.logo}" alt="">` : badge(t)}
      <span class="club"><span>${esc(t.name)}</span>${loan ? `<i class="loan">LOAN</i>` : ""}</span>
      <span class="y">${yrs}</span>
    </li>`;
  }).join("");
  const h = $("hint");
  h.hidden = !G.round.hint;
  h.textContent = `${G.player.country} · ${G.player.position}`;
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
  $("lives").innerHTML = Array.from({ length: LIVES }, (_, i) => `<i class="${i < left ? "" : "x"}"></i>`).join("");
  $("wrong").innerHTML = G.round.wrong.length
    ? "MISSED " + G.round.wrong.map(id => `<s>${esc(byId(id).name.toUpperCase())}</s>`).join("")
    : `${left} GUESSES`;
  $("btn-hint").disabled = G.round.hint;
  $("guess").value = "";
  closeSuggest();
}

const byId = id => SEARCH[G.sport].find(p => p.id === id);

function guess(p) {
  if (!G || G.round.done) return;
  if (p.id === G.player.id) return finish(true);
  if (G.round.wrong.includes(p.id)) return;
  G.round.wrong.push(p.id);
  save();
  if (G.round.wrong.length >= LIVES) return finish(false);
  renderAnswer();
  $("guess").focus();
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
  renderStats();
  showResult();
}

function showResult() {
  const r = G.round;
  $("answer").hidden = true;
  $("result").hidden = false;
  $("hint").hidden = true;
  const v = $("verdict");
  v.className = "verdict " + (r.won ? "good" : "bad");
  v.textContent = r.won ? `CORRECT · +${r.points} PTS` : "OUT OF GUESSES · IT WAS";
  $("reveal").textContent = G.player.name;
  $("reveal-meta").textContent = `${G.player.country} · ${G.player.position}` +
    (G.stats.streak > 1 ? ` · ${G.stats.streak} IN A ROW` : "");
  $("btn-next").focus();
}

$("btn-next").addEventListener("click", nextRound);
$("btn-hint").addEventListener("click", () => {
  G.round.hint = true;
  save();
  renderPath();
  renderAnswer();
});
$("btn-skip").addEventListener("click", () => finish(false));
$("back").addEventListener("click", () => {
  G = null;
  document.body.className = "";
  $("game").hidden = true;
  $("home").hidden = false;
  renderHome();
});

// ---------- search with suggestions ----------
const input = $("guess"), list = $("suggest");
let hits = [], sel = 0;

input.addEventListener("input", () => {
  const q = fold(input.value.trim());
  if (!q) return closeSuggest();
  hits = SEARCH[G.sport]
    .filter(p => !G.round.wrong.includes(p.id))
    .map(p => ({ p, rank: rank(p.id, q) }))
    .filter(x => x.rank < 9)
    .sort((a, b) => a.rank - b.rank || a.p.name.localeCompare(b.p.name))
    .slice(0, 8)
    .map(x => x.p);
  sel = 0;
  list.hidden = false;
  list.innerHTML = hits.length
    ? hits.map((p, i) => `<li data-i="${i}" class="${i === sel ? "on" : ""}">${mark(p.name, q)}</li>`).join("")
    : `<li class="none">No player by that name</li>`;
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

input.addEventListener("keydown", e => {
  if (list.hidden || !hits.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
    [...list.children].forEach((li, i) => li.classList.toggle("on", i === sel));
    list.children[sel].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    pickHit(sel);
  } else if (e.key === "Escape") closeSuggest();
});
list.addEventListener("pointerdown", e => {
  const li = e.target.closest("li[data-i]");
  if (!li) return;
  e.preventDefault(); // keep focus in the input
  pickHit(+li.dataset.i);
});
input.addEventListener("blur", () => setTimeout(closeSuggest, 120));

function pickHit(i) {
  const p = hits[i];
  closeSuggest();
  if (p) guess(p);
}
function closeSuggest() { list.hidden = true; hits = []; }

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }

function ticker() {
  const lead = G.sport === "football" ? "DEADLINE DAY" : "TRADE DEADLINE";
  const c = G.player.career;
  const bit = `${lead} · ${c.length} MOVES · ${c[0][1]}–${c[c.length - 1][2] ?? "NOW"} · ONE NAME · `;
  return bit.repeat(3);
}

document.querySelectorAll("[data-logo]").forEach(el => el.innerHTML = `${BRAND[0]}<i>${BRAND[1]}</i>`);
renderHome();
