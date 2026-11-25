import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, nowSec } from "../db";
import { requireWallet } from "../auth";
import { ApiError } from "../errors";
import { RULES, maxAllowedPrice, isPriceAllowed, splitPayment } from "../rules";

export async function marketplaceRoutes(app: FastifyInstance) {
  app.post("/marketplace/precheck", async (req) => {
    const wallet = requireWallet(req);
    // Fiyat string gelir (en küçük birim, tam sayı)
    const { ticketId, price } = z
      .object({ ticketId: z.string(), price: z.string().regex(/^\d+$/, "price tam sayı string olmalı") })
      .parse(req.body);

    const row = db
      .prepare(
        `SELECT t.id, t.owner_wallet, t.used,
                e.face_price, e.max_price_bps, e.royalty_bps, e.starts_at
           FROM tickets t JOIN events e ON e.id = t.event_id
          WHERE t.id = ?`,
      )
      .get(ticketId) as
      | { id: string; owner_wallet: string; used: number; face_price: number; max_price_bps: number; royalty_bps: number; starts_at: number }
      | undefined;

    if (!row) throw new ApiError(404, "NOT_FOUND", "Bilet bulunamadı");
    // TODO (zincir): sahiplik
    if (row.owner_wallet !== wallet) throw new ApiError(403, "NOT_OWNER", "Bu bilet size ait değil");
    if (row.used === 1) throw new ApiError(409, "TICKET_USED", "Kullanılmış bilet satılamaz");

    const active = db.prepare("SELECT id FROM listings WHERE ticket_id = ? AND status = 'active'").get(ticketId);
    if (active) throw new ApiError(409, "ALREADY_LISTED", "Bilet zaten satışta");

    if (nowSec() > row.starts_at - RULES.listingClosesHoursBeforeEvent * 3600) {
      throw new ApiError(422, "LISTING_CLOSED", "Etkinliğe çok az kaldı, yeni listeleme açılamaz");
    }

    const ask = BigInt(price);
    const face = BigInt(row.face_price);
    const cap = maxAllowedPrice(face, row.max_price_bps);
    if (ask <= 0n) throw new ApiError(422, "INVALID_PRICE", "Fiyat sıfırdan büyük olmalı");
    if (!isPriceAllowed(face, ask, row.max_price_bps)) {
      throw new ApiError(422, "PRICE_ABOVE_CAP", `Fiyat üst sınırı aşıyor (en fazla ${cap.toString()})`);
    }

    const { royalty, seller } = splitPayment(ask, row.royalty_bps);
    return {
      ok: true,
      ticketId,
      price: ask.toString(),
      maxResalePrice: cap.toString(),
      royaltyBps: row.royalty_bps,
      royalty: royalty.toString(),
      sellerReceives: seller.toString(),
    };
  });
}
