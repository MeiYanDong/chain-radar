# Postmortems

Postmortems are evidence records. They should separate:

- confirmed facts,
- inference,
- unknowns,
- code changes made because of the incident,
- tests added because of the incident.

## Existing Evidence

The current main postmortem remains at:

- [Auto-Sell VOLTS / ORCL Postmortem](../../auto-sell-volts-orcl-postmortem.md)

Do not move it yet. It still has active links from the broader `chain-radar` docs.

## Rules

- Do not claim success from a transaction hash alone.
- Always record receipt status.
- Record which host or database contained the evidence.
- Keep secrets, raw RPC URLs, wallet private keys, and raw logs out of public docs.
- Preserve uncertainty when archive/debug/trace evidence is unavailable.
