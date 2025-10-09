#!/usr/bin/env ts-node
/// <reference path="./types.d.ts" />
import "dotenv/config";
import { Wallet } from "ethers";
import { markets as fetchAaveMarkets } from "@aave/client/actions";
import { chainId as toAaveChainId, evmAddress } from "@aave/client";
import { DefaultPriceOracle, UnifiedSDK } from "../UnifiedSDK";
import { CompoundSDK } from "../CompoundSDK";
import { PendleSDK, CHAINS } from "../PendleSDK";
import { buildAaveClient } from "../aave/client";

function parseList(value: string | undefined): string[] {
    return (value || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function parseSymbolMap(value: string | undefined): Record<string, string> {
    const map: Record<string, string> = {};
    for (const entry of parseList(value)) {
        const [key, symbol] = entry.split(":");
        if (key && symbol) {
            map[key.trim()] = symbol.trim().toUpperCase();
        }
    }
    return map;
}

async function main() {
    const defaultChainId = CHAINS.base.id;
    const chainId = Number(process.env.BALANCE_CHAIN_ID || process.env.UNIFIED_CHAIN_ID || defaultChainId);
    const rpcUrl = process.env.UNIFIED_RPC_URL || process.env.RPC_URL_8453 || process.env.RPC_URL;

    if (!rpcUrl) {
        throw new Error("RPC URL is required. Set UNIFIED_RPC_URL or RPC_URL_8453 in your .env file.");
    }

    const privateKey = process.env.PRIVATE_KEY;
    const accountAddress = process.env.ACCOUNT_ADDRESS || (privateKey ? new Wallet(privateKey).address : undefined);

    if (!accountAddress) {
        throw new Error("Set ACCOUNT_ADDRESS or PRIVATE_KEY in your .env file to derive the user account.");
    }

    const compoundConfig: Record<string, unknown> = {
        chainId,
        rpcUrl,
        slippage: 0.005,
        verbose: true
    };

    if (privateKey) {
        compoundConfig.privateKey = privateKey;
    }

    const compound = new CompoundSDK(compoundConfig);

    const pendleConfig: Record<string, unknown> = {
        chainId,
        rpcUrl,
        receiver: accountAddress,
        verbose: true
    };

    if (privateKey) {
        pendleConfig.privateKey = privateKey;
    }

    const pendle = new PendleSDK(pendleConfig);

    let compoundAssets = parseList(process.env.UNIFIED_COMPOUND_ASSETS || process.env.COMPOUND_ASSETS).map((asset) => asset.toUpperCase());
    if (!compoundAssets.length) {
        compoundAssets = autoCompoundAssets(compound);
        if (compoundAssets.length === 0) {
            compoundAssets = ["USDC"];
        }
    }

    let pendleMarkets = parseList(process.env.UNIFIED_PENDLE_MARKETS || process.env.PENDLE_MARKETS);
    if (!pendleMarkets.length) {
        pendleMarkets = Object.keys(pendle.markets || {});
    }

    const pendleUnderlying = (() => {
        const fromEnv = parseSymbolMap(process.env.UNIFIED_PENDLE_UNDERLYING || process.env.PENDLE_UNDERLYING_SYMBOLS);
        if (Object.keys(fromEnv).length) {
            return fromEnv;
        }

        const map: Record<string, string> = {};
        for (const marketKey of pendleMarkets) {
            const meta = pendle.getMarketConfig(marketKey) || {};
            if (meta?.underlyingSymbol) {
                map[marketKey] = String(meta.underlyingSymbol).toUpperCase();
            } else if (meta?.underlying) {
                map[marketKey] = String(meta?.name || marketKey).toUpperCase();
            } else if (meta?.name) {
                map[marketKey] = String(meta.name).toUpperCase();
            }
        }
        return map;
    })();

    let aaveMarkets = parseList(process.env.UNIFIED_AAVE_MARKETS || process.env.AAVE_MARKETS);
    let aaveStableSymbols = parseList(process.env.UNIFIED_AAVE_STABLE_SYMBOLS || process.env.AAVE_STABLE_SYMBOLS || "USDC,USDT,DAI").map((symbol) => symbol.toUpperCase());
    let aaveStableAddresses = parseList(process.env.UNIFIED_AAVE_STABLE_ADDRESSES || process.env.AAVE_STABLE_ADDRESSES).map((address) => address.toLowerCase());

    let aaveClient: ReturnType<typeof buildAaveClient> | null = null;
    try {
        aaveClient = buildAaveClient();
        const discovered = await discoverAaveMarkets({
            client: aaveClient,
            chainId,
            account: accountAddress
        });

        if (discovered.markets.length) {
            aaveMarkets = discovered.markets;
        }

        if (!aaveStableSymbols.length && discovered.stableSymbols.length) {
            aaveStableSymbols = discovered.stableSymbols;
        }

        if (!aaveStableAddresses.length && discovered.stableAddresses.length) {
            aaveStableAddresses = discovered.stableAddresses;
        }
    } catch (error) {
        console.warn("⚠️  Unable to auto-discover Aave markets:", (error as Error).message);
    }

    const unified = new UnifiedSDK({
        chainId,
        account: accountAddress,
        priceOracle: new DefaultPriceOracle(),
        compound: {
            default: {
                sdk: compound,
                assets: compoundAssets,
                stableSymbols: parseList(process.env.UNIFIED_COMPOUND_STABLE_SYMBOLS || process.env.COMPOUND_STABLE_SYMBOLS).map((symbol) => symbol.toUpperCase())
            }
        },
        pendle: {
            default: {
                sdk: pendle,
                markets: pendleMarkets,
                underlyingSymbols: pendleUnderlying
            }
        },
        aave: aaveClient && aaveMarkets.length ? {
            [chainId]: {
                client: aaveClient,
                markets: aaveMarkets,
                stableSymbols: aaveStableSymbols,
                stableAddresses: aaveStableAddresses
            }
        } : undefined
    });

    let protocols = parseList(process.env.BALANCE_PROTOCOLS || process.env.UNIFIED_PROTOCOLS || "aave,compound,pendle")
        .map((protocol) => protocol.toLowerCase());

    if (!aaveMarkets.length) {
        protocols = protocols.filter((protocol) => protocol !== "aave");
    }

    if (!protocols.length) {
        throw new Error("Provide at least one protocol via BALANCE_PROTOCOLS or UNIFIED_PROTOCOLS env variable.");
    }

    console.log(`\n🔍 Unified balance lookup for ${accountAddress} on chain ${chainId}`);

    const summary = await unified.getUnifiedBalanceSummary({
        chainId,
        accountAddress,
        protocols,
        includeItems: true
    });

    console.log("\n=== SUMMARY ===");
    console.log("Total USD:", summary.totals.usd.toFixed(4));

    for (const result of summary.protocols) {
        console.log(`\n=== ${result.protocol.toUpperCase()} ===`);
        console.log("Total USD:", result.totals.usd.toFixed(4));

        if (!result.items.length) {
            console.log("No positions detected.");
            continue;
        }

        console.table(result.items.map((item) => ({
            asset: item.symbol || item.address,
            amount: item.amount,
            usdValue: item.usdValue,
            price: item.price,
            market: item.market
        })));

        const failures = Array.isArray((result.metadata as Record<string, unknown>)?.failures)
            ? (result.metadata as { failures: Array<{ asset?: string; error?: unknown }> }).failures
            : [];

        if (failures.length) {
            console.warn("Skipped assets:");
            for (const failure of failures) {
                console.warn(`- ${failure.asset || "unknown"}:`, failure.error);
            }
        }
    }

    console.log("\n=== WALLET (Configured Tokens) ===");
    console.log("Stable USD:", summary.wallet.totals.stableUsd.toFixed(4));
    console.log("Asset USD:", summary.wallet.totals.assetUsd.toFixed(4));
    if (!summary.wallet.stable.length && !summary.wallet.assets.length) {
        console.log("No on-chain wallet balances detected for configured tokens.");
    } else {
        if (summary.wallet.stable.length) {
            console.log("\n-- Stablecoins --");
            console.table(summary.wallet.stable.map((item) => ({
                asset: item.symbol || item.address,
                amount: item.amount,
                usdValue: item.usdValue,
                price: item.price
            })));
        }

        if (summary.wallet.assets.length) {
            console.log("\n-- Volatile Assets --");
            console.table(summary.wallet.assets.map((item) => ({
                asset: item.symbol || item.address,
                amount: item.amount,
                usdValue: item.usdValue,
                price: item.price
            })));
        }
    }

    if (summary.wallet.failures.length) {
        console.warn("Wallet token lookups skipped:");
        for (const failure of summary.wallet.failures) {
            console.warn(`- ${failure.token || "unknown"}:`, failure.error);
        }
    }

    const protocolFailures = summary.failures.filter((failure) => failure.protocol !== 'wallet');
    if (protocolFailures.length) {
        console.warn("\nProtocols skipped:");
        for (const failure of protocolFailures) {
            console.warn(`- ${failure.protocol}:`, failure.error);
        }
    }
}

interface DiscoverAaveParams {
    client: ReturnType<typeof buildAaveClient>;
    chainId: number;
    account: string;
}

async function discoverAaveMarkets({ client, chainId, account }: DiscoverAaveParams) {
    const marketsSet = new Set<string>();
    const stableSymbolSet = new Set<string>();
    const stableAddressSet = new Set<string>();

    try {
        const chainIdentifier = toAaveChainId(chainId);
        const result = await fetchAaveMarkets(client, {
            chainIds: [chainIdentifier],
            user: evmAddress(account)
        });

        if (result.isErr()) {
            throw result.error;
        }

        const list = Array.isArray(result.value) ? result.value : [];

        for (const market of list) {
            const address = typeof market?.address === "string" ? market.address : undefined;
            if (!address) continue;

            const reserves = Array.isArray(market?.supplyReserves) ? market.supplyReserves : [];
            const hasExposure = reserves.some((reserve) => {
                const reserveState = reserve?.userState as Record<string, unknown> | undefined;
                const amount = extractNumber(
                    reserveState?.["balance"]
                    ?? reserveState?.["supplyBalance"]
                    ?? reserveState?.["aTokenBalance"]
                    ?? reserveState?.["walletBalance"]
                );
                return amount > 0;
            });

            if (!hasExposure) {
                continue;
            }

            marketsSet.add(address);

            for (const reserve of reserves) {
                const reserveState = reserve?.userState as Record<string, unknown> | undefined;
                const symbol = typeof reserve?.underlyingToken?.symbol === "string"
                    ? reserve.underlyingToken.symbol.toUpperCase()
                    : undefined;
                const reserveAddress = typeof reserve?.underlyingToken?.address === "string"
                    ? reserve.underlyingToken.address.toLowerCase()
                    : undefined;

                if (symbol && /(USDC|USDT|USDBC|USDbC|USDE|USDS|USDP|USDX|USDC\.e|DAI|FRAX|LUSD|PYUSD|USD)/i.test(symbol)) {
                    stableSymbolSet.add(symbol);
                    if (reserveAddress) {
                        stableAddressSet.add(reserveAddress);
                    }
                }

                const amount = extractNumber(
                    reserveState?.["balance"]
                    ?? reserveState?.["supplyBalance"]
                    ?? reserveState?.["aTokenBalance"]
                    ?? reserveState?.["walletBalance"]
                );

                if (!amount) {
                    continue;
                }

                const usdValue = extractNumber(
                    reserveState?.["usdValue"]
                    ?? reserveState?.["balanceUsd"]
                    ?? reserveState?.["balanceUSD"]
                    ?? reserveState?.["supplyBalanceUsd"]
                );

                if (usdValue > 0 && symbol && reserveAddress) {
                    stableSymbolSet.add(symbol);
                    stableAddressSet.add(reserveAddress);
                }
            }
        }
    } catch (error) {
        console.warn("⚠️  discoverAaveMarkets failed:", (error as Error).message);
    }

    return {
        markets: Array.from(marketsSet),
        stableSymbols: Array.from(stableSymbolSet),
        stableAddresses: Array.from(stableAddressSet)
    };
}

function extractNumber(value: unknown): number {
    if (value == null) return 0;
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    if (typeof value === "object") {
        const maybe = value as Record<string, unknown>;
        if (typeof maybe.value !== "undefined") {
            return extractNumber(maybe.value);
        }
        if (typeof maybe.amount !== "undefined") {
            return extractNumber(maybe.amount);
        }
    }
    return 0;
}

function autoCompoundAssets(sdk: CompoundSDK): string[] {
    const set = new Set<string>();
    const markets = sdk?.markets ?? {};
    for (const market of Object.values<{ assets?: Record<string, { symbol?: string }> }>(markets)) {
        const assets = market?.assets || {};
        for (const info of Object.values<{ symbol?: string }>(assets)) {
            const symbol = info?.symbol;
            if (symbol) {
                set.add(symbol.toUpperCase());
            }
        }
    }
    return Array.from(set);
}

main().catch((error) => {
    console.error("\n❌ Unified balance script failed:", (error as Error).message);
    process.exit(1);
});
