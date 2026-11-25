use anchor_lang::prelude::*;

use crate::{error::ErrorCode, state::Listing};

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        mut,
        has_one = seller @ ErrorCode::Unauthorized,
        close = seller
    )]
    pub listing: Account<'info, Listing>,
}

pub fn handle_cancel_listing(_ctx: Context<CancelListing>) -> Result<()> {
    Ok(())
}
