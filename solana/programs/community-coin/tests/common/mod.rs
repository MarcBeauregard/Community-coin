//! Test harness: the program runs natively inside the Solana runtime (solana-program-test), next to the real
//! Token-2022 and associated-token programs. `Hub` wraps the instructions so tests read like the Solidity suite.
#![allow(dead_code)]

use anchor_lang::prelude::Pubkey;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_2022::spl_token_2022::extension::StateWithExtensions;
use community_coin::state::{Commitment, Config, Idea, Lobby, Lock, Meme, Pledge, Union};
use solana_program_test::{processor, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    program_stubs,
    clock::Clock,
    instruction::{AccountMeta, Instruction},
    native_token::LAMPORTS_PER_SOL,
    signature::Keypair,
    signer::Signer,
    system_program,
    transaction::Transaction,
};

pub const SOL: u64 = LAMPORTS_PER_SOL;
pub const TOKEN: u64 = 1_000_000;
pub const OPEN: i64 = 300;
pub const VOTE: i64 = 3 * 24 * 3600;
pub const SPIKE: u16 = 5000;
pub const PROTOCOL: u16 = 20;
pub const T0: i64 = 1_800_000_000;
/// What the runtime charges the signer of a transaction (one signature).
pub const TX_FEE: u64 = 5_000;

fn entry(program_id: &Pubkey, accounts: &[anchor_lang::prelude::AccountInfo], data: &[u8]) -> anchor_lang::solana_program::entrypoint::ProgramResult {
    let accounts = Box::leak(Box::new(accounts.to_vec()));
    community_coin::entry(program_id, accounts, data)
}

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &community_coin::ID).0
}
pub fn config_pda() -> Pubkey {
    pda(&[b"config"])
}
pub fn authority_pda() -> Pubkey {
    pda(&[b"authority"])
}
pub fn vault_pda() -> Pubkey {
    pda(&[b"vault"])
}
pub fn mint_of(symbol: &str) -> Pubkey {
    pda(&[b"mint", &community_coin::math::symbol_key(symbol).unwrap()])
}
pub fn meme_pda(mint: &Pubkey) -> Pubkey {
    pda(&[b"meme", mint.as_ref()])
}
pub fn commit_pda(mint: &Pubkey, user: &Pubkey) -> Pubkey {
    pda(&[b"commit", mint.as_ref(), user.as_ref()])
}
pub fn union_pda(id: u64) -> Pubkey {
    pda(&[b"union", &id.to_le_bytes()])
}
pub fn lock_pda(id: u64, user: &Pubkey) -> Pubkey {
    pda(&[b"lock", &id.to_le_bytes(), user.as_ref()])
}
pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    spl_associated_token_account_client::address::get_associated_token_address_with_program_id(owner, mint, &spl_token_2022::ID)
}

pub struct Params {
    pub open: i64,
    pub vest: i64,
    pub spike: u16,
    pub vote: i64,
    pub protocol: u16,
}

impl Default for Params {
    fn default() -> Self {
        Params { open: OPEN, vest: 0, spike: SPIKE, vote: VOTE, protocol: PROTOCOL }
    }
}

pub struct Hub {
    pub ctx: ProgramTestContext,
    pub users: Vec<Keypair>,
    pub treasury: Keypair,
    pub now: i64,
    /// Every transaction sent, with its instructions and the program's logs, for the wire format cross-check.
    pub sent: Vec<Sent>,
}

pub struct Sent {
    pub instructions: Vec<Instruction>,
    pub logs: Vec<String>,
    /// The events the program emitted (each as its 8-byte discriminator and Borsh fields), when tapped.
    pub events: Vec<Vec<u8>>,
}

/// Event data emitted since the last transaction. Natively, solana-program-test prints `sol_log_data` to stdout
/// instead of logging "Program data: …" as a validator does; `tap_events` routes it here instead.
static EVENT_DATA: std::sync::Mutex<Vec<Vec<u8>>> = std::sync::Mutex::new(Vec::new());

struct EventTap(Box<dyn program_stubs::SyscallStubs>);

