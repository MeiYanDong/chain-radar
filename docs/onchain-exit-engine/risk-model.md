# Risk Model

## Core Principle

Fast is useful only after the engine is correct.

The engine should prefer a known safe failure over an unaudited false success.

## Risk Classes

### False Trigger

Risk:

- selling when the event is not the intended trigger.

Controls:

- strict `> 3000 VIRTUAL` threshold when that trigger type is used,
- same-transaction spend and receive matching,
- token whitelist,
- official executor validation,
- pending signal confirmation fallback.

### Wrong Route

Risk:

- selling through the wrong market or wrong router.

Controls:

- token route registry,
- verified small-sell flag,
- route-specific spender,
- dry-run or alert-only mode for unverified routes.

### Wrong Spender

Risk:

- allowance exists, but not for the actual sell spender.

Controls:

- market address and approval spender must be separate fields,
- preapproval checks must use the spender returned or configured for the backend,
- trigger-time approval should be disabled for fast-path tokens.

### Slippage / Bad Min-Out

Risk:

- `amountOutMin=0` or stale quote exposes the sell to unnecessary loss.
- quote failure means the configured market may not support the token at all.

Controls:

- reference-based min-out from trigger price,
- quote-based min-out only when route quote is reliable,
- required nonzero min-out for live trading,
- token-level slippage policy,
- direct sell quote gate must pass before any approval or sell submission.

### Gas / Fee Too Low

Risk:

- transaction is delayed, dropped, or replaced by competitors.

Controls:

- fixed gas for verified routes,
- dynamic priority fee with caps,
- multi-RPC broadcast,
- replacement policy for underpriced transactions.

### Nonce Conflict

Risk:

- multiple trigger events use the same wallet and collide.

Controls:

- wallet-level nonce manager,
- token-level duplicate sell lock,
- explicit queue or reservation policy,
- retry after nonce rejection.

### Public Mempool Exposure

Risk:

- public broadcast can be sandwiched or copied.

Controls:

- Flashblocks / protected RPC when available,
- configurable public broadcast fallback,
- do not claim Base private routing unless provider confirms support.

### Receipt Blindness

Risk:

- tx hash exists, but the on-chain transaction reverted.

Controls:

- receipt follow-up is mandatory,
- `receipt.status` is final success proof,
- reverted receipt updates audit row as failed,
- urgent alert on reverted sell.

### External API Dependency

Risk:

- OKX or another aggregator is slow, unavailable, or returns unsupported routes.

Controls:

- OKX API begins as quote-only,
- direct backend remains available,
- OKX live path requires small real sell receipt success,
- token-level backend policy decides use.

## Go-Live Gate

Before live trading resumes:

- readiness report passes,
- token route is verified,
- spender is verified,
- allowance is sufficient,
- gas balance covers burst target,
- direct small sell has succeeded or route is marked alert-only,
- receipt finalizer is enabled,
- cloud service state is intentionally started.
