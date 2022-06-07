//! A Solana SStars IDO program
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::{
        invoke,
    },
    system_instruction::{
        transfer,
    },
    sysvar::{
        rent::Rent
    },
};

use anchor_spl::token::{self, Token, Mint, Transfer};
use std::ops::Deref;

pub mod merkle_proof;

declare_id!("7jcTKW1gzgwywcBsMp9TSZn5XDfKrWquEMJNnwSu2YUY");

pub mod constants {
    pub const USER_DEPOSIT_PDA_SEED: &[u8] = b"user_deposit";
    pub const WHITELIST_PDA_SEED: &[u8] = b"whitelist";
}

fn verify_merkle(
    index: u64,
    value: u64,
    wallet: Pubkey,
    proof: Vec<[u8; 32]>,
    root: [u8; 32]
) -> bool {
    let node = solana_program::keccak::hashv(&[
        &[0x00],
        &index.to_le_bytes(),
        &wallet.to_bytes(),
        &value.to_le_bytes(),
    ]);
    merkle_proof::verify(proof, root, node.0)
}

#[program]
pub mod sstars_ido_contract {
    use super::*;

    /**
     * ****************************************
     *
     * Initialize Program Config
     * ****************************************
     */
    /// upgradeable Initialize
    /// @param _config_nonce            Program Config Account Address Nonce
    pub fn initialize(ctx: Context<Initialize>, ido_name: String, token_type: u8, nonce: u8, check_whitelist: bool) -> Result<()> {
        msg!("INITIALIZE Token");
        let ido_account = &mut ctx.accounts.ido_account;

        let name_bytes = ido_name.as_bytes();
        let mut name_data = [b' '; 10];
        name_data[..name_bytes.len()].copy_from_slice(name_bytes);

        ido_account.ido_name = name_data;
        ido_account.token_type = token_type;
        ido_account.ido_authority = ctx.accounts.ido_authority.key();
        ido_account.token_mint = ctx.accounts.token_mint.key();
        ido_account.service_vault = ctx.accounts.service_vault.key();
        ido_account.total_amount = 0;
        ido_account.nonce = nonce;
        ido_account.freeze_program = false;
        ido_account.check_whitelist = check_whitelist;

        Ok(())
    }

    pub fn set_whitelist(ctx: Context<SetWhitelist>, root: [u8; 32]) -> Result<()> {
        let whitelist = &mut ctx.accounts.whitelist_account;
        whitelist.root = root;
        Ok(())
    }

    pub fn verify(
        ctx: Context<Verify>,
        index: u64,
        value: u64,
        wallet: Pubkey,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        let check_verify = verify_merkle(
            index,
            value,
            wallet,
            proof,
            ctx.accounts.whitelist_account.root
        );
        require!(
            check_verify,
            InvalidProof
        );
        Ok(())
    }

    pub fn toggle_freeze_program(
        ctx: Context<FreezeProgram>,
        ido_name: String,
    ) -> Result<()> {
        msg!("toggle_freeze_program - handle {}", ido_name);
        ctx.accounts.ido_account.freeze_program = !ctx.accounts.ido_account.freeze_program;

        Ok(())
    }

    #[access_control(unrestricted_phase(& ctx.accounts.ido_account))]
    pub fn init_user_deposit(ctx: Context<InitUserDeposit>) -> Result<()> {
        msg!("INIT USER DEPOSIT");
        let user_deposit = &mut ctx.accounts.user_deposit;
        let now_ts = Clock::get().unwrap().unix_timestamp;
        user_deposit.authority = ctx.accounts.user_authority.key();
        user_deposit.amount = 0;
        user_deposit.started_at = now_ts as u64;
        user_deposit.updated_at = now_ts as u64;
        Ok(())
    }

    pub fn init_user_allocation(ctx: Context<InitUserAllocation>) -> Result<()> {
        msg!("INIT USER Allocation");
        let user_allocation = &mut ctx.accounts.user_allocation;
        user_allocation.allocation_amount = 0;
        Ok(())
    }

