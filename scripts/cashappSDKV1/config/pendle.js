// Pendle protocol configuration and lightweight ABI encodings
const PENDLE_ROUTER = '0x888888888889758F76e7103c6CbF23ABbF58F946';
const PENDLE_SWAP = '0xd4F480965D2347d421F1bEC7F545682E5Ec2151D';
const PENDLE_API_BASE = 'https://api-v2.pendle.finance';

const PENDLE_CHAINS = {
    ethereum: { id: 1, name: 'Ethereum', usdc: '0xA0b86a33E6441E1A1E5c87A3dC9E1e18e8f0b456' },
    bsc: { id: 56, name: 'BSC', usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' },
    polygon: { id: 137, name: 'Polygon', usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' },
    base: { id: 8453, name: 'Base', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    arbitrum: { id: 42161, name: 'Arbitrum', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' }
};

const ERC20_ABI = {
    decimals: '0x313ce567',
    allowance: '0xdd62ed3e',
    approve: '0x095ea7b3',
    balanceOf: '0x70a08231'
};

// Pendle markets we support out of the box, grouped by chain for easy lookups
const PENDLE_MARKETS = {
    base: {
        defaultMarket: 'youusd-base',
        markets: {
            'youusd-base': {
                name: 'yoUSD-Base',
                address: '0x44e2b05b2c17a12b37f11de18000922e64e23faa',
                underlying: '0x0000000f2eb9f69274678c76222b35eec7588a65',
                sy: '0xe181aed8e14469231618504df46e8c069314589b',
                pt: '0xb04cee9901c0a8d783fe280ded66e60c13a4e296',
                yt: '0xe8652183d21bd5de4c8168c1d6c085db5333df11',
                maturity: null
            },
            'usde-base-20251211': {
                name: 'USDe-Base 11 Dec 2025',
                address: '0x8991847176b1d187e403dd92a4e55fc8d7684538',
                underlying: '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34',
                sy: '0x5dfbeaea9e41f85c334075482a20afb7031207ae',
                pt: '0x194b8fed256c02ef1036ed812cae0c659ee6f7fd',
                yt: '0x1490516d8391e4d0bcbd13b7a56b4fe4996478be',
                maturity: '2025-12-11'
            }
        }
    }
};

function buildMarketLookup(markets) {
    const byAddress = {};
    const byAlias = {};

    for (const [chainKey, chainMarkets] of Object.entries(markets)) {
        const { markets: entries = {} } = chainMarkets || {};
        for (const [alias, meta] of Object.entries(entries)) {
            if (!meta?.address) continue;
            const context = {
                chain: chainKey,
                chainId: PENDLE_CHAINS[chainKey]?.id,
                alias,
                ...meta
            };

            byAlias[alias.toLowerCase()] = context;
            byAddress[meta.address.toLowerCase()] = context;
        }
    }

    return { byAddress, byAlias };
}

const PENDLE_MARKET_LOOKUP = buildMarketLookup(PENDLE_MARKETS);

function resolvePendleMarket(identifier) {
    if (!identifier) return null;
    const value = identifier.toLowerCase();
    return PENDLE_MARKET_LOOKUP.byAddress[value]
        || PENDLE_MARKET_LOOKUP.byAlias[value]
        || null;
}

module.exports = {
    PENDLE_ROUTER,
    PENDLE_SWAP,
    PENDLE_API_BASE,
    PENDLE_CHAINS,
    ERC20_ABI,
    PENDLE_MARKETS,
    PENDLE_MARKET_LOOKUP,
    resolvePendleMarket
};
