# OKX API Backend Roadmap

OKX API is a secondary backend candidate, not the primary execution path.

The primary path remains self-owned direct sell because it is easier to audit end to end:

```text
trigger -> route registry -> direct sell -> receipt finalizer -> audit / alert
```

OKX can be useful if it gives a better route, a safer spender model, or a faster prepared transaction for specific tokens. It must earn live status token by token.

## Integration Order

### 1. Quote Only

First implementation must only request quotes and route facts.

Record:

- request timestamp,
- response timestamp,
- latency in ms,
- token in,
- token out,
- amount in,
- estimated amount out,
- price impact,
- route summary,
- spender address,
- raw route id or quote id if available,
- error or timeout.

No transaction signing or submission is allowed in this stage.

### 2. Route And Spender Verification

Before any approval or live submit:

- spender must match the route registry,
- token route must be configured,
- token route must not be `alert_only`,
- allowance target must be explicit,
- quote must be tied to the same chain, token, wallet, and amount.

If OKX returns a new spender, the engine must stop at `dry_run` until the route is reviewed.

### 3. Small Real Sell Test

OKX backend can become live only after a small real sell succeeds on-chain.

Required evidence:

- submitted tx hash,
- `receipt.status === 'success'`,
- actual amount out,
- spender used,
- market/router/aggregator used,
- gas used,
- final audit row.

The test must be token-specific. A successful sell for token A does not verify token B.

### 4. Token-Level Backend Policy

Backend policy belongs in the route registry.

Allowed policies:

- `direct`: direct sell only.
- `okx_quote_only`: OKX can quote, but cannot submit.
- `alert_only`: route is not live.

Future live OKX submit should require a new explicit policy such as `okx_live_secondary`, and that policy should still keep direct sell fallback available.

### 5. Receipt Gate

OKX cannot bypass the engine state model.

Rules:

- API success is not sell success.
- Submitted tx hash is not sell success.
- Only `receipt.status === 'success'` can become `confirmed`.
- Reverted, timeout, and unknown receipt must not be treated as success.

## Timeout And Fallback

OKX must have a strict latency budget.

If quote or transaction preparation exceeds the budget:

- keep direct sell as the fallback,
- store the OKX timeout as evidence,
- do not block a verified direct route waiting for OKX.

## Implementation Note

Before implementation, verify the current official OKX API docs. Do not code against old endpoint memory.
