import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { ApiError } from "../errors";
import { maxAllowedPrice } from "../rules";

type EventRow = {
  id: string;
  name: string;
  venue: string | null;
  starts_at: number;
  face_price: number;
  max_price_bps: number;
  royalty_bps: number;
  organizer_wallet: string;
  chain_event_address: string | null;
};

export function serializeEvent(e: EventRow) {
  const face = BigInt(e.face_price);
  return {
    id: e.id,
    name: e.name,
    venue: e.venue,
    startsAt: e.starts_at,
    facePrice: face.toString(),
    maxResalePrice: maxAllowedPrice(face, e.max_price_bps).toString(),
    royaltyBps: e.royalty_bps,
    organizerWallet: e.organizer_wallet,
    chainEventAddress: e.chain_event_address,
  };
}

export async function eventsRoutes(app: FastifyInstance) {
  app.get("/events", async () => {
    const rows = db.prepare("SELECT * FROM events ORDER BY starts_at").all() as EventRow[];
    return { events: rows.map(serializeEvent) };
  });

  app.get<{ Params: { id: string } }>("/events/:id", async (req) => {
    const row = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id) as EventRow | undefined;
    if (!row) throw new ApiError(404, "NOT_FOUND", "Etkinlik bulunamadı");
    return serializeEvent(row);
  });
}
