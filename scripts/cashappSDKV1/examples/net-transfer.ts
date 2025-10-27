import 'dotenv/config';
import { Wallet } from 'ethers';
import {
    UnifiedSDK,
    DefaultPriceOracle,
    NetTransferArgs,
    NetTransferResult,
    NetTransferBatchResult,
    CHAINS
} from '../bolaritySDK';

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
    const fallbackAccount = process.env.NET_TRANSFER_ACCOUNT
        || process.env.ACCOUNT_ADDRESS
        || (privateKey ? new Wallet(privateKey).address : undefined);

    const accountsFromEnv = parseList(process.env.NET_TRANSFER_ACCOUNTS);
    const accounts = accountsFromEnv.length
        ? accountsFromEnv
        : (fallbackAccount ? [fallbackAccount] : []);

    if (!accounts.length) {
        throw new Error("Provide at least one account via NET_TRANSFER_ACCOUNTS, NET_TRANSFER_ACCOUNT, ACCOUNT_ADDRESS, or PRIVATE_KEY.");
    }

    const primaryAccount = accounts[0];

    const nowSeconds = Math.floor(Date.now() / 1000);
    const defaultWindow = Number(process.env.NET_TRANSFER_WINDOW_SECONDS || 300);
    const startTime = parseTimestamp(process.env.NET_TRANSFER_START, nowSeconds - defaultWindow);
    const endTime = parseTimestamp(process.env.NET_TRANSFER_END, nowSeconds);

    const includeBreakdown = String(process.env.NET_TRANSFER_BREAKDOWN || "false").toLowerCase() === "true";

    const sdk = new UnifiedSDK({
        chainId,
        account: primaryAccount,
        rpcUrls: { [chainId]: rpcUrl },
        priceOracle: new DefaultPriceOracle(),
        transferExclusions: parseList(process.env.NET_TRANSFER_EXCLUDE)
    });

    const args: NetTransferArgs = {
        chainId,
        startTime,
        endTime,
        includeBreakdown,
        tokens: parseTokenOverrides(process.env.NET_TRANSFER_TOKENS)
    };
    const isBatch = accounts.length > 1;

    if (isBatch) {
        args.accounts = accounts;
        const batch: NetTransferBatchResult = await sdk.getNetTransfers(args);
        console.log("\n=== Net Transfer Batch Summary ===");
        console.log("Accounts:", accounts.length);
        console.log("Chain:", batch.chainId);
        console.log("Window:", `${new Date(batch.startTime * 1000).toISOString()} → ${new Date(batch.endTime * 1000).toISOString()}`);
        console.log("Tokens Evaluated:", batch.tokensEvaluated);
        console.log("Block Range:", `${batch.fromBlock} → ${batch.toBlock}`);

        for (const summary of batch.accounts) {
            console.log(`\n- ${summary.account}`);
            console.log("  Inbound (USD):", summary.inboundUsd.toFixed(6));
            console.log("  Outbound (USD):", summary.outboundUsd.toFixed(6));
            const netUsd = summary.netUsd ?? (summary.inboundUsd - summary.outboundUsd);
            console.log("  Net (USD):", netUsd.toFixed(6));
            if (includeBreakdown && summary.breakdown?.length) {
                for (const token of summary.breakdown) {
                    console.log(`    · ${token.symbol}: +${token.inboundUsd.toFixed(6)} / -${token.outboundUsd.toFixed(6)}`);
                }
            }
        }
    } else {
        args.accountAddress = accounts[0];
        const single: NetTransferResult = await sdk.getNetTransfer(args);

        console.log("\n=== Net Transfer Summary ===");
        console.log("Account:", single.account);
        console.log("Chain:", single.chainId);
        console.log("Window:", `${new Date(single.startTime * 1000).toISOString()} → ${new Date(single.endTime * 1000).toISOString()}`);
        console.log("Inbound (USD):", single.inboundUsd.toFixed(6));
        console.log("Outbound (USD):", single.outboundUsd.toFixed(6));
        console.log("Net Transfer (USD):", single.netTransfer.toFixed(6));
        console.log("Tokens Evaluated:", single.tokensEvaluated);
        console.log("Block Range:", `${single.fromBlock} → ${single.toBlock}`);

        if (includeBreakdown && Array.isArray(single.breakdown)) {
            console.log("\n=== Token Breakdown ===");
            for (const token of single.breakdown) {
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
}

main().catch((error) => {
    console.error("\n❌ Net transfer example failed:", error);
    process.exit(1);
});
