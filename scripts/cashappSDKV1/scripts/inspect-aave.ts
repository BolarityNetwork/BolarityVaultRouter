import 'dotenv/config';
import { chainId as toAaveChainId, evmAddress } from '@aave/client';
import { markets as fetchMarkets, userSupplies } from '@aave/client/actions';
import { buildAaveClient } from '../src/aave/client';

const DEFAULT_CHAIN_ID = 8453;

function extractNumber(value: unknown): number {
    if (value == null) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof value === 'bigint') {
        return Number(value);
    }
    if (typeof value === 'object') {
        const maybe = value as Record<string, unknown>;
        if (typeof maybe.amount !== 'undefined') {
            return extractNumber(maybe.amount);
        }
        if (typeof maybe.value !== 'undefined') {
            return extractNumber(maybe.value);
        }
    }
    return 0;
}

function unwrapResult<T>(result: any): T | null {
    if (!result) return null;
    if (typeof result.isErr === 'function') {
        if (result.isErr()) {
            console.error('Result error:', result.error);
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
}

async function inspectAccount(account: string, chainId: number) {
    const client = buildAaveClient();
    const chainIdentifier = toAaveChainId(chainId);
    const user = evmAddress(account);

    console.log(`\n=== Inspecting Aave data for ${account} (chain ${chainId}) ===`);

    try {
        const marketResultRaw = await fetchMarkets(client, {
            chainIds: [chainIdentifier],
            user
        });

        const markets = unwrapResult<any[]>(marketResultRaw) ?? [];

        if (!markets.length) {
            console.log('\n-- fetchMarkets returned no markets or errored --');
        } else {
            console.log(`\n-- fetchMarkets returned ${markets.length} markets --`);
            for (const market of markets) {
                const marketAddress = market?.address || market?.marketAddress;
                console.log(`\nMarket: ${marketAddress} (${market?.name || 'unknown'})`);
                const reserves = Array.isArray(market?.supplyReserves) ? market.supplyReserves : [];
                console.log(`Reserves: ${reserves.length}`);
                for (const reserve of reserves) {
                    const symbol = reserve?.underlyingToken?.symbol || reserve?.symbol || reserve?.market?.symbol;
                    const reserveAddress = reserve?.underlyingToken?.address || reserve?.market?.underlyingTokenAddress;
                    const userState = reserve?.userState as Record<string, unknown> | undefined;
                    if (!userState) continue;

                    const supplyBalance = extractNumber(userState['supplyBalance']);
                    const principalBalance = extractNumber(userState['principalBalance']);
                    const aTokenBalance = extractNumber(userState['aTokenBalance']);
                    const walletBalance = extractNumber(userState['walletBalance']);
                    const balance = extractNumber(userState['balance']);
                    const balanceUsd = extractNumber(userState['usdValue'] ?? userState['balanceUsd'] ?? userState['balanceUSD']);

                    if (supplyBalance || principalBalance || aTokenBalance || walletBalance || balance) {
                        console.log(`  Reserve ${symbol || reserveAddress}:`);
                        console.log(`    supplyBalance:   ${supplyBalance}`);
                        console.log(`    principalBalance:${principalBalance}`);
                        console.log(`    aTokenBalance:   ${aTokenBalance}`);
                        console.log(`    walletBalance:   ${walletBalance}`);
                        console.log(`    balance (raw):   ${balance}`);
                        console.log(`    usdValue:        ${balanceUsd}`);
                    }
                }
            }
        }

        const marketsForSupply = markets
            .map(info => info?.address || info?.marketAddress)
            .filter(Boolean)
            .map((address: string) => ({
                chainId: chainIdentifier,
                address: evmAddress(address)
            }));

        const supplyResultRaw = await userSupplies(client, {
            user,
            markets: marketsForSupply
        });

        console.log(`\n-- userSupplies response --`);
        const positions = unwrapResult<any[]>(supplyResultRaw) ?? [];

        console.log(`Positions: ${positions.length}`);
        for (const position of positions) {
            const symbol = position?.reserve?.symbol || position?.symbol;
            const address = position?.reserve?.address || position?.reserve?.underlyingAsset;
            const supplyBalance = extractNumber(position?.supplyBalance);
            const principalBalance = extractNumber(position?.principalBalance);
            const balance = extractNumber(position?.balance);
            const walletBalance = extractNumber(position?.walletBalance);
            const aTokenBalance = extractNumber(position?.aTokenBalance);
            const balanceUsd = extractNumber(
                position?.balanceUsd
                ?? position?.balanceUSD
                ?? position?.underlyingBalanceUSD
                ?? position?.valueUsd
                ?? position?.valueUSD
            );

            console.log(`\n  Position ${symbol || address}:`);
            console.log(`    supplyBalance:   ${supplyBalance}`);
            console.log(`    principalBalance:${principalBalance}`);
            console.log(`    aTokenBalance:   ${aTokenBalance}`);
            console.log(`    balance:         ${balance}`);
            console.log(`    walletBalance:   ${walletBalance}`);
            console.log(`    usdValue:        ${balanceUsd}`);
            console.dir(position, { depth: 3 });
        }
    } catch (error) {
        console.error('Unexpected error while inspecting Aave data:', error);
    }
}

async function main() {
    const chainId = Number(process.env.BALANCE_CHAIN_ID || process.env.UNIFIED_CHAIN_ID || DEFAULT_CHAIN_ID);
    const accounts = process.argv.slice(2);

    const targets = accounts.length
        ? accounts
        : [
            '0x8271A5Fcb45066D77F88288f4c076E55fD61ffEA',
            '0xa550C6011DfBA4925abEb0B48104062682870BB8'
        ];

    for (const account of targets) {
        await inspectAccount(account, chainId);
    }
}

main().catch((error) => {
    console.error('inspect-aave failed:', error);
    process.exit(1);
});
