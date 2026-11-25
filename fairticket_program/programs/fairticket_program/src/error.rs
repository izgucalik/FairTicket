use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Nominal fiyat sifirdan buyuk olmali")]
    InvalidFacePrice,
    #[msg("Fiyat tavani en az 10000 bps (nominal fiyat) olmali")]
    InvalidMaxPriceBps,
    #[msg("Telif orani 10000 bps'i gecemez")]
    InvalidRoyaltyBps,
}
