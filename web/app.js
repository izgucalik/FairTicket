// FairTicket arayüzü — tek dosya. Sunucu (chain-api) aynı kökten servis eder.
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (a) => (a && a.length > 12 ? a.slice(0, 4) + "…" + a.slice(-4) : a || "—");
const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

// Messages: human-readable English text for the UI
const MSG = {
  price_above_cap: (e) => `Price cap of ${fmt(e.face != null ? effMax(e.max_price, e.face) : e.max_price)} USDC exceeded`,
  not_owner: "This ticket does not belong to this wallet",
  ticket_used: "This ticket has already been used",
  ticket_listed: "Ticket is listed for sale; an entry code cannot be generated",
  already_listed: "Ticket is already listed",
  already_used: "Error: this code/ticket was already used! Replay attack blocked",
  expired: "Code expired; generate a new QR",
  unknown: "Code not recognized",
  session_expired: "Session expired; approve again with your wallet",
  wallet_not_controlled: "The server has no signature for this wallet",
  payment_mismatch: "Payment amount or destination does not match",
  SOLD_OUT: "Sold out",
  NETWORK: "Could not reach the server",
  rpc_rate_limited: "Devnet RPC is rate-limiting right now; try again in a few seconds",
  INTERNAL: "Server error",
  user_rejected: "The wallet rejected the transaction",
};
const errText = (e) => (typeof MSG[e.code] === "function" ? MSG[e.code](e.data || {}) : MSG[e.code]) || e.message || e.code || "Unknown error";

// Project rule: resale cap = min(event cap, face value × 1.2). All cap texts use this.
const effMax = (max, face) => Math.min(Number(max), Math.round(Number(face) * 120) / 100);
const effPct = (max, face) => Math.round((effMax(max, face) / Number(face)) * 100);

// Event tags come from the server in Turkish; shown in English here.
const TAGS = { "Öne çıkan": "Featured", "Caz": "Jazz", "Konferans": "Conference", "Festival": "Festival", "Hackathon": "Hackathon" };
const tagText = (t) => TAGS[t] || t;

// Project rule: organizer royalty is a fixed 5% everywhere in the UI (display and fee math).
const ROYALTY_PCT = 5;

const MAX_QTY = 5;
const qtyOf = (e) => Math.max(1, Math.min(state.qty[e.id] || 1, MAX_QTY, e.remaining));

const state = {
  qty: {},
  wallet: null, provider: null, demoWallet: null, organizer: null,
  events: [], listings: [], tickets: [],
  tab: "home", sessions: {}, rot: {}, gate: null,
};

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch { throw { code: "NETWORK" }; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false || data.valid === false) {
    throw { code: data.error || data.reason || "HTTP_" + res.status, message: data.message, data };
  }
  return data;
}

function toast(text, bad = false, link) {
  const el = document.createElement("div");
  el.className = "toast" + (bad ? " bad" : "");
  el.innerHTML = esc(text) + (link ? ` <a href="${esc(link)}" target="_blank" rel="noopener">View on chain ↗</a>` : "");
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

/* ---------- Wallet: real Phantom connection; demo fallback otherwise ---------- */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
  return s;
}
const getPhantom = () => { const p = window.phantom?.solana || window.solana; return p && p.isPhantom ? p : null; };

async function connectPhantom() {
  const p = getPhantom();
  if (!p) { toast("Phantom not found. You can use the demo wallet.", true); return; }
  const r = await p.connect();
  state.provider = p;
  state.wallet = (r?.publicKey || p.publicKey).toString();
  state.demoWallet = null;
  await afterConnect();
}

async function connectDemo() {
  const { address } = await api("GET", "/demo/wallet");
  state.provider = null;          // demo: signing happens on the server
  state.wallet = address;
  state.demoWallet = address;
  await afterConnect();
}

async function afterConnect() {
  state.sessions = {}; state.rot = {};
  renderWallet();
  await refresh();
}

function renderWallet() {
  const el = $("#wallet-area");
  if (!state.wallet) {
    el.innerHTML = `<button class="wbtn" data-act="connect-phantom">Connect Phantom</button>
      <button class="wbtn" data-act="connect-demo">Demo wallet</button>`;
    return;
  }
  const label = state.demoWallet ? "Demo wallet" : "Phantom";
  el.innerHTML = `<button class="wbtn conn" data-act="disconnect" title="${esc(state.wallet)} — disconnect"><span class="dot ${state.demoWallet ? "demo" : ""}"></span>${label} · ${esc(short(state.wallet))}</button>`;
}

