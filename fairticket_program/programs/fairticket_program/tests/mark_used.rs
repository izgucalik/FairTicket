use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

fn setup() -> (LiteSVM, Keypair) {
    let program_id = fairticket_program::id();
    let payer = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/fairticket_program.so"
    ));
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    (svm, payer)
}

fn event_pda(authority: &Pubkey, event_id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[
            fairticket_program::constants::EVENT_SEED,
            authority.as_ref(),
            &event_id.to_le_bytes(),
        ],
        &fairticket_program::id(),
    )
    .0
}

fn ticket_pda(event: &Pubkey, index: u32) -> Pubkey {
    Pubkey::find_program_address(
        &[
            fairticket_program::constants::TICKET_SEED,
            event.as_ref(),
            &index.to_le_bytes(),
        ],
        &fairticket_program::id(),
    )
    .0
}

fn listing_pda(ticket: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[fairticket_program::constants::LISTING_SEED, ticket.as_ref()],
        &fairticket_program::id(),
    )
    .0
}

fn send(svm: &mut LiteSVM, signer: &Keypair, ix: Instruction) -> Result<(), String> {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e))
}

fn mark_used(svm: &mut LiteSVM, signer: &Keypair, event: Pubkey, ticket: Pubkey) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        fairticket_program::id(),
        &fairticket_program::instruction::MarkUsed {}.data(),
        fairticket_program::accounts::MarkUsed {
            authority: signer.pubkey(),
            event,
            ticket,
        }
        .to_account_metas(None),
    );
    send(svm, signer, ix)
}

fn read_ticket(svm: &LiteSVM, ticket: &Pubkey) -> fairticket_program::state::Ticket {
    let acc = svm.get_account(ticket).unwrap();
    let mut data: &[u8] = &acc.data;
    fairticket_program::state::Ticket::try_deserialize(&mut data).unwrap()
}

// Etkinlik + organizator + sahibi `holder` olan 1 bilet
fn kur() -> (LiteSVM, Keypair, Keypair, Pubkey, Pubkey) {
    let (mut svm, org) = setup();
    let holder = Keypair::new();
    svm.airdrop(&holder.pubkey(), 1_000_000_000).unwrap();
    let event = event_pda(&org.pubkey(), 1);
    let ticket = ticket_pda(&event, 0);

    let ix = Instruction::new_with_bytes(
        fairticket_program::id(),
        &fairticket_program::instruction::CreateEvent {
            event_id: 1,
            face_price: 100_000_000,
            max_price_bps: 11_000,
            royalty_bps: 750,
            payment_mint: Pubkey::new_from_array([7u8; 32]),
        }
        .data(),
        fairticket_program::accounts::CreateEvent {
            authority: org.pubkey(),
            event,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &org, ix).unwrap();

    let ix = Instruction::new_with_bytes(
        fairticket_program::id(),
        &fairticket_program::instruction::MintTicket { owner: holder.pubkey() }.data(),
        fairticket_program::accounts::MintTicket {
            authority: org.pubkey(),
            event,
            ticket,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &org, ix).unwrap();
    (svm, org, holder, event, ticket)
}

#[test]
fn organizator_kullanildi_isaretler() {
    let (mut svm, org, _holder, event, ticket) = kur();
    assert!(!read_ticket(&svm, &ticket).used);
    mark_used(&mut svm, &org, event, ticket).unwrap();
    assert!(read_ticket(&svm, &ticket).used);
}

#[test]
fn ikinci_kez_kullanildi_yazilamaz() {
    let (mut svm, org, _holder, event, ticket) = kur();
    mark_used(&mut svm, &org, event, ticket).unwrap();
    // Ayni islem tekrar gonderilirse LiteSVM AlreadyProcessed dondurur; blockhash'i yenile
    svm.expire_blockhash();
    let err = mark_used(&mut svm, &org, event, ticket).unwrap_err();
    assert!(err.contains("TicketUsed"), "beklenmeyen hata: {err}");
}

#[test]
fn organizator_olmayan_isaretleyemez() {
    let (mut svm, _org, holder, event, ticket) = kur();
    let err = mark_used(&mut svm, &holder, event, ticket).unwrap_err();
    assert!(err.contains("Unauthorized"), "beklenmeyen hata: {err}");
    assert!(!read_ticket(&svm, &ticket).used);
}

#[test]
fn kullanilmis_bilet_artik_listelenemez() {
    let (mut svm, org, holder, event, ticket) = kur();
    mark_used(&mut svm, &org, event, ticket).unwrap();

    let ix = Instruction::new_with_bytes(
        fairticket_program::id(),
        &fairticket_program::instruction::ListTicket { price: 100_000_000 }.data(),
        fairticket_program::accounts::ListTicket {
            seller: holder.pubkey(),
            event,
            ticket,
            listing: listing_pda(&ticket),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let err = send(&mut svm, &holder, ix).unwrap_err();
    assert!(err.contains("TicketUsed"), "beklenmeyen hata: {err}");
}
