import { createHmac, timingSafeEqual } from "node:crypto";

// Üretimde .env içine QR_SECRET koy. Yoksa geliştirme anahtarı kullanılır.
const SECRET = process.env.QR_SECRET ?? "dev-qr-secret-degistir";

export type EntryPayload = { t: string; w: string; n: string; e: number };

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (data: string) => createHmac("sha256", SECRET).update(data).digest();

export function signEntryToken(p: EntryPayload): string {
  const body = b64(JSON.stringify(p));
  return `${body}.${b64(mac(body))}`;
}

// Bozuksa null döner. Süre ve kullanım kontrolü çağıranın işi.
export function verifyEntryToken(token: string): EntryPayload | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = mac(body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof p.t !== "string" || typeof p.w !== "string" || typeof p.n !== "string" || typeof p.e !== "number") return null;
    return p;
  } catch {
    return null;
  }
}
