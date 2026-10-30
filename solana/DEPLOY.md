# Deploying the program to devnet

The lobby instructions live in the same program as the launchpad (`programs/community-coin`). This environment has
no Solana toolchain and no access to devnet, so the program has not been deployed from here; these are the steps.

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"     # solana CLI + cargo-build-sbf
cargo install --git https://github.com/coral-xyz/anchor --tag v0.31.1 anchor-cli
solana config set --url devnet
solana-keygen new -o ~/.config/solana/id.json                     # the deployer
solana airdrop 5
solana-keygen new -o target/deploy/community_coin-keypair.json    # the program's address
```

1. Put the new program address in `declare_id!` (`programs/community-coin/src/lib.rs`), in `PROGRAM_ID` of
   `web/src/solana.js` and `web/lobbies/src/chain/wire.js`, then rebuild and rerun every check (the addresses of the
   cross-checks move with it).
2. `anchor build && anchor deploy --provider.cluster devnet`.
3. Initialize the hub once (`initialize`: opening window, vesting, spike share, union window, protocol fee and its
   recipient), as `web/e2e-wallet.mjs` does against its mock cluster.
4. Create a lobby: `create_lobby(id, opens_at, 1800, 3300, 3600, max_pledge, bond)`.
5. Run the indexer: `npm run index:lobbies -- --rpc https://api.devnet.solana.com --program <address> --lobby <id>`.
6. Crank at 00:55 and 01:00: `finalize` (all ideas), `launch_winner`, then `refund`, `claim_founder` and
   `return_bond` for everyone. Each is permissionless; a small cron or the indexer can send them.
