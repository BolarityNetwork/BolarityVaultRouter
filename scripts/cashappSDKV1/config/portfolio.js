// Chain-specific token classification for wallet balance discovery
// Each entry groups tokens into `stable` and `assets` (non-stable) buckets.

const PORTFOLIO_TOKENS = {
    1: { // Ethereum Mainnet
        stable: [
            { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
            { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
            { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 }
        ],
        assets: [
            { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
            { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
            { symbol: 'WSTETH', address: '0x7f39C581F595B53c5cbAd5aBdcBAc420B74A6c6C', decimals: 18 }
        ]
    },
    10: { // Optimism
        stable: [
            { symbol: 'USDC', address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', decimals: 6 },
            { symbol: 'USDT', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
            { symbol: 'DAI', address: '0xda10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 }
        ],
        assets: [
            { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
            { symbol: 'WBTC', address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095', decimals: 8 },
            { symbol: 'OP', address: '0x4200000000000000000000000000000000000042', decimals: 18 }
        ]
    },
    8453: { // Base
        stable: [
            { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
            { symbol: 'USDBC', address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6 }
        ],
        assets: [
            { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
            { symbol: 'CBETH', address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', decimals: 18 },
            { symbol: 'CBBTC', address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8 },
            { symbol: 'WSTETH', address: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', decimals: 18 }
        ]
    }
};

module.exports = {
    PORTFOLIO_TOKENS
};
