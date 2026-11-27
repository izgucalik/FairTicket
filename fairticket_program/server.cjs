const fs = require("fs");
const os = require("os");
const express = require("express");
let anchor;
try { anchor = require("@anchor-lang/core"); } catch { anchor = require("@coral-xyz/anchor"); }
const { Keypair, Connection, PublicKey, SystemProgram, Transaction, clusterApiUrl } = require("@solana/web3.js");
const { getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const { BN } = anchor;

const MINT = new PublicKey("9GoqbmaYzShY2hMmaAUkNZf9gysrd4TNzdiczmHuLUJn");
const USDC = 1_000_000;
const KEYFILE = __dirname + "/.demo-keys.json";

const organizer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(os.homedir() + "/.config/solana/id.json"))));
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(organizer), { commitment: "confirmed" });
const program = new anchor.Program(require("./target/idl/fairticket_program.json"), provider);

// Ayşe ve Mehmet anahtarları bir kez üretilir, dosyada saklanır (git'e girmez)
let keys;
if (fs.existsSync(KEYFILE)) keys = JSON.parse(fs.readFileSync(KEYFILE));
else {
  keys = { seller: Array.from(Keypair.generate().secretKey), buyer: Array.from(Keypair.generate().secretKey) };
  fs.writeFileSync(KEYFILE, JSON.stringify(keys));
}
const seller = Keypair.fromSecretKey(Uint8Array.from(keys.seller));
const buyer = Keypair.fromSecretKey(Uint8Array.from(keys.buyer));

const txUrl = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
const bal = async (a) => (await connection.getTokenAccountBalance(a)).value.uiAmount;
let D = null;
let busy = false;

function addLog(text, url) { if (D) D.log.unshift({ t: new Date().toLocaleTimeString("tr-TR"), text, url }); }

async function reset() {
  busy = true; D = null;
  try {
    const t = new Transaction();
    for (const k of [seller, buyer]) {
      if ((await connection.getBalance(k.publicKey)) < 20_000_000)
        t.add(SystemProgram.transfer({ fromPubkey: organizer.publicKey, toPubkey: k.publicKey, lamports: 50_000_000 }));
    }
    if (t.instructions.length) await provider.sendAndConfirm(t);
    const orgAta = await getOrCreateAssociatedTokenAccount(connection, organizer, MINT, organizer.publicKey);
    const sellerAta = await getOrCreateAssociatedTokenAccount(connection, organizer, MINT, seller.publicKey);
    const buyerAta = await getOrCreateAssociatedTokenAccount(connection, organizer, MINT, buyer.publicKey);
    if ((await bal(buyerAta.address)) < 100) await mintTo(connection, organizer, MINT, buyerAta.address, organizer, 1000 * USDC);

    const eventId = new BN(Date.now());
    const [eventPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("event"), organizer.publicKey.toBuffer(), eventId.toArrayLike(Buffer, "le", 8)], program.programId);
    const [ticketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ticket"), eventPda.toBuffer(), Buffer.alloc(4)], program.programId);
    const [listingPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("listing"), ticketPda.toBuffer()], program.programId);
    D = { eventPda, ticketPda, listingPda, orgAta, sellerAta, buyerAta, price: null, log: [] };

    let sig = await program.methods.createEvent(eventId, new BN(50 * USDC), 12000, 1000, MINT)
      .accounts({ authority: organizer.publicKey, event: eventPda, systemProgram: SystemProgram.programId }).rpc();
    addLog("Etkinlik oluşturuldu (nominal 50, tavan %120, telif %10)", txUrl(sig));
    sig = await program.methods.mintTicket(seller.publicKey)
      .accounts({ authority: organizer.publicKey, event: eventPda, ticket: ticketPda, systemProgram: SystemProgram.programId }).rpc();
    addLog("Bilet basıldı, sahibi Ayşe", txUrl(sig));
  } finally { busy = false; }
}

async function state() {
  if (!D || busy) return { ready: false };
  const t = await program.account.ticket.fetch(D.ticketPda);
  return {
    ready: true,
    eventPda: D.eventPda.toBase58(),
    ticket: { owner: t.owner.equals(buyer.publicKey) ? "mehmet" : "ayse", used: t.used, price: D.price },
    balances: { ayse: await bal(D.sellerAta.address), mehmet: await bal(D.buyerAta.address), organizer: await bal(D.orgAta.address) },
    log: D.log,
  };
}

const h = (label, fn) => async (req, res) => {
  try { res.json(await fn(req.body || {})); }
  catch (e) {
    const code = e.error?.errorCode?.code || "Hata";
    const message = e.error?.errorMessage || e.message.split("\n")[0];
    addLog(`ZİNCİR REDDETTİ (${label}): ${code}`);
    res.status(400).json({ error: code, message });
  }
};

const app = express();
app.use(express.json());
app.use(express.static(__dirname + "/public"));

app.get("/api/state", async (req, res) => { try { res.json(await state()); } catch (e) { res.json({ ready: false }); } });

app.post("/api/reset", (req, res) => {
  if (busy) return res.json({ ok: true });
  reset().catch((e) => console.error(e));
  res.json({ ok: true });
});

app.post("/api/list", h("listeleme", async ({ price }) => {
  const sig = await program.methods.listTicket(new BN(Math.round(Number(price) * USDC)))
    .accounts({ seller: seller.publicKey, event: D.eventPda, ticket: D.ticketPda, listing: D.listingPda, systemProgram: SystemProgram.programId })
    .signers([seller]).rpc();
  D.price = Number(price);
  addLog(`Ayşe ${price} USDC'ye listeledi`, txUrl(sig));
  return { ok: true };
}));

app.post("/api/buy", h("satın alma", async () => {
  const price = D.price;
  const sig = await program.methods.buyTicket()
    .accounts({ buyer: buyer.publicKey, event: D.eventPda, ticket: D.ticketPda, listing: D.listingPda, seller: seller.publicKey,
      buyerToken: D.buyerAta.address, sellerToken: D.sellerAta.address, organizerToken: D.orgAta.address, tokenProgram: TOKEN_PROGRAM_ID })
    .signers([buyer]).rpc();
  D.price = null;
  addLog("Mehmet satın aldı, telif bölüşüldü", txUrl(sig));
  return { ok: true, price };
}));

app.post("/api/mark-used", h("okutma", async ({ qr }) => {
  if (qr !== "fairticket:" + D.eventPda.toBase58()) throw new Error("Bu QR bu etkinliğe ait değil");
  const sig = await program.methods.markUsed()
    .accounts({ authority: organizer.publicKey, event: D.eventPda, ticket: D.ticketPda }).rpc();
  addLog("Bilet okutuldu, zincirde KULLANILDI", txUrl(sig));
  return { ok: true };
}));

app.listen(3000, () => console.log("Demo: http://localhost:3000"));
reset().then(() => console.log("Hazır: etkinlik ve bilet oluşturuldu")).catch((e) => console.error(e));
