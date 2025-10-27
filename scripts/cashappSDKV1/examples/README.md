# Examples Overview

All scripts in this folder are written in TypeScript and import directly from the unified `bolaritySDK` entry. They are meant to be run with `ts-node` during development or after compiling with `tsc`.

## Prerequisites

```bash
npm install
npm install --save-dev typescript ts-node
npm install @aave/client               # required for Aave aggregation helpers
```

Populate `.env` with the RPC URLs, signer credentials, and optional overrides referenced by each script (see the root README for the full list).

## Scripts

| Script | Purpose |
|--------|---------|
| `pendle.ts` | Interactive walkthrough covering quotes, APY calculations, arbitrage simulation, redeem flows, and PT balance checks. |
| `compound.ts` | Menu-driven helper for APR lookups, wallet balances, supply/withdraw transactions, rewards claims, and TVL analytics. |
| `net-transfer.ts` | Calculates inbound/outbound wallet flows across a time window (single account or batch) using the Unified SDK net-transfer API. |
| `unified-balance.ts` | Aggregates Aave, Compound, Pendle, and configured wallet tokens into one JSON/console report. |

Run any script with:

```bash
ts-node examples/<script>.ts
```

For production environments compile once and execute the emitted JavaScript:

```bash
npx tsc
node dist/examples/<script>.js
```

Each script prints meaningful diagnostics and uses the shared configuration files under `src/config` so you can onboard new markets without editing the example code. Git pull requests are welcome—keep the scripts focused on showcasing end-to-end flows.