// Hybrid signing: the server builds the transaction, the wallet signs (Phantom or demo server key), the server submits it.
async function signAndSend(prepPath, prepBody, submitExtra, { serverSign = false } = {}) {
  const prep = await api("POST", prepPath, prepBody);
  const { Transaction } = window.solanaWeb3;
  const tx = Transaction.from(Uint8Array.from(atob(prep.tx), (c) => c.charCodeAt(0)));
  if (state.demoWallet) {
    // Demo wallet: the server signs with its own key (no wallet_not_controlled).
    const r = await api("POST", "/demo/submit", { tx: prep.tx, ...submitExtra });
    return r;
  }
  let signed;
  try { signed = await state.provider.signTransaction(tx); }
  catch { throw { code: "user_rejected" }; }
  const b64 = btoa(String.fromCharCode(...signed.serialize({ requireAllSignatures: false, verifySignatures: false })));
  return api("POST", "/tx/submit", { signed: b64, ...submitExtra });
}

/* ---------- Veri ---------- */
async function refresh() {
  try {
    const [e, l] = await Promise.all([api("GET", "/events"), api("GET", "/listings")]);
    state.events = e.events || [];
    state.listings = l.listings || [];
    state.tickets = state.wallet ? (await api("GET", "/tickets?owner=" + encodeURIComponent(state.wallet))).tickets || [] : [];
  } catch (e) { toast("Could not load data: " + errText(e), true); }
  render();
}

/* ---------- Render ---------- */
function render() {
  if (state.tab !== "gate") stopScan();
  const isOrg = !!state.wallet && state.wallet === state.organizer;
  $("#tab-org").hidden = !isOrg;
  if (!isOrg && state.tab === "org") state.tab = "events";
  document.body.classList.toggle("is-home", state.tab === "home");
  $("#cnt-market").textContent = state.listings.length;
  $("#cnt-mine").textContent = state.tickets.filter((t) => t.status !== "used").length;
  renderEvents();
  renderMarket();
  renderMine();
  repaintLiveQrs();
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("on", p.id === "page-" + state.tab));
}

