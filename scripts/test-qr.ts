// Önce sunucu çalışıyor olmalı: npm run dev. Proje kökünden çalıştır.
import nacl from "tweetnacl";
import bs58 from "bs58";
import { db } from "../src/db";
import { verifyEntryToken } from "../src/qr-token";

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

// Test cüzdanı ve ona ait iki bilet (biri kullanılmış)
const kp = nacl.sign.keyPair();
const wallet = bs58.encode(kp.publicKey);

db.prepare("DELETE FROM entry_tokens WHERE ticket_id IN ('tq1','tq2')").run();
db.prepare("DELETE FROM tickets WHERE id IN ('tq1','tq2')").run();
db.prepare("INSERT INTO tickets (id, event_id, owner_wallet, used) VALUES ('tq1','evt1',?,0)").run(wallet);
db.prepare("INSERT INTO tickets (id, event_id, owner_wallet, used) VALUES ('tq2','evt1',?,1)").run(wallet);

// Giriş
let r = await call("POST", "/auth/challenge", { wallet });
r = await call("POST", "/auth/verify", { wallet, signature: sign(kp, r.json.message) });
const token = r.json.token as string;
check("giriş yapıldı", r.status === 200 && !!token);

// 1) Kendi bileti -> token
r = await call("GET", "/tickets/tq1/qr", undefined, token);
check("kendi biletine QR token dönüyor", r.status === 200 && typeof r.json.token === "string", `(${r.status})`);
const qr = r.json?.token as string;
const payload = verifyEntryToken(qr ?? "");
check("token imzası geçerli ve içerik doğru", payload?.t === "tq1" && payload?.w === wallet);
check("token süresi ~25 sn", r.json?.ttlSeconds === 25 && payload !== null && payload.e - Math.floor(Date.now() / 1000) <= 25);
const row = db.prepare("SELECT used FROM entry_tokens WHERE nonce = ?").get(payload?.n ?? "");
check("nonce veritabanına yazıldı", !!row);

// 2) Her istekte farklı token
r = await call("GET", "/tickets/tq1/qr", undefined, token);
check("her istekte yeni token üretiliyor", r.json?.token !== qr);

// 3) Başkasının bileti
r = await call("GET", "/tickets/t3/qr", undefined, token);
check("başkasının bileti 403 NOT_OWNER", r.status === 403 && r.json?.error?.code === "NOT_OWNER", `(${r.status})`);

// 4) Kullanılmış bilet
r = await call("GET", "/tickets/tq2/qr", undefined, token);
check("kullanılmış bilet 409", r.status === 409, `(${r.status})`);

// 5) Olmayan bilet
r = await call("GET", "/tickets/yok-123/qr", undefined, token);
check("olmayan bilet 404", r.status === 404, `(${r.status})`);

// 6) Tokensız
r = await call("GET", "/tickets/tq1/qr");
check("tokensız 401", r.status === 401, `(${r.status})`);

// 7) Bozulmuş token doğrulamayı geçmemeli
check("kurcalanmış token reddediliyor", verifyEntryToken(qr.slice(0, -2) + "xx") === null);

console.log(failed === 0 ? "\nTüm testler geçti." : `\n${failed} test başarısız.`);
process.exit(failed === 0 ? 0 : 1);