impl program_stubs::SyscallStubs for EventTap {
    fn sol_log(&self, message: &str) {
        self.0.sol_log(message)
    }
    fn sol_log_compute_units(&self) {
        self.0.sol_log_compute_units()
    }
    fn sol_remaining_compute_units(&self) -> u64 {
        self.0.sol_remaining_compute_units()
    }
    fn sol_invoke_signed(&self, instruction: &Instruction, account_infos: &[anchor_lang::prelude::AccountInfo], signers_seeds: &[&[&[u8]]]) -> anchor_lang::solana_program::entrypoint::ProgramResult {
        self.0.sol_invoke_signed(instruction, account_infos, signers_seeds)
    }
    fn sol_get_sysvar(&self, id: *const u8, var: *mut u8, offset: u64, length: u64) -> u64 {
        self.0.sol_get_sysvar(id, var, offset, length)
    }
    fn sol_get_clock_sysvar(&self, var: *mut u8) -> u64 {
        self.0.sol_get_clock_sysvar(var)
    }
    fn sol_get_epoch_schedule_sysvar(&self, var: *mut u8) -> u64 {
        self.0.sol_get_epoch_schedule_sysvar(var)
    }
    fn sol_get_fees_sysvar(&self, var: *mut u8) -> u64 {
        self.0.sol_get_fees_sysvar(var)
    }
    fn sol_get_rent_sysvar(&self, var: *mut u8) -> u64 {
        self.0.sol_get_rent_sysvar(var)
    }
    fn sol_get_epoch_rewards_sysvar(&self, var: *mut u8) -> u64 {
        self.0.sol_get_epoch_rewards_sysvar(var)
    }
    fn sol_get_last_restart_slot(&self, var: *mut u8) -> u64 {
        self.0.sol_get_last_restart_slot(var)
    }
    fn sol_get_epoch_stake(&self, vote: *const u8) -> u64 {
        self.0.sol_get_epoch_stake(vote)
    }
    unsafe fn sol_memcpy(&self, dst: *mut u8, src: *const u8, n: usize) {
        self.0.sol_memcpy(dst, src, n)
    }
    unsafe fn sol_memmove(&self, dst: *mut u8, src: *const u8, n: usize) {
        self.0.sol_memmove(dst, src, n)
    }
    unsafe fn sol_memcmp(&self, s1: *const u8, s2: *const u8, n: usize, result: *mut i32) {
        self.0.sol_memcmp(s1, s2, n, result)
    }
    unsafe fn sol_memset(&self, s: *mut u8, c: u8, n: usize) {
        self.0.sol_memset(s, c, n)
    }
    fn sol_get_return_data(&self) -> Option<(Pubkey, Vec<u8>)> {
        self.0.sol_get_return_data()
    }
    fn sol_set_return_data(&self, data: &[u8]) {
        self.0.sol_set_return_data(data)
    }
    fn sol_log_data(&self, fields: &[&[u8]]) {
        EVENT_DATA.lock().unwrap().push(fields.concat());
    }
    fn sol_get_processed_sibling_instruction(&self, index: usize) -> Option<Instruction> {
        self.0.sol_get_processed_sibling_instruction(index)
    }
    fn sol_get_stack_height(&self) -> u64 {
        self.0.sol_get_stack_height()
    }
}

/// Records the events of every later transaction in `Sent::events`. Call once a hub has started (solana-program-test
/// installs its own stubs then), and only from a test binary whose tests run one at a time.
pub fn tap_events() {
    struct Placeholder;
    impl program_stubs::SyscallStubs for Placeholder {}
    let inner = program_stubs::set_syscall_stubs(Box::new(Placeholder));
    program_stubs::set_syscall_stubs(Box::new(EventTap(inner)));
}

pub fn program() -> ProgramTest {
    let mut pt = ProgramTest::new("community_coin", community_coin::ID, processor!(entry));
    pt.prefer_bpf(false);
    pt
}

impl Hub {
    pub async fn start(params: Params, users: usize) -> Hub {
        let mut hub = Hub::bare(users).await;
        let to = hub.treasury.pubkey();
        hub.initialize(&params, to).await.unwrap();
        hub
    }

    /// A chain with the program and funded users, the hub not initialized yet.
    pub async fn bare(users: usize) -> Hub {
        let mut pt = program();
        let users: Vec<Keypair> = (0..users).map(|_| Keypair::new()).collect();
        let treasury = Keypair::new();
        for u in users.iter().chain(std::iter::once(&treasury)) {
            pt.add_account(u.pubkey(), Account { lamports: 10_000 * SOL, owner: system_program::ID, ..Account::default() });
        }
        let ctx = pt.start_with_context().await;
        let mut hub = Hub { ctx, users, treasury, now: T0, sent: vec![] };
        hub.set_time(T0).await;
        hub
    }