function renderEvents() {
  const evs = state.events;
  if (!evs.length) { $("#events").innerHTML = `<div class="card empty">Loading events…</div>`; return; }
  const feat = evs.find((e) => e.featured) || evs[0];
  const rest = evs.filter((e) => e !== feat);
  const pct = (e) => Math.round((e.minted / e.supply) * 100);
  const card = (e, big) => `
    <div class="card ${big ? "feat" : ""} ev-card">
      <div>
        <div class="kicker">${esc(tagText(e.tag))}${big && tagText(e.tag) !== "Featured" ? " · Featured" : ""}</div>
        <div class="title">${esc(e.name)}</div>
        <div class="meta">${esc(e.date ? new Date(e.date).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", weekday: "short" }) : "Date to be announced")} · ${esc(e.venue)}</div>
      </div>
      ${big ? `<div class="kv">
        <div><small>Face price</small><b>${fmt(e.face)} USDC</b></div>
        <div><small>Cap (${effPct(e.max, e.face)})</small><b class="amber">${fmt(effMax(e.max, e.face))} USDC</b></div>
        <div><small>Organizer royalty</small><b>${ROYALTY_PCT}%</b></div>
        <div><small>Tickets left</small><b>${e.remaining}</b></div></div>` : ""}
      <div class="meta small">${big ? "" : `Face ${fmt(e.face)} USDC · Cap ${fmt(effMax(e.max, e.face))} USDC · Royalty ${ROYALTY_PCT}% · Left ${e.remaining}`}</div>
      <div class="bar" style="margin-top:0"><i style="width:${pct(e)}%"></i></div>
      <div class="ev-foot">
        <div class="price">${fmt(e.face)}<small>USDC</small></div>
        <label class="qty" title="Number of tickets">Qty
          <select data-qty-for="${esc(e.id)}" ${e.remaining <= 0 ? "disabled" : ""}>
            ${Array.from({ length: Math.max(1, Math.min(MAX_QTY, e.remaining)) }, (_, i) => `<option value="${i + 1}" ${qtyOf(e) === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}
          </select>
        </label>
        <button class="btn" data-act="buy-primary" data-id="${esc(e.id)}" ${e.remaining <= 0 ? "disabled" : ""}>${e.remaining <= 0 ? "Sold out" : "Buy ticket"}</button>
      </div>
    </div>`;
  $("#events").innerHTML = card(feat, true) + `<div class="grid2">${rest.map((e) => card(e, false)).join("")}</div>`;
}

function renderMarket() {
  const ls = state.listings;
  // Top summary: the event with the most listings.
  const counts = {};
  ls.forEach((l) => (counts[l.event] = (counts[l.event] || 0) + 1));
  const topName = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const ev = state.events.find((e) => e.name === topName) || state.events[0];
  $("#market-sum").innerHTML = ev ? `
    <div class="sumcard">
      <div>
        <div class="kicker">Event summary</div>
        <div class="title">${esc(ev.name)}</div>
        <div class="kv" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          <div><small>Face price</small><b>${fmt(ev.face)} USDC</b></div>
          <div><small>Price cap (${effPct(ev.max, ev.face)}%)</small><b class="amber">${fmt(effMax(ev.max, ev.face))} USDC</b></div>
          <div><small>Organizer royalty</small><b>${ROYALTY_PCT}%</b></div>
        </div>
      </div>
      <div class="meta small" style="text-align:right">Aktif ilan<br><b style="font-size:24px;color:var(--tx)">${ls.length}</b></div>
    </div>` : `<div class="empty">Etkinlik bilgisi yok.</div>`;

  $("#listings").innerHTML = ls.length ? ls.map((l) => {
    const diff = l.price - l.face;
    const cls = diff > 0 ? "up" : "down";
    const mine = state.wallet && l.seller === state.wallet;
    const fee = (l.price * ROYALTY_PCT) / 100;
    return `<div class="lrow">
      <div style="min-width:0">
        <div class="t">${esc(l.event)} <span class="pill">${esc(l.ticket_id)}</span></div>
        <div class="mono">Seller ${esc(short(l.seller))}</div>
        <div class="feeline">Cap ${fmt(effMax(l.max_price, l.face))} · Royalty ${ROYALTY_PCT}% = ${fmt(fee)} USDC</div>
      </div>
      <div class="mid" style="text-align:right">
        <div class="price">${fmt(l.price)} USDC</div>
        <div class="small"><span class="delta ${cls}">${diff >= 0 ? "+" : ""}${fmt(diff)} USDC</span><span class="mut">vs. face value</span></div>
      </div>
      ${mine ? `<span class="pill">Your listing</span>`
        : `<button class="btn sm" data-act="buy" data-id="${esc(l.id)}" ${state.wallet ? "" : "disabled"}>Buy</button>`}
    </div>`;
  }).join("") : `<div class="empty">No tickets for sale right now.</div>`;
}

function renderMine() {
  const el = $("#mine");
  if (!state.wallet) { el.innerHTML = `<div class="card empty">Connect Phantom or choose the demo wallet to see your tickets.</div>`; return; }
  const live = state.tickets.filter((t) => t.status !== "used");
  const used = state.tickets.filter((t) => t.status === "used");
  const card = (t) => {
    const sellable = t.status === "valid";
    return `<div class="card tk">
      <div class="tk-head">
        <div><div class="title" style="font-size:16px">${esc(t.event)}</div><div class="mono">${esc(t.id)}</div></div>
        <span class="pill ${t.status === "valid" ? "mint" : t.status === "listed" ? "amber" : "red"}">${t.status === "valid" ? "Valid" : t.status === "listed" ? "Listed" : "Used"}</span>
      </div>
      ${t.status === "valid" ? `<div class="qrwrap" id="qr-${esc(t.id)}">${qrInner(t.id)}</div>` : ""}
      ${t.status === "listed" ? `<div class="meta small">Ticket is listed; an entry code cannot be generated until the listing is removed.</div>` : ""}
      ${t.status === "used" ? `<div class="meta small">This ticket has been used for entry.</div>` : ""}
      ${sellable ? `<div class="sellrow">
        <label>Sale price (USDC · cap ${fmt(effMax(t.max_price, t.face))})
          <input type="number" min="1" step="0.5" value="${esc(Math.min(effMax(t.max_price, t.face), t.face * 1.05).toFixed(2))}" data-sell-for="${esc(t.id)}">
        </label>
        <button class="btn ghost sm" data-act="list" data-id="${esc(t.id)}">List for sale</button>
      </div>
      <div class="err" id="serr-${esc(t.id)}"></div>` : ""}
    </div>`;
  };
  el.innerHTML = `
    <div class="section-t">Active tickets (${live.length})</div>
    <div class="grid2">${live.length ? live.map(card).join("") : `<div class="card empty">You have no active tickets. Buy one from the Events tab.</div>`}</div>
    ${used.length ? `<div class="section-t">Used (${used.length})</div><div class="grid2">${used.map(card).join("")}</div>` : ""}`;
}

// Card content. An active QR survives re-renders (15 s refresh, tab switch).
function qrInner(ticketId) {
  const live = lastRotate[ticketId];
  const verdict = verdicts[ticketId] ? verdictHtml(verdicts[ticketId]) : "";
  return `<div class="qrbox empty" data-qr="${esc(ticketId)}">${live ? "" : `Use the "Generate entry QR" button for an entry code`}</div>
  <div style="flex:1;min-width:0">
    <div class="small mut">Refreshes in</div>
    <div class="count" id="cd-${esc(ticketId)}">${live ? "" : "—"}</div>
    <div class="token" id="tok-${esc(ticketId)}">${live ? esc(live.token.slice(0, 42) + "…") : ""}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      <button class="btn sm" data-act="qr" data-id="${esc(ticketId)}">Generate entry QR</button>
      <button class="btn ghost sm" data-act="gate-handoff" data-id="${esc(ticketId)}" ${live ? "" : "disabled"} id="gh-${esc(ticketId)}">Scan at gate (demo)</button>
    </div>
    <div id="gr-${esc(ticketId)}">${verdict}</div>
  </div>`;
}

// Repaints open QRs after a re-render (counter and token are re-bound from the DOM).
function repaintLiveQrs() {
  for (const id of Object.keys(lastRotate)) if (state.sessions[id]) paintQr(id);
}

/* ---------- Eylemler ---------- */
// Primary sale: buyer uses Phantom or the demo wallet; payment + minting in one flow.
async function buyPrimary(eventId) {
  const ev = state.events.find((e) => e.id === eventId);
  if (!ev) return;
  const qty = qtyOf(ev);
  const ok = await confirmModal({
    title: "Primary purchase",
    rows: [["Event", ev.name], ["Face price", `${fmt(ev.face)} USDC`], ["Quantity", `${qty}`], ["Organizer", `${ROYALTY_PCT}% (primary)`], ["Total", `${fmt(ev.face * qty)} USDC`],
      ...(qty > 1 ? [["Signatures", `${qty} separate transactions, one per ticket`]] : [])],
    cta: qty > 1 ? `Sign and buy ${qty}` : "Sign and buy",
  });
  if (!ok) return;
  let bought = 0, lastLink, err = null;
  for (; bought < qty; bought++) {
    stepText(`Preparing transaction (${bought + 1}/${qty})…`);
    try {
      const r = await signAndSendPrimary(eventId);
      lastLink = r.explorer;
    } catch (e) { err = e; break; }
  }
  stepText("");
  if (bought > 0) {
    toast(`${bought} of ${qty} ticket(s) purchased. Added to My Tickets.`, false, lastLink);
    state.tab = "mine";
  }
  if (err) toast((bought > 0 ? `Stopped after ${bought} of ${qty}: ` : "") + errText(err), true);
  await refresh();
}

function signAndSendPrimary(eventId) {
  return signAndSend("/primary/prepare", { event_id: eventId, buyer: state.wallet }, { kind: "primary", event_id: eventId, buyer: state.wallet }, {});
}

async function buy(listingId) {
  const l = state.listings.find((x) => x.id === listingId);
  if (!l) return;
  const fee = (l.price * ROYALTY_PCT) / 100;
  const ok = await confirmModal({
    title: "Purchase summary",
    rows: [["Ticket", `${l.event} · ${l.ticket_id}`], ["Sale price", `${fmt(l.price)} USDC`], ["To seller", `${fmt(l.price - fee)} USDC`], ["Organizer royalty", `${fmt(fee)} USDC (${ROYALTY_PCT}%)`]],
    cta: "Sign with Phantom",
  });
  if (!ok) return;
  try {
    const r = await signAndSend("/tx/buy/prepare", { listing_id: l.id, buyer: state.wallet }, { kind: "buy", listing_id: l.id });
    toast(`Purchased. Ticket ${l.ticket_id} is now yours.`, false, r.explorer);
    state.tab = "mine";
  } catch (e) { toast(errText(e), true); }
  await refresh();
}

// Listing: the cap is checked on the client and the server; amber warning if exceeded.
async function listTicket(ticketId) {
  const input = document.querySelector(`[data-sell-for="${CSS.escape(ticketId)}"]`);
  const errEl = $("#serr-" + CSS.escape(ticketId));
  const price = Number(input?.value);
  const t = state.tickets.find((x) => x.id === ticketId);
  if (errEl) errEl.textContent = "";
  const cap = t ? effMax(t.max_price, t.face) : null;
  if (t && price > cap) {
    if (errEl) errEl.innerHTML = `<span class="pill amber">Price cap of ${fmt(cap)} USDC exceeded</span>`;
    return;
  }
  try {
    const r = await signAndSend("/tx/list/prepare", { ticket_id: ticketId, seller: state.wallet, price }, { kind: "list", ticket_id: ticketId, seller: state.wallet, price });
    toast(`Ticket ${ticketId} listed for sale: ${fmt(price)} USDC`, false, r.explorer);
    state.tab = "market";
  } catch (e) {
    if (errEl) errEl.innerHTML = `<span class="pill amber">${esc(errText(e))}</span>`;
    else toast(errText(e), true);
  }
  await refresh();
}

// Summary + confirmation modal (before the Phantom signature).
function confirmModal({ title, rows, cta }) {
  return new Promise((resolve) => {
    const m = $("#modal");
    m.innerHTML = `<h3>${esc(title)}</h3>
      ${rows.map(([k, v]) => `<div class="sumrow"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
      <div class="steps" id="step"></div>
      <div class="actions"><button class="btn ghost" data-m="no">Cancel</button><button class="btn" data-m="yes">${esc(cta)}</button></div>`;
    $("#overlay").classList.add("on");
    m.onclick = (e) => {
      const v = e.target.dataset.m;
      if (!v) return;
      $("#overlay").classList.remove("on");
      m.onclick = null;
      resolve(v === "yes");
    };
  });
}
function stepText(t) { const el = $("#step"); if (el) el.textContent = t; }

