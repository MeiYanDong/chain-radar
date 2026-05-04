# Auto-Sell Postmortem: VOLTS Success Pattern and ORCL/CORL Failure Boundary

Date: 2026-05-05
Timezone: Asia/Shanghai

## Evidence Boundary

This document separates confirmed evidence from current inference.

Confirmed from current repo and AWS runtime:

- The AWS Singapore sentinel is running as `virtuals-buyback-sentinel.service`.
- Current AWS database tables `auto_sell_executions` and `buyback_events` exist but are empty on the new AWS host.
- Current AWS journal contains live `BuybackMonitor` scans and `SelectionMonitor` rankings, but no historical VOLTS sell execution record and no ORCL/CORL execution failure record.
- Existing project documentation records the general auto-sell strategy, the NOVA direct-sell / buyback-triggered sell tests, and the later fast-path optimizations.

Not confirmed from current logs:

- A named historical VOLTS sell transaction hash.
- A named historical ORCL/CORL failed sell transaction hash.
- A database execution row for either event.

Name note:

- Project docs contain `ORCL` / `OracleWars`.
- No local repo reference to `CORL` was found. Treat `CORL` as likely shorthand or typo for `ORCL` until a tx/log proves otherwise.

## VOLTS: Successful Sell Pattern to Preserve

The VOLTS playbook is not just "sell after buyback". The durable pattern is:

1. Detect the buyback before waiting for slow UI/state updates.
   - Official path: watch the known buyback executor address.
   - Black-swan fallback: detect same-transaction VIRTUAL spend strictly greater than `3000 VIRTUAL` into a whitelisted Agent token.

2. Keep the token on the fast path before the trigger.
   - Token is in the preapproved token list.
   - Token decimals and symbol are locally configured.
   - Approval is already granted to the correct spender, so trigger-time execution does not need `symbol()`, `decimals()`, `allowance()`, or first-time `approve`.

3. Submit the sell with minimal trigger-time work.
   - Use the known market contract sell entrypoint.
   - Use the correct approval spender, which may differ from the market contract.
   - Use fixed gas where already tested.
   - Prefer multi-RPC or protected/preconf broadcast when configured.

4. Avoid unsafe `amountOutMin=0`.
   - Current intended production path is reference-based minimum output:
     `AUTO_SELL_MIN_OUT_MODE=reference`
   - Reference price comes from the trigger buy itself: token amount received and VIRTUAL spent.
   - Slippage is applied from that reference price.

5. Treat OKX Wallet limit order as backup, not primary proof.
   - Pre-placed OKX limit orders can cover UI/wallet fallback.
   - The bot must still be able to detect and submit independently, otherwise it cannot beat a crowded limit-order herd.

## ORCL/CORL: Failure Cause, What Is Confirmed vs Inferred

Confirmed root causes from the earlier direct-sell test history:

- The sell transaction entrypoint is the market contract.
- The ERC20 allowance spender is the platform authorization/spender address.
- These two addresses cannot be assumed to be the same.
- A fixed gas limit of `260000` was too low for the tested sell path; it was raised to `350000`.

Likely ORCL/CORL failure class, pending historical tx/log recovery:

- If ORCL/CORL failed like the earlier failed direct-sell tests, the most likely causes are:
  - allowance was granted to the wrong spender,
  - approval was missing and the trigger had to do approve + sell,
  - gas limit was too low,
  - trigger-time quote/min-out or RPC calls added delay/failure,
  - RPC timeout or public broadcast path was too weak.

What should not be claimed yet:

- Do not claim a specific ORCL/CORL failure cause unless the original failed tx hash or server log is recovered.
- Do not claim the AWS host has historical proof; the new AWS DB is empty for auto-sell executions.

## Current Strategy Status

Current code supports the lessons above:

- `auto_sell_executions` audit table for future trigger records.
- Per-token pending sell lock to prevent duplicate conflicting sells.
- Single-wallet nonce queue for burst events.
- Preapproved token metadata/allowance fast path.
- Strict `> 3000 VIRTUAL` large-buy fallback.
- Multi-RPC signed broadcast mode.
- Reference-based `amountOutMin`.
- Dynamic fee mode and protected/Flashblocks broadcast controls.
- Health checks that report disabled live trading, missing private key, min-out mode, fee mode, protected RPC, OKX backup, and fallback state.

Current AWS deployment is intentionally safe monitor mode:

- `AUTO_SELL_ENABLED=0`
- `AUTO_SELL_DRY_RUN=1`
- No private key was transferred to the AWS host.

## Follow-Up Needed

1. Recover old production logs or tx hashes for VOLTS and ORCL/CORL if exact postmortem is required.
2. Backfill a named case section once the tx hashes are known:
   - trigger tx
   - detected block/time
   - sell tx or failed tx
   - detected-to-submit ms
   - receipt/revert reason
   - final delta versus OKX/manual sell path
3. Keep this document in GitHub because it preserves the risk boundary and prevents future agents from repeating wrong-spender / wrong-gas assumptions.

## GitHub Sync Recommendation

Sync to GitHub:

- Source code for auto-sell logic.
- Test files and simulations.
- SSM operation scripts.
- This postmortem and cloud-stability ledger.

Do not sync:

- `.env`
- wallet private keys
- RPC secrets
- raw SQLite runtime databases
- raw logs containing private endpoints or operational secrets
