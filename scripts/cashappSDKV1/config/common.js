// Centralized shared constants for SDK modules
const MAX_UINT256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

// Default public RPC endpoints per chain (extend as needed)
const DEFAULT_RPCS = {
    1: 'https://rpc.ankr.com/eth/d71a9cd8dd190bf86a472bb7c7211ec1d99f131c9739266c6420a2efcafe4325',
    8453: 'https://rpc.ankr.com/base/d71a9cd8dd190bf86a472bb7c7211ec1d99f131c9739266c6420a2efcafe4325'
};

module.exports = {
    MAX_UINT256,
    DEFAULT_RPCS
};
