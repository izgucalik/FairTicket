// FairTicket arayüzü — tek dosya. Sunucu (chain-api) aynı kökten servis eder.
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (a) => (a && a.length > 12 ? a.slice(0, 4) + "…" + a.slice(-4) : a || "—");
const fmt = (n) => Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 2 });

// Mesajlar: arayüzde ve jüri için okunabilir Türkçe karşılıklar
const MSG = {
  price_above_cap: (e) => `Fiyat tavanı ${fmt(e.max_price)} USDC aşıldı`,
  not_owner: "Bu bilet bu cüzdana ait değil",
  ticket_used: "Bu bilet daha önce kullanıldı",
  ticket_listed: "Bilet satışta; giriş kodu üretilemez",
  already_listed: "Bilet zaten satışta",
  already_used: "Hata: Bu kod/bilet daha önce kullanıldı! Replay saldırısı engellendi",
  expired: "Kodun süresi doldu; yeniden QR üretilmeli",
  unknown: "Kod tanınmıyor",
  session_expired: "Oturum doldu; cüzdanla yeniden onaylayın",
  wallet_not_controlled: "Bu cüzdan için sunucu imzası yok",
  payment_mismatch: "Ödeme tutarı veya hedefi eşleşmiyor",
  SOLD_OUT: "Kontenjan dolu",
  NETWORK: "Sunucuya ulaşılamadı",
  rpc_rate_limited: "Devnet RPC şu an sınırlıyor; birkaç saniye sonra tekrar deneyin",
  INTERNAL: "Sunucu hatası",
  user_rejected: "Cüzdan işlemi reddetti",
};
const errText = (e) => (typeof MSG[e.code] === "function" ? MSG[e.code](e.data || {}) : MSG[e.code]) || e.message || e.code || "Bilinmeyen hata";

const state = {
  wallet: null, provider: null, demoWallet: null,
  events: [], listings: [], tickets: [],
  tab: "events", sessions: {}, rot: {}, gate: null,
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
  el.innerHTML = esc(text) + (link ? ` <a href="${esc(link)}" target="_blank" rel="noopener">Zincirde gör ↗</a>` : "");
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

/* ---------- Cüzdan: Phantom gerçek bağlantı; yoksa demo fallback ---------- */
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
  if (!p) { toast("Phantom bulunamadı. Demo cüzdanı kullanılabilir.", true); return; }
  const r = await p.connect();
  state.provider = p;
  state.wallet = (r?.publicKey || p.publicKey).toString();
  state.demoWallet = null;
  await afterConnect();
}

async function connectDemo() {
  const { address } = await api("GET", "/demo/wallet");
  state.provider = null;          // demo: imza sunucu tarafında (hibrit değil, sunucu imzalı)
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
    el.innerHTML = `<button class="wbtn" data-act="connect-phantom">Phantom bağla</button>
      <button class="wbtn" data-act="connect-demo">Demo cüzdan</button>`;
    return;
  }
  const label = state.demoWallet ? "Demo cüzdan" : "Phantom";
  el.innerHTML = `<button class="wbtn conn" data-act="disconnect" title="Bağlantıyı kes"><span class="dot ${state.demoWallet ? "demo" : ""}"></span>${label} · ${esc(short(state.wallet))}</button>`;
}

// Hibrit imza: sunucu işlemi kurar, cüzdan imzalar (Phantom ya da demo sunucu imzası), sunucu gönderir.
async function signAndSend(prepPath, prepBody, submitExtra, { serverSign = false } = {}) {
  const prep = await api("POST", prepPath, prepBody);
  const { Transaction } = window.solanaWeb3;
  const tx = Transaction.from(Uint8Array.from(atob(prep.tx), (c) => c.charCodeAt(0)));
  if (state.demoWallet) {
    // Demo cüzdanı: sunucu kendi anahtarıyla imzalar (wallet_not_controlled yok).
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
  } catch (e) { toast("Veri alınamadı: " + errText(e), true); }
  render();
}

