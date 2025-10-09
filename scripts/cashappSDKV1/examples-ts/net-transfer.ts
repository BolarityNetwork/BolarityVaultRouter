#!/usr/bin/env ts-node
import "dotenv/config";
import { Wallet } from "ethers";
import { UnifiedSDK, DefaultPriceOracle, NetTransferArgs, NetTransferResult } from "../UnifiedSDK";
import { CHAINS } from "../PendleSDK";

function parseList(value: string | undefined): string[] {
    return (value || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function parseTimestamp(value: string | undefined, fallbackSeconds: number): number {
    if (!value) {
        return fallbackSeconds;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    }

    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) {
        return Math.floor(asDate.getTime() / 1000);
    }

    throw new Error(`Unable to parse timestamp value: ${value}`);
}

function parseTokenOverrides(value: string | undefined) {
    const tokens: Array<{ address: string; symbol?: string }> = [];
    for (const entry of parseList(value)) {
        const [symbol, address] = entry.includes(":") ? entry.split(":") : [undefined, entry];
        if (!address) continue;
        tokens.push({
            address: address.trim(),
            symbol: symbol ? symbol.trim().toUpperCase() : undefined
        });
    }
    return tokens;
}

async function main() {
    const defaultChainId = CHAINS.base.id;
    const chainId = Number(process.env.NET_TRANSFER_CHAIN_ID || process.env.UNIFIED_CHAIN_ID || defaultChainId);
    const rpcUrl = process.env.NET_TRANSFER_RPC_URL
        || process.env.UNIFIED_RPC_URL
        || process.env.RPC_URL_8453
        || process.env.RPC_URL;

    if (!rpcUrl) {
        throw new Error("RPC URL is required. Set NET_TRANSFER_RPC_URL or UNIFIED_RPC_URL in your .env file.");
    }

    const privateKey = process.env.PRIVATE_KEY;
    const accountAddress = process.env.NET_TRANSFER_ACCOUNT
        || process.env.ACCOUNT_ADDRESS
        || (privateKey ? new Wallet(privateKey).address : undefined);

    if (!accountAddress) {
        throw new Error("Set NET_TRANSFER_ACCOUNT, ACCOUNT_ADDRESS, or PRIVATE_KEY in your .env file.");
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const defaultWindow = Number(process.env.NET_TRANSFER_WINDOW_SECONDS || 60);
    const startTime = parseTimestamp(process.env.NET_TRANSFER_START, nowSeconds - defaultWindow);
    const endTime = parseTimestamp(process.env.NET_TRANSFER_END, nowSeconds);

    const includeBreakdown = String(process.env.NET_TRANSFER_BREAKDOWN || "false").toLowerCase() === "true";

    const sdk = new UnifiedSDK({
        chainId,
        account: accountAddress,
        rpcUrls: { [chainId]: rpcUrl },
        priceOracle: new DefaultPriceOracle(),
        transferExclusions: parseList(process.env.NET_TRANSFER_EXCLUDE)
    });

    const args: NetTransferArgs = {
        chainId,
        accountAddress,
        startTime,
        endTime,
        includeBreakdown,
        tokens: parseTokenOverrides(process.env.NET_TRANSFER_TOKENS)
    };

    const result: NetTransferResult = await sdk.getNetTransfer(args);

    console.log("\n=== Net Transfer Summary ===");
    console.log("Account:", result.account);
    console.log("Chain:", result.chainId);
    console.log("Window:", `${new Date(result.startTime * 1000).toISOString()} → ${new Date(result.endTime * 1000).toISOString()}`);
    console.log("Inbound (USD):", result.inboundUsd.toFixed(6));
    console.log("Outbound (USD):", result.outboundUsd.toFixed(6));
    console.log("Net Transfer (USD):", result.netTransfer.toFixed(6));
    console.log("Tokens Evaluated:", result.tokensEvaluated);
    console.log("Block Range:", `${result.fromBlock} → ${result.toBlock}`);

    if (includeBreakdown && Array.isArray(result.breakdown)) {
        console.log("\n=== Token Breakdown ===");
        for (const token of result.breakdown) {
            console.log(`\n${token.symbol} (${token.address})`);
            console.log("  Inbound:", token.inboundUsd.toFixed(6));
            console.log("  Outbound:", token.outboundUsd.toFixed(6));
            if (token.transfers?.length) {
                for (const transfer of token.transfers) {
                    console.log(`    [${transfer.direction}] ${transfer.amount.toFixed(6)} @ block ${transfer.blockNumber} (${transfer.transactionHash})`);
                }
            }
        }
    }
}

main().catch((error) => {
    console.error("\n❌ Net transfer example failed:", error);
    process.exit(1);
});
