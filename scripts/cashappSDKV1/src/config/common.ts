// Centralized shared constants for SDK modules
export const MAX_UINT256 =
    '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

// Default public RPC endpoints per chain (extend as needed)
export const DEFAULT_RPCS: Record<number, string> = {
    1: 'https://rpc.ankr.com/eth/d71a9cd8dd190bf86a472bb7c7211ec1d99f131c9739266c6420a2efcafe4325',
    8453: 'https://rpc.ankr.com/base/d71a9cd8dd190bf86a472bb7c7211ec1d99f131c9739266c6420a2efcafe4325'
};

// Default exclusion list for internal router/adapter addresses used when
// computing wallet net transfers.
export const DEFAULT_TRANSFER_EXCLUSIONS = {
    global: [
        '0xd4F480965D2347d421F1bEC7F545682E5Ec2151D', // Pendle Router (Base)
        '0x888888888889758F76e7103c6CbF23ABbF58F946', // Pendle Reward Distributor
        '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5'  // Aave Base Pool Configurator / Router
    ]
};
