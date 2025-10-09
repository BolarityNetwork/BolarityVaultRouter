export interface UnifiedBalanceItem {
    protocol: string;
    market?: string | null;
    symbol?: string | null;
    address?: string | null;
    ptToken?: string | null;
    role?: string | null;
    amount: number;
    usdValue: number;
    price?: number | null;
    decimals?: number | null;
    isStable?: boolean;
    raw?: Record<string, unknown> | null;
    category?: string | null;
    [key: string]: unknown;
}

export interface UnifiedBalanceTotals {
    usd: number;
    [currency: string]: unknown;
}

export interface UnifiedBalanceResult {
    protocol: string;
    chainId: number;
    account: string;
    currency: string;
    totals: UnifiedBalanceTotals;
    items: UnifiedBalanceItem[];
    metadata: Record<string, unknown>;
    timestamp: number;
}

export interface UnifiedBalanceSummary {
    account: string;
    chainId: number;
    currency: string;
    totals: {
        usd: number;
        depositsUsd?: number;
        walletUsd?: number;
        [key: string]: unknown;
    };
    protocols: UnifiedBalanceResult[];
    wallet: WalletBalance;
    failures: Array<{ protocol: string; token?: string | null; error: unknown }>;
    timestamp: number;
}

export interface UnifiedBalanceSummaryArgs {
    chainId?: number;
    accountAddress?: string;
    protocols?: string[];
    currency?: string;
    includeItems?: boolean;
}

export interface WalletBalance {
    stable: UnifiedBalanceItem[];
    assets: UnifiedBalanceItem[];
    totals: {
        usd: number;
        stableUsd: number;
        assetUsd: number;
    };
    failures: Array<{ token?: string | null; error: unknown }>;
    metadata: Record<string, unknown>;
}

export interface PriceOracleLike {
    getUsdPrice(args: {
        chainId: number;
        address?: string;
        symbol?: string;
        skipCache?: boolean;
    }): Promise<number>;
}

export interface UnifiedSDKInit {
    chainId?: number;
    account?: string;
    priceOracle?: PriceOracleLike;
    verbose?: boolean;
    extraStableSymbols?: string[];
    stableTokenMap?: Record<number, string[]>;
    rpcUrls?: Record<number, string> | Record<string, string>;
    aave?: Record<number, unknown> & { default?: unknown } | null;
    compound?: unknown;
    pendle?: unknown;
    transferExclusions?: Record<string, unknown> | string[] | null;
    excludeAddresses?: Record<string, unknown> | string[] | null;
    transferConfig?: {
        excludeAddresses?: Record<string, unknown> | string[] | null;
        [key: string]: unknown;
    } | null;
}

export interface GetUserBalanceArgs {
    chainId?: number;
    protocol: string;
    accountAddress?: string;
    currency?: string;
    includeItems?: boolean;
    options?: Record<string, unknown>;
}

export declare class DefaultPriceOracle implements PriceOracleLike {
    constructor(options?: {
        cacheTtlMs?: number;
        httpClient?: unknown;
        timeoutMs?: number;
    });

    getUsdPrice(args: {
        chainId: number;
        address?: string;
        symbol?: string;
        skipCache?: boolean;
    }): Promise<number>;
}

export interface NetTransferLogDetail {
    direction: 'in' | 'out';
    counterparty?: string | null;
    amount: number;
    blockNumber: number;
    transactionHash: string;
    timestamp: number;
}

export interface NetTransferTokenBreakdown {
    symbol: string;
    address: string;
    decimals: number;
    inboundUsd: number;
    outboundUsd: number;
    transfers?: NetTransferLogDetail[];
}

export interface NetTransferArgs {
    chainId?: number;
    userAddress?: string;
    accountAddress?: string;
    startTime: number | string | Date;
    endTime?: number | string | Date;
    tokens?: Array<string | { address: string; symbol?: string; decimals?: number }>
        | Record<string, unknown>;
    excludeAddresses?: Array<string | Record<string, unknown>> | Record<string, unknown>;
    includeBreakdown?: boolean;
    maxBlockSpan?: number;
    options?: Record<string, unknown>;
}

export interface NetTransferResult {
    chainId: number;
    account: string;
    startTime: number;
    endTime: number;
    inboundUsd: number;
    outboundUsd: number;
    netTransfer: number;
    tokensEvaluated: number;
    fromBlock: number;
    toBlock: number;
    logsEvaluated: number;
    breakdown?: NetTransferTokenBreakdown[];
}

export declare class UnifiedSDK {
    constructor(config?: UnifiedSDKInit);

    getUserBalance(args: GetUserBalanceArgs): Promise<UnifiedBalanceResult>;
    getUnifiedBalanceSummary(args?: UnifiedBalanceSummaryArgs): Promise<UnifiedBalanceSummary>;
    getNetTransfer(args: NetTransferArgs): Promise<NetTransferResult>;
}