/* ---------- QR: session + refresh every 15 s ---------- */
// The wallet approves once (10-min session), then the server issues a fresh-nonce QR every 15 s.
async function startQr(ticketId) {
  try {
    if (!state.sessions[ticketId] || state.sessions[ticketId].exp < Date.now()) {
      let r;
      if (state.demoWallet) {
        r = await api("POST", "/demo/session", { ticket_id: ticketId, wallet: state.wallet });
      } else {
        const message = `FairTicket giris ${ticketId} ${Date.now()}`;
        const { signature } = await state.provider.signMessage(new TextEncoder().encode(message), "utf8");
        r = await api("POST", "/qr/session", { ticket_id: ticketId, wallet: state.wallet, message, signature: base58(signature) });
      }
      state.sessions[ticketId] = { s: r.session, exp: Date.now() + r.expires_in * 1000 };
    }
    await rotate(ticketId);
    clearInterval(state.rot[ticketId]);
    state.rot[ticketId] = setInterval(() => tickQr(ticketId), 250);
  } catch (e) { toast(errText(e), true); }
}

let lastRotate = {};
const verdicts = {};   // ticket -> last entry result (shown on the card)

function paintQr(ticketId) {
  const live = lastRotate[ticketId];
  const q = document.querySelector(`[data-qr="${CSS.escape(ticketId)}"]`);
  if (live && q) {
    q.className = "qrbox";
    q.innerHTML = "";
    new QRCode(q, { text: live.token, width: 140, height: 140, correctLevel: QRCode.CorrectLevel.M });
  }
  const tok = $("#tok-" + CSS.escape(ticketId));
  if (tok && live) tok.textContent = live.token.slice(0, 42) + "…";
  const gh = $("#gh-" + CSS.escape(ticketId));
  if (gh) gh.disabled = !live;
}

