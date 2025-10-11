# Bolarity DeFi SDK

> TypeScript tooling for CashApp’s DeFi integrations across Compound V3, Pendle, and Aave.

The SDK unifies protocol clients, configuration, and ready-made scripts so engineers can:

- Interact with Compound V3 markets (APR insights, supply/withdraw, rewards, TVL).
- Price and execute Pendle trades, query maturities/APY, and manage PT balances.
- Aggregate Aave/Compound/Pendle balances into a single report (with wallet holdings).
- Analyse wallet net transfers and inspect Aave markets/TVL programmatically.
- Reference a canonical vault catalogue shared between front-end and back-end teams.

---

## Key Features

- **Unified entry point** – import everything from `bolaritySDK.ts`; no manual wiring.
- **Typed protocol clients** – Compound, Pendle, and Unified aggregation SDKs ship with the repo.
- **Static configs** – chain & market metadata live in `src/config` for fast extensibility.
- **Vault registry** – lightweight Flexi/Time vault list that references protocol configs.
- **Rich examples** – CLI utilities covering balances, swaps, vault metadata, and TVL snapshots.
- **Aave helpers** – scripts to inspect raw Aave data or fetch per-reserve supply metrics.

---

## Table of Contents

1. [Getting Started](#getting-started)  
2. [Configuration Files](#configuration-files)  
3. [Core SDK Modules](#core-sdk-modules)  
   - [CompoundSDK](#compoundsdk)  
   - [PendleSDK](#pendlesdk)  
   - [UnifiedSDK](#unifiedsdk)  
4. [Vault Registry](#vault-registry)  
5. [Scripts & Utilities](#scripts--utilities)  
6. [Examples](#examples)  
7. [Type Definitions](#type-definitions)  
8. [Environment Variables](#environment-variables)  
9. [Development Notes](#development-notes)

---

## Getting Started

```bash
npm install
npm install --save-dev ts-node typescript
# optional (required for Aave analytics)
npm install @aave/client @aave/client/actions
```

Create a local `.env` from the example and fill in credentials:

```bash
cp .env.example .env
```

You can run the project in two ways:

1. **ts-node (recommended during development)** – `npx ts-node examples/compound.ts`
2. **Compile + run** – `npx tsc && node dist/examples/compound.js`

---

## Configuration Files

| File | Purpose |
| ---- | ------- |
| `src/config/common.ts` | Shared constants, default RPCs, transfer exclusions. |
| `src/config/compound.ts` | Compound V3 (Comet) registry with markets, assets, ABIs. |
| `src/config/pendle.ts` | Pendle market catalogue, chain IDs, helpers. |
| `src/config/portfolio.ts` | Token lists for wallet balance scanning (stable vs volatile). |
| `src/config/vaults.ts` | Flexi/Time vault references pointing to the protocol configs. |

When onboarding new markets or chains, update the relevant config first—SDKs and examples will pick them up automatically.

---

## Core SDK Modules

Everything can be imported from the root entry:

```ts
import {
  CompoundSDK,
  PendleSDK,
  UnifiedSDK,
  DefaultPriceOracle,
  buildAaveClient,
  CHAINS,
  COMPOUND_MARKETS,
  PENDLE_MARKETS
} from './bolaritySDK';
```

### CompoundSDK

`src/sdk/CompoundSDK.ts`

**What it does**

- Computes APR components (`getInterestAPR`, `getCompAPR`, `getTotalAPR`).
- Supplies / withdraws assets (`supply`, `withdraw`).
- Claims rewards (`claimRewards`).
- Reads balances + TVL snapshots (`getBalance`, `getTVL`).
- Exposes market metadata sourced from `COMPOUND_MARKETS`.

**Usage**

```ts
const compound = new CompoundSDK({
  chainId: 8453,
  rpcUrl: process.env.RPC_URL_8453!,
  privateKey: process.env.PRIVATE_KEY
});

const apr = await compound.getTotalAPR('USDC');
console.log('APR', apr.totalAPRPercentage);

await compound.supply('USDC', 500);
const balance = await compound.getBalance('USDC', process.env.ACCOUNT_ADDRESS!);
console.log('Supplied', balance.supplied);
```

> **Note:** supply/withdraw/claim require a signer; when running examples ensure the account holds sufficient balance.

### PendleSDK

`src/sdk/PendleSDK.ts`

**What it does**

- Enumerates market metadata (`getMarketConfig`, `getMarketTokens`).
- Quotes swaps with APY/maturity details (`getQuote`, `getQuoteWithAPYExample`).
- Provides arbitrage helpers (`arbitrageStablecoin`) and redemption flows (`getRedeemQuote`).
- Fetches PT balances (`getPtBalance`).

**Usage**

```ts
const pendle = new PendleSDK({
  chainId: CHAINS.base.id,
  rpcUrl: process.env.RPC_URL_8453!,
  receiver: process.env.PENDLE_RECEIVER_ADDRESS,
  privateKey: process.env.PRIVATE_KEY,
});

const market = pendle.getMarketConfig('youusd-base');
const quote = await pendle.getQuote(market.underlying, market.pt, 100, 'youusd-base');
console.log('Quote APY', quote.apyPercentage);
```

> Extend `PENDLE_MARKETS` to add new markets; the SDK will surface them automatically.

### UnifiedSDK

`src/sdk/UnifiedSDK.ts`

**What it does**

- Aggregates balances across Compound, Pendle, Aave (optional), and wallet holdings.
- Produces per-protocol breakdowns (`getUserBalance`).
- Computes wallet net transfers (`getNetTransfer`, `getNetTransfers`).
- Supports custom RPCs, price oracles, and exclusion lists.

**Usage**

```ts
const unified = new UnifiedSDK({
  chainId: CHAINS.base.id,
  account: process.env.ACCOUNT_ADDRESS,
  priceOracle: new DefaultPriceOracle(),
  compound: { default: { sdk: compoundInstance } },
  pendle: { default: { sdk: pendleInstance } },
  aave: {
    [CHAINS.base.id]: {
      client: buildAaveClient(),
      markets: ['0xA238Dd80C259a72e81d7e4664a9801593F98d1c5']
    }
  }
});

const summary = await unified.getUnifiedBalanceSummary({
  accountAddress: process.env.ACCOUNT_ADDRESS!,
  includeItems: true
});

console.log('Unified USD', summary.totals.usd);
```

> Wallet token coverage is controlled by `portfolioConfig.PORTFOLIO_TOKENS`. Update that map for new chains or assets.

---

## Vault Registry

Vaults are defined in `src/config/vaults.ts` as lightweight references (id, protocol, chain, market, risk level).

```ts
import { VAULT_LIST } from './config/vaults';

for (const vault of VAULT_LIST) {
  console.log(vault.id, vault.protocol, vault.chain, vault.market, vault.riskLevel);
}
```

Each entry links to an existing protocol config. Typical workflow to add a vault:

1. Add/update the underlying market in `src/config/compound.ts` or `src/config/pendle.ts` (Aave data stays dynamic via the official SDK).
2. Append the vault reference under `flexi` (Compound/Aave) or `time` (Pendle) in `vaults.ts`.
3. Consumers (API, UI) can load protocol-specific metadata by following those pointers. See `examples/vault-info.ts` for a reference implementation.

---

## Scripts & Utilities

| Script | Description |
| ------ | ----------- |
| `scripts/aave-tvl.ts` | Snapshot total market TVL/liquidity (filterable per reserve via symbol/address). |
| `scripts/inspect-aave.ts` | Dump raw Aave `markets` and `userSupplies` responses for debugging. |

Run with `npx ts-node <script> [...args]`.

---

## Examples

| Example | Purpose |
| ------- | ------- |
| `examples/pendle.ts` | Interactive Pendle playground: quotes, APY analysis, arbitrage sims, PT balances. |
| `examples/compound.ts` | CLI for Compound APRs, balances, supply/withdraw, rewards, TVL. |
| `examples/unified-balance.ts` | Unified report (protocol + wallet) with optional auto-discovery of markets. |
| `examples/net-transfer.ts` | Wallet net transfer calculator (single or batch). |
| `examples/vault-info.ts` | Loads every vault, resolves protocol configs, and prints static metadata. |

Execute with `npx ts-node examples/<file>.ts` or compile via `npx tsc` first.

---

## Type Definitions

Shared interfaces live in `src/sdk/types.ts` (balance items, net transfer summaries, price oracle contracts, etc.). Import them from `bolaritySDK.ts` to maintain consistency across services.

---

## Environment Variables

Common variables expected in `.env`:

| Variable | Description |
| -------- | ----------- |
| `PRIVATE_KEY` | Signer for write operations (supply/withdraw, swaps, etc.). |
| `ACCOUNT_ADDRESS` | Default user address for read operations. |
| `RPC_URL_*` | RPC endpoints per chain (e.g. `RPC_URL_8453` for Base). |
| `UNIFIED_RPC_URL` | Optional override for unified balance scripts. |
| `PENDLE_RECEIVER_ADDRESS` | Default receiver used by Pendle swaps. |
| `AAVE_TVL_CHAIN_ID` | Default chain for the TVL script. |
| `NET_TRANSFER_*` / `UNIFIED_*` | Additional overrides used by example scripts (see source comments). |

---

## Development Notes

- The project builds to CommonJS (`npx tsc`).
- Aave integration depends on `@aave/client`; install it before running Aave scripts/examples.
- For allowance or supply operations, ensure the signer has sufficient balance on the configured chain.
- When troubleshooting Aave analytics, run `scripts/inspect-aave.ts` to view the raw API payloads.
- Extend protocol configs first—SDKs, vault registry, and CLI utilities are wired to those sources.

Happy building!
