import 'dotenv/config';
import axios from 'axios';
import { chainId as toAaveChainId } from '@aave/client';
import { markets as fetchMarkets } from '@aave/client/actions';
import { buildAaveClient } from '../src/aave/client';
import {
  CompoundSDK,
  PendleSDK,
  commonConfig,
  compoundConfig,
  pendleConfig,
  vaultConfig
} from '../bolaritySDK';
import type { VaultReference } from '../src/config/vaults';

const { DEFAULT_RPCS } = commonConfig;
const { COMPOUND_CHAIN_IDS, COMPOUND_MARKETS } = compoundConfig;
const { PENDLE_CHAINS, PENDLE_MARKETS, PENDLE_API_BASE } = pendleConfig;
const { VAULTS, VAULT_LIST } = vaultConfig;

const AAVE_CHAIN_IDS: Record<string, number> = {
    base: 8453
};

const compoundClients = new Map<number, CompoundSDK>();
const pendleClients = new Map<number, PendleSDK>();
const aaveClient = buildAaveClient();

function extractNumber(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === 'object') {
        const maybe = value as Record<string, unknown>;
        if (typeof maybe.amount !== 'undefined') return extractNumber(maybe.amount);
        if (typeof maybe.value !== 'undefined') return extractNumber(maybe.value);
    }
    return null;
}

function unwrapResult<T>(result: any): T | null {
    if (!result) return null;
    if (typeof result.isErr === 'function') {
        if (result.isErr()) {
            console.error('Aave SDK error:', result.error);
            return null;
        }
        if ('value' in result) return result.value as T;
    }
    if ('value' in (result as any)) return (result as any).value as T;
    return result as T;
}

function getRpcUrl(chainId: number): string {
    const envKey = `RPC_URL_${chainId}`;
    const envValue = process.env[envKey];
    const fallback = DEFAULT_RPCS[chainId];
    const globalRpc = process.env.RPC_URL;
    const rpc = envValue || fallback || globalRpc;
    if (!rpc) {
        throw new Error(`No RPC URL configured for chain ${chainId}. Set ${envKey} or RPC_URL.`);
    }
    return rpc;
}

function getCompoundClient(chainId: number): CompoundSDK {
    if (!compoundClients.has(chainId)) {
        compoundClients.set(chainId, new CompoundSDK({
            chainId,
            rpcUrl: getRpcUrl(chainId)
        }));
    }
    return compoundClients.get(chainId)!;
}

function getPendleClient(chainId: number): PendleSDK {
    if (!pendleClients.has(chainId)) {
        pendleClients.set(chainId, new PendleSDK({
            chainId,
            rpcUrl: getRpcUrl(chainId),
            receiver: process.env.PENDLE_RECEIVER_ADDRESS
        }));
    }
    return pendleClients.get(chainId)!;
}

function resolveCategory(vault: VaultReference): 'flexi' | 'time' {
    return VAULTS.flexi.includes(vault) ? 'flexi' : 'time';
}

async function fetchCompoundMetrics(vault: VaultReference) {
    const chainId = COMPOUND_CHAIN_IDS[vault.chain as keyof typeof COMPOUND_CHAIN_IDS];
    if (!chainId) {
        throw new Error(`Unknown Compound chain '${vault.chain}' for vault ${vault.id}`);
    }
    const marketConfig = COMPOUND_MARKETS[vault.chain]?.markets[vault.market];
    if (!marketConfig) {
        throw new Error(`Compound market not found: ${vault.chain}.${vault.market}`);
    }

    const sdk = getCompoundClient(chainId);
    const baseEntry = Object.entries(marketConfig.assets).find(([, asset]) => asset.role === 'base')
        || Object.entries(marketConfig.assets)[0];
    if (!baseEntry) {
        throw new Error(`Compound market ${vault.market} has no assets defined`);
    }
    const baseSymbol = baseEntry[0];

    const apr = await sdk.getTotalAPR(baseSymbol);
    const tvl = await sdk.getTVL(vault.chain, marketConfig.comet);

    return {
        apy: apr.totalAPR,
        tvl: tvl.totalTVL
    };
}

