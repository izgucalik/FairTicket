// FairTicket API (API.md sözleşmesi) — Devnet programına bağlı.
// Çalıştırma: node chain-api/server.mjs   (port 8000)
//
// Kısıt: list_ticket ve buy_ticket işlemleri ilgili cüzdanın imzasını ister.
// Bu sunucu yalnızca anahtarını tuttuğu demo cüzdanları (fairticket_program/.demo-keys.json)
// için bu işlemleri imzalayabilir. Diğer cüzdanlar için 403 wallet_not_controlled döner.

import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import anchor from "@coral-xyz/anchor";
import { Keypair, Connection, PublicKey, SystemProgram, Transaction, clusterApiUrl } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo, getAccount, TOKEN_PROGRAM_ID, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";

const { BN } = anchor;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const PORT = 8000;
const MODE = "devnet";
const USDC = 1_000_000;
const QR_TTL = 30;                 // API.md: expires_in 30
const QR_MSG_MAX_AGE_MS = 5 * 60_000;
const PROGRAM_ID = new PublicKey("6xrY8GHUgWPZrjkRdNGTrD5Cp55icUN3L4Fot7MLiujs");
const MINT = new PublicKey("9GoqbmaYzShY2hMmaAUkNZf9gysrd4TNzdiczmHuLUJn");
const STORE_PATH = path.join(HERE, "store.json");
const KEYS_PATH = path.join(ROOT, "fairticket_program", ".demo-keys.json");
const IDL_PATH = path.join(ROOT, "fairticket_program", "target", "idl", "fairticket_program.json");

const IDL = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
if (IDL.address !== PROGRAM_ID.toBase58()) throw new Error("IDL adresi beklenen program ID ile eşleşmiyor");

const organizer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))),
);
const demoKeys = JSON.parse(fs.readFileSync(KEYS_PATH, "utf8"));
const controlled = new Map();      // base58 adres -> Keypair (sadece demo cüzdanları)
for (const k of Object.values(demoKeys)) {
  const kp = Keypair.fromSecretKey(Uint8Array.from(k));
  controlled.set(kp.publicKey.toBase58(), kp);
}

const RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
const connection = new Connection(RPC_URL, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(organizer), { commitment: "confirmed" });
const program = new anchor.Program(IDL, provider);

/* ---------- Kalıcı yerel durum (önbellek + QR nonce'ları) ---------- */
function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")); }
  catch {
    return { seq: { e: 0, t: 0, l: 0 }, qrSecret: randomBytes(32).toString("hex"), events: {}, tickets: {}, listings: {}, nonces: {} };
  }
}
const store = loadStore();
function save() {
  fs.writeFileSync(STORE_PATH + ".tmp", JSON.stringify(store, null, 2));
  fs.renameSync(STORE_PATH + ".tmp", STORE_PATH);
}
const nextId = (k) => `${k}${++store.seq[k]}`;

/* ---------- Yardımcılar ---------- */
const usdc = (base) => Number(base) / USDC;
const toBase = (x) => BigInt(Math.round(Number(x) * USDC));
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const ALIAS = { not_ticket_owner: "not_owner" };

class ApiErr extends Error {
  constructor(status, code, message, extra = {}) { super(message || code); this.status = status; this.code = code; this.extra = extra; }
}

// Zincir hatasını API kodlarına çevirir (ör. PriceAboveCap -> price_above_cap).
function chainErr(e) {
  const raw = e?.error?.errorCode?.code;
  if (raw) {
    const code = ALIAS[snake(raw)] || snake(raw);
    return new ApiErr(422, code, e.error.errorMessage || raw);
  }
  return new ApiErr(502, "chain_error", (e?.message || "zincir hatası").split("\n")[0]);
}

function parsePubkey(s, field) {
  try { return new PublicKey(String(s)); }
  catch { throw new ApiErr(400, "VALIDATION_ERROR", `${field} geçerli bir Solana adresi değil`); }
}

// Zincir işlemleri tek sırada çalışır: bilet indeksi ve nonce yarışları önlenir.
let queue = Promise.resolve();
const serial = (fn) => { const run = queue.then(fn); queue = run.catch(() => {}); return run; };

const eventPda = (chainEventId) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("event"), organizer.publicKey.toBuffer(), new BN(chainEventId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID)[0];
const ticketPda = (evKey, index) => {
  const b = Buffer.alloc(4); b.writeUInt32LE(index);
  return PublicKey.findProgramAddressSync([Buffer.from("ticket"), evKey.toBuffer(), b], PROGRAM_ID)[0];
};
const listingPda = (tk) => PublicKey.findProgramAddressSync([Buffer.from("listing"), tk.toBuffer()], PROGRAM_ID)[0];

async function ensureSol(pub, minLamports = 0.01e9) {
  if ((await connection.getBalance(pub)) >= minLamports) return;
  await provider.sendAndConfirm(new Transaction().add(
    SystemProgram.transfer({ fromPubkey: organizer.publicKey, toPubkey: pub, lamports: 0.05e9 })));
}
// Devnet test USDC'si: mint yetkisi organizatörde. Alıcı bakiyesi yetmezse tamamlanır.
async function ensureUsdc(owner, ata, amount) {
  const acc = await getAccount(connection, ata);
  if (acc.amount < BigInt(amount)) await mintTo(connection, organizer, MINT, ata, organizer, BigInt(amount) * 2n);
}

