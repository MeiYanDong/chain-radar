# Runbook

This runbook is public-safe. It must not contain private keys, full RPC URLs, wallet balances, cloud ids, public IPs, raw server logs, or provider-specific deployment state.

Provider-specific deployment notes must stay outside this engine folder.

## Local Orientation

From the repo:

```bash
pwd
git status --short
npm run build -- --pretty false
npm run exit-engine:test
npm run auto-sell:test
```

Health check command shape:

```bash
npm run auto-sell:health
```

Token onboarding command shape:

```bash
npm run exit-engine:token-check -- <tokenAddress> --allow-dry-run
npm run exit-engine:token-check -- <tokenAddress> --require-large-buy
npm run exit-engine:token-check -- <tokenAddress> --market <sellTarget> --quote <quoteRouter> --spender <spender>
npm run exit-engine:token-check -- <tokenAddress> --no-discovery
npm run exit-engine:token-check -- <tokenAddress> --no-network
```

The token check is read-only. With RPC configured, it probes token `symbol`, `decimals`, direct sell quote, wallet balance, and spender allowance. It does not submit approvals or sells.

Do not assume `market`, `quote`, and `spender` are the same address. Virtuals BondingV5 pre-token routes use BondingV5 as the sell target, but FRouterV3 as both quote router and approval spender.

If the configured market quote fails, the checker can scan recent Blockscout token transfers for contract counterparties and test them as token-specific market candidates. Only a candidate with a non-zero `getAmountsOut` quote can become the discovered market. If no candidate quotes, the token stays blocked.

A new token is not live-ready just because the address exists. The checker must at least classify it as dry-run-ready first, then the operator should do a small verified sell before marking the route live.

The execution path also enforces a direct quote gate. If `getAmountsOut` fails or returns zero for the resolved quote router/token pair, the engine returns `failed` before any approval or sell transaction is submitted.

Deployment hosts may need a compiled runtime command, but the host path, service manager, and environment files are deployment-specific and intentionally not defined here.

## Recovery Checklist

If a sell is submitted but not confirmed:

1. Check receipt status.
2. If receipt is `success`, update audit and close incident.
3. If receipt is `reverted`, mark failed and inspect route/spender/min-out/gas.
4. If receipt times out, check explorer and RPC alternatives.
5. If nonce is stuck, inspect pending tx and consider replacement only with explicit approval.
6. Do not claim success from tx hash alone.

## OKX API Future Runbook Rule

When OKX API is added:

- start in quote-only mode,
- record API latency and route facts,
- verify spender before approval,
- do small real sell before live use,
- store receipt status like direct sell,
- keep direct sell fallback available.
