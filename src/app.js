/* ---------- The Daily Rack: public site (Supabase-backed) ---------- */
const SUPABASE_URL = "https://zycnmucgmhwkrulqdluc.supabase.co";
const SUPABASE_KEY = "sb_publishable_BnklB2jMV3inRrCodEYdCA_UnO5jRgB";
/* Usernames sign in with a password. Supabase needs an email-shaped login, so each username maps to a private
   placeholder address. Nothing is ever emailed to it. */
const LOGIN_DOMAIN = "players.dailyrack.app";
const loginFor = u => `${u.toLowerCase()}@${LOGIN_DOMAIN}`;

const $ = s => document.querySelector(s);
const esc = t => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SECTION_NAMES = { NYT: "The Times Puzzles", Web: "Around the Web", Sports: "Sports" };
const ORD = n => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
const NAME_RE = /^[A-Za-z][A-Za-z' -]{0,29}$/, USER_RE = /^[A-Za-z0-9_.]{2,16}$/;

let sb = null, me = null, profile = null, results = [], loaded = false, netErr = "", fresh = null, sheet = null, authMode = null;

/* ---------- data ---------- */
async function loadToday() {
  if (!sb) return;
  const { data, error } = await sb.from("results")
    .select("user_id, game, score, rank, grid, created_at, profiles(username, first_name, last_name)")
    .eq("day", todayKey());
  if (error) { netErr = me ? "Couldn't load today's results. Check your connection and refresh." : ""; render(); return; }
  results = data || []; loaded = true; netErr = ""; render();
}
async function loadProfile() {
  profile = null;
  if (!me) return;
  const { data } = await sb.from("profiles").select("username, first_name, last_name").eq("id", me.id).maybeSingle();
  profile = data || null;
}
const mine = gid => me && results.find(r => r.user_id === me.id && r.game === gid);
function parseShare(t) { for (const [id, fn] of Object.entries(PARSERS)) { const r = fn(t); if (r) return { id, ...r }; } return null; }

async function logText(t) {
  const r = parseShare(t); if (!r) return { error: "notgame" };
  if (!me) { openAuth("join"); return { error: "signin" }; }
  const row = { user_id: me.id, day: todayKey(), game: r.id, score: r.score, rank: r.rank, grid: shareGrid(t) || null };
  const { error } = await sb.from("results").upsert(row, { onConflict: "user_id,day,game" });
  if (error) return { error: "save" };
  fresh = r.id; await loadToday();
  return { name: GAMES.find(g => g.id === r.id).name, score: r.score };
}

function ranking(gid) {
  const rows = results.filter(r => r.game === gid);
  rows.sort((a, b) => (a.rank ?? 1e12) - (b.rank ?? 1e12));
  rows.forEach(r => r.place = r.rank == null ? null : rows.filter(o => o.rank != null && o.rank < r.rank).length + 1);
  return rows;
}
function leaderOf(gid) { const r = ranking(gid)[0]; return r && r.rank != null && results.filter(x => x.game === gid).length > 1 ? r : null; }

/* ---------- render ---------- */
function render() {
  const now = new Date(), start = new Date(now.getFullYear(), 0, 0);
  $("#vol").textContent = `Vol. I · No. ${Math.floor((now - start) / 864e5)}`;
  $("#date").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const ds = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  $("#greet").innerHTML = `Welcome${profile ? `, ${esc(profile.first_name)}` : ""}! <em>Today is ${esc(ds)}.</em>`;
  $("#pass").innerHTML = profile
    ? `<span class="who-am-i">@${esc(profile.username)}</span> · <button class="pass" id="signout">Sign out</button>`
    : `<button class="pass" id="open-join">Get your press pass</button> · <button class="pass" id="open-signin">Sign in</button>`;
  $("#guest").hidden = !!me;
  $("#neterr").textContent = netErr; $("#neterr").hidden = !netErr;
  $("#sections").innerHTML = CATS.map((c, ci) => {
    const gs = GAMES.filter(g => g.cat === c); const n = gs.filter(g => mine(g.id)).length;
    return `<section><div class="flag"><span class="letter">${"ABCDEFGH"[ci]}</span><h2>${SECTION_NAMES[c] || c}</h2>${me ? `<span class="ct">${n}/${gs.length} solved</span>` : ""}</div>
      <div class="panels">${gs.map(g => { const e = mine(g.id); const L = leaderOf(g.id); return `
      <article class="panel${e ? " done" : ""}">
        <div class="art" aria-hidden="true">${art(g.id)}</div>
        <div class="cap"><div class="cap-txt">${g.src ? `<span class="src">${g.src}</span>` : ""}<h3>${g.name}</h3>
          ${L ? `<div class="leader">Leader: ${esc(L.profiles?.username || "someone")} · ${esc(L.score || "")}</div>` : ""}
          <div class="go">${e ? "Play again" : "Play"} →</div></div>
          <div class="pbtns">${e ? "" : `<button class="pbtn" data-act="log" data-id="${g.id}">Log</button>`}<button class="pbtn" data-act="rank" data-id="${g.id}">Rankings</button></div></div>
        <a class="cover" href="${g.url}" target="_blank" rel="noopener" aria-label="Play ${g.name}"></a>
        ${e ? `<div class="stamp${fresh === g.id ? " fresh" : ""}"><b>Solved</b></div>` : ""}
      </article>`; }).join("")}</div></section>`;
  }).join("");
  fresh = null;
  if (sheet && sheet.kind === "rank") renderSheet();
  $("#reset-in").textContent = `Next edition in ${untilMidnight().join(":")}`;
}

/* ---------- sign up / sign in ---------- */
function openAuth(mode) { authMode = mode; renderAuth(); }
function closeAuth() { authMode = null; renderAuth(); }
function renderAuth() {
  const m = $("#modal");
  if (!authMode) { m.hidden = true; m.innerHTML = ""; lock(); return; }
  const join = authMode === "join";
  m.innerHTML = `<div class="scrim" data-close="auth"></div>
  <div class="pass-card" role="dialog" aria-modal="true" aria-labelledby="pc-title">
    <div class="pc-top"><span>Press</span><span>Vol. I</span></div>
    <div class="pc-body">
      <div class="pc-mast">The Daily Rack</div>
      <h2 id="pc-title">${join ? "Welcome, reader." : "Welcome back."}</h2>
      <p>${join ? "Make your press pass to log scores and see how you rank against your friends." : "Sign in with your username and password."}</p>
      <form id="auth-form" novalidate>
        ${join ? `<div class="pf-row">
          <label for="pf-first">First name<input id="pf-first" maxlength="30" autocomplete="given-name"></label>
          <label for="pf-last">Last name<input id="pf-last" maxlength="30" autocomplete="family-name"></label></div>` : ""}
        <label for="pf-user">Username<input id="pf-user" maxlength="16" autocomplete="username" spellcheck="false" autocapitalize="off" placeholder="e.g. matt_g"></label>
        <label for="pf-pass">Password<input id="pf-pass" type="password" minlength="6" autocomplete="${join ? "new-password" : "current-password"}"></label>
        ${join ? `<small>Username shows in the rankings: 2 to 16 letters, numbers, dots or underscores. Password: at least 6 characters.</small>` : ""}
        <div class="toast" id="pf-msg" role="status"></div>
        <div class="pc-actions"><button class="btn" id="auth-go">${join ? "Issue my press pass" : "Sign in"}</button>
          <button type="button" class="pc-later" id="auth-switch">${join ? "I already have one" : "I need a press pass"}</button></div>
      </form>
    </div>
  </div>`;
  m.hidden = false; lock(); setTimeout(() => $(join ? "#pf-first" : "#pf-user")?.focus(), 50);
}
async function submitAuth() {
  const join = authMode === "join", msg = $("#pf-msg"), btn = $("#auth-go");
  const bad = t => { msg.className = "toast"; msg.textContent = t; };
  const user = $("#pf-user").value.trim(), pass = $("#pf-pass").value;
  if (!sb) return bad("The paper can't reach its database right now. Refresh and try again.");
  if (!USER_RE.test(user)) return bad("Usernames are 2 to 16 letters, numbers, dots or underscores.");
  if (pass.length < 6) return bad("Passwords need at least 6 characters.");
  let first = "", last = "";
  if (join) {
    first = $("#pf-first").value.trim(); last = $("#pf-last").value.trim();
    if (!NAME_RE.test(first) || !NAME_RE.test(last)) return bad("Add your first and last name (letters, spaces, hyphens or apostrophes).");
  }
  btn.disabled = true; const label = btn.textContent; btn.textContent = join ? "Issuing…" : "Signing in…";
  try {
    if (join) {
      const { data: taken } = await sb.rpc("username_taken", { name: user });
      if (taken) return bad(`"${user}" is taken. Try another username.`);
      const { error } = await sb.auth.signUp({ email: loginFor(user), password: pass, options: { data: { first_name: first, last_name: last, username: user } } });
      if (error) return bad(/registered|exists/i.test(error.message) ? `"${user}" is taken. Try another username.` : "Couldn't issue your press pass. Try again in a moment.");
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: loginFor(user), password: pass });
      if (error) return bad("That username and password don't match. Check both and try again.");
    }
    closeAuth();
  } finally { btn.disabled = false; btn.textContent = label; }
}

