import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { db, nowSec } from "../db";
import { requireWallet } from "../auth";
import { ApiError } from "../errors";
import { RULES } from "../rules";
import { signEntryToken } from "../qr-token";

export async function qrRoutes(app: FastifyInstance) {
  const handler = async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const wallet = requireWallet(req);
    const ticket = db
      .prepare("SELECT id, owner_wallet, used FROM tickets WHERE id = ?")
      .get(req.params.id) as { id: string; owner_wallet: string; used: number } | undefined;

    if (!ticket) throw new ApiError(404, "NOT_FOUND", "Bilet bulunamadı");
    // TODO (zincir): sahiplik
    if (ticket.owner_wallet !== wallet) throw new ApiError(403, "NOT_OWNER", "Bu bilet size ait değil");
    if (ticket.used === 1) throw new ApiError(409, "TICKET_USED", "Bilet zaten kullanılmış");

    const nonce = randomBytes(16).toString("hex");
    const expiresAt = nowSec() + RULES.qr.ttlSeconds;
    db.prepare("INSERT INTO entry_tokens (nonce, ticket_id, wallet, expires_at) VALUES (?, ?, ?, ?)").run(
      nonce,
      ticket.id,
      wallet,
      expiresAt,
    );
    const token = signEntryToken({ t: ticket.id, w: wallet, n: nonce, e: expiresAt });
    return { token, expiresAt, ttlSeconds: RULES.qr.ttlSeconds };
  };

  // Frontend hangisini çağırırsa çağırsın çalışsın
  app.get<{ Params: { id: string } }>("/tickets/:id/qr", handler);
  app.post<{ Params: { id: string } }>("/tickets/:id/qr", handler);
}