function eventView(ev) {
  return { name: ev.name, faceBase: BigInt(ev.faceBase), maxBps: ev.maxBps, royaltyBps: ev.royaltyBps };
}
const capBase = (ev) => (BigInt(ev.faceBase) * BigInt(ev.maxBps)) / 10000n;
const royaltyOf = (price, bps) => (price * BigInt(bps)) / 10000n;

async function fetchTicketChain(t) {
  return program.account.ticket.fetch(ticketPda(new PublicKey(store.events[t.eventId].pda), t.index));
}
function activeListingFor(ticketId) {
  return Object.values(store.listings).find((l) => l.ticketId === ticketId && l.status === "active");
}

/* ---------- Uygulama ---------- */
const app = express();
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const send = (fn) => async (req, res) => {
  try {
    const out = await fn(req);
    res.json({ mode: MODE, ...out });
  } catch (e) {
    if (e instanceof ApiErr) {
      // /qr/verify hatası API.md'de { valid:false, reason } biçiminde
      if (e.extra.valid === false) return res.status(e.status).json({ mode: MODE, valid: false, reason: e.extra.reason });
      return res.status(e.status).json({ mode: MODE, ok: false, error: e.code, message: e.message, ...e.extra });
    }
    if (e?.name === "ZodError") return res.status(400).json({ mode: MODE, ok: false, error: "VALIDATION_ERROR", message: e.message });
    // Devnet RPC hız sınırı: kullanıcıya açık ve yeniden denenebilir bir hata olarak dön.
    if (isRateLimit(e)) {
      return res.status(503).json({ mode: MODE, ok: false, error: "rpc_rate_limited",
        message: "Devnet RPC şu an istekleri sınırlıyor. Birkaç saniye sonra tekrar deneyin (SOLANA_RPC_URL ile kendi RPC adresinizi kullanabilirsiniz)." });
    }
    console.error(e);
    res.status(500).json({ mode: MODE, ok: false, error: "INTERNAL", message: "Sunucu hatası" });
  }
};
function isRateLimit(e) {
  const s = `${e?.message || ""} ${e?.cause?.message || ""}`;
  return /429|Too Many Requests/i.test(s);
}

app.get("/health", send(async () => ({ ok: true, organizer: organizer.publicKey.toBase58() })));

// POST /events — organizatör etkinlik ve kuralları tanımlar (create_event).
app.post("/events", send(async ({ body }) => {
  const name = String(body.name ?? "").trim();
  const face = Number(body.face_price), max = Number(body.max_price);
  const roy = Number(body.royalty_percent), supply = Number(body.supply);
  if (!name) throw new ApiErr(400, "VALIDATION_ERROR", "Etkinlik adı gerekli");
  if (!(face > 0) || !(max >= face)) throw new ApiErr(400, "VALIDATION_ERROR", "Nominal fiyat > 0 ve azami fiyat ≥ nominal olmalı");
  if (!(roy >= 0 && roy <= 100)) throw new ApiErr(400, "VALIDATION_ERROR", "Telif yüzde 0–100 arasında olmalı");
  if (!(Number.isInteger(supply) && supply > 0)) throw new ApiErr(400, "VALIDATION_ERROR", "Kontenjan pozitif tam sayı olmalı");

  const faceBase = toBase(face);
  const maxBps = Math.round((max / face) * 10000);
  const royaltyBps = Math.round(roy * 100);
  const chainEventId = Date.now();
  const pda = eventPda(chainEventId);

  return serial(async () => {
    try {
      await program.methods.createEvent(new BN(chainEventId), new BN(faceBase.toString()), maxBps, royaltyBps, MINT)
        .accounts({ authority: organizer.publicKey, event: pda, systemProgram: SystemProgram.programId }).rpc();
    } catch (e) { throw chainErr(e); }
    const id = nextId("e");
    store.events[id] = { id, name, pda: pda.toBase58(), chainEventId, faceBase: faceBase.toString(), maxBps, royaltyBps, supply, ticketCount: 0 };
    save();
    return { event_id: id };
  });
}));

// POST /tickets/mint — yetkili bilet üretimi (mint_ticket).
app.post("/tickets/mint", send(async ({ body }) => {
  const ev = store.events[body.event_id];
  if (!ev) throw new ApiErr(404, "NOT_FOUND", "Etkinlik bulunamadı");
  const owner = parsePubkey(body.owner, "owner");

  return serial(async () => {
    if (ev.ticketCount >= ev.supply) throw new ApiErr(409, "SOLD_OUT", "Kontenjan dolu");
    const evKey = new PublicKey(ev.pda);
    const onChain = await program.account.event.fetch(evKey);
    const index = onChain.ticketCount;
    try {
      await program.methods.mintTicket(owner)
        .accounts({ authority: organizer.publicKey, event: evKey, ticket: ticketPda(evKey, index), systemProgram: SystemProgram.programId })
        .rpc();
    } catch (e) { throw chainErr(e); }
    const id = nextId("t");
    store.tickets[id] = { id, eventId: ev.id, index, used: false };
    ev.ticketCount += 1;
    save();
    return { ticket_id: id, status: "valid" };
  });
}));

