# Lobbies: legal copy (draft for counsel)

This is the plain-language copy the app shows (the "Risks and terms" sheet, the pledge sheet's line, the footer). It
is a draft written for clarity, not legal advice: a lawyer in each launch market must review it, and decide on the
points below, before real money goes through the lobbies.

## Shown in the app

- Pledge sheet: "Memecoins are speculative and can lose all their value. This is not an investment or advice."
  with a link to Risks and terms; before signing it also says what happens if the idea wins, if it loses, how to
  change one's mind, and the network fee.
- Discover footer and the wallet: the same line and link.
- Risks and terms (`src/screens/sheets.js`, `TermsSheet`): what a pledge is; withdrawals until 00:55; automatic
  refunds at the lock; the winner's single price and its vesting (25% at once, the rest over 3 days); risks
  (speculative, can go to zero, illiquidity, smart-contract bugs, not advice); fees (network fee, 0.05 SOL bond
  returned at the lock, the launchpad's trading fees); eligibility (legal age, not where prohibited, own taxes);
  clans and voice (founders only, moderation, no illegal or hateful content, no doxxing, voice not recorded);
  data (wallet and pledges public on Solana, clan content kept for the clan, deletes erased, no sale of data).

## For counsel to decide

1. Whether a pledge pool that buys a token's opening batch is a regulated activity in each market (securities,
   commodities, gambling, money transmission), and the resulting geofencing and age checks.
2. KYC/AML thresholds, if any, for pledges and for the launchpad's trading.
3. Full Terms of Service and Privacy Policy (the sheet is a summary, not a contract): governing law, liability,
   dispute resolution, content licence for clan media, takedown and law-enforcement requests, data retention.
4. The wording of risk warnings required by local rules (e.g. crypto-asset promotions).
5. Hosts: they earn nothing today; any future reward changes their status.