async function rotate(ticketId) {
  const sess = state.sessions[ticketId];
  if (!sess) return;
  const asked = Date.now();   // the server TTL starts at request time; the counter must start there too
  const r = await api("POST", "/qr/rotate", { session: sess.s });
  lastRotate[ticketId] = { token: r.token, at: asked, ttl: r.expires_in };
  paintQr(ticketId);
}

async function tickQr(ticketId) {
  const last = lastRotate[ticketId];
  const cd = $("#cd-" + CSS.escape(ticketId));
  if (!last || !cd) return;
  const left = Math.max(0, Math.ceil((last.at + last.ttl * 1000 - Date.now()) / 1000));
  cd.textContent = left + "s";
  cd.classList.toggle("low", left <= 5);
  if (left <= 0 && !last.busy) {
    last.busy = true;
    try { await rotate(ticketId); }
    catch (e) {
      clearInterval(state.rot[ticketId]);
      cd.textContent = "Expired";
      cd.classList.add("low");
      const sess = state.sessions[ticketId];
      if (e.code === "session_expired" || (sess && sess.exp < Date.now())) {
        delete state.sessions[ticketId];
      }
    } finally { last.busy = false; }
  }
}

/* ---------- Gate (demo): the user presents the token with a button; the server accepts it only once ---------- */
async function gateHandoff(ticketId) {
  const last = lastRotate[ticketId];
  if (!last) return;
  state.gate = null;
  const r = await verifyToken(last.token);
  showGateVerdict(r, ticketId);
  await refresh();
}

