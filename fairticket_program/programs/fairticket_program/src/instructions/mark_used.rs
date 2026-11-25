use anchor_lang::prelude::*;

use crate::{
    error::ErrorCode,
    state::{Event, Ticket},
};

#[derive(Accounts)]
pub struct MarkUsed<'info> {
    pub authority: Signer<'info>,
    #[account(has_one = authority @ ErrorCode::Unauthorized)]
    pub event: Account<'info, Event>,
    #[account(
        mut,
        has_one = event @ ErrorCode::EventMismatch,
        constraint = !ticket.used @ ErrorCode::TicketUsed,
    )]
    pub ticket: Account<'info, Ticket>,
}

pub fn handle_mark_used(ctx: Context<MarkUsed>) -> Result<()> {
    ctx.accounts.ticket.used = true;
    Ok(())
}
