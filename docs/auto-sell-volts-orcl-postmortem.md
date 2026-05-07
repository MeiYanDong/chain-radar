# Auto-Sell Postmortem: VOLTS Success Pattern and ORCL/CORL Failure Boundary

Date: 2026-05-05
Timezone: Asia/Shanghai

## Evidence Boundary

This document separates confirmed evidence from current inference.

Confirmed from current repo, AWS runtime history, and the old Alibaba production host:

- The AWS Singapore sentinel runs as `virtuals-buyback-sentinel.service` when active.
- As of 2026-05-07, the competition work is paused: the AWS service is stopped and disabled, and the Alibaba PM2 monitor is stopped.
- Current AWS database tables `auto_sell_executions` and `buyback_events` exist but are empty on the new AWS host.
- Current AWS journal contains live `BuybackMonitor` scans and `SelectionMonitor` rankings, but no historical VOLTS sell execution record and no ORCL/CORL execution failure record.
- The old Alibaba SWAS production host at `/opt/chain-radar` contains the historical records in `data/chain-radar.db` and `/root/.pm2/logs/chain-radar-pot-monitor-out.log`.
- Existing project documentation records the general auto-sell strategy, the NOVA direct-sell / buyback-triggered sell tests, and the later fast-path optimizations.

Confirmed Alibaba evidence:

- VOLTS auto-sell was submitted from the Flashblocks trigger path in 475ms, used the preapproved fast path with no approve transaction, and the sell receipt status was `0x1`.
- ORCL auto-sell was submitted from the Flashblocks trigger path in 516ms, also used the preapproved fast path with no approve transaction, but the sell receipt status was `0x0`.
- The old execution table recorded both as `status=sent` and left `sell_receipt_status` empty. That means the old system proved submission, but did not close the loop on chain receipt success/failure.

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

6. Treat OKX API as roadmap option 2, not the current primary path.
   - The current mainline remains the self-owned direct sell execution path.
   - OKX API can be evaluated later as a secondary executor or route source, especially for unknown market/spender paths.
   - OKX API must not bypass strict trigger tests, preapproval checks, receipt-status checks, or direct-sell fallback.

## ORCL/CORL: Failure Cause, What Is Confirmed vs Inferred

Confirmed root causes and boundaries:

- The sell transaction entrypoint is the market contract.
- The ERC20 allowance spender is the platform authorization/spender address.
- These two addresses cannot be assumed to be the same.
- A fixed gas limit of `260000` was too low for the tested sell path; it was raised to `350000`.
- ORCL did not fail because the bot missed the trigger: it detected and submitted in about 516ms.
- ORCL did not fail because it needed trigger-time approval: the execution row has no approve transaction and used the preapproved spender.
- ORCL failed after submission: the chain receipt for the sell transaction is `0x0`.
- The old system did not automatically mark that receipt failure, because it saved `status=sent` immediately after broadcast and did not later update `sell_receipt_status`.

Likely ORCL failure class:

- The ORCL sell was sent to the market address captured from the ORCL buyback trigger, while VOLTS was sent to the known working market address.
- The current code defaults to the configured canonical market address unless `AUTO_SELL_USE_TRIGGER_MARKET_ADDRESS=1`.
- Historical-state simulation could not be completed on the current Chainstack plan because archive/debug/trace requests are unavailable, so the exact EVM revert branch is still not decoded.

What should not be claimed yet:

- Do not claim ORCL is fully proven fixed until a future ORCL sell receipt succeeds, or an archive/debug trace proves the old failure branch and a targeted simulation passes.
- Do not use the new AWS DB as historical proof; the evidence is on the old Alibaba host.

## Current Strategy Status

Current code supports the lessons above:

- `auto_sell_executions` audit table for future trigger records.
- Receipt follow-up now updates `sell_receipt_status`; reverted sell receipts are marked failed and trigger an urgent alert.
- Per-token pending sell lock to prevent duplicate conflicting sells.
- Single-wallet nonce queue for burst events.
- Preapproved token metadata/allowance fast path.
- Strict `> 3000 VIRTUAL` large-buy fallback.
- Multi-RPC signed broadcast mode.
- Reference-based `amountOutMin`.
- Dynamic fee mode and protected/Flashblocks broadcast controls.
- Health checks that report disabled live trading, missing private key, min-out mode, fee mode, protected RPC, OKX backup, and fallback state.

Paused runtime status:

- AWS was live-configured and readiness-checked before the pause: `AUTO_SELL_ENABLED=1`, `AUTO_SELL_DRY_RUN=0`, Chainstack-first RPC profile, and two broadcast endpoints in the multi-RPC/Flashblocks submit path.
- As of 2026-05-07, the AWS systemd service is stopped and disabled; the EC2 instance remains running to preserve SSM access.
- The Alibaba PM2 monitor is stopped and saved as stopped.

## Roadmap: OKX API as Secondary Executor

Do not replace the direct sell path with OKX API first. The roadmap order is:

1. Keep direct sell as the primary fast path.
   - Preserve strict `> 3000 VIRTUAL` fallback.
   - Preserve receipt follow-up and urgent alerting on reverted sells.
   - Preserve preapproved metadata/allowance and multi-RPC broadcast.

2. Add OKX API in dry-run / quote-only mode.
   - Compare OKX route output with the direct reference-based `amountOutMin`.
   - Record OKX router/spender, estimated output, price impact, gas hints, and API latency.
   - Do not submit through OKX in this phase.

3. Add OKX preapproval and small-sell verification.
   - Use OKX approve data only after verifying the returned spender.
   - Run small real sells on test-held tokens before enabling for buyback windows.
   - Store receipt status exactly like direct sells.

4. Promote OKX to secondary live executor only after proof.
   - OKX may be useful when direct sell route or market address is uncertain.
   - If OKX quote/API fails, the direct sell path must remain available.
   - If both are available, token-level policy should decide which path is primary.

## Follow-Up Needed

1. While paused, improve the direct sell path locally and keep tests green.
2. If exact ORCL revert decoding is still required, use an archive/debug-capable Base endpoint to trace the historical ORCL sell transaction.
3. Add OKX API only as a secondary executor roadmap item, starting from dry-run quote comparison.
4. Keep this document in GitHub because it preserves the risk boundary and prevents future agents from repeating wrong-spender / wrong-market / no-receipt assumptions.

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