    #[access_control(unrestricted_phase(& ctx.accounts.ido_account))]
    pub fn deposit(
        ctx: Context<Deposit>,
        index: u64,
        max_allocation_amount: u64,
        allocation_amount: u64,
        amount: u64,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        msg!("DEPOSIT TOKEN");
        let ido_account = &mut ctx.accounts.ido_account;
        let user_deposit = &mut ctx.accounts.user_deposit;
        let user_allocation = &mut ctx.accounts.user_allocation;
        let now_ts = Clock::get().unwrap().unix_timestamp;

        if ido_account.check_whitelist {
            let check_verify = verify_merkle(
                index,
                max_allocation_amount,
                ctx.accounts.user_authority.key(),
                proof,
                ctx.accounts.whitelist_account.root
            );
            require!(
                check_verify,
                InvalidProof
            );
        }

        let total_allocation_amount = (user_allocation.allocation_amount as u128)
            .checked_add(allocation_amount as u128)
            .unwrap()
            .try_into()
            .unwrap();

        require!(
            max_allocation_amount >= total_allocation_amount,
            InvalidAmount
        );

        let is_native = ctx.accounts.token_mint.key() == spl_token::native_mint::id();

        if is_native {
            invoke(
                &transfer(
                    ctx.accounts.user_authority.to_account_info().key,
                    ctx.accounts.service_vault.key,
                    amount,
                ),
                &[
                    ctx.accounts.user_authority.to_account_info(),
                    ctx.accounts.service_vault.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        } else {
            // Transfer user's USDC to service USDC account.
            let cpi_accounts = Transfer {
                from: ctx.accounts.user_token_wallet.to_account_info(),
                to: ctx.accounts.service_vault.to_account_info(),
                authority: ctx.accounts.user_authority.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
            token::transfer(cpi_ctx, amount)?;
        }
        //update ido_account total_amount
        ido_account.total_amount = (ido_account.total_amount as u128)
            .checked_add(amount as u128)
            .unwrap()
            .try_into()
            .unwrap();

        //update user_deposit info
        user_deposit.updated_at = now_ts as u64;
        user_deposit.amount = (user_deposit.amount as u128)
            .checked_add(amount as u128)
            .unwrap()
            .try_into()
            .unwrap();
        user_allocation.allocation_amount = total_allocation_amount;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(ido_name: String, token_type: u8)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub ido_authority: Signer<'info>,

    #[account(
    init,
    payer = ido_authority,
    seeds = [ido_name.as_bytes(), &[token_type]],
    bump,
    space = IdoAccount::LEN + 8
    )]
    pub ido_account: Box<Account<'info, IdoAccount>>,

    pub token_mint: Box<Account<'info, Mint>>,

    /// CHECK: This is not dangerous because we don't read or write from this account
    pub service_vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SetWhitelist<'info> {
    #[account(mut)]
    pub ido_authority: Signer<'info>,

    #[account(
    seeds = [
    ido_account.ido_name.as_ref().trim_ascii_whitespace(), &[ido_account.token_type]
    ],
    bump = ido_account.nonce,
    has_one = ido_authority,
    )]
    pub ido_account: Box<Account<'info, IdoAccount>>,

    #[account(
    init_if_needed,
    payer = ido_authority,
    space = WhitelistAccount::LEN + 8,
    seeds = [
    ido_account.ido_name.as_ref().trim_ascii_whitespace(),
    constants::WHITELIST_PDA_SEED.as_ref(),
    ],
    bump,
    )]
    pub whitelist_account: Box<Account<'info, WhitelistAccount>>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Verify<'info> {
    #[account(mut)]
    pub ido_authority: Signer<'info>,

    #[account(
    seeds = [
    ido_account.ido_name.as_ref().trim_ascii_whitespace(), &[ido_account.token_type]
    ],
    bump = ido_account.nonce,
    has_one = ido_authority,
    )]
    pub ido_account: Box<Account<'info, IdoAccount>>,

    #[account(
    seeds = [
    ido_account.ido_name.as_ref().trim_ascii_whitespace(),
    constants::WHITELIST_PDA_SEED.as_ref(),
    ],
    bump,
    )]
    pub whitelist_account: Box<Account<'info, WhitelistAccount>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FreezeProgram<'info> {
    pub initializer: Signer<'info>,

    #[account(
    mut,
    seeds = [
    ido_account.ido_name.as_ref().trim_ascii_whitespace()
    ],
    constraint = ido_account.ido_authority == * initializer.key,
    bump = ido_account.nonce,
    )]
    pub ido_account: Account<'info, IdoAccount>,
}

