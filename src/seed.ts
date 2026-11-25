// Kullanım: npm run seed -- <cüzdan-adresi>
import { db, nowSec } from "./db";
import { RULES } from "./rules";

const wallet = process.argv[2];
if (!wallet) {
  console.error("Kullanım: npm run seed -- <cüzdan-adresi>");
  process.exit(1);
}

db.exec("DELETE FROM scan_logs; DELETE FROM entry_tokens; DELETE FROM listings; DELETE FROM tickets; DELETE FROM events; DELETE FROM gates;");

const startsAt = nowSec() + 7 * 24 * 3600;
db.prepare(
  `INSERT INTO events (id, name, venue, starts_at, face_price, max_price_bps, royalty_bps, organizer_wallet)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
).run("evt1", "Demo Konseri", "Demo Salonu", startsAt, 100_000_000, RULES.resale.defaultMaxPriceBps, RULES.resale.defaultRoyaltyBps, wallet);

const addTicket = db.prepare("INSERT INTO tickets (id, event_id, owner_wallet) VALUES (?, ?, ?)");
addTicket.run("t1", "evt1", wallet);
addTicket.run("t2", "evt1", wallet);
addTicket.run("t3", "evt1", "BASKA_BIR_CUZDAN_ADRESI_ORNEK_0000000000");

db.prepare("INSERT INTO listings (id, ticket_id, seller_wallet, price, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)").run(
  "l1",
  "t3",
  "BASKA_BIR_CUZDAN_ADRESI_ORNEK_0000000000",
  105_000_000,
  nowSec(),
);

db.prepare("INSERT INTO gates (id, name, api_key) VALUES (?, ?, ?)").run("gate1", "Ana Giriş", "demo-gate-key");

console.log("Seed tamam. Turnike anahtarı: demo-gate-key");
