# Token Onboarding Smoke Tests

This file stores public-safe read-only smoke results. Do not include private RPC URLs, wallet addresses, wallet balances, cloud identifiers, raw logs, or secrets.

## 2026-05-07 ZMAC Read-Only Check

Command shape:

```bash
npm run exit-engine:token-check -- 0xF62711E12D3Bf4FF4CF7cD3dAD6E76Cd22272EeC --allow-dry-run
```

Result:

- token: `0xF62711E12D3Bf4FF4CF7cD3dAD6E76Cd22272EeC`
- detected symbol: `ZMAC`
- detected decimals: `18`
- default market checked: `0x1A540088125d00dD3990f9dA45CA0859af4d3B01`
- quote probe: failed; `getAmountsOut` reverted
- allowance probe: read succeeded
- balance probe: read succeeded, but the execution wallet had no usable ZMAC position
- onboarding decision: `blocked`

Interpretation:

The token metadata is readable, but this token is not eligible for direct dry-run or live sell through the default market address. Before using ZMAC or a similar token, the route must discover the correct token-specific market / spender, then rerun the read-only quote and allowance checks. A successful quote is still not enough for live mode; live mode also requires preapproval and a small verified sell receipt.
