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

fn mint_key() -> Pubkey {
    Pubkey::new_from_array([7u8; 32])
}

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

// SPL token hesabi (165 bayt) elle olusturulur; mint hesabi gerekmez.
fn put_token(svm: &mut LiteSVM, template: Pubkey, addr: Pubkey, mint: &Pubkey, owner: &Pubkey, amount: u64) {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1; // state = Initialized
    let mut acc = svm.get_account(&template).unwrap();
    acc.data = d;
    acc.owner = anchor_spl::token::ID;
    acc.lamports = 10_000_000;
    svm.set_account(addr, acc).unwrap();
}

fn token_amount(svm: &LiteSVM, addr: &Pubkey) -> u64 {
    let acc = svm.get_account(addr).unwrap();
    u64::from_le_bytes(acc.data[64..72].try_into().unwrap())
}

fn read_ticket(svm: &LiteSVM, ticket: &Pubkey) -> fairticket_program::state::Ticket {
    let acc = svm.get_account(ticket).unwrap();
    let mut data: &[u8] = &acc.data;
    fairticket_program::state::Ticket::try_deserialize(&mut data).unwrap()
}

struct W {
    svm: LiteSVM,
    org: Keypair,
    seller: Keypair,
    buyer: Keypair,
    event: Pubkey,
    ticket: Pubkey,
    seller_tok: Pubkey,
    buyer_tok: Pubkey,
    org_tok: Pubkey,
}

fn list(svm: &mut LiteSVM, seller: &Keypair, event: Pubkey, ticket: Pubkey, price: u64) {
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
    send(svm, seller, ix).unwrap();
}

