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
        payment_mint: Pubkey,
    ) -> Result<()> {
        crate::instructions::create_event::handle_create_event(
            ctx,
            event_id,
            face_price,
            max_price_bps,
            royalty_bps,
            payment_mint,
        )
    }

    pub fn mint_ticket(ctx: Context<MintTicket>, owner: Pubkey) -> Result<()> {
        crate::instructions::mint_ticket::handle_mint_ticket(ctx, owner)
    }

    pub fn list_ticket(ctx: Context<ListTicket>, price: u64) -> Result<()> {
        crate::instructions::list_ticket::handle_list_ticket(ctx, price)
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>) -> Result<()> {
        crate::instructions::buy_ticket::handle_buy_ticket(ctx)
    }

    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        crate::instructions::cancel_listing::handle_cancel_listing(ctx)
    }
}
