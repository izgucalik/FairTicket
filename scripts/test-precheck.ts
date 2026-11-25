// Önce sunucu çalışıyor olmalı: npm run dev. Proje kökünden çalıştır.
import nacl from "tweetnacl";
import bs58 from "bs58";
import { db, nowSec } from "../src/db";
import { splitPayment } from "../src/rules";

const BASE = process.env.API_URL ?? "http://localhost:3001";
let failed = 0;

function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
}

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}

const sign = (kp: nacl.SignKeyPair, message: string) =>
  bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));

// --- Hazırlık: kendi etkinlik, bilet ve cüzdanlarımız ---
const kp = nacl.sign.keyPair();
const wallet = bs58.encode(kp.publicKey);
const OTHER = "BASKA_BIR_CUZDAN_ADRESI_ORNEK_0000000000";

db.exec(`
DELETE FROM listings WHERE ticket_id IN ('tp1','tp2','tp3','tp4','tp5');
DELETE FROM entry_tokens WHERE ticket_id IN ('tp1','tp2','tp3','tp4','tp5');
DELETE FROM tickets WHERE id IN ('tp1','tp2','tp3','tp4','tp5');
DELETE FROM events WHERE id IN ('evpc1','evpc2');
`);
const addEvent = db.prepare(
  "INSERT INTO events (id, name, venue, starts_at, face_price, max_price_bps, royalty_bps, organizer_wallet) VALUES (?, ?, 'Test', ?, 100000000, 11000, 750, ?)",
);
addEvent.run("evpc1", "Precheck Etkinliği", nowSec() + 7 * 24 * 3600, OTHER);
addEvent.run("evpc2", "Yakında Başlayan", nowSec() + 3600, OTHER); // 1 saat kaldı -> listeleme kapalı

const addTicket = db.prepare("INSERT INTO tickets (id, event_id, owner_wallet, used) VALUES (?, ?, ?, ?)");
addTicket.run("tp1", "evpc1", wallet, 0); // normal bilet
addTicket.run("tp2", "evpc1", wallet, 1); // kullanılmış
addTicket.run("tp3", "evpc2", wallet, 0); // listeleme kapanmış etkinlik
addTicket.run("tp4", "evpc1", OTHER, 0);  // başkasının
addTicket.run("tp5", "evpc1", wallet, 0); // zaten listede olacak
db.prepare("INSERT INTO listings (id, ticket_id, seller_wallet, price, status, created_at) VALUES ('lp5','tp5',?,100000000,'active',?)").run(wallet, nowSec());

let r = await call("POST", "/auth/challenge", { wallet });
r = await call("POST", "/auth/verify", { wallet, signature: sign(kp, r.json.message) });
const token = r.json.token as string;
check("giriş yapıldı", r.status === 200 && !!token);

const pre = (ticketId: string, price: string) => call("POST", "/marketplace/precheck", { ticketId, price }, token);

// 1) Sınırın altı -> ok + telif hesabı splitPayment ile aynı
r = await pre("tp1", "105000000");
const exp = splitPayment(105_000_000n, 750);
check("sınırın altı -> ok", r.status === 200 && r.json?.ok === true, `(${r.status})`);
check("telif hesabı splitPayment ile uyuşuyor", r.json?.royalty === exp.royalty.toString() && r.json?.sellerReceives === exp.seller.toString(), JSON.stringify(r.json));
check("maxResalePrice 110000000", r.json?.maxResalePrice === "110000000");

// 2) Tam sınır -> ok
r = await pre("tp1", "110000000");
check("tam sınır -> ok", r.status === 200 && r.json?.ok === true, `(${r.status})`);

// 3) Sınırın 1 birim üstü -> 422
r = await pre("tp1", "110000001");
check("sınır + 1 birim -> 422 PRICE_ABOVE_CAP", r.status === 422 && r.json?.error?.code === "PRICE_ABOVE_CAP", `(${r.status})`);

// 4) Kullanılmış bilet -> 409
r = await pre("tp2", "100000000");
check("kullanılmış bilet -> 409", r.status === 409 && r.json?.error?.code === "TICKET_USED", `(${r.status})`);

// 5) Başkasının bileti -> 403
r = await pre("tp4", "100000000");
check("başkasının bileti -> 403 NOT_OWNER", r.status === 403 && r.json?.error?.code === "NOT_OWNER", `(${r.status})`);

// Ek kontroller
r = await pre("tp3", "100000000");
check("etkinliğe 2 saatten az kala -> 422 LISTING_CLOSED", r.status === 422 && r.json?.error?.code === "LISTING_CLOSED", `(${r.status})`);

r = await pre("tp5", "100000000");
check("zaten listedeki bilet -> 409 ALREADY_LISTED", r.status === 409 && r.json?.error?.code === "ALREADY_LISTED", `(${r.status})`);

r = await pre("tp1", "0");
check("fiyat 0 -> 422 INVALID_PRICE", r.status === 422 && r.json?.error?.code === "INVALID_PRICE", `(${r.status})`);

r = await call("POST", "/marketplace/precheck", { ticketId: "tp1", price: 105000000 }, token);
check("fiyat sayı (string değil) -> 400", r.status === 400, `(${r.status})`);

r = await pre("tp1", "10.5");
check("ondalıklı fiyat -> 400", r.status === 400, `(${r.status})`);

r = await pre("yok-123", "100000000");
check("olmayan bilet -> 404", r.status === 404, `(${r.status})`);

r = await call("POST", "/marketplace/precheck", { ticketId: "tp1", price: "100000000" });
check("tokensız -> 401", r.status === 401, `(${r.status})`);

console.log(failed === 0 ? "\nTüm testler geçti." : `\n${failed} test başarısız.`);
process.exit(failed === 0 ? 0 : 1);