async function verifyToken(token) {
  try {
    const r = await api("POST", "/qr/verify", { token });
    return { valid: true, ticket_id: r.ticket_id };
  } catch (e) {
    return { valid: false, reason: e.data?.reason || e.code };
  }
}

function verdictHtml(r) {
  return r.valid
    ? `<div class="verdict ok">✓ Entry approved<small>Ticket ${esc(r.ticket_id)} marked as used.</small></div>`
    : `<div class="verdict bad">✕ ${esc(MSG[r.reason] || "Entry denied")}</div>`;
}

function showGateVerdict(r, ticketId) {
  verdicts[ticketId] = r;
  if (r.valid) {
    // Ticket used: stop the QR flow and close the code.
    clearInterval(state.rot[ticketId]);
    delete lastRotate[ticketId];
    delete state.sessions[ticketId];
  }
  const el = $("#gr-" + CSS.escape(ticketId));
  if (el) el.innerHTML = verdictHtml(r);
  else toast(r.valid ? `Entry approved: ${r.ticket_id}` : (MSG[r.reason] || "Entry denied"), !r.valid);
}

/* ---------- Olaylar ---------- */
document.addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-qty-for]");
  if (!sel) return;
  state.qty[sel.dataset.qtyFor] = Number(sel.value);
  sel.blur();   // odak kalırsa otomatik yenileme sürekli atlanır
});

document.addEventListener("click", async (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) { state.tab = tab.dataset.tab; render(); if (state.tab === "gate") startScan(); return; }
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  if (a === "connect-phantom") return connectPhantom().catch((x) => toast(x.message || "Connection cancelled", true));
  if (a === "connect-demo") return connectDemo().catch((x) => toast(errText(x), true));
  if (a === "disconnect") { try { await state.provider?.disconnect(); } catch {} state.wallet = null; state.demoWallet = null; state.provider = null; state.sessions = {}; Object.values(state.rot).forEach(clearInterval); state.rot = {}; lastRotate = {}; renderWallet(); return refresh(); }
  if (a === "buy-primary") return buyPrimary(id);
  if (a === "buy") return buy(id);
  if (a === "list") return listTicket(id);
  if (a === "qr") return startQr(id);
  if (a === "gate-handoff") return gateHandoff(id);
});

/* ---------- Staff: scan QR with the camera (jsQR) ---------- */
const SCAN_COOLDOWN_MS = 3000;
const scan = { stream: null, raf: 0, busy: false, until: 0, starting: false };
const gateResult = (html) => { $("#gate-result").innerHTML = html; };

function stopScan() {
  cancelAnimationFrame(scan.raf);
  scan.raf = 0;
  if (scan.stream) { scan.stream.getTracks().forEach((t) => t.stop()); scan.stream = null; }
  const v = $("#scan-video");
  if (v) v.srcObject = null;
}

