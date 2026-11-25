import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, nowSec } from "../db";
import { ApiError } from "../errors";
import { verifyEntryToken } from "../qr-token";

type Reject = { result: "REJECT"; reason: string };
type Accept = { result: "ACCEPT"; ticketId: string };

export async function gateRoutes(app: FastifyInstance) {
  app.post("/gate/verify", async (req) => {
    const key = req.headers["x-gate-key"];
    const gate = typeof key === "string"
      ? (db.prepare("SELECT id FROM gates WHERE api_key = ?").get(key) as { id: string } | undefined)
      : undefined;
    if (!gate) throw new ApiError(401, "UNAUTHORIZED", "Geçersiz turnike anahtarı");

    const { token } = z.object({ token: z.string() }).parse(req.body);

    const log = (ticketId: string | null, result: string, reason: string | null) =>
      db.prepare("INSERT INTO scan_logs (ticket_id, gate_id, result, reason, at) VALUES (?, ?, ?, ?, ?)").run(
        ticketId, gate.id, result, reason, nowSec(),
      );
    const reject = (ticketId: string | null, reason: string): Reject => {
      log(ticketId, "REJECT", reason);
      return { result: "REJECT", reason };
    };

    // 1) İmza ve biçim
    const p = verifyEntryToken(token);
    if (!p) return reject(null, "QR_INVALID");

    // 2) Süre
    if (p.e < nowSec()) return reject(p.t, "QR_EXPIRED");

    // 3) Nonce bizim ürettiğimiz bir kayıt mı?
    const rec = db
      .prepare("SELECT ticket_id, wallet FROM entry_tokens WHERE nonce = ?")
      .get(p.n) as { ticket_id: string; wallet: string } | undefined;
    if (!rec || rec.ticket_id !== p.t || rec.wallet !== p.w) return reject(p.t, "QR_INVALID");

    // 4) Bilet hâlâ bu cüzdanın mı? (satıldıysa eski QR geçmez)
    const ticket = db
      .prepare("SELECT owner_wallet, used FROM tickets WHERE id = ?")
      .get(p.t) as { owner_wallet: string; used: number } | undefined;
    if (!ticket) return reject(p.t, "TICKET_NOT_FOUND");
    // TODO (zincir): sahiplik
    if (ticket.owner_wallet !== p.w) return reject(p.t, "NOT_OWNER");

    // 5) ATOMİK kabul: hem nonce hem bilet tek transaction içinde "kullanıldı" olur.
    // better-sqlite3 senkron çalışır; UPDATE ... WHERE used = 0 sayesinde
    // aynı anda gelen isteklerden yalnızca biri changes = 1 alır.
    const accept = db.transaction((): Accept | Reject => {
      const n = db.prepare("UPDATE entry_tokens SET used = 1 WHERE nonce = ? AND used = 0").run(p.n);
      if (n.changes !== 1) return { result: "REJECT", reason: "ALREADY_USED" };
      const t = db.prepare("UPDATE tickets SET used = 1, used_at = ? WHERE id = ? AND used = 0").run(nowSec(), p.t);
      if (t.changes !== 1) throw new Error("ROLLBACK_TICKET_USED"); // nonce işaretini de geri alır
      return { result: "ACCEPT", ticketId: p.t };
    });

    let out: Accept | Reject;
    try {
      out = accept();
    } catch (e) {
      if ((e as Error).message === "ROLLBACK_TICKET_USED") {
        out = { result: "REJECT", reason: "ALREADY_USED" };
      } else {
        throw e;
      }
    }

    log(p.t, out.result, out.result === "REJECT" ? out.reason : null);
    return out;
  });
}
