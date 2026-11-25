use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Event {
    pub authority: Pubkey,
    // Satislarda gecerli tek odeme token'i (Devnet USDC)
    pub payment_mint: Pubkey,
    pub event_id: u64,
    // Tutarlar en kucuk birim, tam sayi (USDC icin 6 basamak)
    pub face_price: u64,
    pub max_price_bps: u16,
    pub royalty_bps: u16,
    pub ticket_count: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Ticket {
    pub event: Pubkey,
    pub owner: Pubkey,
    pub index: u32,
    pub used: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Listing {
    pub ticket: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub bump: u8,
}