/* ---------- Render ---------- */
function render() {
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
  if (!evs.length) { $("#events").innerHTML = `<div class="card empty">Etkinlik yükleniyor…</div>`; return; }
  const feat = evs.find((e) => e.featured) || evs[0];
  const rest = evs.filter((e) => e !== feat);
  const pct = (e) => Math.round((e.minted / e.supply) * 100);
  const card = (e, big) => `
    <div class="card ${big ? "feat" : ""} ev-card">
      <div>
        <div class="kicker">${esc(e.tag)}${big ? " · Öne çıkan" : ""}</div>
        <div class="title">${esc(e.name)}</div>
        <div class="meta">${esc(new Date(e.date).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "short" }))} · ${esc(e.venue)}</div>
      </div>
      ${big ? `<div class="kv">
        <div><small>Etiket fiyatı</small><b>${fmt(e.face)} USDC</b></div>
        <div><small>Tavan (%${e.cap_pct})</small><b class="amber">${fmt(e.max)} USDC</b></div>
        <div><small>Organizatör payı</small><b>%${fmt(e.royalty_percent)}</b></div>
        <div><small>Kalan bilet</small><b>${e.remaining}</b></div></div>` : ""}
      <div class="meta small">${big ? "" : `Etiket ${fmt(e.face)} USDC · Tavan ${fmt(e.max)} USDC · Telif %${fmt(e.royalty_percent)} · Kalan ${e.remaining}`}</div>
      <div class="bar" style="margin-top:0"><i style="width:${pct(e)}%"></i></div>
      <div class="ev-foot">
        <div class="price">${fmt(e.face)}<small>USDC</small></div>
        <button class="btn" data-act="buy-primary" data-id="${esc(e.id)}" ${e.remaining <= 0 ? "disabled" : ""}>${e.remaining <= 0 ? "Tükendi" : "Bilet al"}</button>
      </div>
    </div>`;
  $("#events").innerHTML = card(feat, true) + `<div class="grid2">${rest.map((e) => card(e, false)).join("")}</div>`;
}

function renderMarket() {
  const ls = state.listings;
  // Üst özet: ilk ilanın etkinliği (en çok ilan olan).
  const counts = {};
  ls.forEach((l) => (counts[l.event] = (counts[l.event] || 0) + 1));
  const topName = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const ev = state.events.find((e) => e.name === topName) || state.events[0];
  $("#market-sum").innerHTML = ev ? `
    <div class="sumcard">
      <div>
        <div class="kicker">Etkinlik özeti</div>
        <div class="title">${esc(ev.name)}</div>
        <div class="kv" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          <div><small>Etiket fiyatı</small><b>${fmt(ev.face)} USDC</b></div>
          <div><small>Fiyat tavanı (%${ev.cap_pct})</small><b class="amber">${fmt(ev.max)} USDC</b></div>
          <div><small>Organizatör payı</small><b>%${fmt(ev.royalty_percent)}</b></div>
        </div>
      </div>
      <div class="meta small" style="text-align:right">Aktif ilan<br><b style="font-size:24px;color:var(--tx)">${ls.length}</b></div>
    </div>` : `<div class="empty">Etkinlik bilgisi yok.</div>`;

  $("#listings").innerHTML = ls.length ? ls.map((l) => {
    const diff = l.price - l.face;
    const cls = diff > 0 ? "up" : "down";
    const mine = state.wallet && l.seller === state.wallet;
    const fee = (l.price * l.royalty_percent) / 100;
    return `<div class="lrow">
      <div style="min-width:0">
        <div class="t">${esc(l.event)} <span class="pill">${esc(l.ticket_id)}</span></div>
        <div class="mono">Satıcı ${esc(short(l.seller))}</div>
        <div class="feeline">Tavan ${fmt(l.max_price)} · Telif %${fmt(l.royalty_percent)} = ${fmt(fee)} USDC</div>
      </div>
      <div class="mid" style="text-align:right">
        <div class="price">${fmt(l.price)} USDC</div>
        <div class="small"><span class="delta ${cls}">${diff >= 0 ? "+" : ""}${fmt(diff)} USDC</span><span class="mut">nominale göre</span></div>
      </div>
      ${mine ? `<span class="pill">Sizin ilanınız</span>`
        : `<button class="btn sm" data-act="buy" data-id="${esc(l.id)}" ${state.wallet ? "" : "disabled"}>Satın Al</button>`}
    </div>`;
  }).join("") : `<div class="empty">Şu an satışta bilet yok.</div>`;
}

