const fs = require("fs");
const os = require("os");
let anchor;
try { anchor = require("@anchor-lang/core"); } catch { anchor = require("@coral-xyz/anchor"); }
const {
  Keypair, Connection, PublicKey, SystemProgram, Transaction, clusterApiUrl,
} = require("@solana/web3.js");
const { getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } = require("@solana/spl-token");
const { BN } = anchor;

const MINT = new PublicKey("7iNRCoLV5rdwtZXNJC2aHCocYGUiGsKkBRE8J3ovZ7vE");
const USDC = 1_000_000; // 6 ondalik

async function expectFail(label, fn) {
  try {
    await fn();
    console.log(`   BEKLENMEYEN: "${label}" basarili oldu!`);
  } catch (e) {
    const code = e.error?.errorCode?.code || e.message.split("\n")[0];
    console.log(`   ✔ Zincir reddetti (${label}): ${code}`);
  }
}

async function main() {
  const secret = JSON.parse(fs.readFileSync(os.homedir() + "/.config/solana/id.json"));
  const organizer = Keypair.fromSecretKey(Uint8Array.from(secret));
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(organizer), { commitment: "confirmed" });
  const idl = require("../target/idl/fairticket_program.json");
  const program = new anchor.Program(idl, provider);

  const seller = Keypair.generate();
  const buyer = Keypair.generate();
  const tx = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  const bal = async (a) => (await connection.getTokenAccountBalance(a)).value.uiAmount;

  console.log("0) Hazirlik: satici ve alici cuzdanlari, sahte USDC");
  await provider.sendAndConfirm(
    new Transaction().add(
      SystemProgram.transfer({ fromPubkey: organizer.publicKey, toPubkey: seller.publicKey, lamports: 50_000_000 }),
      SystemProgram.transfer({ fromPubkey: organizer.publicKey, toPubkey: buyer.publicKey, lamports: 50_000_000 })
    )
  );
  const orgAta = await getOrCreateAssociatedTokenAccount(connection, organizer, MINT, organizer.publicKey);
  const sellerAta = await getOrCreateAssociatedTokenAccount(connection, organizer, MINT, seller.publicKey);
  const buyerAta = await getOrCreateAssociatedTokenAccount(connection, organizer, MINT, buyer.publicKey);
  await mintTo(connection, organizer, MINT, buyerAta.address, organizer, 1000 * USDC);
  console.log("   Alici 1000 sahte USDC ile basliyor");

  const eventId = new BN(Date.now());
  const [eventPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("event"), organizer.publicKey.toBuffer(), eventId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  const [ticketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("ticket"), eventPda.toBuffer(), Buffer.alloc(4)],
    program.programId
  );
  const [listingPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("listing"), ticketPda.toBuffer()],
    program.programId
  );

  console.log("1) Etkinlik olusturuluyor: nominal 50 USDC, tavan %120, telif %10");
  let sig = await program.methods
    .createEvent(eventId, new BN(50 * USDC), 12000, 1000, MINT)
    .accounts({ authority: organizer.publicKey, event: eventPda, systemProgram: SystemProgram.programId })
    .rpc();
  console.log("   " + tx(sig));
  console.log(`   Etkinlik hesabi: https://explorer.solana.com/address/${eventPda}?cluster=devnet`);

  console.log("2) Bilet basiliyor, sahibi: satici");
  sig = await program.methods
    .mintTicket(seller.publicKey)
    .accounts({ authority: organizer.publicKey, event: eventPda, ticket: ticketPda, systemProgram: SystemProgram.programId })
    .rpc();
  console.log("   " + tx(sig));

  console.log("3) Satici 70 USDC'ye listelemeye calisiyor (tavan 60)");
  await expectFail("tavan ustu fiyat", () =>
    program.methods
      .listTicket(new BN(70 * USDC))
      .accounts({ seller: seller.publicKey, event: eventPda, ticket: ticketPda, listing: listingPda, systemProgram: SystemProgram.programId })
      .signers([seller])
      .rpc()
  );

  console.log("4) Satici 55 USDC'ye listeliyor (tavan altinda)");
  sig = await program.methods
    .listTicket(new BN(55 * USDC))
    .accounts({ seller: seller.publicKey, event: eventPda, ticket: ticketPda, listing: listingPda, systemProgram: SystemProgram.programId })
    .signers([seller])
    .rpc();
  console.log("   " + tx(sig));

  console.log("5) Alici satin aliyor");
  sig = await program.methods
    .buyTicket()
    .accounts({
      buyer: buyer.publicKey,
      event: eventPda,
      ticket: ticketPda,
      listing: listingPda,
      seller: seller.publicKey,
      buyerToken: buyerAta.address,
      sellerToken: sellerAta.address,
      organizerToken: orgAta.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([buyer])
    .rpc();
  console.log("   " + tx(sig));
  console.log(`   Alici: ${await bal(buyerAta.address)} USDC, Satici: ${await bal(sellerAta.address)} USDC (55 - %10 telif)`);
  console.log(`   Organizator bakiyesi (telif dahil): ${await bal(orgAta.address)} USDC`);
  let t = await program.account.ticket.fetch(ticketPda);
  console.log(`   Yeni sahip alici mi? ${t.owner.equals(buyer.publicKey)}`);

  console.log("6) Kapida bilet okutuluyor (mark_used)");
  sig = await program.methods
    .markUsed()
    .accounts({ authority: organizer.publicKey, event: eventPda, ticket: ticketPda })
    .rpc();
  console.log("   " + tx(sig));
  t = await program.account.ticket.fetch(ticketPda);
  console.log(`   Zincirde kullanildi mi? ${t.used}`);

  console.log("7) Ayni bilet tekrar okutuluyor");
  await expectFail("kullanilmis bilet", () =>
    program.methods
      .markUsed()
      .accounts({ authority: organizer.publicKey, event: eventPda, ticket: ticketPda })
      .rpc()
  );

  console.log("\nDemo tamam.");
}

main().catch((e) => { console.error(e); process.exit(1); });