// GET /tickets?owner= — cüzdanın biletleri (sahiplik zincirden okunur).
app.get("/tickets", send(async ({ query }) => {
  const owner = parsePubkey(query.owner, "owner");
  const out = [];
  await Promise.all(Object.values(store.tickets).map(async (t) => {
    try {
      const c = await fetchTicketChain(t);
      if (c.used && !t.used) { t.used = true; }
      if (!c.owner.equals(owner)) return;
      const listing = activeListingFor(t.id);
      const status = c.used ? "used" : listing ? "listed" : "valid";
      out.push({
        id: t.id, event: store.events[t.eventId].name, owner: c.owner.toBase58(), status,
        face: usdc(store.events[t.eventId].faceBase), max_price: usdc(capBase(store.events[t.eventId])),
      });
    } catch (e) { if (isRateLimit(e)) throw e; /* zincirde henüz yoksa atla */ }
  }));
  save();
  return { tickets: out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })) };
}));

// GET /listings — aktif ilanlar.
app.get("/listings", send(async () => {
  const listings = Object.values(store.listings)
    .filter((l) => l.status === "active")
    .map((l) => {
      const ev = store.events[store.tickets[l.ticketId].eventId];
      return {
        id: l.id, ticket_id: l.ticketId, event: ev.name, price: usdc(l.price), max_price: usdc(capBase(ev)),
        face: usdc(ev.faceBase), royalty_percent: ev.royaltyBps / 100, seller: l.seller,
      };
    });
  return { listings };
}));

// POST /listings — bileti pazar yerinde listeler (list_ticket). Tavan zincirde zorunlu.
app.post("/listings", send(async ({ body }) => {
  const t = store.tickets[body.ticket_id];
  if (!t) throw new ApiErr(404, "NOT_FOUND", "Bilet bulunamadı");
  const ev = store.events[t.eventId];
  const seller = parsePubkey(body.seller, "seller");
  const price = Number(body.price);
  if (!(price > 0)) throw new ApiErr(422, "INVALID_PRICE", "Fiyat sıfırdan büyük olmalı");

  const base = toBase(price);
  const cap = capBase(ev);
  if (base > cap) throw new ApiErr(422, "price_above_cap", "Fiyat izin verilen üst sınırı aşıyor", { ok: false, max_price: usdc(cap) });

  const kp = controlled.get(seller.toBase58());
  if (!kp) throw new ApiErr(403, "wallet_not_controlled", "Bu cüzdanın imzası sunucuda yok; listeleme cüzdan imzasıyla yapılmalı");

  return serial(async () => {
    const evKey = new PublicKey(ev.pda);
    const tk = ticketPda(evKey, t.index);
    const c = await program.account.ticket.fetch(tk);
    if (c.used) throw new ApiErr(409, "ticket_used", "Kullanılmış bilet satılamaz");
    if (!c.owner.equals(seller)) throw new ApiErr(403, "not_owner", "Bu bilet size ait değil");
    if (activeListingFor(t.id)) throw new ApiErr(409, "already_listed", "Bilet zaten satışta");

    await ensureSol(seller);
    const lk = listingPda(tk);
    try {
      await program.methods.listTicket(new BN(base.toString()))
        .accounts({ seller, event: evKey, ticket: tk, listing: lk, systemProgram: SystemProgram.programId })
        .signers([kp]).rpc();
    } catch (e) { throw chainErr(e); }

    const id = nextId("l");
    store.listings[id] = { id, ticketId: t.id, seller: seller.toBase58(), price: base.toString(), status: "active" };
    save();
    return { ok: true, listing_id: id };
  });
}));

