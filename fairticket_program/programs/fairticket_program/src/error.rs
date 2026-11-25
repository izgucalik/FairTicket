use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Nominal fiyat sifirdan buyuk olmali")]
    InvalidFacePrice,
    #[msg("Fiyat tavani en az 10000 bps (nominal fiyat) olmali")]
    InvalidMaxPriceBps,
    #[msg("Telif orani 10000 bps'i gecemez")]
    InvalidRoyaltyBps,
    #[msg("Bu islemi sadece yetkili hesap yapabilir")]
    Unauthorized,
    #[msg("Bilet sayaci tasti")]
    TicketCountOverflow,
    #[msg("Fiyat sifirdan buyuk olmali")]
    InvalidPrice,
    #[msg("Fiyat izin verilen ust siniri asiyor")]
    PriceAboveCap,
    #[msg("Bu bilet size ait degil")]
    NotTicketOwner,
    #[msg("Kullanilmis bilet listelenemez")]
    TicketUsed,
    #[msg("Bilet bu etkinlige ait degil")]
    EventMismatch,
}