#[derive(Accounts)]
pub struct InitUserDeposit<'info> {
    // User Accounts
    #[account(mut)]
    pub user_authority: Signer<'info>,

    #[account(
    init,
    payer = user_authority,
    seeds = [
    user_authority.key().as_ref(),
    ido_account.ido_name.as_ref().trim_ascii_whitespace(),&[ido_account.token_type],
    constants::USER_DEPOSIT_PDA_SEED.as_ref(),
    ],
    bump,
    space = UserDeposit::LEN + 8
    )]
    pub user_deposit: Box<Account<'info, UserDeposit>>,

    // IDO Accounts
    #[account(
    seeds = [ido_account.ido_name.as_ref().trim_ascii_whitespace(),&[ido_account.token_type],],
    bump = ido_account.nonce
    )]
    pub ido_account: Box<Account<'info, IdoAccount>>,

    // Programs and Sysvars
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitUserAllocation<'info> {
    // User Accounts
    #[account(mut)]
    pub user_authority: Signer<'info>,

    #[account(
    init,
    payer = user_authority,
    seeds = [
    user_authority.key().as_ref(),
    ido_account.ido_name.as_ref().trim_ascii_whitespace(),
    constants::USER_DEPOSIT_PDA_SEED.as_ref(),
    ],
    bump,
    space = UserAllocation::LEN + 8
    )]
    pub user_allocation: Box<Account<'info, UserAllocation>>,

    // IDO Accounts
    #[account(
    seeds = [ido_account.ido_name.as_ref().trim_ascii_whitespace(),&[ido_account.token_type],],
    bump = ido_account.nonce
    )]
    pub ido_account: Box<Account<'info, IdoAccount>>,
    // Programs and Sysvars
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    // User Accounts
    #[account(mut)]
    pub user_authority: Signer<'info>,
    // IDO Accounts
    #[account(
    mut,
    seeds = [
    ido_account.ido_name.as_ref().trim_ascii_whitespace(),&[ido_account.token_type],
    ],
    bump = ido_account.nonce,
    has_one = token_mint,
    has_one = service_vault
    )]
    pub ido_account: Box<Account<'info, IdoAccount>>,
    pub token_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub service_vault: UncheckedAccount<'info>,

    #[account(
    mut,
    seeds = [
    user_authority.key().as_ref(),
    ido_account.ido_name.as_ref().trim_ascii_whitespace(),&[ido_account.token_type],
    constants::USER_DEPOSIT_PDA_SEED.as_ref(),
    ],
    bump,
    constraint = user_deposit.authority == user_authority.key(),
    )]
    pub user_deposit: Box<Account<'info, UserDeposit>>,

    #[account(
    mut,
    seeds = [
    user_authority.key().as_ref(),
    ido_account.ido_name.as_ref().trim_ascii_whitespace(),
    constants::USER_DEPOSIT_PDA_SEED.as_ref(),
    ],
    bump,
    )]
    pub user_allocation: Box<Account<'info, UserAllocation>>,

    #[account(mut)]
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub user_token_wallet: UncheckedAccount<'info>,

    #[account(
    seeds = [
    ido_account.ido_name.as_ref().trim_ascii_whitespace(),
    constants::WHITELIST_PDA_SEED.as_ref(),
    ],
    bump,
    )]
    pub whitelist_account: Box<Account<'info, WhitelistAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct IdoAccount {
    pub ido_name: [u8; 10],
    //Setting an arbitrary max of ten characters in the ido name. // 10
    pub token_type: u8,
    // 1
    pub ido_authority: Pubkey,
    // 32
    pub token_mint: Pubkey,
    // 32
    pub service_vault: Pubkey,
    // 32
    pub total_amount: u64,
    // 1
    pub check_whitelist: bool,
    // 8
    pub freeze_program: bool,
    // 1
    pub nonce: u8, // 1
}

impl IdoAccount {
    pub const LEN: usize = 10 + 1 + 32 + 32 + 32 + 8 + 1 + 1 + 1;
}

#[account]
pub struct WhitelistAccount {
    pub root: [u8; 32],
}

impl WhitelistAccount {
    pub const LEN: usize = 32;
}

#[account]
pub struct UserDeposit {
    pub authority: Pubkey,
    // 32
    pub amount: u64,
    // 8
    pub started_at: u64,
    //8
    pub updated_at: u64, //8
}

impl UserDeposit {
    pub const LEN: usize = 32 + 8 + 8 + 8;
}

#[account]
pub struct UserAllocation {
    pub allocation_amount: u64,
    // 8
}

impl UserAllocation {
    pub const LEN: usize = 8;
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid action, E5000")]
    PermissionError,
    #[msg("Given nonce is invalid, E1000")]
    InvalidNonce,
    #[msg("IDO has not started, E1001")]
    IDONotStarted,
    #[msg("IDO has ended, E1002")]
    IDOEnded,
    #[msg("IDO has not finished yet, E1003")]
    IDOStarted,
    #[msg("Insufficient USDC, E1004")]
    LowUsdc,
    #[msg("Invalid proof")]
    InvalidProof,
    #[msg("Invalid amount")]
    InvalidAmount,
}

// Access control modifiers
// Asserts the IDO is still accepting deposits.
fn unrestricted_phase(ido_account: &IdoAccount) -> Result<()> {
    if ido_account.freeze_program {
        return err!(ErrorCode::IDONotStarted);
    }
    Ok(())
}

/// Trait to allow trimming ascii whitespace from a &[u8].
pub trait TrimAsciiWhitespace {
    /// Trim ascii whitespace (based on `is_ascii_whitespace()`) from the
    /// start and end of a slice.
    fn trim_ascii_whitespace(&self) -> &[u8];
}

impl<T: Deref<Target=[u8]>> TrimAsciiWhitespace for T {
    fn trim_ascii_whitespace(&self) -> &[u8] {
        let from = match self.iter().position(|x| !x.is_ascii_whitespace()) {
            Some(i) => i,
            None => return &self[0..0],
        };
        let to = self.iter().rposition(|x| !x.is_ascii_whitespace()).unwrap();
        &self[from..=to]
    }
}
