use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Event, Ticket},
};

#[derive(Accounts)]
pub struct MintTicket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub event: Account<'info, Event>,
    #[account(
        init,
        payer = authority,
        space = 8 + Ticket::INIT_SPACE,
        seeds = [TICKET_SEED, event.key().as_ref(), &event.ticket_count.to_le_bytes()],
        bump
    )]
    pub ticket: Account<'info, Ticket>,
    pub system_program: Program<'info, System>,
}

pub fn handle_mint_ticket(ctx: Context<MintTicket>, owner: Pubkey) -> Result<()> {
    let event_key = ctx.accounts.event.key();
    let ev = &mut ctx.accounts.event;
    let t = &mut ctx.accounts.ticket;

    t.event = event_key;
    t.owner = owner;
    t.index = ev.ticket_count;
    t.used = false;
    t.bump = ctx.bumps.ticket;

    ev.ticket_count = ev
        .ticket_count
        .checked_add(1)
        .ok_or(ErrorCode::TicketCountOverflow)?;
    Ok(())
}
