// Önce sunucu çalışıyor olmalı: npm run dev
import nacl from "tweetnacl";
import bs58 from "bs58";

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
  return { status: res.status, json, text };
}

const sign = (kp: nacl.SignKeyPair, message: string) =>
  bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));

// Fiyat içeren alanlar string mi?
function badPriceFields(obj: any, path = ""): string[] {
  const bad: string[] = [];
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (/price|amount/i.test(k) && typeof v !== "string") bad.push(`${p} (${typeof v})`);
      bad.push(...badPriceFields(v, p));
    }
  }
  return bad;
}

// maxResalePrice içeren nesneleri bul
function findCapObjects(obj: any, out: any[] = []): any[] {
  if (obj && typeof obj === "object") {
    if ("maxResalePrice" in obj) out.push(obj);
    for (const v of Object.values(obj)) findCapObjects(v, out);
  }
  return out;
}

// Giriş
const kp = nacl.sign.keyPair();
const wallet = bs58.encode(kp.publicKey);
let r = await call("POST", "/auth/challenge", { wallet });
const msg = r.json.message as string;
r = await call("POST", "/auth/verify", { wallet, signature: sign(kp, msg) });
const token = r.json.token as string;
check("token alındı", r.status === 200 && typeof token === "string");

// /events
r = await call("GET", "/events");
const list: any[] = Array.isArray(r.json) ? r.json : r.json?.events ?? [];
check("/events 200 ve en az 1 etkinlik", r.status === 200 && list.length > 0, `(${list.length} etkinlik)`);
const bad1 = badPriceFields(r.json);
check("/events fiyatlar string", bad1.length === 0, bad1.join(", "));
const eventsJson = r.json;

// /events/:id
const id = list[0]?.id;
r = await call("GET", `/events/${id}`);
check("/events/:id 200", r.status === 200, `(id=${id})`);
const bad2 = badPriceFields(r.json);
check("/events/:id fiyatlar string", bad2.length === 0, bad2.join(", "));
const eventJson = r.json;

// Olmayan etkinlik
r = await call("GET", "/events/olmayan-id-123");
check("/events/olmayan-id 404", r.status === 404, `(${r.status})`);

// /me/tickets
r = await call("GET", "/me/tickets");
check("/me/tickets tokensız 401", r.status === 401 && r.json?.error?.code === "UNAUTHORIZED");

r = await call("GET", "/me/tickets", undefined, token);
const tickets: any[] = Array.isArray(r.json) ? r.json : r.json?.tickets ?? [];
check("/me/tickets tokenla 200", r.status === 200, `(${tickets.length} bilet, yeni cüzdan olduğu için 0 normal)`);
const bad3 = badPriceFields(r.json);
check("/me/tickets fiyatlar string", bad3.length === 0, bad3.join(", "));

// maxResalePrice = nominal * 1.1 (tam sayı hesabı)
const caps = [...findCapObjects(eventsJson), ...findCapObjects(eventJson)];
check("maxResalePrice alanı dönüyor", caps.length > 0);
for (const c of caps.slice(0, 3)) {
  const nominalKey = Object.keys(c).find((k) => /nominal|face|^price$/i.test(k));
  if (!nominalKey) {
    check("maxResalePrice için nominal alan bulundu", false, `(alanlar: ${Object.keys(c).join(", ")})`);
    continue;
  }
  const expected = ((BigInt(c[nominalKey]) * 110n) / 100n).toString();
  check(
    `maxResalePrice doğru (${nominalKey}=${c[nominalKey]})`,
    c.maxResalePrice === expected,
    `beklenen ${expected}, gelen ${c.maxResalePrice}`
  );
}

console.log(failed === 0 ? "\nTüm testler geçti." : `\n${failed} test başarısız.`);
process.exit(failed === 0 ? 0 : 1);