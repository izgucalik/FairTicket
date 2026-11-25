import { db } from "./db";

for (const t of ["events", "tickets", "listings", "gates", "entry_tokens", "scan_logs"]) {
  console.log(`\n== ${t} ==`);
  console.table(db.prepare(`SELECT * FROM ${t}`).all());
}