/* ---------- log + rankings sheet ---------- */
function openSheet(kind, gid) {
  if (kind === "log" && !me) return openAuth("join");
  sheet = { kind, gid }; renderSheet(); setTimeout(() => $("#sh-text")?.focus(), 50);
}
function closeSheet() { sheet = null; renderSheet(); }
function renderSheet() {
  const el = $("#sheet");
  if (!sheet) { el.innerHTML = ""; el.hidden = true; lock(); return; }
  const g = GAMES.find(x => x.id === sheet.gid);
  if (sheet.kind === "log" && el.dataset.k === "log:" + g.id && !el.hidden) return;
  let body;
  if (sheet.kind === "log") {
    body = `<h2 id="sh-title">Log your ${esc(g.name)}</h2><p>In ${esc(g.name)}, tap Share, then paste the result here.</p>
      <form id="sh-form" style="display:grid;gap:10px">
        <textarea id="sh-text" aria-label="Paste your ${esc(g.name)} result" placeholder="Paste your ${esc(g.name)} share text"></textarea>
        <div class="toast" id="sh-msg" role="status"></div>
        <div class="sh-actions"><button class="btn" id="sh-go">Log result</button></div>
      </form>`;
  } else {
    const rows = ranking(g.id), sc = SCORING[g.id] || { col: "Score", rule: "Logged results for today." };
    const you = me && rows.find(r => r.user_id === me.id);
    body = `<h2 id="sh-title">${esc(g.name)} rankings</h2><p class="rule"><b>How it's scored:</b> ${esc(sc.rule)}</p>
      ${!me ? `<div class="you">Sign in or get a press pass to see today's rankings and add your own result.</div>
        <div class="sh-actions"><button class="btn" id="sh-join">Get your press pass</button><button class="pc-later" id="sh-signin">Sign in</button></div>` :
      !loaded ? `<p class="waiting">${esc(netErr || "Loading rankings…")}</p>` : `
      <div class="you">${you ? (you.place ? `You're <b>${ORD(you.place)}</b> (${esc(you.score)})` : "You're in, unranked (no score was found in your share).") : `You haven't logged ${esc(g.name)} today.`}</div>
      ${rows.length ? `<table class="rk"><thead><tr><th></th><th>Player</th><th>${esc(sc.col)}</th></tr></thead><tbody>${rows.map(r => `
        <tr class="${me && r.user_id === me.id ? "me" : ""}"><td class="pl">${r.place ?? "–"}</td>
        <td class="who"><span class="nm">${esc(r.profiles?.username || "someone")}<small>${esc(((r.profiles?.first_name || "") + " " + (r.profiles?.last_name || "")).trim())}</small></span>${r.grid ? `<pre class="grid">${esc(r.grid)}</pre>` : ""}</td>
        <td class="sc">${esc(r.score || "Solved")}</td></tr>`).join("")}</tbody></table>`
        : `<p class="waiting">No one has logged ${esc(g.name)} yet today. Be first.</p>`}
      ${you ? "" : `<div class="sh-actions"><button class="btn" id="sh-switch">Log my result</button></div>`}`}`;
  }
  el.dataset.k = sheet.kind + ":" + g.id;
  el.innerHTML = `<div class="scrim" data-close="sheet"></div><div class="pass-card" role="dialog" aria-modal="true" aria-labelledby="sh-title">
    <div class="pc-top ${sheet.kind === "rank" ? "ink" : ""}"><span>${sheet.kind === "log" ? "Filing desk" : "Standings"}</span><span>${esc(g.name)}</span></div>
    <button class="sh-close" id="sh-x" aria-label="Close">×</button><div class="pc-body">${body}</div></div>`;
  el.hidden = false; lock();
}
function lock() { document.body.classList.toggle("locked", !$("#modal").hidden || !$("#sheet").hidden); }
function say(msg, ok) { const o = $("#toast"); o.className = ok ? "toast ok" : "toast"; o.textContent = msg; }

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const t = e.target, id = t.id;
  if (id === "open-join" || id === "sh-join" || id === "guest-join") { closeSheet(); return openAuth("join"); }
  if (id === "open-signin" || id === "sh-signin" || id === "guest-signin") { closeSheet(); return openAuth("signin"); }
  if (id === "auth-switch") return openAuth(authMode === "join" ? "signin" : "join");
  if (id === "signout") return sb.auth.signOut();
  if (t.dataset.close === "auth") return closeAuth();
  if (id === "sh-x" || t.dataset.close === "sheet") return closeSheet();
  if (id === "sh-switch") { const gid = sheet.gid; closeSheet(); return openSheet("log", gid); }
  const b = t.closest(".pbtn"); if (b) openSheet(b.dataset.act, b.dataset.id);
});
document.addEventListener("submit", async e => {
  e.preventDefault();
  if (e.target.id === "auth-form") return submitAuth();
  if (e.target.id === "sh-form") {
    const g = GAMES.find(x => x.id === sheet.gid), t = $("#sh-text").value.trim(), m = $("#sh-msg");
    const bad = x => { m.className = "toast"; m.textContent = x; };
    if (!t) return bad(`Paste your ${g.name} share text first.`);
    const r = parseShare(t);
    if (!r) return bad(`That doesn't look like a ${g.name} result. Copy it from the game's Share button.`);
    if (r.id !== g.id) return bad(`That's a ${GAMES.find(x => x.id === r.id)?.name || "different game"} result, not ${g.name}.`);
    $("#sh-go").disabled = true;
    const out = await logText(t);
    if (out.error) { $("#sh-go").disabled = false; return bad("Couldn't save that. Check your connection and try again."); }
    closeSheet(); say(`Filed: ${out.name}${out.score ? `, ${out.score}` : ""}`, true);
  }
});
document.addEventListener("keydown", e => { if (e.key !== "Escape") return; if (!$("#sheet").hidden) closeSheet(); else if (!$("#modal").hidden) closeAuth(); });
/* Paste anywhere (outside a text box) to log straight away */
document.addEventListener("paste", async e => {
  if (e.target.closest("input,textarea") || sheet || authMode) return;
  const t = (e.clipboardData || window.clipboardData)?.getData("text") || ""; if (!t.trim()) return;
  e.preventDefault(); const out = await logText(t);
  if (out.error === "notgame") say("That paste didn't look like a game result. Copy it from the game's Share button.", false);
  else if (out.error === "save") say("Couldn't save that. Check your connection and try again.", false);
  else if (!out.error) say(`Filed: ${out.name}${out.score ? `, ${out.score}` : ""}`, true);
});
let lastDay = todayKey();
setInterval(() => { if (todayKey() !== lastDay) { lastDay = todayKey(); loadToday(); } else $("#reset-in").textContent = `Next edition in ${untilMidnight().join(":")}`; }, 1000);
/* Keep rankings fresh: refetch when the tab comes back and every 30 seconds while open */
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadToday(); });
setInterval(() => { if (!document.hidden) loadToday(); }, 30000);

/* ---------- boot ---------- */
render();
(async () => {
  if (!window.supabase) { netErr = "Couldn't load the paper's database. Refresh to try again."; render(); return; }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data } = await sb.auth.getSession();
  me = data.session?.user || null; await loadProfile(); await loadToday(); render();
  sb.auth.onAuthStateChange(async (_ev, session) => {
    const was = me?.id; me = session?.user || null;
    if (me?.id !== was) { await loadProfile(); await loadToday(); render(); if (me && profile) say(`Signed in as ${profile.username}.`, true); }
  });
})();
