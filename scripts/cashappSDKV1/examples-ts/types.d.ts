declare module "../CompoundSDK" {
    export interface CompoundSDKOptions {
        chainId: number;
        rpcUrl: string;
        privateKey?: string;
        slippage?: number;
        verbose?: boolean;
    }

    export interface CompoundBalanceInfo {
        asset: string;
        supplied: number;
        compRewards?: number;
        totalValue?: number;
    }

    export class CompoundSDK {
        constructor(options: CompoundSDKOptions);
        getBalance(asset: string, userAddress: string): Promise<CompoundBalanceInfo>;
        getTotalAPR(asset: string): Promise<unknown>;
        getTVL(chainName?: string, cometAddress?: string): Promise<unknown>;
        markets?: Record<string, { assets?: Record<string, { symbol?: string }> }>;
        [key: string]: unknown;
    }
}

declare module "../PendleSDK" {
    export interface PendleSDKOptions {
        chainId: number;
        rpcUrl: string;
        receiver?: string;
        privateKey?: string;
        verbose?: boolean;
    }

    export interface PendleBalanceInfo {
        market: string;
        account?: string;
        balance: string;
        balanceRaw: string;
        decimals?: number;
    }

    export class PendleSDK {
        constructor(options: PendleSDKOptions);
        getPtBalance(market: string, userAddress?: string): Promise<PendleBalanceInfo>;
        getMarketConfig(market: string): Record<string, unknown>;
        markets: Record<string, unknown>;
        [key: string]: unknown;
    }

    export const CHAINS: Record<string, { id: number; name: string; usdc?: string }>;
}

declare module "../CompoundSDK.js" {
    export * from "../CompoundSDK";
}

declare module "../PendleSDK.js" {
    export * from "../PendleSDK";
}

declare module "../UnifiedSDK" {
    export * from "../UnifiedSDK.js";
}