    pub async fn set_time(&mut self, t: i64) {
        let mut clock: Clock = self.ctx.banks_client.get_sysvar().await.unwrap();
        clock.unix_timestamp = t;
        self.ctx.set_sysvar(&clock);
        self.now = t;
    }

    pub async fn warp(&mut self, seconds: i64) {
        let t = self.now + seconds;
        self.set_time(t).await;
    }

    pub fn user(&self, i: usize) -> &Keypair {
        &self.users[i]
    }

    pub async fn send(&mut self, ixs: Vec<Instruction>, signer: &Keypair) -> Result<(), BanksClientError> {
        let hash = self.ctx.banks_client.get_latest_blockhash().await.unwrap();
        let payer = Keypair::from_bytes(&signer.to_bytes()).unwrap();
        let tx = Transaction::new_signed_with_payer(&ixs, Some(&payer.pubkey()), &[&payer], hash);
        let r = self.ctx.banks_client.process_transaction_with_metadata(tx).await.unwrap();
        // Every transaction gets a fresh blockhash so identical retries are not deduplicated.
        let _ = self.ctx.get_new_latest_blockhash().await;
        let events = std::mem::take(&mut *EVENT_DATA.lock().unwrap());
        self.sent.push(Sent { instructions: ixs, logs: r.metadata.map(|m| m.log_messages).unwrap_or_default(), events });
        r.result.map_err(BanksClientError::TransactionError)
    }

    pub async fn send_as(&mut self, i: usize, ixs: Vec<Instruction>) -> Result<(), BanksClientError> {
        let kp = Keypair::from_bytes(&self.users[i].to_bytes()).unwrap();
        self.send(ixs, &kp).await
    }

