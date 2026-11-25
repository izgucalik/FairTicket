pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("6xrY8GHUgWPZrjkRdNGTrD5Cp55icUN3L4Fot7MLiujs");

#[program]
pub mod fairticket_program {
    use super::*;

    pub fn create_event(
        ctx: Context<CreateEvent>,
        event_id: u64,
        face_price: u64,
        max_price_bps: u16,
        royalty_bps: u16,
    ) -> Result<()> {
        crate::instructions::create_event::handle_create_event(
            ctx,
            event_id,
            face_price,
            max_price_bps,
            royalty_bps,
        )
    }
}