function renderMine() {
  const el = $("#mine");
  if (!state.wallet) { el.innerHTML = `<div class="card empty">Biletlerinizi görmek için Phantom bağlayın ya da demo cüzdanı seçin.</div>`; return; }
  const live = state.tickets.filter((t) => t.status !== "used");
  const used = state.tickets.filter((t) => t.status === "used");
  const card = (t) => {
    const sellable = t.status === "valid";
    return `<div class="card tk">
      <div class="tk-head">
        <div><div class="title" style="font-size:16px">${esc(t.event)}</div><div class="mono">${esc(t.id)}</div></div>
        <span class="pill ${t.status === "valid" ? "mint" : t.status === "listed" ? "amber" : "red"}">${t.status === "valid" ? "Geçerli" : t.status === "listed" ? "Satışta" : "Kullanıldı"}</span>
      </div>
      ${t.status === "valid" ? `<div class="qrwrap" id="qr-${esc(t.id)}">${qrInner(t.id)}</div>` : ""}
      ${t.status === "listed" ? `<div class="meta small">Bilet satışta; ilan kaldırılmadan giriş kodu üretilemez.</div>` : ""}
      ${t.status === "used" ? `<div class="meta small">Bu bilet giriş için kullanıldı.</div>` : ""}
      ${sellable ? `<div class="sellrow">
        <label>Satış fiyatı (USDC · tavan ${fmt(t.max_price)})
          <input type="number" min="1" step="0.5" value="${esc(Math.min(t.max_price, t.face * 1.05).toFixed(2))}" data-sell-for="${esc(t.id)}">
        </label>
        <button class="btn ghost sm" data-act="list" data-id="${esc(t.id)}">Satışa çıkar</button>
      </div>
      <div class="err" id="serr-${esc(t.id)}"></div>` : ""}
    </div>`;
  };
  el.innerHTML = `
    <div class="section-t">Aktif biletler (${live.length})</div>
    <div class="grid2">${live.length ? live.map(card).join("") : `<div class="card empty">Aktif biletiniz yok. Etkinlikler sekmesinden bilet alabilirsiniz.</div>`}</div>
    ${used.length ? `<div class="section-t">Kullanılmış (${used.length})</div><div class="grid2">${used.map(card).join("")}</div>` : ""}`;
}

// Kart içeriği. Aktif QR varsa yeniden çizimde (15 sn'lik yenileme, sekme değişimi) kaybolmaz.
function qrInner(ticketId) {
  const live = lastRotate[ticketId];
  const verdict = verdicts[ticketId] ? verdictHtml(verdicts[ticketId]) : "";
  return `<div class="qrbox empty" data-qr="${esc(ticketId)}">${live ? "" : `Giriş QR kodu için "Giriş QR üret" butonunu kullanın`}</div>
  <div style="flex:1;min-width:0">
    <div class="small mut">Yenilenmeye kalan</div>
    <div class="count" id="cd-${esc(ticketId)}">${live ? "" : "—"}</div>
    <div class="token" id="tok-${esc(ticketId)}">${live ? esc(live.token.slice(0, 42) + "…") : ""}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      <button class="btn sm" data-act="qr" data-id="${esc(ticketId)}">Giriş QR üret</button>
      <button class="btn ghost sm" data-act="gate-handoff" data-id="${esc(ticketId)}" ${live ? "" : "disabled"} id="gh-${esc(ticketId)}">Turnikede Okut (demo)</button>
    </div>
    <div id="gr-${esc(ticketId)}">${verdict}</div>
  </div>`;
}

// Yeniden çizimden sonra açık QR'ları yeniden boyar (sayaç ve token DOM'dan yeniden bağlanır).
function repaintLiveQrs() {
  for (const id of Object.keys(lastRotate)) if (state.sessions[id]) paintQr(id);
}

/* ---------- Eylemler ---------- */
// Birincil satış: alıcı Phantom ya da demo cüzdan; ödeme + bilet basımı tek akış.
async function buyPrimary(eventId) {
  const ev = state.events.find((e) => e.id === eventId);
  if (!ev) return;
  const ok = await confirmModal({
    title: "Birincil satın alma",
    rows: [["Etkinlik", ev.name], ["Etiket fiyatı", `${fmt(ev.face)} USDC`], ["Organizatör", `%${fmt(ev.royalty_percent)} (birincil)`], ["Toplam", `${fmt(ev.face)} USDC`]],
    cta: "İmzala ve satın al",
  });
  if (!ok) return;
  stepText("İşlem hazırlanıyor…");
  try {
    const r = await signAndSendPrimary(eventId);
    toast(`Bilet alındı: ${r.ticket_id}. Biletlerim sekmesine eklendi.`, false, r.explorer);
    state.tab = "mine";
  } catch (e) { toast(errText(e), true); }
  stepText("");
  await refresh();
}

function signAndSendPrimary(eventId) {
  return signAndSend("/primary/prepare", { event_id: eventId, buyer: state.wallet }, { kind: "primary", event_id: eventId, buyer: state.wallet }, {});
}

async function buy(listingId) {
  const l = state.listings.find((x) => x.id === listingId);
  if (!l) return;
  const fee = (l.price * l.royalty_percent) / 100;
  const ok = await confirmModal({
    title: "Satın alma özeti",
    rows: [["Bilet", `${l.event} · ${l.ticket_id}`], ["Satış fiyatı", `${fmt(l.price)} USDC`], ["Satıcıya", `${fmt(l.price - fee)} USDC`], ["Organizatör telifi", `${fmt(fee)} USDC (%${fmt(l.royalty_percent)})`]],
    cta: "Phantom ile imzala",
  });
  if (!ok) return;
  try {
    const r = await signAndSend("/tx/buy/prepare", { listing_id: l.id, buyer: state.wallet }, { kind: "buy", listing_id: l.id });
    toast(`Satın alındı. Bilet ${l.ticket_id} artık sizin.`, false, r.explorer);
    state.tab = "mine";
  } catch (e) { toast(errText(e), true); }
  await refresh();
}

