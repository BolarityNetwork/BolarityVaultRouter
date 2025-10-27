import 'dotenv/config';
import { chainId as toAaveChainId } from '@aave/client';
import { markets as fetchMarkets } from '@aave/client/actions';
import { buildAaveClient } from '../src/aave/client';

type Decimalish = string | number | { toString(): string };

const toNumber = (value: Decimalish | null | undefined): number => {
    if (value == null) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number(value);
    return Number(value.toString());
};

const unwrapResult = <T,>(result: any): T | null => {
    if (!result) return null;
    if (typeof result.isErr === 'function') {
        if (result.isErr()) {
            console.error('Aave SDK error:', result.error);
            return null;
        }
        if ('value' in result) {
            return result.value as T;
        }
    }
    if ('value' in (result as any)) {
        return (result as any).value as T;
    }
    return result as T;
};

async function main() {
    const args = process.argv.slice(2);
    const chainId = Number(args[0] || process.env.AAVE_TVL_CHAIN_ID || 8453);
    const filterSymbol = args[1] ? String(args[1]).toUpperCase() : null;
    const filterAddress = args[2] ? String(args[2]).toLowerCase() : null;

    const client = buildAaveClient();
    const chainIdentifier = toAaveChainId(chainId);

    const marketResult = await fetchMarkets(client, {
        chainIds: [chainIdentifier]
    });

    const markets = unwrapResult<any[]>(marketResult) ?? [];
    if (!markets.length) {
        console.error(`No markets returned for chain ${chainId}.`);
        process.exit(1);
    }

    let totalTvl = 0;
    let totalLiquidity = 0;

    console.log(`Aave TVL Snapshot (chain ${chainId})`);
    console.log('-----------------------------------');
    if (filterSymbol) {
        console.log(`Filter symbol: ${filterSymbol}`);
    }
    if (filterAddress) {
        console.log(`Filter address: ${filterAddress}`);
    }

    for (const market of markets) {
        const address = market?.address || market?.marketAddress || 'unknown';
        const name = market?.name || 'Unknown Market';
        const marketSize = toNumber(market?.totalMarketSize);
        const availableLiquidity = toNumber(market?.totalAvailableLiquidity);
        const borrowed = marketSize - availableLiquidity;
        const reserves = Array.isArray(market?.supplyReserves) ? market.supplyReserves : [];

        totalTvl += marketSize;
        totalLiquidity += availableLiquidity;

        if (filterSymbol || filterAddress) {
            for (const reserve of reserves) {
                const symbol = String(reserve?.underlyingToken?.symbol || reserve?.symbol || '').toUpperCase();
                const underlying = String(reserve?.underlyingToken?.address || '').toLowerCase();
                if (filterSymbol && symbol !== filterSymbol) continue;
                if (filterAddress && underlying !== filterAddress) continue;

                const suppliedUsd = toNumber(reserve?.size?.usd);
                const supplied = toNumber(reserve?.size?.amount?.value);
                const borrowedUsd = toNumber(reserve?.borrowInfo?.totalDebtBalanceUSD);

                console.log(`${name} (${address}) - ${symbol || underlying}`);
                console.log(`  Total Supplied:       ${supplied.toLocaleString(undefined, { maximumFractionDigits: 6 })}`);
                console.log(`  Total Supplied (USD): ${suppliedUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`);
                if (borrowedUsd) {
                    console.log(`  Total Borrowed (USD): ${borrowedUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`);
                }
                console.log('');
            }
            continue;
        }

        console.log(`${name} (${address})`);
        console.log(`  Total Market Size (TVL): ${marketSize.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`);
        console.log(`  Available Liquidity:     ${availableLiquidity.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`);
        console.log(`  Utilized (Borrowed):     ${borrowed.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`);

        if (reserves.length) {
            for (const reserve of reserves) {
                const symbol = reserve?.underlyingToken?.symbol || reserve?.symbol || reserve?.market?.symbol;
                const suppliedUsd = toNumber(reserve?.size?.usd);
                if (!suppliedUsd) continue;
                console.log(`    - ${symbol}: ${suppliedUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD supplied`);
            }
        }
        console.log('');
    }

    if (!filterSymbol && !filterAddress) {
        console.log('-----------------------------------');
        console.log(`Total TVL:        ${totalTvl.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`);
        console.log(`Total Liquidity:  ${totalLiquidity.toLocaleString(undefined, { maximumFractionDigits: 2 })} USD`);
    }
}

main().catch((error) => {
    console.error('Failed to fetch Aave TVL:', error);
    process.exit(1);
});
