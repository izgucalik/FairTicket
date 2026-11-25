use anchor_lang::prelude::*;

#[constant]
pub const EVENT_SEED: &[u8] = b"event";

#[constant]
pub const TICKET_SEED: &[u8] = b"ticket";

#[constant]
pub const LISTING_SEED: &[u8] = b"listing";

// 10000 bps = %100. Tavan en az nominal fiyat kadar olmali.
#[constant]
pub const BPS_DENOMINATOR: u16 = 10_000;
