use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Event, Listing, Ticket},
};

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub event: Account<'info, Event>,
    #[account(
        mut,
        has_one = event @ ErrorCode::EventMismatch,
        constraint = !ticket.used @ ErrorCode::TicketUsed,
    )]
    pub ticket: Account<'info, Ticket>,
    #[account(
        mut,
        seeds = [LISTING_SEED, ticket.key().as_ref()],
        bump = listing.bump,
        has_one = seller @ ErrorCode::Unauthorized,
        close = seller
    )]
    pub listing: Account<'info, Listing>,
    /// Listeleme kapaninca kira bedeli buraya doner
    #[account(mut)]
    pub seller: SystemAccount<'info>,
    #[account(
        mut,
        token::mint = event.payment_mint,
        token::authority = buyer
    )]
    pub buyer_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = event.payment_mint,
        token::authority = seller
    )]
    pub seller_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = event.payment_mint,
        token::authority = event.authority
    )]
    pub organizer_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_buy_ticket(ctx: Context<BuyTicket>) -> Result<()> {
    require_keys_neq!(
        ctx.accounts.buyer.key(),
        ctx.accounts.seller.key(),
        ErrorCode::CannotBuyOwnTicket
    );
    // Bilet baska birine gectiyse eski listeleme gecersizdir
    require_keys_eq!(
        ctx.accounts.ticket.owner,
        ctx.accounts.seller.key(),
        ErrorCode::ListingStale
    );

    let price = ctx.accounts.listing.price;
    let royalty_bps = ctx.accounts.event.royalty_bps as u128;
    let royalty = (price as u128)
        .checked_mul(royalty_bps)
        .ok_or(ErrorCode::MathOverflow)?
        / (BPS_DENOMINATOR as u128);
    let royalty = royalty as u64;
    let seller_amount = price.checked_sub(royalty).ok_or(ErrorCode::MathOverflow)?;

    // 1) Alici -> satici
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.buyer_token.to_account_info(),
                to: ctx.accounts.seller_token.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        seller_amount,
    )?;

    // 2) Alici -> organizator (telif)
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.buyer_token.to_account_info(),
                to: ctx.accounts.organizer_token.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        royalty,
    )?;

    // 3) Sahiplik devri (listeleme hesabi `close` ile kapanir)
    ctx.accounts.ticket.owner = ctx.accounts.buyer.key();
    Ok(())
}