// Satışa çıkarma: tavan istemcide ve sunucuda kontrol edilir; aşımda amber uyarı.
async function listTicket(ticketId) {
  const input = document.querySelector(`[data-sell-for="${CSS.escape(ticketId)}"]`);
  const errEl = $("#serr-" + CSS.escape(ticketId));
  const price = Number(input?.value);
  const t = state.tickets.find((x) => x.id === ticketId);
  if (errEl) errEl.textContent = "";
  if (t && price > t.max_price) {
    if (errEl) errEl.innerHTML = `<span class="pill amber">Fiyat tavanı ${fmt(t.max_price)} USDC aşıldı</span>`;
    return;
  }
  try {
    const r = await signAndSend("/tx/list/prepare", { ticket_id: ticketId, seller: state.wallet, price }, { kind: "list", ticket_id: ticketId, seller: state.wallet, price });
    toast(`Bilet ${ticketId} satışa çıktı: ${fmt(price)} USDC`, false, r.explorer);
    state.tab = "market";
  } catch (e) {
    if (errEl) errEl.innerHTML = `<span class="pill amber">${esc(errText(e))}</span>`;
    else toast(errText(e), true);
  }
  await refresh();
}

// Özet + onay modalı (Phantom imzasından önce).
function confirmModal({ title, rows, cta }) {
  return new Promise((resolve) => {
    const m = $("#modal");
    m.innerHTML = `<h3>${esc(title)}</h3>
      ${rows.map(([k, v]) => `<div class="sumrow"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}
      <div class="steps" id="step"></div>
      <div class="actions"><button class="btn ghost" data-m="no">Vazgeç</button><button class="btn" data-m="yes">${esc(cta)}</button></div>`;
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

/* ---------- QR: oturum + 15 sn'de bir yenileme ---------- */
// Cüzdan bir kez onaylar (oturum 10 dk), sonra her 15 sn'de sunucu yeni nonce'lu QR üretir.
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
const verdicts = {};   // bilet -> son giriş sonucu (kartta gösterilir)

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
  const r = await api("POST", "/qr/rotate", { session: sess.s });
  lastRotate[ticketId] = { token: r.token, at: Date.now(), ttl: r.expires_in };
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
      cd.textContent = "Süre doldu";
      cd.classList.add("low");
      const sess = state.sessions[ticketId];
      if (e.code === "session_expired" || (sess && sess.exp < Date.now())) {
        delete state.sessions[ticketId];
      }
    } finally { last.busy = false; }
  }
}

/* ---------- Turnike (demo): kullanıcı butonla token'ı sunar; sunucu tek kez kabul eder ---------- */
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
    ? `<div class="verdict ok">✓ Giriş onaylandı<small>Bilet ${esc(r.ticket_id)} kullanıldı olarak işaretlendi.</small></div>`
    : `<div class="verdict bad">✕ ${esc(MSG[r.reason] || "Giriş reddedildi")}</div>`;
}

function showGateVerdict(r, ticketId) {
  verdicts[ticketId] = r;
  if (r.valid) {
    // Bilet kullanıldı: QR akışını durdur, kodu kapat.
    clearInterval(state.rot[ticketId]);
    delete lastRotate[ticketId];
    delete state.sessions[ticketId];
  }
  const el = $("#gr-" + CSS.escape(ticketId));
  if (el) el.innerHTML = verdictHtml(r);
  else toast(r.valid ? `Giriş onaylandı: ${r.ticket_id}` : (MSG[r.reason] || "Giriş reddedildi"), !r.valid);
}

/* ---------- Olaylar ---------- */
document.addEventListener("click", async (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) { state.tab = tab.dataset.tab; render(); return; }
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  if (a === "connect-phantom") return connectPhantom().catch((x) => toast(x.message || "Bağlantı iptal edildi", true));
  if (a === "connect-demo") return connectDemo().catch((x) => toast(errText(x), true));
  if (a === "disconnect") { state.wallet = null; state.demoWallet = null; state.provider = null; state.sessions = {}; Object.values(state.rot).forEach(clearInterval); state.rot = {}; lastRotate = {}; renderWallet(); return refresh(); }
  if (a === "buy-primary") return buyPrimary(id);
  if (a === "buy") return buy(id);
  if (a === "list") return listTicket(id);
  if (a === "qr") return startQr(id);
  if (a === "gate-handoff") return gateHandoff(id);
});

/* ---------- Başlatma ---------- */
renderWallet();
refresh();
setInterval(() => { if (state.wallet) refresh(); }, 15000);  // canlı senkronizasyon: pazar ve biletler