// POST /listings/:id/buy — satın alma: ödeme bölünür, bilet devredilir (buy_ticket).
app.post("/listings/:id/buy", send(async ({ params, body }) => {
  const l = store.listings[params.id];
  if (!l || l.status !== "active") throw new ApiErr(404, "NOT_FOUND", "Aktif ilan bulunamadı");
  const t = store.tickets[l.ticketId];
  const ev = store.events[t.eventId];
  const buyer = parsePubkey(body.buyer, "buyer");
  const kp = controlled.get(buyer.toBase58());
  if (!kp) throw new ApiErr(403, "wallet_not_controlled", "Bu cüzdanın imzası sunucuda yok; satın alma cüzdan imzasıyla yapılmalı");

  return serial(async () => {
    const seller = new PublicKey(l.seller);
    const price = BigInt(l.price);
    const royalty = royaltyOf(price, ev.royaltyBps);
    const sellerReceives = price - royalty;
    const evKey = new PublicKey(ev.pda);
    const tk = ticketPda(evKey, t.index);

    await ensureSol(seller);
    await ensureSol(buyer, 0.01e9);
    const buyerAta = await getOrCreateAssociatedTokenAccount(connection, organizer, MINT, buyer);
    const sellerAta = await getOrCreateAssociatedTokenAccount(connection, organizer, MINT, seller);
    const orgAta = await getOrCreateAssociatedTokenAccount(connection, organizer, MINT, organizer.publicKey);
    await ensureUsdc(buyer, buyerAta.address, price);

    try {
      await program.methods.buyTicket()
        .accounts({
          buyer, event: evKey, ticket: tk, listing: listingPda(tk), seller,
          buyerToken: buyerAta.address, sellerToken: sellerAta.address, organizerToken: orgAta.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([kp]).rpc();
    } catch (e) { throw chainErr(e); }

    l.status = "sold";
    save();
    return {
      ok: true,
      seller_receives: usdc(sellerReceives),
      organizer_royalty: usdc(royalty),
      new_owner: buyer.toBase58(),
    };
  });
}));

// POST /qr/issue — sahibin cüzdan imzasını doğrular, kısa ömürlü token üretir.
app.post("/qr/issue", send(async ({ body }) => {
  const t = store.tickets[body.ticket_id];
  if (!t) throw new ApiErr(404, "NOT_FOUND", "Bilet bulunamadı");
  const wallet = parsePubkey(body.wallet, "wallet");
  const m = /^FairTicket giris (\S+) (\d+)$/.exec(String(body.message ?? ""));
  if (!m || m[1] !== t.id || Math.abs(Date.now() - Number(m[2])) > QR_MSG_MAX_AGE_MS)
    throw new ApiErr(401, "invalid_signature", "Mesaj geçersiz veya süresi dolmuş");

  let ok = false;
  try {
    ok = nacl.sign.detached.verify(
      new TextEncoder().encode(body.message), bs58.decode(String(body.signature ?? "")), wallet.toBytes());
  } catch { ok = false; }
  if (!ok) throw new ApiErr(401, "invalid_signature", "İmza geçersiz");

  const c = await serial(() => fetchTicketChain(t));
  if (!c.owner.equals(wallet)) throw new ApiErr(403, "not_owner", "Bu bilet size ait değil");
  if (c.used) throw new ApiErr(409, "ticket_used", "Bilet zaten kullanılmış");
  if (activeListingFor(t.id)) throw new ApiErr(409, "ticket_listed", "Bilet satışta; ilan kaldırılmadan giriş kodu üretilemez");

  const nonce = randomBytes(16).toString("hex");
  const expires = Math.floor(Date.now() / 1000) + QR_TTL;
  store.nonces[nonce] = { ticketId: t.id, wallet: wallet.toBase58(), expires, used: false };
  save();
  const body64 = Buffer.from(JSON.stringify({ t: t.id, w: wallet.toBase58(), n: nonce, e: expires })).toString("base64url");
  const sig = createHmac("sha256", store.qrSecret).update(body64).digest("base64url");
  return { token: `${body64}.${sig}`, expires_in: QR_TTL };
}));

// POST /qr/verify — giriş görevlisi doğrulaması. Nonce tek kullanımlıktır.
app.post("/qr/verify", send(async ({ body }) => {
  const reject = (reason) => { throw new ApiErr(400, "REJECT", reason, { valid: false, reason }); };
  const token = String(body.token ?? "");
  const [b64, sig, extra] = token.split(".");
  if (!b64 || !sig || extra !== undefined) reject("unknown");

  const expected = createHmac("sha256", store.qrSecret).update(b64).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) reject("unknown");

  let p;
  try { p = JSON.parse(Buffer.from(b64, "base64url").toString()); } catch { reject("unknown"); }
  const rec = store.nonces[p.n];
  if (!rec || rec.ticketId !== p.t || rec.wallet !== p.w) reject("unknown");
  if (rec.used) reject("already_used");
  if (activeListingFor(rec.ticketId)) reject("ticket_listed");
  if (rec.expires < Math.floor(Date.now() / 1000)) reject("expired");

  // Senkron kontrol+işaretleme: aynı anda gelen iki okutmadan yalnızca biri geçer.
  rec.used = true;
  save();

  return serial(async () => {
    const t = store.tickets[rec.ticketId];
    const ev = store.events[t.eventId];
    const tk = ticketPda(new PublicKey(ev.pda), t.index);
    const fail = (reason) => { rec.used = false; save(); reject(reason); };
    try {
      const c = await program.account.ticket.fetch(tk);
      if (!c.owner.equals(new PublicKey(rec.wallet))) fail("not_owner");
      if (c.used) { t.used = true; save(); reject("ticket_used"); }
      await program.methods.markUsed()
        .accounts({ authority: organizer.publicKey, event: new PublicKey(ev.pda), ticket: tk }).rpc();
    } catch (e) {
      if (e instanceof ApiErr) throw e;
      fail(e?.error?.errorCode?.code ? snake(e.error.errorCode.code) : "chain_error");
    }
    t.used = true;
    save();
    return { valid: true, ticket_id: t.id };
  });
}));

/* ---------- Hibrit imza akışı: harici cüzdan (Phantom) imzalar, sunucu gönderir ---------- */
// Sunucu işlemi kurar, fee payer ve blockhash'i ekler; cüzdan kendi imzasını ekler.
const serializeUnsigned = (tx) => tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");

// POST /tx/list/prepare — { ticket_id, seller, price } -> { tx } (cüzdan imzalayacak)
app.post("/tx/list/prepare", send(async ({ body }) => {
  const t = store.tickets[body.ticket_id];
  if (!t) throw new ApiErr(404, "NOT_FOUND", "Bilet bulunamadı");
  const ev = store.events[t.eventId];
  const seller = parsePubkey(body.seller, "seller");
  const price = Number(body.price);
  if (!(price > 0)) throw new ApiErr(422, "INVALID_PRICE", "Fiyat sıfırdan büyük olmalı");
  const base = toBase(price);
  const cap = capBase(ev);
  if (base > cap) throw new ApiErr(422, "price_above_cap", `Fiyat tavanı ${usdc(cap)} USDC aşıldı`, { ok: false, max_price: usdc(cap) });

  return serial(async () => {
    const evKey = new PublicKey(ev.pda);
    const tk = ticketPda(evKey, t.index);
    const c = await program.account.ticket.fetch(tk);
    if (c.used) throw new ApiErr(409, "ticket_used", "Kullanılmış bilet satılamaz");
    if (!c.owner.equals(seller)) throw new ApiErr(403, "not_owner", "Bu bilet size ait değil");
    if (activeListingFor(t.id)) throw new ApiErr(409, "already_listed", "Bilet zaten satışta");
    await ensureSol(seller);
    const tx = await program.methods.listTicket(new BN(base.toString()))
      .accounts({ seller, event: evKey, ticket: tk, listing: listingPda(tk), systemProgram: SystemProgram.programId })
      .transaction();
    tx.feePayer = seller;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    return { tx: serializeUnsigned(tx) };
  });
}));

// POST /tx/buy/prepare — { listing_id, buyer } -> { tx }
app.post("/tx/buy/prepare", send(async ({ body }) => {
  const l = store.listings[body.listing_id];
  if (!l || l.status !== "active") throw new ApiErr(404, "NOT_FOUND", "Aktif ilan bulunamadı");
  const t = store.tickets[l.ticketId];
  const ev = store.events[t.eventId];
  const buyer = parsePubkey(body.buyer, "buyer");
  const seller = new PublicKey(l.seller);
  const price = BigInt(l.price);
  if (buyer.equals(seller)) throw new ApiErr(422, "CANNOT_BUY_OWN", "Kendi biletinizi satın alamazsınız");

  return serial(async () => {
    const evKey = new PublicKey(ev.pda);
    const tk = ticketPda(evKey, t.index);
    await ensureSol(seller);
    await ensureSol(buyer, 0.01e9);
    const buyerAta = await getOrCreateAssociatedTokenAccount(connection, organizer, MINT, buyer);
    const sellerAta = await getOrCreateAssociatedTokenAccount(connection, organizer, MINT, seller);
    const orgAta = await getOrCreateAssociatedTokenAccount(connection, organizer, MINT, organizer.publicKey);
    await ensureUsdc(buyer, buyerAta.address, price);
    const tx = await program.methods.buyTicket()
      .accounts({
        buyer, event: evKey, ticket: tk, listing: listingPda(tk), seller,
        buyerToken: buyerAta.address, sellerToken: sellerAta.address, organizerToken: orgAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();
    tx.feePayer = buyer;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const royalty = royaltyOf(price, ev.royaltyBps);
    return { tx: serializeUnsigned(tx), seller_receives: usdc(price - royalty), organizer_royalty: usdc(royalty) };
  });
}));

const WALLET_EXTRA_PROGRAMS = new Set([
  "ComputeBudget111111111111111111111111111111",
  "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
]);
const coreInstructions = (tx) => tx.instructions.filter((i) => !WALLET_EXTRA_PROGRAMS.has(i.programId.toBase58()));
const dumpIxs = (tx) => tx.instructions.map((i) => `${i.programId.toBase58().slice(0, 8)}…(${i.data.length}b)`).join(", ");

// POST /tx/submit — { signed, kind: "list"|"buy", ticket_id|listing_id, seller|buyer, price? }
// Cüzdanın imzaladığı işlemi zincire gönderir, onaylanınca yerel durumu günceller.
app.post("/tx/submit", send(async ({ body }) => {
  const raw = Buffer.from(String(body.signed ?? ""), "base64");
  let tx;
  try { tx = Transaction.from(raw); } catch { throw new ApiErr(400, "VALIDATION_ERROR", "İmzalı işlem okunamadı"); }
  // Hangi işlem gönderildiğini doğrula: yalnızca bu programın beklenen talimatı kabul edilir.
  const disc = (name) => Buffer.from(IDL.instructions.find((i) => i.name === name).discriminator);
  const expectName = body.kind === "list" ? "list_ticket" : body.kind === "buy" ? "buy_ticket" : body.kind === "primary" ? null : null;
  if (expectName) {
    const core = coreInstructions(tx);
    const ok = core.length === 1
      && core[0].programId.equals(PROGRAM_ID)
      && Buffer.from(core[0].data.subarray(0, 8)).equals(disc(expectName));
    if (!ok) console.log("unexpected_tx:", dumpIxs(tx));
    if (!ok) throw new ApiErr(422, "unexpected_tx", `İşlem ${expectName} talimatıyla eşleşmiyor`);
  }

  // Birincil satış: işlem tam olarak bu etkinliğin etiket tutarını organizatöre transfer etmeli.
  if (body.kind === "primary") {
    const ev = store.events[body.event_id];
    if (!ev) throw new ApiErr(404, "NOT_FOUND", "Etkinlik bulunamadı");
    const buyer = parsePubkey(body.buyer, "buyer");
    const core = coreInstructions(tx);
    const ix = core[0];
    const orgAta = getAssociatedTokenAddressSync(MINT, organizer.publicKey);
    const ok = core.length === 1 && ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data[0] === 3
      && ix.data.readBigUInt64LE(1) === BigInt(ev.faceBase) && ix.keys[1].pubkey.equals(orgAta) && tx.feePayer?.equals(buyer);
    if (!ok) console.log("payment_mismatch:", dumpIxs(tx), "| feePayer:", tx.feePayer?.toBase58(), "| beklenen alıcı:", buyer.toBase58());
    if (!ok) throw new ApiErr(422, "payment_mismatch", "Ödeme işlemi beklenen tutar ve hedefle eşleşmiyor");
  }

  let sig;
  try {
    sig = await connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed" });
    await connection.confirmTransaction(sig, "confirmed");
  } catch (e) {
    const logs = e?.transactionMessage || e?.message || "";
    const m = /custom program error: 0x([0-9a-f]+)/i.exec(logs);
    const reason = m ? `zincir hatası 0x${m[1]}` : "işlem zincirde reddedildi";
    throw new ApiErr(422, "chain_rejected", reason);
  }

  if (body.kind === "primary") {
    const ev = store.events[body.event_id];
    let id;
    try { id = await mintPrimary(ev, new PublicKey(body.buyer)); }
    catch (e) { throw new ApiErr(502, "mint_failed", `Ödeme alındı (${sig}) ama bilet basılamadı: ${e.message || e.code}`); }
    return { ok: true, ticket_id: id, signature: sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` };
  }
  if (body.kind === "list") {
    const t = store.tickets[body.ticket_id];
    const ev = store.events[t.eventId];
    const id = nextId("l");
    store.listings[id] = { id, ticketId: t.id, seller: body.seller, price: toBase(body.price).toString(), status: "active" };
    save();
    return { ok: true, listing_id: id, signature: sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` };
  }
  if (body.kind === "buy") {
    const l = store.listings[body.listing_id];
    l.status = "sold";
    save();
    return { ok: true, signature: sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` };
  }
  throw new ApiErr(400, "VALIDATION_ERROR", "kind list veya buy olmalı");
}));

/* ---------- Demo seed (idempotent) ---------- */
// Her çalıştırmada: adı aynı etkinliği yeniden oluşturmaz, eksik bilet/ilanları tamamlar.
// Satıcı, sunucunun tuttuğu demo satıcı keypair'idir (zincirde list_ticket imzalanabilsin diye).
const SEED_EVENTS = [
  { name: "Devnet Demo Konseri", face: 50, max: 60, roy: 10, supply: 300, prices: [54, 59] },
  { name: "Kadıköy Jazz Gecesi", face: 40, max: 48, roy: 10, supply: 150, prices: [] },
  { name: "Solana İstanbul Zirvesi 2026", face: 50, max: 65, roy: 10, supply: 200, prices: [58, 62] },
  { name: "İstanbul Elektronik Müzik Festivali", face: 80, max: 100, roy: 12, supply: 300, prices: [95, 88] },
  { name: "Teknoloji & Web3 Hackathon Finali", face: 25, max: 30, roy: 5, supply: 120, prices: [27] },
];
const SELLER_ADDR = Keypair.fromSecretKey(Uint8Array.from(demoKeys.seller)).publicKey.toBase58();
const DEMO_BUYER = Keypair.fromSecretKey(Uint8Array.from(demoKeys.buyer)).publicKey.toBase58();

async function selfCall(method, path, body) {
  const res = await fetch(`http://localhost:${PORT}${path}`, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(`${path}: ${data.error || res.status} ${data.message || ""}`);
  return data;
}

async function runSeed() {
  const created = [];
  for (const spec of SEED_EVENTS) {
    let ev = Object.values(store.events).find((e) => e.name === spec.name);
    if (!ev) {
      const r = await selfCall("POST", "/events", { name: spec.name, face_price: spec.face, max_price: spec.max, royalty_percent: spec.roy, supply: spec.supply });
      ev = store.events[r.event_id];
      created.push(spec.name);
    }
    const ticketsOf = Object.values(store.tickets).filter((t) => t.eventId === ev.id);
    const listed = ticketsOf.filter((t) => activeListingFor(t.id)).length;
    const need = spec.prices.length - listed;
    const spare = ticketsOf.filter((t) => !activeListingFor(t.id));
    for (let i = spare.length; i < need; i++) {
      const m = await selfCall("POST", "/tickets/mint", { event_id: ev.id, owner: SELLER_ADDR });
      spare.push(store.tickets[m.ticket_id]);
    }
    for (let i = 0; i < need; i++) {
      await selfCall("POST", "/listings", { ticket_id: spare[i].id, seller: SELLER_ADDR, price: spec.prices[listed + i] });
    }
  }
  // Demo cüzdanına (sunucunun buyer anahtarı) hazır 2 bilet: Biletlerim ilk açılışta dolu görünsün.
  if (!store.demoTickets) {
    const demo = Object.values(store.events).find((e) => e.name === "Devnet Demo Konseri");
    for (let i = 0; i < 2; i++) await selfCall("POST", "/tickets/mint", { event_id: demo.id, owner: DEMO_BUYER });
    store.demoTickets = true;
  }
  store.seed = true;
  save();
  return { seeded: true, created_events: created, listings: Object.keys(store.listings).length };
}

// GET /events — etkinlikler ve kesilen bilet sayısı (dashboard istatistikleri için).
// Demo etkinlik bilgileri (tamamen kurgusal; tarih ve mekân demo amaçlıdır).
const META = {
  "Devnet Demo Konseri": { venue: "Zorlu PSM · Ana Salon, İstanbul", date: "2027-02-12T20:30:00+03:00", tag: "Öne çıkan", featured: true },
  "Kadıköy Jazz Gecesi": { venue: "Moda Sahnesi, İstanbul", date: "2027-01-19T21:00:00+03:00", tag: "Caz" },
  "Solana İstanbul Zirvesi 2026": { venue: "Lütfi Kırdar Kongre Merkezi", date: "2027-01-24T09:30:00+03:00", tag: "Konferans" },
  "İstanbul Elektronik Müzik Festivali": { venue: "Küçükçiftlik Park, İstanbul", date: "2027-07-18T16:00:00+03:00", tag: "Festival" },
  "Teknoloji & Web3 Hackathon Finali": { venue: "Bilgi Üniversitesi Kampüsü", date: "2027-03-08T10:00:00+03:00", tag: "Hackathon" },
};

app.get("/events", send(async () => {
  const events = Object.values(store.events)
    .filter((e) => META[e.name]) // eski test kayıtları (Konser A) listelenmez
    .map((e) => {
      const m = META[e.name];
      const face = usdc(e.faceBase), max = usdc(capBase(e));
      return {
        id: e.id, name: e.name, venue: m.venue, date: m.date, tag: m.tag, featured: !!m.featured,
        face, max, cap_pct: Math.round((max / face) * 100), royalty_percent: e.royaltyBps / 100,
        supply: e.supply, minted: e.ticketCount, remaining: e.supply - e.ticketCount,
      };
    });
  return { events };
}));

/* ---------- Birincil satış, dinamik QR oturumu, demo cüzdan ---------- */
const ROTATE_TTL = 15;    // QR her 15 saniyede yenilenir (tek kullanımlık nonce)
const SESSION_TTL = 600;  // cüzdan onayı 10 dakika geçerli; QR'lar bu oturumla yenilenir

const signBlob = (obj) => {
  const b = Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b}.${createHmac("sha256", store.qrSecret).update(b).digest("base64url")}`;
};
const openBlob = (tok) => {
  const [b, s, x] = String(tok ?? "").split(".");
  if (!b || !s || x !== undefined) return null;
  const exp = createHmac("sha256", store.qrSecret).update(b).digest();
  const given = Buffer.from(s, "base64url");
  if (given.length !== exp.length || !timingSafeEqual(given, exp)) return null;
  try { return JSON.parse(Buffer.from(b, "base64url").toString()); } catch { return null; }
};

function issueToken(t, wallet, ttl) {
  const nonce = randomBytes(16).toString("hex");
  const expires = Math.floor(Date.now() / 1000) + ttl;
  store.nonces[nonce] = { ticketId: t.id, wallet, expires, used: false };
  save();
  return signBlob({ t: t.id, w: wallet, n: nonce, e: expires });
}

// Cüzdan mesajı: "FairTicket giris <bilet> <zaman>" ve ed25519 imza kontrolü.
function checkWalletMsg(t, walletStr, message, signature) {
  const m = /^FairTicket giris (\S+) (\d+)$/.exec(String(message ?? ""));
  if (!m || m[1] !== t.id || Math.abs(Date.now() - Number(m[2])) > QR_MSG_MAX_AGE_MS)
    throw new ApiErr(401, "invalid_signature", "Mesaj geçersiz veya süresi dolmuş");
  let ok = false;
  try {
    ok = nacl.sign.detached.verify(new TextEncoder().encode(message), bs58.decode(String(signature ?? "")), new PublicKey(walletStr).toBytes());
  } catch { ok = false; }
  if (!ok) throw new ApiErr(401, "invalid_signature", "İmza geçersiz");
}

// Sahiplik, kullanım ve ilan durumu: QR üretmeden önce zincirden doğrulanır.
async function assertUsable(t, wallet) {
  const c = await serial(() => fetchTicketChain(t));
  if (!c.owner.equals(wallet)) throw new ApiErr(403, "not_owner", "Bu bilet size ait değil");
  if (c.used) throw new ApiErr(409, "ticket_used", "Bilet zaten kullanılmış");
  if (activeListingFor(t.id)) throw new ApiErr(409, "ticket_listed", "Bilet satışta; giriş kodu üretilemez");
}

// POST /qr/session — cüzdan bir kez imzalar, 10 dk'lık oturum döner (Phantom her 15 sn'de açılmaz).
app.post("/qr/session", send(async ({ body }) => {
  const t = store.tickets[body.ticket_id];
  if (!t) throw new ApiErr(404, "NOT_FOUND", "Bilet bulunamadı");
  const wallet = parsePubkey(body.wallet, "wallet");
  checkWalletMsg(t, wallet.toBase58(), body.message, body.signature);
  await assertUsable(t, wallet);
  return { session: signBlob({ s: 1, t: t.id, w: wallet.toBase58(), e: Math.floor(Date.now() / 1000) + SESSION_TTL }), expires_in: SESSION_TTL };
}));

// POST /demo/session — demo cüzdanı (sunucunun anahtarı) için imzasız oturum.
app.post("/demo/session", send(async ({ body }) => {
  const t = store.tickets[body.ticket_id];
  if (!t) throw new ApiErr(404, "NOT_FOUND", "Bilet bulunamadı");
  const wallet = parsePubkey(body.wallet, "wallet");
  if (!controlled.has(wallet.toBase58())) throw new ApiErr(403, "wallet_not_controlled", "Demo cüzdanı değil");
  await assertUsable(t, wallet);
  return { session: signBlob({ s: 1, t: t.id, w: wallet.toBase58(), e: Math.floor(Date.now() / 1000) + SESSION_TTL }), expires_in: SESSION_TTL };
}));

// POST /qr/rotate — oturumla 15 saniyelik yeni tek kullanımlık QR token'ı.
app.post("/qr/rotate", send(async ({ body }) => {
  const s = openBlob(body.session);
  if (!s || s.s !== 1 || s.e < Math.floor(Date.now() / 1000))
    throw new ApiErr(401, "session_expired", "Oturum süresi doldu; cüzdanla yeniden onaylayın");
  const t = store.tickets[s.t];
  if (!t) throw new ApiErr(404, "NOT_FOUND", "Bilet bulunamadı");
  await assertUsable(t, new PublicKey(s.w));
  return { token: issueToken(t, s.w, ROTATE_TTL), expires_in: ROTATE_TTL };
}));

app.get("/demo/wallet", send(async () => ({ address: DEMO_BUYER })));

// POST /demo/submit — demo cüzdanı (fee payer) için sunucu imzalı gönderim. Doğrulama /tx/submit'te yapılır.
app.post("/demo/submit", send(async ({ body }) => {
  let tx;
  try { tx = Transaction.from(Buffer.from(String(body.tx ?? ""), "base64")); }
  catch { throw new ApiErr(400, "VALIDATION_ERROR", "İşlem okunamadı"); }
  const kp = tx.feePayer && controlled.get(tx.feePayer.toBase58());
  if (!kp) throw new ApiErr(403, "wallet_not_controlled", "Demo cüzdanı değil");
  tx.partialSign(kp);
  const { tx: _omit, ...rest } = body;
  const r = await fetch(`http://localhost:${PORT}/tx/submit`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...rest, signed: tx.serialize().toString("base64") }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new ApiErr(r.status, data.error || "chain_error", data.message);
  return data;
}));

// Birincil satış: alıcı etiket fiyatını USDC olarak öder (SPL transfer), sunucu bileti alıcıya basar.
async function buildPrimaryTx(ev, buyer) {
  const price = BigInt(ev.faceBase);
  const buyerAta = await getOrCreateAssociatedTokenAccount(connection, organizer, MINT, buyer);
  const orgAta = await getOrCreateAssociatedTokenAccount(connection, organizer, MINT, organizer.publicKey);
  await ensureSol(buyer, 0.01e9);
  await ensureUsdc(buyer, buyerAta.address, price);
  const tx = new Transaction().add(createTransferInstruction(buyerAta.address, orgAta.address, buyer, price));
  tx.feePayer = buyer;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  return tx;
}

async function mintPrimary(ev, buyer) {
  return serial(async () => {
    if (ev.ticketCount >= ev.supply) throw new ApiErr(409, "SOLD_OUT", "Kontenjan dolu");
    const evKey = new PublicKey(ev.pda);
    const index = (await program.account.event.fetch(evKey)).ticketCount;
    try {
      await program.methods.mintTicket(buyer)
        .accounts({ authority: organizer.publicKey, event: evKey, ticket: ticketPda(evKey, index), systemProgram: SystemProgram.programId })
        .rpc();
    } catch (e) { throw chainErr(e); }
    const id = nextId("t");
    store.tickets[id] = { id, eventId: ev.id, index, used: false };
    ev.ticketCount += 1;
    save();
    return id;
  });
}

// POST /primary/prepare — { event_id, buyer } -> { tx, price } (alıcı imzalayacak)
app.post("/primary/prepare", send(async ({ body }) => {
  const ev = store.events[body.event_id];
  if (!ev) throw new ApiErr(404, "NOT_FOUND", "Etkinlik bulunamadı");
  if (ev.ticketCount >= ev.supply) throw new ApiErr(409, "SOLD_OUT", "Kontenjan dolu");
  const buyer = parsePubkey(body.buyer, "buyer");
  return serial(async () => ({ tx: serializeUnsigned(await buildPrimaryTx(ev, buyer)), price: usdc(ev.faceBase) }));
}));

// POST /demo/primary — demo cüzdanı için sunucu imzalı birincil satış.
app.post("/demo/primary", send(async ({ body }) => {
  const ev = store.events[body.event_id];
  if (!ev) throw new ApiErr(404, "NOT_FOUND", "Etkinlik bulunamadı");
  const buyer = parsePubkey(body.buyer, "buyer");
  const kp = controlled.get(buyer.toBase58());
  if (!kp) throw new ApiErr(403, "wallet_not_controlled", "Demo cüzdanı değil");
  const sig = await serial(async () => {
    try {
      const tx = await buildPrimaryTx(ev, buyer);
      tx.partialSign(kp);
      const s = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(s, "confirmed");
      return s;
    } catch (e) { throw chainErr(e); }
  });
  const id = await mintPrimary(ev, buyer);
  return { ok: true, ticket_id: id, signature: sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` };
}));

// Sayfa dosyaları aynı kökten servis edilir: tarayıcı http://localhost:8000/ adresini açar.
app.use(express.static(path.join(ROOT, "web")));

// Idempotent: her çağrıda yalnızca eksik etkinlik/ilan/bilet tamamlanır.
app.post("/seed", send(async () => runSeed()));

app.listen(PORT, async () => {
  const info = await connection.getAccountInfo(PROGRAM_ID);
  console.log(`FairTicket API: http://localhost:${PORT}  (mode=${MODE})`);
  console.log(`Program ${PROGRAM_ID.toBase58()} on devnet: ${info ? "bulundu" : "BULUNAMADI"}`);
  console.log(`Organizatör: ${organizer.publicKey.toBase58()}`);
  // Her açılışta idempotent seed: eksik demo verisi varsa tamamlanır.
  {
    try { console.log("Seed:", JSON.stringify(await runSeed())); }
    catch (e) { console.error("Seed hatası:", e.message); }
  }
});
