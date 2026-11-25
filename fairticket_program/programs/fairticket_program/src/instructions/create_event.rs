use anchor_lang::prelude::*;

use crate::{constants::*, error::ErrorCode, state::Event};

#[derive(Accounts)]
#[instruction(event_id: u64)]
pub struct CreateEvent<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Event::INIT_SPACE,
        seeds = [EVENT_SEED, authority.key().as_ref(), &event_id.to_le_bytes()],
        bump
    )]
    pub event: Account<'info, Event>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_event(
    ctx: Context<CreateEvent>,
    event_id: u64,
    face_price: u64,
    max_price_bps: u16,
    royalty_bps: u16,
) -> Result<()> {
    require!(face_price > 0, ErrorCode::InvalidFacePrice);
    require!(max_price_bps >= BPS_DENOMINATOR, ErrorCode::InvalidMaxPriceBps);
    require!(royalty_bps <= BPS_DENOMINATOR, ErrorCode::InvalidRoyaltyBps);

    let ev = &mut ctx.accounts.event;
    ev.authority = ctx.accounts.authority.key();
    ev.event_id = event_id;
    ev.face_price = face_price;
    ev.max_price_bps = max_price_bps;
    ev.royalty_bps = royalty_bps;
    ev.ticket_count = 0;
    ev.bump = ctx.bumps.event;
    Ok(())
}