async function fetchPendleMetrics(vault: VaultReference) {
    const chainInfo = PENDLE_CHAINS[vault.chain as keyof typeof PENDLE_CHAINS];
    const marketConfig = PENDLE_MARKETS[vault.chain]?.markets?.[vault.market];
    if (!chainInfo || !marketConfig) {
        throw new Error(`Pendle market not found: ${vault.chain}.${vault.market}`);
    }

    const pendleSdk = getPendleClient(chainInfo.id);

    let apy: number | null = null;
    try {
        const config = pendleSdk.getMarketConfig(vault.market);
        const exampleAmount = Number(process.env.PENDLE_VAULT_SAMPLE_AMOUNT || '100');
        const quote = await pendleSdk.getQuoteWithAPYExample(
            config.underlying,
            config.pt,
            vault.market,
            exampleAmount
        );
        if (typeof quote.apy === 'number') {
            apy = quote.apy;
        }
    } catch (error) {
        console.error(`Pendle APY calculation failed for ${vault.id}:`, (error as Error).message);
    }

    let tvl: number | null = null;
    try {
        const url = `${PENDLE_API_BASE}/core/v1/${chainInfo.id}/markets/${marketConfig.address}`;
        const response = await axios.get(url);
        const data = response.data || {};
        if (typeof data?.liquidity?.usd === 'number') {
            tvl = data.liquidity.usd;
        }
    } catch (error) {
        console.error(`Pendle TVL fetch failed for ${vault.id}:`, (error as Error).message);
    }

    return { apy, tvl };
}

async function fetchAaveMetrics(vault: VaultReference) {
    const chainId = AAVE_CHAIN_IDS[vault.chain];
    if (!chainId) {
        throw new Error(`Unsupported Aave chain '${vault.chain}' for vault ${vault.id}`);
    }

    const chainIdentifier = toAaveChainId(chainId);
    const marketResult = await fetchMarkets(aaveClient, {
        chainIds: [chainIdentifier]
    });
    const markets = unwrapResult<any[]>(marketResult) ?? [];

    const targetSymbol = vault.market.toUpperCase();

    for (const market of markets) {
        const reserves = Array.isArray(market?.supplyReserves) ? market.supplyReserves : [];
        const reserve = reserves.find((entry: any) => {
            const symbol = entry?.underlyingToken?.symbol || entry?.symbol || entry?.market?.symbol;
            return typeof symbol === 'string' && symbol.toUpperCase() === targetSymbol;
        });
        if (reserve) {
            const apy = extractNumber(reserve?.supplyInfo?.apy?.value ?? reserve?.supplyInfo?.apy);
            const tvl = extractNumber(reserve?.supplyInfo?.totalSupplyBalanceUSD ?? reserve?.size?.usd);
            return { apy, tvl };
        }
    }

    return { apy: null, tvl: null };
}

async function fetchVaultMetrics(vault: VaultReference) {
    switch (vault.protocol) {
        case 'compound':
            return fetchCompoundMetrics(vault);
        case 'pendle':
            return fetchPendleMetrics(vault);
        case 'aave':
            return fetchAaveMetrics(vault);
        default:
            return { apy: null, tvl: null };
    }
}

function formatPercent(value: number | null | undefined) {
    if (value == null) return 'n/a';
    return `${(value * 100).toFixed(2)}%`;
}

function formatUsd(value: number | null | undefined) {
    if (value == null) return 'n/a';
    return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

async function main() {
    const rows: Array<Record<string, string>> = [];

    for (const vault of VAULT_LIST) {
        const category = resolveCategory(vault);
        const staticInfo = {
            id: vault.id,
            category,
            protocol: vault.protocol,
            chain: vault.chain,
            market: vault.market,
            risk: vault.riskLevel
        };

        let metrics: { apy: number | null; tvl: number | null } = { apy: null, tvl: null };
        try {
            metrics = await fetchVaultMetrics(vault);
        } catch (error) {
            console.error(`Failed to fetch metrics for ${vault.id}:`, (error as Error).message);
        }

        rows.push({
            ...staticInfo,
            apy: formatPercent(metrics.apy),
            tvl: formatUsd(metrics.tvl),
            note: vault.note || ''
        });
    }

    console.table(rows);
}

main().catch((error) => {
    console.error('vault-info example failed:', error);
    process.exit(1);
});
