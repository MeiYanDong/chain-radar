# Token Onboarding Smoke Tests

This file stores public-safe read-only smoke results. Do not include private RPC URLs, wallet addresses, wallet balances, cloud identifiers, raw logs, or secrets.

## 2026-05-07 ZMAC Read-Only Check

Command shape:

```bash
npm run exit-engine:token-check -- 0xF62711E12D3Bf4FF4CF7cD3dAD6E76Cd22272EeC --allow-dry-run --no-discovery
```

Result:

- token: `0xF62711E12D3Bf4FF4CF7cD3dAD6E76Cd22272EeC`
- detected symbol: `ZMAC`
- detected decimals: `18`
- sell target: `0x1A540088125d00dD3990f9dA45CA0859af4d3B01`
- quote router: `0x02FE8eC3d9BBf7318eb54590bcC39198a8b47deD`
- approval spender: `0x02FE8eC3d9BBf7318eb54590bcC39198a8b47deD`
- quote probe: passed
- allowance probe: read succeeded
- balance probe: read succeeded, but the execution wallet had no usable ZMAC position
- route discovery: disabled for this smoke because the default BondingV5 route is now quoteable
- onboarding decision: `approval_required`

Interpretation:

ZMAC is a Virtuals BondingV5 pre-token route. The wallet submits `sell(uint256,address,uint256,uint256)` to the BondingV5 sell target, but quote reads and token allowance must use FRouterV3. The previous failed smoke called `getAmountsOut` on the sell target itself, which was the wrong contract for this token class.

The current route is monitor/dry-run usable, but not live-ready. Live mode still requires spender approval against FRouterV3, a non-zero wallet token balance, and a small verified sell receipt before the route is marked live.

Execution implication:

The direct sell execution path now separates sell target, quote router, and approval spender. It still requires the quote gate before approving or selling, so an unquoteable route fails closed before any transaction is submitted.
