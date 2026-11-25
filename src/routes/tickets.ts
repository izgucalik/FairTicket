import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { requireWallet } from "../auth";
import { serializeEvent } from "./events";

export async function ticketsRoutes(app: FastifyInstance) {
  app.get("/me/tickets", async (req) => {
    const wallet = requireWallet(req);

    const rows = db
      .prepare(
        `SELECT t.id AS ticket_id, t.used, t.used_at, t.chain_address,
                e.*,
                (SELECT l.price FROM listings l
                  WHERE l.ticket_id = t.id AND l.status = 'active' LIMIT 1) AS listed_price
           FROM tickets t
           JOIN events e ON e.id = t.event_id
          WHERE t.owner_wallet = ?
          ORDER BY e.starts_at`
      )
      .all(wallet) as any[];

    return {
      tickets: rows.map((r) => ({
        id: r.ticket_id,
        used: r.used === 1,
        usedAt: r.used_at,
        chainAddress: r.chain_address,
        listedPrice: r.listed_price == null ? null : String(r.listed_price),
        event: serializeEvent(r),
      })),
    };
  });
}
