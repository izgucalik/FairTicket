import Database from "better-sqlite3";
import "dotenv/config";

export const db = new Database(process.env.DB_PATH ?? "fairticket.db");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Zincir gerçeğin kaynağıdır; buradaki tablolar önbellek ve backend'e özel veriler içindir.
// Tutarlar (face_price, price) en küçük birim cinsinden tam sayı olarak saklanır.
db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  venue TEXT,
  starts_at INTEGER NOT NULL,
  face_price INTEGER NOT NULL,
  max_price_bps INTEGER NOT NULL,
  royalty_bps INTEGER NOT NULL,
  organizer_wallet TEXT NOT NULL,
  chain_event_address TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  owner_wallet TEXT NOT NULL,
  chain_address TEXT,
  used INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  seller_wallet TEXT NOT NULL,
  price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  tx_signature TEXT
);

CREATE TABLE IF NOT EXISTS entry_tokens (
  nonce TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  wallet TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS scan_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT,
  gate_id TEXT,
  result TEXT NOT NULL,
  reason TEXT,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  wallet TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

export const nowSec = () => Math.floor(Date.now() / 1000);
