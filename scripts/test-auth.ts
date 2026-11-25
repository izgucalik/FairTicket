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
  return { status: res.status, json: (await res.json()) as any };
}

const sign = (kp: nacl.SignKeyPair, message: string) =>
  bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));

const alice = nacl.sign.keyPair();
const mallory = nacl.sign.keyPair();
const aliceWallet = bs58.encode(alice.publicKey);

// 1) Doğru imzayla giriş
let r = await call("POST", "/auth/challenge", { wallet: aliceWallet });
check("challenge mesajı geliyor", r.status === 200 && typeof r.json.message === "string");
const msg = r.json.message as string;

r = await call("POST", "/auth/verify", { wallet: aliceWallet, signature: sign(alice, msg) });
check("doğru imzayla token alınıyor", r.status === 200 && typeof r.json.token === "string");
const token = r.json.token as string;

// 2) Token ile korumalı uç nokta
r = await call("GET", "/me", undefined, token);
check("token ile /me cüzdanı döndürüyor", r.status === 200 && r.json.wallet === aliceWallet);

// 3) Token olmadan
r = await call("GET", "/me");
check("token olmadan /me 401 dönüyor", r.status === 401 && r.json.error?.code === "UNAUTHORIZED");

// 4) Başkasının imzasıyla giriş denemesi
r = await call("POST", "/auth/challenge", { wallet: aliceWallet });
const msg2 = r.json.message as string;
r = await call("POST", "/auth/verify", { wallet: aliceWallet, signature: sign(mallory, msg2) });
check("yanlış anahtarla imza 401 dönüyor", r.status === 401);

// 5) Aynı challenge ikinci kez kullanılamaz
r = await call("POST", "/auth/verify", { wallet: aliceWallet, signature: sign(alice, msg2) });
const first = r.status;
r = await call("POST", "/auth/verify", { wallet: aliceWallet, signature: sign(alice, msg2) });
check("challenge tek kullanımlık", first === 200 && r.status === 401);

console.log(failed === 0 ? "\nTüm testler geçti." : `\n${failed} test başarısız.`);
process.exit(failed === 0 ? 0 : 1);
