use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Event, Listing, Ticket},
};

#[derive(Accounts)]
pub struct ListTicket<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    pub event: Account<'info, Event>,
    #[account(
        has_one = event @ ErrorCode::EventMismatch,
        constraint = ticket.owner == seller.key() @ ErrorCode::NotTicketOwner,
        constraint = !ticket.used @ ErrorCode::TicketUsed,
    )]
    pub ticket: Account<'info, Ticket>,
    #[account(
        init,
        payer = seller,
        space = 8 + Listing::INIT_SPACE,
        seeds = [LISTING_SEED, ticket.key().as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,
    pub system_program: Program<'info, System>,
}

pub fn handle_list_ticket(ctx: Context<ListTicket>, price: u64) -> Result<()> {
    require!(price > 0, ErrorCode::InvalidPrice);

    // Tavan = nominal * bps / 10000, u128 ile (tasma yok, kayan nokta yok)
    let ev = &ctx.accounts.event;
    let cap = (ev.face_price as u128) * (ev.max_price_bps as u128) / (BPS_DENOMINATOR as u128);
    require!((price as u128) <= cap, ErrorCode::PriceAboveCap);

    let l = &mut ctx.accounts.listing;
    l.ticket = ctx.accounts.ticket.key();
    l.seller = ctx.accounts.seller.key();
    l.price = price;
    l.bump = ctx.bumps.listing;
    Ok(())
}