// Etkinlik (nominal 100 USDC, tavan %110, telif %7.5), seller'in 1 bileti, listeleme ve token hesaplari
fn kur(price: u64, buyer_balance: u64) -> W {
    let (mut svm, org) = setup();
    let seller = funded(&mut svm);
    let buyer = funded(&mut svm);
    let event = event_pda(&org.pubkey(), 1);

    let ix = Instruction::new_with_bytes(
        fairticket_program::id(),
        &fairticket_program::instruction::CreateEvent {
            event_id: 1,
            face_price: 100_000_000,
            max_price_bps: 11_000,
            royalty_bps: 750,
            payment_mint: mint_key(),
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

    let ticket = ticket_pda(&event, 0);
    let ix = Instruction::new_with_bytes(
        fairticket_program::id(),
        &fairticket_program::instruction::MintTicket { owner: seller.pubkey() }.data(),
        fairticket_program::accounts::MintTicket {
            authority: org.pubkey(),
            event,
            ticket,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &org, ix).unwrap();

    list(&mut svm, &seller, event, ticket, price);

    let (seller_tok, buyer_tok, org_tok) = (
        Keypair::new().pubkey(),
        Keypair::new().pubkey(),
        Keypair::new().pubkey(),
    );
    put_token(&mut svm, org.pubkey(), seller_tok, &mint_key(), &seller.pubkey(), 0);
    put_token(&mut svm, org.pubkey(), buyer_tok, &mint_key(), &buyer.pubkey(), buyer_balance);
    put_token(&mut svm, org.pubkey(), org_tok, &mint_key(), &org.pubkey(), 0);

    W { svm, org, seller, buyer, event, ticket, seller_tok, buyer_tok, org_tok }
}

#[allow(clippy::too_many_arguments)]
fn buy(
    svm: &mut LiteSVM,
    buyer: &Keypair,
    event: Pubkey,
    ticket: Pubkey,
    seller_wallet: Pubkey,
    buyer_tok: Pubkey,
    seller_tok: Pubkey,
    org_tok: Pubkey,
) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        fairticket_program::id(),
        &fairticket_program::instruction::BuyTicket {}.data(),
        fairticket_program::accounts::BuyTicket {
            buyer: buyer.pubkey(),
            event,
            ticket,
            listing: listing_pda(&ticket),
            seller: seller_wallet,
            buyer_token: buyer_tok,
            seller_token: seller_tok,
            organizer_token: org_tok,
            token_program: anchor_spl::token::ID,
        }
        .to_account_metas(None),
    );
    send(svm, buyer, ix)
}

#[test]
fn basarili_satis_odeme_telif_ve_sahiplik() {
    let mut w = kur(105_000_000, 200_000_000);
    buy(&mut w.svm, &w.buyer, w.event, w.ticket, w.seller.pubkey(), w.buyer_tok, w.seller_tok, w.org_tok).unwrap();

    // splitPayment(105_000_000, 750): telif 7_875_000, satici 97_125_000
    assert_eq!(token_amount(&w.svm, &w.org_tok), 7_875_000);
    assert_eq!(token_amount(&w.svm, &w.seller_tok), 97_125_000);
    assert_eq!(token_amount(&w.svm, &w.buyer_tok), 200_000_000 - 105_000_000);
    assert_eq!(read_ticket(&w.svm, &w.ticket).owner, w.buyer.pubkey());
    assert!(w.svm.get_account(&listing_pda(&w.ticket)).is_none());
}

#[test]
fn telif_asagi_yuvarlanir_kalan_saticiya() {
    // 105_000_001 * 750 / 10000 = 7_875_000.075 -> 7_875_000; satici 97_125_001
    let mut w = kur(105_000_001, 200_000_000);
    buy(&mut w.svm, &w.buyer, w.event, w.ticket, w.seller.pubkey(), w.buyer_tok, w.seller_tok, w.org_tok).unwrap();
    assert_eq!(token_amount(&w.svm, &w.org_tok), 7_875_000);
    assert_eq!(token_amount(&w.svm, &w.seller_tok), 97_125_001);
}

#[test]
fn yetersiz_bakiye_islemi_geri_alir() {
    let mut w = kur(105_000_000, 50_000_000);
    let res = buy(&mut w.svm, &w.buyer, w.event, w.ticket, w.seller.pubkey(), w.buyer_tok, w.seller_tok, w.org_tok);
    assert!(res.is_err());
    assert_eq!(read_ticket(&w.svm, &w.ticket).owner, w.seller.pubkey());
    assert!(w.svm.get_account(&listing_pda(&w.ticket)).is_some());
    assert_eq!(token_amount(&w.svm, &w.buyer_tok), 50_000_000);
    assert_eq!(token_amount(&w.svm, &w.seller_tok), 0);
}

#[test]
fn kendi_biletini_satin_alamaz() {
    let mut w = kur(105_000_000, 200_000_000);
    // Satici, kendisine ait ikinci (ayri) bir token hesabiyla alici gibi davranir
    let seller_tok2 = Keypair::new().pubkey();
    put_token(&mut w.svm, w.org.pubkey(), seller_tok2, &mint_key(), &w.seller.pubkey(), 200_000_000);
    let err = buy(&mut w.svm, &w.seller, w.event, w.ticket, w.seller.pubkey(), seller_tok2, w.seller_tok, w.org_tok).unwrap_err();
    assert!(err.contains("CannotBuyOwnTicket"), "beklenmeyen hata: {err}");
    assert_eq!(read_ticket(&w.svm, &w.ticket).owner, w.seller.pubkey());
    assert_eq!(token_amount(&w.svm, &seller_tok2), 200_000_000);
}

#[test]
fn yanlis_mint_ile_odeme_reddedilir() {
    let mut w = kur(105_000_000, 200_000_000);
    let sahte_mint = Pubkey::new_from_array([8u8; 32]);
    let sahte_tok = Keypair::new().pubkey();
    put_token(&mut w.svm, w.org.pubkey(), sahte_tok, &sahte_mint, &w.buyer.pubkey(), 500_000_000);

    let err = buy(&mut w.svm, &w.buyer, w.event, w.ticket, w.seller.pubkey(), sahte_tok, w.seller_tok, w.org_tok).unwrap_err();
    assert!(err.contains("ConstraintTokenMint"), "beklenmeyen hata: {err}");
    assert_eq!(read_ticket(&w.svm, &w.ticket).owner, w.seller.pubkey());
}

#[test]
fn telif_baskasinin_hesabina_yonlendirilemez() {
    let mut w = kur(105_000_000, 200_000_000);
    let mallory = Keypair::new().pubkey();
    let mallory_tok = Keypair::new().pubkey();
    put_token(&mut w.svm, w.org.pubkey(), mallory_tok, &mint_key(), &mallory, 0);

    let err = buy(&mut w.svm, &w.buyer, w.event, w.ticket, w.seller.pubkey(), w.buyer_tok, w.seller_tok, mallory_tok).unwrap_err();
    assert!(err.contains("ConstraintTokenOwner"), "beklenmeyen hata: {err}");
    assert_eq!(token_amount(&w.svm, &mallory_tok), 0);
}

#[test]
fn odeme_saticinin_hesabina_yonlendirilemez() {
    let mut w = kur(105_000_000, 200_000_000);
    let mallory = Keypair::new().pubkey();
    let mallory_tok = Keypair::new().pubkey();
    put_token(&mut w.svm, w.org.pubkey(), mallory_tok, &mint_key(), &mallory, 0);

    let err = buy(&mut w.svm, &w.buyer, w.event, w.ticket, w.seller.pubkey(), w.buyer_tok, mallory_tok, w.org_tok).unwrap_err();
    assert!(err.contains("ConstraintTokenOwner"), "beklenmeyen hata: {err}");
}

#[test]
fn satilan_bilet_tekrar_satin_alinamaz() {
    let mut w = kur(105_000_000, 300_000_000);
    buy(&mut w.svm, &w.buyer, w.event, w.ticket, w.seller.pubkey(), w.buyer_tok, w.seller_tok, w.org_tok).unwrap();

    // Listeleme kapandi: ikinci alici ayni bileti alamaz
    let buyer2 = funded(&mut w.svm);
    let buyer2_tok = Keypair::new().pubkey();
    put_token(&mut w.svm, w.org.pubkey(), buyer2_tok, &mint_key(), &buyer2.pubkey(), 200_000_000);
    let res = buy(&mut w.svm, &buyer2, w.event, w.ticket, w.seller.pubkey(), buyer2_tok, w.seller_tok, w.org_tok);
    assert!(res.is_err());
    assert_eq!(read_ticket(&w.svm, &w.ticket).owner, w.buyer.pubkey());
    assert_eq!(token_amount(&w.svm, &buyer2_tok), 200_000_000);
}

#[test]
fn yeni_sahip_bileti_tavan_icinde_tekrar_listeleyebilir() {
    let mut w = kur(105_000_000, 300_000_000);
    buy(&mut w.svm, &w.buyer, w.event, w.ticket, w.seller.pubkey(), w.buyer_tok, w.seller_tok, w.org_tok).unwrap();
    // Yeni sahip (buyer) listeler; eski sahip (seller) artik listeleyemez (list_ticket testleri bunu kapsiyor)
    list(&mut w.svm, &w.buyer, w.event, w.ticket, 110_000_000);
    assert!(w.svm.get_account(&listing_pda(&w.ticket)).is_some());
}
