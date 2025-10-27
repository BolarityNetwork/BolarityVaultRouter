// Compound V3 (Comet) configuration and ABIs
export type CompoundAssetRole = 'base' | 'collateral' | 'reward' | string;

export interface CompoundAssetConfig {
    symbol: string;
    underlying: string;
    decimals: number;
    role?: CompoundAssetRole;
}

export interface CompoundMarketConfig {
    name?: string;
    keyAssetAddress?: string;
    comet: string;
    rewards: string;
    assets: Record<string, CompoundAssetConfig>;
}

export interface CompoundChainConfig {
    defaultMarket: string;
    markets: Record<string, CompoundMarketConfig>;
}

export type CompoundMarketRegistry = Record<string, CompoundChainConfig>;

export const COMPOUND_MARKETS: CompoundMarketRegistry = {
    ethereum: {
        defaultMarket: 'usdc',
        markets: {
            usdc: {
                name: 'Ethereum USDC',
                keyAssetAddress: '0xA0b86a33E6441E1A1E5c87A3dC9E1e18e8f0b456',
                comet: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
                rewards: '0x1B0e765F6224C21223AeA2af16c1C46E38885a40',
                assets: {
                    USDC: {
                        symbol: 'USDC',
                        underlying: '0xA0b86a33E6441E1A1E5c87A3dC9E1e18e8f0b456',
                        decimals: 6,
                        role: 'base'
                    },
                    WETH: {
                        symbol: 'WETH',
                        underlying: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
                        decimals: 18,
                        role: 'collateral'
                    },
                    COMP: {
                        symbol: 'COMP',
                        underlying: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
                        decimals: 18,
                        role: 'reward'
                    }
                }
            }
        }
    },
    base: {
        defaultMarket: 'usdc',
        markets: {
            usdc: {
                name: 'Base USDC (Native)',
                keyAssetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                comet: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
                rewards: '0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1',
                assets: {
                    USDC: {
                        symbol: 'USDC',
                        underlying: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                        decimals: 6,
                        role: 'base'
                    },
                    WETH: {
                        symbol: 'WETH',
                        underlying: '0x4200000000000000000000000000000000000006',
                        decimals: 18,
                        role: 'collateral'
                    },
                    cbETH: {
                        symbol: 'cbETH',
                        underlying: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
                        decimals: 18,
                        role: 'collateral'
                    },
                    cbBTC: {
                        symbol: 'cbBTC',
                        underlying: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
                        decimals: 8,
                        role: 'collateral'
                    },
                    wstETH: {
                        symbol: 'wstETH',
                        underlying: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
                        decimals: 18,
                        role: 'collateral'
                    },
                    COMP: {
                        symbol: 'COMP',
                        underlying: '0x9e1028F5F1D5eDE59748FFceE5532509976840E0',
                        decimals: 18,
                        role: 'reward'
                    }
                }
            },
            usdbc: {
                name: 'Base USDbC (Bridged)',
                keyAssetAddress: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
                comet: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
                rewards: '0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1',
                assets: {
                    USDBC: {
                        symbol: 'USDbC',
                        underlying: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
                        decimals: 6,
                        role: 'base'
                    },
                    WETH: {
                        symbol: 'WETH',
                        underlying: '0x4200000000000000000000000000000000000006',
                        decimals: 18,
                        role: 'collateral'
                    },
                    cbETH: {
                        symbol: 'cbETH',
                        underlying: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
                        decimals: 18,
                        role: 'collateral'
                    },
                    cbBTC: {
                        symbol: 'cbBTC',
                        underlying: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
                        decimals: 8,
                        role: 'collateral'
                    },
                    COMP: {
                        symbol: 'COMP',
                        underlying: '0x9e1028F5F1D5eDE59748FFceE5532509976840E0',
                        decimals: 18,
                        role: 'reward'
                    }
                }
            },
            weth: {
                name: 'Base WETH',
                keyAssetAddress: '0x4200000000000000000000000000000000000006',
                comet: '0x46e6B241b524310239732D51387075E0e70970bf',
                rewards: '0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1',
                assets: {
                    WETH: {
                        symbol: 'WETH',
                        underlying: '0x4200000000000000000000000000000000000006',
                        decimals: 18,
                        role: 'base'
                    },
                    cbETH: {
                        symbol: 'cbETH',
                        underlying: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
                        decimals: 18,
                        role: 'collateral'
                    },
                    cbBTC: {
                        symbol: 'cbBTC',
                        underlying: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
                        decimals: 8,
                        role: 'collateral'
                    },
                    USDC: {
                        symbol: 'USDC',
                        underlying: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                        decimals: 6,
                        role: 'collateral'
                    },
                    COMP: {
                        symbol: 'COMP',
                        underlying: '0x9e1028F5F1D5eDE59748FFceE5532509976840E0',
                        decimals: 18,
                        role: 'reward'
                    }
                }
            }
        }
    }
};

export const COMPOUND_ABI = {
    comet: [
        'function supply(address asset, uint amount)',
        'function withdraw(address asset, uint amount)',
        'function balanceOf(address account) view returns (uint256)',
        'function collateralBalanceOf(address account, address asset) view returns (uint128)',
        'function getSupplyRate(uint utilization) view returns (uint64)',
        'function getBorrowRate(uint utilization) view returns (uint64)',
        'function getUtilization() view returns (uint256)',
        'function baseToken() view returns (address)',
        'function numAssets() view returns (uint8)',
        'function getAssetInfo(uint8 i) view returns (uint8 offset, address asset, address priceFeed, uint128 scale, uint128 borrowCollateralFactor, uint128 liquidateCollateralFactor, uint128 liquidationFactor, uint128 supplyCap)',
        'function totalSupply() view returns (uint256)',
        'function totalBorrow() view returns (uint256)',
        'function totalsCollateral(address asset) view returns (uint128 totalSupplyAsset, uint128 totalBorrowAsset)',
        'function getPrice(address priceFeed) view returns (uint256)',
        'function baseTokenPriceFeed() view returns (address)'
    ],
    rewards: [
        'function claim(address comet, address src, bool shouldAccrue)',
        'function getRewardOwed(address comet, address account) view returns (uint256, uint256)',
        'function rewardConfig(address comet) view returns (address token, uint64 rescaleFactor, bool shouldUpscale)'
    ],
    erc20: [
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)',
        'function balanceOf(address account) view returns (uint256)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
        'function name() view returns (string)'
    ]
};

export const COMPOUND_CHAIN_IDS = {
    ethereum: 1,
    base: 8453
};

export const COMPOUND_CHAIN_NAMES = Object.fromEntries(
    Object.entries(COMPOUND_CHAIN_IDS).map(([name, id]) => [id, name])
) as Record<number | string, string>;
