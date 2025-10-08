# Unified Balance Integration Guide

This directory contains the TypeScript script `unified-balance.ts`, which
illustrates how to aggregate Aave, Compound, and Pendle balances for a user
account with the `UnifiedSDK`.

## When to use the example script

The script is meant for **backend or internal tooling**. It discovers the
markets automatically and prints protocol-specific tables together with the
USD total. Run it manually for debugging or wire it into cron jobs that export
CSV/JSON snapshots.

```bash
# prerequisites (once per repo)
npm install --save-dev typescript ts-node
npm install @aave/client

# configure .env (RPC_URL_8453, PRIVATE_KEY/ACCOUNT_ADDRESS, etc.)
TS_NODE_PROJECT=tsconfig.unified.json \
  npx ts-node src/sdk/examples-ts/unified-balance.ts
```

The script prints:
- **SUMMARY** – combined USD value (protocol deposits + wallet balances).
- **Per-protocol sections** – raw output from `getUserBalance` for Aave,
  Compound, and Pendle.
- **Wallet (Configured Tokens)** – balances detected via
  `getUnifiedBalanceSummary` using the token lists in
  `src/sdk/config/portfolio.js` (stablecoins counted at $1, other assets priced
  with the default oracle).

## Building an API for external apps

If an external app (web/mobile) needs the unified balance, expose an API in
your server that calls `UnifiedSDK.getUserBalance` and returns JSON. A minimal
Express-style handler would look like this:

```ts
import express from "express";
import { UnifiedSDK, DefaultPriceOracle } from "@sdk/UnifiedSDK";
import { CompoundSDK } from "@sdk/CompoundSDK";
import { PendleSDK, CHAINS } from "@sdk/PendleSDK";
import { buildAaveClient } from "@sdk/aave/client";

const router = express.Router();
const chainId = CHAINS.base.id;

const compound = new CompoundSDK({ chainId, rpcUrl: process.env.RPC_URL_8453 });
const pendle = new PendleSDK({ chainId, rpcUrl: process.env.RPC_URL_8453 });
const aaveClient = buildAaveClient();

const unified = new UnifiedSDK({
  chainId,
  priceOracle: new DefaultPriceOracle(),
  compound: { default: { sdk: compound } },
  pendle: { default: { sdk: pendle } },
  aave: {
    [chainId]: {
      client: aaveClient,
      markets: ["0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" /* ... */]
    }
  }
});

router.get("/balances/:address", async (req, res) => {
  try {
    const accountAddress = req.params.address;
    const protocolParam = req.query.protocol?.toString();

    if (protocolParam) {
      const result = await unified.getUserBalance({
        protocol: protocolParam,
        accountAddress
      });
      res.json(result);
      return;
    }

    const summary = await unified.getUnifiedBalanceSummary({
      accountAddress
    });

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});
```

* Keep the SDK instantiation cached (e.g., singletons) so every request just
  calls `getUserBalance`.
* Validate the `protocol` query parameter (`aave | compound | pendle`) before
  passing it through.
* If your frontend needs all protocols at once, loop over the list on the
  server and merge the `totals/items` arrays into a single payload.

## Frontend integration

On the frontend, simply fetch from your API and render totals. Example React
snippet using the Express handler above:

```tsx
async function fetchUnifiedBalance(address: string) {
  const res = await fetch(`/api/balances/${address}?protocol=compound`);
  if (!res.ok) throw new Error("Failed to load balance");
  return res.json();
}
```

The frontend should not instantiate the SDK directly (the libraries expect
server-side secrets such as RPC URLs and, in some cases, private keys).

## Customising protocols & markets

* **Compound** – control which markets appear via `UNIFIED_COMPOUND_ASSETS` or
  the `assets` array in the SDK config. When omitted, the example auto-discovers
  the base asset per Comet in `compound.js`.
* **Pendle** – add or edit markets in `src/sdk/config/pendle.js`. Leaving
  `UNIFIED_PENDLE_MARKETS` unset makes the script include all configured markets.
* **Aave** – update `src/sdk/aave/client.ts` if you need custom API keys or
  hosts; provide `UNIFIED_AAVE_MARKETS` to limit the markets queried.

Feel free to copy the `unified-balance.ts` logic into your production backend
and replace the `console.table` output with whatever response format your
application needs.