    pub async fn initialize(&mut self, p: &Params, recipient: Pubkey) -> Result<(), BanksClientError> {
        let ix = Instruction {
            program_id: community_coin::ID,
            accounts: community_coin::accounts::Initialize {
                payer: self.treasury.pubkey(),
                config: config_pda(),
                authority: authority_pda(),
                vault: vault_pda(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: community_coin::instruction::Initialize {
                open_window: p.open,
                vest_window: p.vest,
                spike_share_bps: p.spike,
                union_window: p.vote,
                protocol_fee_bps: p.protocol,
                fee_recipient: recipient,
            }
            .data(),
        };
        let kp = Keypair::from_bytes(&self.treasury.to_bytes()).unwrap();
        self.send(vec![ix], &kp).await
    }

    // ------------------------------------------------------------------ reads

    pub async fn account(&mut self, key: Pubkey) -> Option<Account> {
        self.ctx.banks_client.get_account(key).await.unwrap()
    }

    pub async fn meme(&mut self, mint: &Pubkey) -> Meme {
        let a = self.account(meme_pda(mint)).await.expect("meme account");
        Meme::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub async fn config(&mut self) -> Config {
        let a = self.account(config_pda()).await.unwrap();
        Config::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub async fn commitment(&mut self, mint: &Pubkey, user: &Pubkey) -> Option<Commitment> {
        let a = self.account(commit_pda(mint, user)).await?;
        Some(Commitment::try_deserialize(&mut a.data.as_slice()).unwrap())
    }

    pub async fn union(&mut self, id: u64) -> Union {
        let a = self.account(union_pda(id)).await.unwrap();
        Union::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub async fn lock(&mut self, id: u64, user: &Pubkey) -> Option<Lock> {
        let a = self.account(lock_pda(id, user)).await?;
        Some(Lock::try_deserialize(&mut a.data.as_slice()).unwrap())
    }

    pub async fn balance(&mut self, owner: &Pubkey, mint: &Pubkey) -> u64 {
        match self.account(ata(owner, mint)).await {
            Some(a) => StateWithExtensions::<spl_token_2022::state::Account>::unpack(&a.data).unwrap().base.amount,
            None => 0,
        }
    }

    pub async fn supply(&mut self, mint: &Pubkey) -> u64 {
        let a = self.account(*mint).await.unwrap();
        StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&a.data).unwrap().base.supply
    }

    pub async fn lamports(&mut self, key: &Pubkey) -> u64 {
        self.account(*key).await.map(|a| a.lamports).unwrap_or(0)
    }

    /// The meme's ancestors, root first, as the remaining accounts of a routed instruction.
    pub async fn ancestors(&mut self, mint: &Pubkey) -> Vec<Pubkey> {
        let mut out = vec![];
        let mut p = self.meme(mint).await.parent;
        while p != Pubkey::default() {
            out.insert(0, p);
            p = self.meme(&p).await.parent;
        }
        out
    }

    fn metas(mints: &[Pubkey]) -> Vec<AccountMeta> {
        mints.iter().map(|m| AccountMeta::new(meme_pda(m), false)).collect()
    }

    // ------------------------------------------------------------------ instructions

    pub async fn launch(&mut self, i: usize, symbol: &str, parent: Option<Pubkey>, sol_in: u64) -> Result<Pubkey, BanksClientError> {
        self.launch_named(i, &format!("{symbol} coin"), symbol, parent, sol_in).await
    }

    pub async fn launch_named(&mut self, i: usize, name: &str, symbol: &str, parent: Option<Pubkey>, sol_in: u64) -> Result<Pubkey, BanksClientError> {
        let creator = self.user(i).pubkey();
        let key = community_coin::math::symbol_key(symbol).map(|k| k).unwrap_or_else(|_| symbol.as_bytes().to_vec());
        let mint = pda(&[b"mint", &key]);
        let mut lineage = match parent {
            Some(p) => self.ancestors(&p).await,
            None => vec![],
        };
        if let Some(p) = parent {
            lineage.push(p);
        }
        let mut accounts = community_coin::accounts::Launch {
            creator,
            config: config_pda(),
            authority: authority_pda(),
            vault: vault_pda(),
            mint,
            meme: meme_pda(&mint),
            commitment: commit_pda(&mint, &creator),
            token_program: spl_token_2022::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        accounts.extend(Self::metas(&lineage));
        let ix = Instruction {
            program_id: community_coin::ID,
            accounts,
            data: community_coin::instruction::Launch { key, name: name.to_string(), symbol: symbol.to_string(), uri: String::new(), sol_in }.data(),
        };
        self.send_as(i, vec![ix]).await.map(|_| mint)
    }

    pub async fn commit_sol(&mut self, i: usize, mint: Pubkey, sol_in: u64) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let lineage = self.ancestors(&mint).await;
        let mut accounts = community_coin::accounts::CommitSol {
            user,
            config: config_pda(),
            vault: vault_pda(),
            meme: meme_pda(&mint),
            commitment: commit_pda(&mint, &user),
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        accounts.extend(Self::metas(&lineage));
        let ix = Instruction { program_id: community_coin::ID, accounts, data: community_coin::instruction::CommitSol { sol_in, min_quote: 0 }.data() };
        self.send_as(i, vec![ix]).await
    }

    pub async fn commit_quote(&mut self, i: usize, mint: Pubkey, amount: u64) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let parent = self.meme(&mint).await.parent;
        let (pm, pt) = if parent == Pubkey::default() { (None, None) } else { (Some(parent), Some(ata(&user, &parent))) };
        let accounts = community_coin::accounts::CommitQuote {
            user,
            config: config_pda(),
            vault: vault_pda(),
            meme: meme_pda(&mint),
            commitment: commit_pda(&mint, &user),
            parent_mint: pm,
            user_parent_tokens: pt,
            token_program: spl_token_2022::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        let ix = Instruction { program_id: community_coin::ID, accounts, data: community_coin::instruction::Commit { amount }.data() };
        self.send_as(i, vec![ix]).await
    }

    pub async fn settle(&mut self, i: usize, mint: Pubkey) -> Result<(), BanksClientError> {
        let ix = Instruction {
            program_id: community_coin::ID,
            accounts: community_coin::accounts::Settle { meme: meme_pda(&mint) }.to_account_metas(None),
            data: community_coin::instruction::Settle {}.data(),
        };
        self.send_as(i, vec![ix]).await
    }

    pub async fn claim(&mut self, i: usize, mint: Pubkey) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let ix = Instruction {
            program_id: community_coin::ID,
            accounts: community_coin::accounts::Claim {
                user,
                config: config_pda(),
                authority: authority_pda(),
                meme: meme_pda(&mint),
                mint,
                commitment: commit_pda(&mint, &user),
                user_tokens: ata(&user, &mint),
                token_program: spl_token_2022::ID,
                associated_token_program: spl_associated_token_account_client::program::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: community_coin::instruction::Claim {}.data(),
        };
        self.send_as(i, vec![ix]).await
    }

    fn ensure_ata(payer: &Pubkey, owner: &Pubkey, mint: &Pubkey) -> Instruction {
        spl_associated_token_account_client::instruction::create_associated_token_account_idempotent(payer, owner, mint, &spl_token_2022::ID)
    }

    fn trade_sol_accounts(user: Pubkey, mint: Pubkey) -> Vec<AccountMeta> {
        community_coin::accounts::TradeSol {
            user,
            config: config_pda(),
            authority: authority_pda(),
            vault: vault_pda(),
            meme: meme_pda(&mint),
            mint,
            user_tokens: ata(&user, &mint),
            token_program: spl_token_2022::ID,
            associated_token_program: spl_associated_token_account_client::program::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None)
    }

    pub async fn buy_sol(&mut self, i: usize, mint: Pubkey, sol_in: u64, min_out: u64) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let lineage = self.ancestors(&mint).await;
        let mut accounts = Self::trade_sol_accounts(user, mint);
        accounts.extend(Self::metas(&lineage));
        let ix = Instruction { program_id: community_coin::ID, accounts, data: community_coin::instruction::BuySol { sol_in, min_out }.data() };
        self.send_as(i, vec![ix]).await
    }

    pub async fn sell_to_sol(&mut self, i: usize, mint: Pubkey, amount: u64, min_out: u64) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let lineage = self.ancestors(&mint).await;
        let mut accounts = Self::trade_sol_accounts(user, mint);
        accounts.extend(Self::metas(&lineage));
        let ix = Instruction { program_id: community_coin::ID, accounts, data: community_coin::instruction::SellToSol { amount, min_out }.data() };
        self.send_as(i, vec![ix]).await
    }

    async fn trade_quote(&mut self, i: usize, mint: Pubkey, data: Vec<u8>) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let parent = self.meme(&mint).await.parent;
        let (pm, pt) = if parent == Pubkey::default() { (None, None) } else { (Some(parent), Some(ata(&user, &parent))) };
        let mut ixs = vec![];
        if let Some(p) = pm {
            ixs.push(Self::ensure_ata(&user, &user, &p));
        }
        let accounts = community_coin::accounts::TradeQuote {
            user,
            config: config_pda(),
            authority: authority_pda(),
            vault: vault_pda(),
            meme: meme_pda(&mint),
            mint,
            user_tokens: ata(&user, &mint),
            parent_mint: pm,
            user_parent_tokens: pt,
            token_program: spl_token_2022::ID,
            associated_token_program: spl_associated_token_account_client::program::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        ixs.push(Instruction { program_id: community_coin::ID, accounts, data });
        self.send_as(i, ixs).await
    }

    pub async fn buy(&mut self, i: usize, mint: Pubkey, amount: u64, min_out: u64) -> Result<(), BanksClientError> {
        self.trade_quote(i, mint, community_coin::instruction::Buy { amount, min_out }.data()).await
    }

    pub async fn sell(&mut self, i: usize, mint: Pubkey, amount: u64, min_out: u64) -> Result<(), BanksClientError> {
        self.trade_quote(i, mint, community_coin::instruction::Sell { amount, min_out }.data()).await
    }

    /// `who`: Some(i) for a user, None for the treasury.
    pub async fn claim_fees(&mut self, who: Option<usize>, mint: Pubkey, protocol: bool) -> Result<(), BanksClientError> {
        let kp = match who {
            Some(i) => Keypair::from_bytes(&self.users[i].to_bytes()).unwrap(),
            None => Keypair::from_bytes(&self.treasury.to_bytes()).unwrap(),
        };
        let owner = kp.pubkey();
        let parent = self.meme(&mint).await.parent;
        let (pm, pt) = if parent == Pubkey::default() { (None, None) } else { (Some(parent), Some(ata(&owner, &parent))) };
        let mut ixs = vec![];
        if let Some(p) = pm {
            ixs.push(Self::ensure_ata(&owner, &owner, &p));
        }
        ixs.push(Instruction {
            program_id: community_coin::ID,
            accounts: community_coin::accounts::ClaimFees {
                owner,
                config: config_pda(),
                authority: authority_pda(),
                vault: vault_pda(),
                meme: meme_pda(&mint),
                parent_mint: pm,
                owner_parent_tokens: pt,
                token_program: spl_token_2022::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: community_coin::instruction::ClaimFees { protocol }.data(),
        });
        self.send(ixs, &kp).await
    }

    pub async fn propose_union(&mut self, i: usize, meme: Pubkey, target: Pubkey) -> Result<u64, BanksClientError> {
        let id = self.config().await.union_count;
        let lineage = self.ancestors(&target).await;
        let mut accounts = community_coin::accounts::ProposeUnion {
            proposer: self.user(i).pubkey(),
            config: config_pda(),
            meme: meme_pda(&meme),
            target: meme_pda(&target),
            union: union_pda(id),
            system_program: system_program::ID,
        }
        .to_account_metas(None);
        accounts.extend(lineage.iter().map(|m| AccountMeta::new_readonly(meme_pda(m), false)));
        let ix = Instruction { program_id: community_coin::ID, accounts, data: community_coin::instruction::ProposeUnion {}.data() };
        self.send_as(i, vec![ix]).await.map(|_| id)
    }

    pub async fn lock_union(&mut self, i: usize, id: u64, amount: u64) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let meme = self.union(id).await.meme;
        let ix = Instruction {
            program_id: community_coin::ID,
            accounts: community_coin::accounts::LockUnion {
                user,
                union: union_pda(id),
                meme: meme_pda(&meme),
                mint: meme,
                user_tokens: ata(&user, &meme),
                lock: lock_pda(id, &user),
                token_program: spl_token_2022::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: community_coin::instruction::LockUnion { amount }.data(),
        };
        self.send_as(i, vec![ix]).await
    }

    pub async fn unlock_union(&mut self, i: usize, id: u64) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let meme = self.union(id).await.meme;
        let ix = Instruction {
            program_id: community_coin::ID,
            accounts: community_coin::accounts::UnlockUnion {
                user,
                config: config_pda(),
                authority: authority_pda(),
                union: union_pda(id),
                meme: meme_pda(&meme),
                mint: meme,
                user_tokens: ata(&user, &meme),
                lock: lock_pda(id, &user),
                token_program: spl_token_2022::ID,
                associated_token_program: spl_associated_token_account_client::program::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: community_coin::instruction::UnlockUnion {}.data(),
        };
        self.send_as(i, vec![ix]).await
    }

    pub async fn execute_union(&mut self, i: usize, id: u64) -> Result<(), BanksClientError> {
        let u = self.union(id).await;
        let creator = self.meme(&u.meme).await.creator;
        let lineage = self.ancestors(&u.target).await;
        let mut accounts = community_coin::accounts::ExecuteUnion {
            executor: self.user(i).pubkey(),
            config: config_pda(),
            vault: vault_pda(),
            union: union_pda(id),
            meme: meme_pda(&u.meme),
            mint: u.meme,
            target: meme_pda(&u.target),
            creator,
            fee_recipient: self.treasury.pubkey(),
        }
        .to_account_metas(None);
        accounts.extend(Self::metas(&lineage));
        let ix = Instruction { program_id: community_coin::ID, accounts, data: community_coin::instruction::ExecuteUnion { min_target_in: 0 }.data() };
        self.send_as(i, vec![ix]).await
    }
}

/// The custom error code a failed transaction carries (6000 + its index in CoinError), if any.
pub fn error_code(e: &BanksClientError) -> Option<u32> {
    use solana_sdk::instruction::InstructionError;
    use solana_sdk::transaction::TransactionError;
    match e {
        BanksClientError::TransactionError(TransactionError::InstructionError(_, InstructionError::Custom(c)))
        | BanksClientError::SimulationError { err: TransactionError::InstructionError(_, InstructionError::Custom(c)), .. } => Some(*c),
        _ => None,
    }
}

pub fn code(e: community_coin::errors::CoinError) -> u32 {
    6000 + e as u32
}

// ------------------------------------------------------------------ lobbies

pub fn lobby_pda(id: u64) -> Pubkey {
    pda(&[b"lobby", &id.to_le_bytes()])
}
pub fn ticker_key(symbol: &str) -> Vec<u8> {
    community_coin::math::symbol_key(symbol).unwrap_or_else(|_| symbol.as_bytes().to_vec())
}
pub fn idea_pda(lobby: &Pubkey, symbol: &str) -> Pubkey {
    pda(&[b"idea", lobby.as_ref(), &ticker_key(symbol)])
}
pub fn pledge_pda(lobby: &Pubkey, user: &Pubkey) -> Pubkey {
    pda(&[b"pledge", lobby.as_ref(), user.as_ref()])
}

/// Windows of a test lobby, in seconds after it opens: the hour of the product.
pub const PROPOSE: i64 = 1800;
pub const LOCK: i64 = 3300;
pub const LENGTH: i64 = 3600;
pub const BOND: u64 = SOL / 20;

impl Hub {
    fn ix(accounts: Vec<AccountMeta>, data: Vec<u8>) -> Instruction {
        Instruction { program_id: community_coin::ID, accounts, data }
    }

    pub async fn create_lobby(&mut self, i: usize, id: u64, opens_at: i64, max_pledge: u64, bond: u64) -> Result<(), BanksClientError> {
        let host = self.user(i).pubkey();
        let ix = Self::ix(
            community_coin::accounts::CreateLobby { host, lobby: lobby_pda(id), system_program: system_program::ID }.to_account_metas(None),
            community_coin::instruction::CreateLobby { id, opens_at, propose_secs: PROPOSE, lock_secs: LOCK, length: LENGTH, max_pledge, bond }.data(),
        );
        self.send_as(i, vec![ix]).await
    }

    pub async fn propose(&mut self, i: usize, id: u64, symbol: &str) -> Result<(), BanksClientError> {
        let proposer = self.user(i).pubkey();
        let lobby = lobby_pda(id);
        let key = ticker_key(symbol);
        let ix = Self::ix(
            community_coin::accounts::ProposeIdea { proposer, lobby, idea: idea_pda(&lobby, symbol), mint: pda(&[b"mint", &key]), system_program: system_program::ID }.to_account_metas(None),
            community_coin::instruction::ProposeIdea { key, name: format!("{symbol} coin"), symbol: symbol.to_string(), uri: String::new() }.data(),
        );
        self.send_as(i, vec![ix]).await
    }

    pub async fn pledge(&mut self, i: usize, id: u64, symbol: &str, amount: u64) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let lobby = lobby_pda(id);
        let ix = Self::ix(
            community_coin::accounts::PledgeOn { user, lobby, idea: idea_pda(&lobby, symbol), pledge: pledge_pda(&lobby, &user), system_program: system_program::ID }.to_account_metas(None),
            community_coin::instruction::Pledge { amount }.data(),
        );
        self.send_as(i, vec![ix]).await
    }

    pub async fn withdraw(&mut self, i: usize, id: u64, symbol: &str, amount: u64) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let lobby = lobby_pda(id);
        let ix = Self::ix(
            community_coin::accounts::Withdraw { user, lobby, idea: idea_pda(&lobby, symbol), pledge: pledge_pda(&lobby, &user) }.to_account_metas(None),
            community_coin::instruction::Withdraw { amount }.data(),
        );
        self.send_as(i, vec![ix]).await
    }

    pub async fn move_pledge(&mut self, i: usize, id: u64, from: &str, to: &str) -> Result<(), BanksClientError> {
        let user = self.user(i).pubkey();
        let lobby = lobby_pda(id);
        let ix = Self::ix(
            community_coin::accounts::MovePledge { user, lobby, from: idea_pda(&lobby, from), to: idea_pda(&lobby, to), pledge: pledge_pda(&lobby, &user) }.to_account_metas(None),
            community_coin::instruction::MovePledge {}.data(),
        );
        self.send_as(i, vec![ix]).await
    }

    /// Anyone (user `i`) finalizes; `symbols` are the ideas passed, normally all of them.
    pub async fn finalize(&mut self, i: usize, id: u64, symbols: &[&str]) -> Result<(), BanksClientError> {
        let lobby = lobby_pda(id);
        let mut accounts = community_coin::accounts::Finalize { lobby }.to_account_metas(None);
        accounts.extend(symbols.iter().map(|s| AccountMeta::new_readonly(idea_pda(&lobby, s), false)));
        let ix = Self::ix(accounts, community_coin::instruction::Finalize {}.data());
        self.send_as(i, vec![ix]).await
    }

    pub async fn launch_winner(&mut self, i: usize, id: u64, symbol: &str) -> Result<Pubkey, BanksClientError> {
        let payer = self.user(i).pubkey();
        let lobby = lobby_pda(id);
        let mint = pda(&[b"mint", &ticker_key(symbol)]);
        let ix = Self::ix(
            community_coin::accounts::LaunchWinner {
                payer,
                config: config_pda(),
                authority: authority_pda(),
                vault: vault_pda(),
                lobby,
                idea: idea_pda(&lobby, symbol),
                mint,
                meme: meme_pda(&mint),
                token_program: spl_token_2022::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            community_coin::instruction::LaunchWinner {}.data(),
        );
        self.send_as(i, vec![ix]).await.map(|_| mint)
    }

    pub async fn void_winner(&mut self, i: usize, id: u64, symbol: &str) -> Result<(), BanksClientError> {
        let lobby = lobby_pda(id);
        let ix = Self::ix(
            community_coin::accounts::VoidWinner { lobby, idea: idea_pda(&lobby, symbol), mint: pda(&[b"mint", &ticker_key(symbol)]) }.to_account_metas(None),
            community_coin::instruction::VoidWinner {}.data(),
        );
        self.send_as(i, vec![ix]).await
    }

    /// User `i` sends the refund of user `of`'s pledge.
    pub async fn refund(&mut self, i: usize, id: u64, of: usize) -> Result<(), BanksClientError> {
        let user = self.user(of).pubkey();
        let lobby = lobby_pda(id);
        let ix = Self::ix(
            community_coin::accounts::Refund { lobby, pledge: pledge_pda(&lobby, &user), user }.to_account_metas(None),
            community_coin::instruction::Refund {}.data(),
        );
        self.send_as(i, vec![ix]).await
    }

    /// User `i` turns user `of`'s winning pledge into their commitment.
    pub async fn claim_founder(&mut self, i: usize, id: u64, of: usize) -> Result<(), BanksClientError> {
        let payer = self.user(i).pubkey();
        let user = self.user(of).pubkey();
        let lobby = lobby_pda(id);
        let mint = self.lobby(id).await.mint;
        let ix = Self::ix(
            community_coin::accounts::ClaimFounder { payer, lobby, pledge: pledge_pda(&lobby, &user), commitment: commit_pda(&mint, &user), system_program: system_program::ID }.to_account_metas(None),
            community_coin::instruction::ClaimFounder {}.data(),
        );
        self.send_as(i, vec![ix]).await
    }

    pub async fn return_bond(&mut self, i: usize, id: u64, symbol: &str) -> Result<(), BanksClientError> {
        let lobby = lobby_pda(id);
        let proposer = self.idea(id, symbol).await.proposer;
        let ix = Self::ix(
            community_coin::accounts::ReturnBond { lobby, idea: idea_pda(&lobby, symbol), proposer }.to_account_metas(None),
            community_coin::instruction::ReturnBond {}.data(),
        );
        self.send_as(i, vec![ix]).await
    }

    pub async fn lobby(&mut self, id: u64) -> Lobby {
        let a = self.account(lobby_pda(id)).await.expect("lobby account");
        Lobby::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub async fn idea(&mut self, id: u64, symbol: &str) -> Idea {
        let a = self.account(idea_pda(&lobby_pda(id), symbol)).await.expect("idea account");
        Idea::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub async fn pledge_of(&mut self, id: u64, i: usize) -> Option<Pledge> {
        let user = self.user(i).pubkey();
        let a = self.account(pledge_pda(&lobby_pda(id), &user)).await?;
        Some(Pledge::try_deserialize(&mut a.data.as_slice()).unwrap())
    }

    /// Lamports above the lobby account's rent: what it holds for pledgers and proposers.
    pub async fn lobby_balance(&mut self, id: u64) -> u64 {
        let a = self.account(lobby_pda(id)).await.unwrap();
        let rent = self.ctx.banks_client.get_rent().await.unwrap().minimum_balance(a.data.len());
        a.lamports - rent
    }
}
