# Config Schema

This is the public-safe configuration contract for extracting the engine.

The future standalone engine should prefer neutral `EXIT_ENGINE_*` keys. The current `chain-radar` runtime can keep using legacy keys while adapters are still in place.

## Rules

- Private keys are secret.
- RPC URLs are secret because provider tokens are often embedded in URLs.
- Public docs may show field names and counts, but not values.
- A public config summary must never include a private key, full RPC URL, wallet balance, DB path, or cloud identifier.
- Legacy `AUTO_SELL_*` and `BUYBACK_*` keys are compatibility inputs, not the target long-term schema.

## Core Keys

| Neutral key | Legacy key | Secret | Purpose |
| --- | --- | --- | --- |
| `EXIT_ENGINE_ENABLED` | `AUTO_SELL_ENABLED` | no | Enable engine execution. |
| `EXIT_ENGINE_DRY_RUN` | `AUTO_SELL_DRY_RUN` | no | Run without submitting transactions. |
| `EXIT_ENGINE_WALLET_PRIVATE_KEY` | `AUTO_SELL_PRIVATE_KEY` | yes | Execution wallet private key. |
| `EXIT_ENGINE_RPC_URL` | `RPC_URL` | yes | Primary RPC URL. |
| `EXIT_ENGINE_RPC_URL_FALLBACKS` | `RPC_URL_FALLBACKS` | yes | Fallback RPC URLs. |
| `EXIT_ENGINE_PROTECTED_RPC_URLS` | `AUTO_SELL_PROTECTED_RPC_URLS` | yes | Protected broadcast RPC URLs. |
| `EXIT_ENGINE_SUBMIT_MODE` | `AUTO_SELL_SUBMIT_MODE` | no | `primary` or `multi-rpc`. |
| `EXIT_ENGINE_PRIMARY_FALLBACK_ENABLED` | `AUTO_SELL_PRIMARY_FALLBACK_ENABLED` | no | Whether multi-RPC failure may fall back to primary RPC. Defaults to the public-broadcast setting. |
| `EXIT_ENGINE_MIN_OUT_MODE` | `AUTO_SELL_MIN_OUT_MODE` | no | `zero`, `quote`, `quote-required`, `reference`, or `quote-reference`. |
| `EXIT_ENGINE_BUYBACK_EXECUTOR_ADDRESS` | `BUYBACK_EXECUTOR_ADDRESS` | no | Official buyback executor address. |
| `EXIT_ENGINE_LARGE_BUY_THRESHOLD_VIRTUAL` | `BUYBACK_LARGE_BUY_THRESHOLD_VIRTUAL` | no | Strict greater-than VIRTUAL threshold. |
| `EXIT_ENGINE_LARGE_BUY_VIRTUAL_USD_FALLBACK` | `BUYBACK_LARGE_BUY_VIRTUAL_USD_FALLBACK` | no | Fallback VIRTUAL/USD price for USD threshold checks. |
| `EXIT_ENGINE_TOKEN_SYMBOLS` | `AUTO_SELL_TOKEN_SYMBOLS` | no | Token-address to symbol mapping. |
| `EXIT_ENGINE_TOKEN_DECIMALS` | `AUTO_SELL_TOKEN_DECIMALS` | no | Token-address to decimals mapping. |
| `EXIT_ENGINE_TOKEN_MARKETS` | `AUTO_SELL_TOKEN_MARKETS` | no | Optional token-address to market-address mapping for per-token routes. |
| `EXIT_ENGINE_TOKEN_SPENDERS` | `AUTO_SELL_TOKEN_SPENDERS` | no | Optional token-address to approval-spender-address mapping. |
| `EXIT_ENGINE_PREAPPROVED_ALLOWANCES` | `AUTO_SELL_PREAPPROVED_ALLOWANCES` | no | Token-address to spender-address mapping. |
| `EXIT_ENGINE_VERIFIED_SELL_ROUTES` | — | no | Token:market:spender triples that have passed a small real sell receipt check. |
| `EXIT_ENGINE_BACKEND_POLICIES` | — | no | Optional token-address to backend policy mapping: `direct`, `okx_quote_only`, or `alert_only`. |
| `EXIT_ENGINE_UNVERIFIED_ROUTE_MODE` | — | no | `alert_only` or `dry_run` for routes without verified sell receipts. |

## Code Boundary

Current source:

- `src/onchain-exit-engine/configSchema.ts`
- `src/onchain-exit-engine/tokenOnboarding.ts`
- `src/checkTokenOnboarding.ts`
- `src/test-config-schema.ts`
- `src/test-token-onboarding.ts`

Current guarantees:

- native `EXIT_ENGINE_*` env can produce an engine config,
- legacy `AUTO_SELL_*` / `BUYBACK_*` env can produce the same shape,
- `src/autoSell.ts` consumes the built config object for readiness and execution behavior,
- `src/watcher.ts` consumes the built config object for official-buyback executor, large-buy fallback, Flashblocks WS, RPC URL, token metadata, preapproval, market, and approval-spender trigger settings,
- disabling public broadcast also disables primary fallback unless primary fallback is explicitly enabled,
- public summary only reports booleans, counts, modes, and numeric policy values,
- public summary omits private key values, full RPC URLs, and `bigint` gas values.
- token onboarding classifies new routes before live use:
  - invalid / missing / wrong route -> blocked,
  - alert-only backend -> monitor-only,
  - missing approval -> approval-required,
  - unverified or unchecked route -> dry-run-ready,
  - verified direct route with non-zero quote and sufficient allowance -> live-ready.

## Extraction Rule

When extracting to a new repository:

1. Keep this schema and the public summary helper.
2. Do not copy legacy `.env` files.
3. Do not copy cloud-specific deployment config.
4. Start the new repo with example values only, never real secrets.
