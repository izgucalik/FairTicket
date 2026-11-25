use anchor_lang::prelude::*;

#[constant]
pub const EVENT_SEED: &[u8] = b"event";

// 10000 bps = %100. Tavan en az nominal fiyat kadar olmalı.
#[constant]
pub const BPS_DENOMINATOR: u16 = 10_000;
