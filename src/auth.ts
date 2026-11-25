import type { FastifyRequest } from "fastify";
import { db, nowSec } from "./db";
import { ApiError } from "./errors";

// Authorization: Bearer <token> başlığından cüzdan adresini döner.
export function requireWallet(req: FastifyRequest): string {
  const h = req.headers.authorization;
  const token = h?.startsWith("Bearer ") ? h.slice(7) : undefined;
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "Giriş gerekli");
  const row = db
    .prepare("SELECT wallet, expires_at FROM sessions WHERE token = ?")
    .get(token) as { wallet: string; expires_at: number } | undefined;
  if (!row || row.expires_at < nowSec()) throw new ApiError(401, "UNAUTHORIZED", "Oturum geçersiz");
  return row.wallet;
}
