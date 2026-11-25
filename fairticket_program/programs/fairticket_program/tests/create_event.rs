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

// Basarili ise Ok, degilse hata metni (log dahil) doner.
fn create_event(
    svm: &mut LiteSVM,
    authority: &Keypair,
    event_id: u64,
    face_price: u64,
    max_price_bps: u16,
    royalty_bps: u16,
) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        fairticket_program::id(),
        &fairticket_program::instruction::CreateEvent {
            event_id,
            face_price,
            max_price_bps,
            royalty_bps,
            payment_mint: Pubkey::new_from_array([7u8; 32]),
        }
        .data(),
        fairticket_program::accounts::CreateEvent {
            authority: authority.pubkey(),
            event: event_pda(&authority.pubkey(), event_id),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&authority.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[authority]).unwrap();
    svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e))
}

#[test]
fn gecerli_etkinlik_olusur_ve_degerler_dogru() {
    let (mut svm, org) = setup();
    // rules.ts ile ayni: nominal 100 USDC, tavan %110, telif %7.5
    create_event(&mut svm, &org, 1, 100_000_000, 11_000, 750).unwrap();

    let acc = svm.get_account(&event_pda(&org.pubkey(), 1)).unwrap();
    let mut data: &[u8] = &acc.data;
    let ev = fairticket_program::state::Event::try_deserialize(&mut data).unwrap();
    assert_eq!(ev.authority, org.pubkey());
    assert_eq!(ev.event_id, 1);
    assert_eq!(ev.face_price, 100_000_000);
    assert_eq!(ev.max_price_bps, 11_000);
    assert_eq!(ev.royalty_bps, 750);
    assert_eq!(ev.ticket_count, 0);
}

#[test]
fn tavan_nominalin_altindaysa_reddedilir() {
    let (mut svm, org) = setup();
    let err = create_event(&mut svm, &org, 1, 100_000_000, 9_999, 750).unwrap_err();
    assert!(err.contains("InvalidMaxPriceBps"), "beklenmeyen hata: {err}");
    assert!(svm.get_account(&event_pda(&org.pubkey(), 1)).is_none());
}

#[test]
fn tavan_tam_nominal_ise_kabul_edilir() {
    let (mut svm, org) = setup();
    create_event(&mut svm, &org, 1, 100_000_000, 10_000, 750).unwrap();
}

#[test]
fn sifir_fiyat_ve_asiri_telif_reddedilir() {
    let (mut svm, org) = setup();
    let e1 = create_event(&mut svm, &org, 1, 0, 11_000, 750).unwrap_err();
    assert!(e1.contains("InvalidFacePrice"), "beklenmeyen hata: {e1}");
    let e2 = create_event(&mut svm, &org, 2, 100_000_000, 11_000, 10_001).unwrap_err();
    assert!(e2.contains("InvalidRoyaltyBps"), "beklenmeyen hata: {e2}");
}

#[test]
fn ayni_event_id_ile_ikinci_kez_olusturulamaz() {
    let (mut svm, org) = setup();
    create_event(&mut svm, &org, 7, 100_000_000, 11_000, 750).unwrap();
    // Farkli fiyat: islem imzasi farkli olsun, hata sadece hesabin zaten var olmasindan gelsin
    let res = create_event(&mut svm, &org, 7, 200_000_000, 11_000, 750);
    assert!(res.is_err());
    // Ilk etkinlik bozulmadi
    let acc = svm.get_account(&event_pda(&org.pubkey(), 7)).unwrap();
    let mut data: &[u8] = &acc.data;
    let ev = fairticket_program::state::Event::try_deserialize(&mut data).unwrap();
    assert_eq!(ev.face_price, 100_000_000);
}

#[test]
fn farkli_organizator_ayni_event_id_kullanabilir() {
    let (mut svm, org1) = setup();
    let org2 = Keypair::new();
    svm.airdrop(&org2.pubkey(), 1_000_000_000).unwrap();
    create_event(&mut svm, &org1, 1, 100_000_000, 11_000, 750).unwrap();
    create_event(&mut svm, &org2, 1, 50_000_000, 12_000, 500).unwrap();
    assert_ne!(event_pda(&org1.pubkey(), 1), event_pda(&org2.pubkey(), 1));
}

#[test]
fn odeme_mint_kaydedilir() {
    let (mut svm, org) = setup();
    create_event(&mut svm, &org, 1, 100_000_000, 11_000, 750).unwrap();

    let acc = svm.get_account(&event_pda(&org.pubkey(), 1)).unwrap();
    let mut data: &[u8] = &acc.data;
    let ev = fairticket_program::state::Event::try_deserialize(&mut data).unwrap();
    assert_eq!(ev.payment_mint, Pubkey::new_from_array([7u8; 32]));
}
