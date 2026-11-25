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

// signer organizator olmak zorunda degil: yetkisiz denemeyi de bununla test ediyoruz.
fn mint_ticket(
    svm: &mut LiteSVM,
    signer: &Keypair,
    event: Pubkey,
    index: u32,
    owner: Pubkey,
) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        fairticket_program::id(),
        &fairticket_program::instruction::MintTicket { owner }.data(),
        fairticket_program::accounts::MintTicket {
            authority: signer.pubkey(),
            event,
            ticket: ticket_pda(&event, index),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(svm, signer, ix)
}

fn read_event(svm: &LiteSVM, event: &Pubkey) -> fairticket_program::state::Event {
    let acc = svm.get_account(event).unwrap();
    let mut data: &[u8] = &acc.data;
    fairticket_program::state::Event::try_deserialize(&mut data).unwrap()
}

fn read_ticket(svm: &LiteSVM, ticket: &Pubkey) -> fairticket_program::state::Ticket {
    let acc = svm.get_account(ticket).unwrap();
    let mut data: &[u8] = &acc.data;
    fairticket_program::state::Ticket::try_deserialize(&mut data).unwrap()
}

#[test]
fn organizator_bilet_basar_ve_sahip_dogru() {
    let (mut svm, org) = setup();
    create_event(&mut svm, &org, 1);
    let event = event_pda(&org.pubkey(), 1);
    let buyer = Keypair::new().pubkey();

    mint_ticket(&mut svm, &org, event, 0, buyer).unwrap();

    let t = read_ticket(&svm, &ticket_pda(&event, 0));
    assert_eq!(t.event, event);
    assert_eq!(t.owner, buyer);
    assert_eq!(t.index, 0);
    assert!(!t.used);
    assert_eq!(read_event(&svm, &event).ticket_count, 1);
}

#[test]
fn ikinci_bilet_farkli_hesap_ve_sayac_artar() {
    let (mut svm, org) = setup();
    create_event(&mut svm, &org, 1);
    let event = event_pda(&org.pubkey(), 1);
    let a = Keypair::new().pubkey();
    let b = Keypair::new().pubkey();

    mint_ticket(&mut svm, &org, event, 0, a).unwrap();
    mint_ticket(&mut svm, &org, event, 1, b).unwrap();

    assert_ne!(ticket_pda(&event, 0), ticket_pda(&event, 1));
    assert_eq!(read_ticket(&svm, &ticket_pda(&event, 0)).owner, a);
    assert_eq!(read_ticket(&svm, &ticket_pda(&event, 1)).owner, b);
    assert_eq!(read_event(&svm, &event).ticket_count, 2);
}

#[test]
fn ayni_sira_no_ile_tekrar_basilamaz() {
    let (mut svm, org) = setup();
    create_event(&mut svm, &org, 1);
    let event = event_pda(&org.pubkey(), 1);
    let a = Keypair::new().pubkey();

    mint_ticket(&mut svm, &org, event, 0, a).unwrap();
    // Sayac artik 1; sira no 0 icin turetilen PDA zaten var / seeds uyusmuyor
    let res = mint_ticket(&mut svm, &org, event, 0, Keypair::new().pubkey());
    assert!(res.is_err());
    assert_eq!(read_ticket(&svm, &ticket_pda(&event, 0)).owner, a);
    assert_eq!(read_event(&svm, &event).ticket_count, 1);
}

#[test]
fn organizator_olmayan_bilet_basamaz() {
    let (mut svm, org) = setup();
    create_event(&mut svm, &org, 1);
    let event = event_pda(&org.pubkey(), 1);

    let mallory = Keypair::new();
    svm.airdrop(&mallory.pubkey(), 1_000_000_000).unwrap();

    let err = mint_ticket(&mut svm, &mallory, event, 0, mallory.pubkey()).unwrap_err();
    assert!(err.contains("Unauthorized"), "beklenmeyen hata: {err}");
    assert!(svm.get_account(&ticket_pda(&event, 0)).is_none());
    assert_eq!(read_event(&svm, &event).ticket_count, 0);
}
