+# Bolarity DeFi SDK
+
+> “Good taste is a matter of eliminating special cases.” – Linus Torvalds
+
+Fully TypeScript DeFi tooling for **Pendle yield markets**, **Compound V3 lending**, and **cross-protocol portfolio analytics** under one roof. Everything now lives behind a single entry point so other developers can simply `import { … } from './bolaritySDK'` and ship.
+
+---
+
+## Quick Start
+
+```bash
+# 1. Install runtime + optional extras
+npm install
+npm install --save-dev typescript ts-node         # if you want to run examples directly
+npm install @aave/client                          # required for Aave balance aggregation
+
+# 2. Provide secrets & RPCs
+cp .env.example .env                              # create your env file
+# customise PRIVATE_KEY, ACCOUNT_ADDRESS, RPC_URL_8453, etc.
+
+# 3. Run any example (ts-node or compiled output)
+ts-node examples/pendle.ts                        # interactive Pendle walkthrough
+ts-node examples/compound.ts                      # Compound CLI menu
+ts-node examples/net-transfer.ts                  # wallet flow breakdown
+ts-node examples/unified-balance.ts               # protocol + wallet snapshot
+```
+
+Need compiled JavaScript instead? Run `npx tsc` and execute the generated files inside `dist/`.
+
+---
+
+## Repository Layout
+
+```
+bolaritySDK.ts          # unified entry re-exporting everything
+src/
+  bolaritySDK.ts        # source entry (used by the root re-export)
+  sdk/                  # protocol implementations
+    CompoundSDK.ts
+    PendleSDK.ts
+    UnifiedSDK.ts
+    types.ts            # shared response/argument interfaces
+  config/               # declarative chain + market metadata
+  aave/client.ts        # thin helper for @aave/client
+examples/               # consolidated TS examples & CLI utilities
+```
+
+Every consumer should only care about `bolaritySDK.ts`. The rest of the tree is organised so each protocol stays focused and easy to extend.
+
+---
+
+## Unified Entry Point
+
+```ts
+// bolaritySDK.ts
+export * from './src/bolaritySDK';
+
+// usage inside your app
+import {
+  CHAINS,
+  PendleSDK,
+  CompoundSDK,
+  UnifiedSDK,
+  DefaultPriceOracle,
+  buildAaveClient,
+  resolvePendleMarket
+} from './bolaritySDK';
+```
+
+Besides the SDK classes you also get:
+
+- `CHAINS`, `PENDLE_ROUTER`, `PENDLE_MARKETS` from Pendle config
+- `COMPOUND_MARKETS` from Compound config
+- Namespace exports `commonConfig`, `compoundConfig`, `pendleConfig`, `portfolioConfig`
+- All shared TypeScript interfaces from `src/sdk/types.ts`
+
+---
+
+## Pendle SDK
+
+```ts
+import { CHAINS, PendleSDK, resolvePendleMarket } from './bolaritySDK';
+
+const sdk = new PendleSDK({
+  chainId: CHAINS.base.id,
+  rpcUrl: process.env.RPC_URL_8453!,
+  receiver: process.env.PENDLE_RECEIVER_ADDRESS,
+  slippage: 0.01,
+  verbose: true
+});
+
+const market = resolvePendleMarket('youusd-base');
+const quote = await sdk.getQuote(market!.underlying, market!.pt, 100, market!.address);
+console.log(`APY ≈ ${(quote.apyPercentage ?? 0).toFixed(2)}%`);
+```
+
+Highlights:
+
+- Enhanced PT quotes with profit, maturity and APY metrics
+- Dry-run and live swap helpers via `arbitrageStablecoin` / `executeSwap`
+- Token balance/introspection helpers used by the aggregation layer
+
+Useful constants: `CHAINS`, `PENDLE_MARKETS`, `resolvePendleMarket`.
+
+---
+
+## Compound SDK
+
+```ts
+import { CompoundSDK } from './bolaritySDK';
+
+const compound = new CompoundSDK({
+  chainId: 8453,
+  rpcUrl: process.env.RPC_URL_8453!,
+  privateKey: process.env.PRIVATE_KEY,
+  verbose: true
+});
+
+const apr = await compound.getTotalAPR('USDC');
+console.log(`Total APR: ${(apr.totalAPRPercentage).toFixed(2)}%`);
+
+const tvl = await compound.getTVL('base');
+console.log(`Base TVL: $${tvl.totalTVL.toLocaleString()}`);
+```
+
+Features:
+
+- Structured responses (`CompoundResult`, `CompoundAPR`, `CompoundBalance`)
+- APR + COMP rewards analytics, TVL snapshots, balance lookups
+- Transaction helpers for supply, withdraw, and rewards
+
+Access available markets via `COMPOUND_MARKETS` and customise them under `src/config/compound.ts`.
+
+---
+
+## Unified SDK
+
+```ts
+import {
+  UnifiedSDK,
+  DefaultPriceOracle,
+  CompoundSDK,
+  PendleSDK,
+  CHAINS,
+  buildAaveClient
+} from './bolaritySDK';
+
+const chainId = CHAINS.base.id;
+const unified = new UnifiedSDK({
+  chainId,
+  priceOracle: new DefaultPriceOracle(),
+  compound: { default: { sdk: new CompoundSDK({ chainId, rpcUrl: process.env.RPC_URL_8453! }) } },
+  pendle: { default: { sdk: new PendleSDK({ chainId, rpcUrl: process.env.RPC_URL_8453! }) } },
+  aave: {
+    [chainId]: {
+      client: buildAaveClient(),
+      markets: process.env.UNIFIED_AAVE_MARKETS?.split(',')
+    }
+  }
+});
+
+const summary = await unified.getUnifiedBalanceSummary({ accountAddress: process.env.ACCOUNT_ADDRESS! });
+console.log(summary.totals.usd);
+```
+
+The unified layer also exposes wallet net transfer analytics:
+
+- `getNetTransfer` / `getNetTransfers`
+- Shared types such as `NetTransferArgs`, `NetTransferResult`, `UnifiedBalanceSummary`
+
+---
+
+## Configuring Markets & Tokens
+
+- **`src/config/common.ts`** – default RPCs, shared constants
+- **`src/config/compound.ts`** – Comet markets per chain
+- **`src/config/pendle.ts`** – Pendle market registry and lookup helpers
+- **`src/config/portfolio.ts`** – stable vs asset token lists used by the wallet scanner
+
+Add or edit entries here; no SDK code changes required.
+
+---
+
+## Examples & CLI Utilities
+
+| Script | Purpose |
+|--------|---------|
+| `examples/pendle.ts` | Interactive Pendle playground (quotes, APY, arbitrage, redeem, PT balances). |
+| `examples/compound.ts` | Menu-driven Compound helper (APRs, balances, TVL, supply/withdraw, rewards). |
+| `examples/net-transfer.ts` | Computes wallet/net flows across a time window with optional batch mode. |
+| `examples/unified-balance.ts` | Aggregates Aave, Compound, Pendle, and wallet balances into one report. |
+
+All examples import from the unified `bolaritySDK` entry. Run them with `ts-node` or after compiling with `tsc`.
+
+---
+
+## TypeScript Build
+
+`tsconfig.json` targets CommonJS so the output is drop-in compatible with existing Node projects. Generated declaration files (`dist/**/*.d.ts`) make the SDK consumable from other TypeScript apps without extra work.
+
+```bash
+npx tsc              # builds to dist/
+node dist/examples/pendle.js
+```
+
+---
+
+## Troubleshooting
+
+- **Missing `@aave/client`** – Install the package or remove Aave-related config before calling Aave helpers.
+- **RPC errors** – Update RPC URLs in `.env` or tweak defaults in `src/config/common.ts`.
+- **Unknown Pendle market** – append it to `src/config/pendle.ts` or pass explicit metadata.
+
+Contributions are welcome—prefer PRs that keep the “data first, no special cases” philosophy intact.
