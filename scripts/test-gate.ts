// Önce sunucu çalışıyor olmalı: npm run dev. Proje kökünden çalıştır.
import nacl from "tweetnacl";
import bs58 from "bs58";
import { randomBytes } from "node:crypto";
import { db, nowSec } from "../src/db";
import { signEntryToken } from "../src/qr-token";

const BASE = process.env.API_URL ?? "http://localhost:3001";
const GATE_KEY = "demo-gate-key";
let failed = 0;

function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
}

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}

const sign = (kp: nacl.SignKeyPair, message: string) =>
  bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));

const scan = (token: string, key = GATE_KEY) => call("POST", "/gate/verify", { token }, { "x-gate-key": key });

// Test cüzdanı ve 4 bilet
const kp = nacl.sign.keyPair();
const wallet = bs58.encode(kp.publicKey);
const ids = ["tg1", "tg2", "tg3", "tg4"];
db.prepare(`DELETE FROM scan_logs WHERE ticket_id IN (${ids.map(() => "?").join(",")})`).run(...ids);
db.prepare(`DELETE FROM entry_tokens WHERE ticket_id IN (${ids.map(() => "?").join(",")})`).run(...ids);
db.prepare(`DELETE FROM tickets WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
for (const id of ids) db.prepare("INSERT INTO tickets (id, event_id, owner_wallet) VALUES (?, 'evt1', ?)").run(id, wallet);

let r = await call("POST", "/auth/challenge", { wallet });
r = await call("POST", "/auth/verify", { wallet, signature: sign(kp, r.json.message) });
const session = r.json.token as string;
check("giriş yapıldı", r.status === 200 && !!session);

const getQr = async (id: string) =>
  (await call("GET", `/tickets/${id}/qr`, undefined, { authorization: `Bearer ${session}` })).json.token as string;

// Senaryo 1: geçerli QR -> ACCEPT
const qr1 = await getQr("tg1");
r = await scan(qr1);
check("(1) geçerli QR -> ACCEPT", r.json?.result === "ACCEPT", JSON.stringify(r.json));
const t1 = db.prepare("SELECT used FROM tickets WHERE id = 'tg1'").get() as { used: number };
check("    bilet veritabanında kullanıldı", t1.used === 1);

// Senaryo 2: aynı QR tekrar -> REJECT
r = await scan(qr1);
check("(2) aynı QR tekrar -> REJECT", r.json?.result === "REJECT", JSON.stringify(r.json));

// Senaryo 3: süresi geçmiş QR -> QR_EXPIRED (geçerli imza, geçmiş tarih)
const nonce = randomBytes(16).toString("hex");
const past = nowSec() - 10;
db.prepare("INSERT INTO entry_tokens (nonce, ticket_id, wallet, expires_at) VALUES (?, 'tg2', ?, ?)").run(nonce, wallet, past);
const expired = signEntryToken({ t: "tg2", w: wallet, n: nonce, e: past });
r = await scan(expired);
check("(3) süresi geçmiş QR -> QR_EXPIRED", r.json?.result === "REJECT" && r.json?.reason === "QR_EXPIRED", JSON.stringify(r.json));

// Senaryo 4: bozuk token -> QR_INVALID
r = await scan("bozuk.token");
check("(4a) bozuk token -> QR_INVALID", r.json?.result === "REJECT" && r.json?.reason === "QR_INVALID", JSON.stringify(r.json));
const tampered = (await getQr("tg2")).slice(0, -2) + "xx";
r = await scan(tampered);
check("(4b) imzası bozuk token -> QR_INVALID", r.json?.result === "REJECT" && r.json?.reason === "QR_INVALID", JSON.stringify(r.json));

// Senaryo 5: aynı QR'ı 10 istekte aynı anda -> tam 1 ACCEPT
const qr3 = await getQr("tg3");
const results = await Promise.all(Array.from({ length: 10 }, () => scan(qr3)));
const accepts = results.filter((x) => x.json?.result === "ACCEPT").length;
const rejects = results.filter((x) => x.json?.result === "REJECT").length;
check("(5) 10 eşzamanlı istek -> tam 1 ACCEPT", accepts === 1 && rejects === 9, `(ACCEPT=${accepts}, REJECT=${rejects})`);

// Ek 1: aynı bilet için iki farklı QR, biri kabul edilince diğeri geçmemeli
const qrA = await getQr("tg4");
const qrB = await getQr("tg4");
const a = await scan(qrA);
const b = await scan(qrB);
check("(6) aynı bilete ait ikinci QR de reddediliyor", a.json?.result === "ACCEPT" && b.json?.result === "REJECT", JSON.stringify([a.json, b.json]));

// Ek 2: yanlış turnike anahtarı
r = await scan(qr1, "yanlis-anahtar");
check("(7) yanlış turnike anahtarı -> 401", r.status === 401, `(${r.status})`);

// Ek 3: her okutma loglandı
const logs = db.prepare("SELECT COUNT(*) AS c FROM scan_logs WHERE ticket_id IN ('tg1','tg2','tg3','tg4')").get() as { c: number };
check("(8) okutmalar scan_logs'a yazıldı", logs.c >= 10, `(${logs.c} kayıt)`);

console.log(failed === 0 ? "\nTüm testler geçti." : `\n${failed} test başarısız.`);
process.exit(failed === 0 ? 0 : 1);