async function startScan() {
  if (scan.stream || scan.starting) return;
  scan.starting = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      gateResult(`<div class="verdict bad">The camera only works over HTTPS (or localhost). Open the page with an https:// address.</div>`);
      return;
    }
    if (typeof jsQR !== "function") {
      gateResult(`<div class="verdict bad">The QR reader library (jsQR) failed to load. Check your internet connection and reload the page.</div>`);
      return;
    }
    gateResult(`<div class="verdict idle">Starting camera…</div>`);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (e) {
      const msg = e.name === "NotAllowedError" || e.name === "SecurityError" ? "Camera permission was not granted. Enable the camera for this site in your browser settings, then press \"Restart camera\"."
        : e.name === "NotFoundError" || e.name === "OverconstrainedError" ? "No camera found on this device."
        : e.name === "NotReadableError" ? "The camera is being used by another application."
        : "Could not open the camera: " + (e.message || e.name);
      gateResult(`<div class="verdict bad">${esc(msg)}</div>`);
      return;
    }
    // If the tab was left while waiting for permission, stop the camera right away.
    if (state.tab !== "gate") { stream.getTracks().forEach((t) => t.stop()); return; }
    scan.stream = stream;
    const v = $("#scan-video");
    v.srcObject = stream;
    await v.play().catch(() => {});
    gateResult(`<div class="verdict idle">Bring the QR code into the frame</div>`);
    scan.until = 0; scan.busy = false;
    scan.raf = requestAnimationFrame(scanFrame);
  } finally { scan.starting = false; }
}

function scanFrame() {
  if (!scan.stream) return;
  scan.raf = requestAnimationFrame(scanFrame);
  const v = $("#scan-video");
  if (scan.busy || Date.now() < scan.until || v.readyState < 2 || !v.videoWidth) return;
  const c = $("#scan-canvas"), ctx = c.getContext("2d", { willReadFrequently: true });
  c.width = v.videoWidth; c.height = v.videoHeight;
  ctx.drawImage(v, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
  if (code && code.data) handleScanned(code.data);
}

async function handleScanned(token) {
  scan.busy = true;
  try {
    const r = await verifyToken(token.trim());
    gateResult(verdictHtml(r));
  } finally {
    scan.busy = false;
    scan.until = Date.now() + SCAN_COOLDOWN_MS;   // do not resubmit the same code back to back
  }
}
$("#scan-restart").addEventListener("click", () => { stopScan(); startScan(); });

/* ---------- Organizer: create event + mint tickets ---------- */
const orgForm = $("#org-form");
const syncMax = () => { const f = Number(orgForm.elements.face.value); orgForm.elements.max.value = f > 0 ? (f * 1.2).toFixed(2) : ""; };
orgForm.elements.face.addEventListener("input", syncMax);
syncMax();
$("#org-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (state.wallet !== state.organizer) return toast("Only the organizer wallet can mint tickets", true);
  const f = Object.fromEntries(new FormData(ev.target));
  // Project rule: cap = face × 1.2 (20%), royalty fixed (ROYALTY_PCT) — form values are not trusted; they are fixed here.
  const face = Number(f.face), max = face * 1.2, count = Number(f.count);
  if (!(face > 0)) return toast("Face price must be greater than 0", true);
  if (!(Number.isInteger(count) && count >= 1 && count <= 10 && count <= Number(f.supply))) return toast("Ticket count must be a whole number from 1 to 10 and not exceed the supply", true);
  const btn = $("#org-btn"), steps = $("#org-steps");
  btn.disabled = true;
  let eventId = null, minted = 0;
  try {
    steps.textContent = "Writing the event on chain…";
    ({ event_id: eventId } = await api("POST", "/events", { name: f.name, face_price: face, max_price: max, royalty_percent: ROYALTY_PCT, supply: Number(f.supply) }));
    for (; minted < count; minted++) {
      steps.textContent = `Minting ticket (${minted + 1}/${count})…`;
      await api("POST", "/tickets/mint", { event_id: eventId, owner: state.wallet });
    }
    steps.textContent = "";
    toast(`${count} ticket(s) minted (${f.name}). Added to My Tickets.`);
    state.tab = "mine";
  } catch (e) {
    steps.textContent = "";
    toast((eventId ? `Event created (${eventId}) but only ${minted}/${count} tickets were minted: ` : "Could not create the event: ") + errText(e), true);
  }
  btn.disabled = false;
  await refresh();
});

// Logo: keyboard access (Enter / Space) — click is handled by the shared [data-tab] handler.
$(".logo").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } });

/* ---------- Startup ---------- */
api("GET", "/health").then((h) => { state.organizer = h.organizer || null; render(); }).catch(() => {});
renderWallet();
refresh();
setInterval(() => { if (state.wallet && !document.activeElement?.closest("#mine, #org-form, select[data-qty-for]")) refresh(); }, 15000);  // live sync: market and tickets
