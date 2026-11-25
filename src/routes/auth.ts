import type { FastifyInstance } from "fastify";
import { z } from "zod";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { randomBytes } from "node:crypto";
import { db, nowSec } from "../db";
import { requireWallet } from "../auth";
import { ApiError } from "../errors";
import { RULES } from "../rules";

const challengeMessage = (nonce: string) => `FairTicket giris dogrulamasi\nNonce: ${nonce}`;

export async function authRoutes(app: FastifyInstance) {
  // 1) Frontend cüzdan adresini gönderir, imzalaması için bir mesaj alır.
  app.post("/auth/challenge", async (req) => {
    const { wallet } = z.object({ wallet: z.string().min(32).max(44) }).parse(req.body);
    const nonce = randomBytes(16).toString("hex");
    db.prepare("INSERT OR REPLACE INTO auth_challenges (wallet, nonce, expires_at) VALUES (?, ?, ?)").run(
      wallet,
      nonce,
      nowSec() + RULES.session.challengeTtlSeconds,
    );
    return { message: challengeMessage(nonce) };
  });

  // 2) Frontend mesajı cüzdanla imzalar (signMessage) ve imzayı BASE58 olarak gönderir.
  app.post("/auth/verify", async (req) => {
    const { wallet, signature } = z.object({ wallet: z.string(), signature: z.string() }).parse(req.body);
    const ch = db.prepare("SELECT nonce, expires_at FROM auth_challenges WHERE wallet = ?").get(wallet) as
      | { nonce: string; expires_at: number }
      | undefined;
    if (!ch || ch.expires_at < nowSec()) throw new ApiError(401, "UNAUTHORIZED", "Challenge süresi doldu");

    let ok = false;
    try {
      ok = nacl.sign.detached.verify(
        new TextEncoder().encode(challengeMessage(ch.nonce)),
        bs58.decode(signature),
        bs58.decode(wallet),
      );
    } catch {
      ok = false;
    }
    if (!ok) throw new ApiError(401, "UNAUTHORIZED", "İmza geçersiz");

    db.prepare("DELETE FROM auth_challenges WHERE wallet = ?").run(wallet);
    const token = randomBytes(32).toString("hex");
    const expiresAt = nowSec() + RULES.session.ttlSeconds;
    db.prepare("INSERT INTO sessions (token, wallet, expires_at) VALUES (?, ?, ?)").run(token, wallet, expiresAt);
    return { token, wallet, expiresAt };
  });

  // Oturum kontrolü: giriş yapmış cüzdanı döner.
  app.get("/me", async (req) => ({ wallet: requireWallet(req) }));
}
