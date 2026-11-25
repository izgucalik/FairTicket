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

fn funded(svm: &mut LiteSVM) -> Keypair {
    let k = Keypair::new();
    svm.airdrop(&k.pubkey(), 1_000_000_000).unwrap();
    k
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

fn create_event(svm: &mut LiteSVM, org: &Keypair, event_id: u64) {
    let ix = Instruction::new_with_bytes(
        fairticket_program::id(),
        &fairticket_program::instruction::CreateEvent {
            event_id,
            face_price: 100_000_000,
            max_price_bps: 11_000,
            royalty_bps: 750,
            payment_mint: Pubkey::new_from_array([7u8; 32]),
        }
        .data(),
        fairticket_program::accounts::CreateEvent {
            authority: org.pubkey(),
            event: event_pda(&org.pubkey(), event_id),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(svm, org, ix).unwrap();
}

fn mint_ticket(svm: &mut LiteSVM, org: &Keypair, event: Pubkey, index: u32, owner: Pubkey) {
    let ix = Instruction::new_with_bytes(
        fairticket_program::id(),
        &fairticket_program::instruction::MintTicket { owner }.data(),
        fairticket_program::accounts::MintTicket {
            authority: org.pubkey(),
            event,
            ticket: ticket_pda(&event, index),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(svm, org, ix).unwrap();
}

fn list_ticket(
    svm: &mut LiteSVM,
    seller: &Keypair,
    event: Pubkey,
    ticket: Pubkey,
    price: u64,
) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        fairticket_program::id(),
        &fairticket_program::instruction::ListTicket { price }.data(),
        fairticket_program::accounts::ListTicket {
            seller: seller.pubkey(),
            event,
            ticket,
            listing: listing_pda(&ticket),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(svm, seller, ix)
}

fn cancel_listing(svm: &mut LiteSVM, signer: &Keypair, ticket: Pubkey) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        fairticket_program::id(),
        &fairticket_program::instruction::CancelListing {}.data(),
        fairticket_program::accounts::CancelListing {
            seller: signer.pubkey(),
            listing: listing_pda(&ticket),
        }
        .to_account_metas(None),
    );
    send(svm, signer, ix)
}

fn read_listing(svm: &LiteSVM, ticket: &Pubkey) -> fairticket_program::state::Listing {
    let acc = svm.get_account(&listing_pda(ticket)).unwrap();
    let mut data: &[u8] = &acc.data;
    fairticket_program::state::Listing::try_deserialize(&mut data).unwrap()
}

// Etkinlik + organizator + 1 bilet (sahibi: seller)
fn kur() -> (LiteSVM, Keypair, Keypair, Pubkey, Pubkey) {
    let (mut svm, org) = setup();
    create_event(&mut svm, &org, 1);
    let event = event_pda(&org.pubkey(), 1);
    let seller = funded(&mut svm);
    mint_ticket(&mut svm, &org, event, 0, seller.pubkey());
    let ticket = ticket_pda(&event, 0);
    (svm, org, seller, event, ticket)
}

#[test]
fn tavanin_altinda_listelenir() {
    let (mut svm, _org, seller, event, ticket) = kur();
    list_ticket(&mut svm, &seller, event, ticket, 105_000_000).unwrap();
    let l = read_listing(&svm, &ticket);
    assert_eq!(l.ticket, ticket);
    assert_eq!(l.seller, seller.pubkey());
    assert_eq!(l.price, 105_000_000);
}

#[test]
fn tam_tavan_kabul_edilir() {
    let (mut svm, _org, seller, event, ticket) = kur();
    list_ticket(&mut svm, &seller, event, ticket, 110_000_000).unwrap();
    assert_eq!(read_listing(&svm, &ticket).price, 110_000_000);
}

#[test]
fn tavan_arti_bir_birim_reddedilir() {
    let (mut svm, _org, seller, event, ticket) = kur();
    let err = list_ticket(&mut svm, &seller, event, ticket, 110_000_001).unwrap_err();
    assert!(err.contains("PriceAboveCap"), "beklenmeyen hata: {err}");
    assert!(svm.get_account(&listing_pda(&ticket)).is_none());
}

#[test]
fn sifir_fiyat_reddedilir() {
    let (mut svm, _org, seller, event, ticket) = kur();
    let err = list_ticket(&mut svm, &seller, event, ticket, 0).unwrap_err();
    assert!(err.contains("InvalidPrice"), "beklenmeyen hata: {err}");
}

#[test]
fn bilet_sahibi_olmayan_listeleyemez() {
    let (mut svm, _org, _seller, event, ticket) = kur();
    let mallory = funded(&mut svm);
    let err = list_ticket(&mut svm, &mallory, event, ticket, 100_000_000).unwrap_err();
    assert!(err.contains("NotTicketOwner"), "beklenmeyen hata: {err}");
    assert!(svm.get_account(&listing_pda(&ticket)).is_none());
}

#[test]
fn kullanilmis_bilet_listelenemez() {
    let (mut svm, _org, seller, event, ticket) = kur();
    // mark_used henuz yok: bilet hesabinda used baytini elle 1 yapiyoruz.
    // Dizilim: 8 (ayirici) + 32 (event) + 32 (owner) + 4 (index) = 76. bayt used.
    let mut acc = svm.get_account(&ticket).unwrap();
    acc.data[76] = 1;
    svm.set_account(ticket, acc).unwrap();

    let err = list_ticket(&mut svm, &seller, event, ticket, 100_000_000).unwrap_err();
    assert!(err.contains("TicketUsed"), "beklenmeyen hata: {err}");
}

#[test]
fn baska_etkinligin_biletiyle_listelenemez() {
    let (mut svm, org, seller, _event, ticket) = kur();
    create_event(&mut svm, &org, 2);
    let event2 = event_pda(&org.pubkey(), 2);
    let err = list_ticket(&mut svm, &seller, event2, ticket, 100_000_000).unwrap_err();
    assert!(err.contains("EventMismatch"), "beklenmeyen hata: {err}");
}

#[test]
fn ayni_bilet_iki_kez_listelenemez() {
    let (mut svm, _org, seller, event, ticket) = kur();
    list_ticket(&mut svm, &seller, event, ticket, 100_000_000).unwrap();
    // Farkli fiyat: islem ayni olmasin, hata sadece listeleme zaten var diye gelsin
    let res = list_ticket(&mut svm, &seller, event, ticket, 90_000_000);
    assert!(res.is_err());
    assert_eq!(read_listing(&svm, &ticket).price, 100_000_000);
}

#[test]
fn iptal_sonrasi_tekrar_listelenebilir() {
    let (mut svm, _org, seller, event, ticket) = kur();
    list_ticket(&mut svm, &seller, event, ticket, 100_000_000).unwrap();
    cancel_listing(&mut svm, &seller, ticket).unwrap();
    assert!(svm.get_account(&listing_pda(&ticket)).is_none());

    list_ticket(&mut svm, &seller, event, ticket, 95_000_000).unwrap();
    assert_eq!(read_listing(&svm, &ticket).price, 95_000_000);
}

#[test]
fn satici_olmayan_iptal_edemez() {
    let (mut svm, _org, seller, event, ticket) = kur();
    list_ticket(&mut svm, &seller, event, ticket, 100_000_000).unwrap();
    let mallory = funded(&mut svm);
    let err = cancel_listing(&mut svm, &mallory, ticket).unwrap_err();
    assert!(err.contains("Unauthorized"), "beklenmeyen hata: {err}");
    assert_eq!(read_listing(&svm, &ticket).price, 100_000_000);
}
