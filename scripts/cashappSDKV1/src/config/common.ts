import { COMPOUND_MARKETS } from './compound';

// Centralized shared constants for SDK modules
export const MAX_UINT256 =
    '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

// Default public RPC endpoints per chain (extend as needed)
export const DEFAULT_RPCS: Record<number, string> = {
    1: 'https://rpc.ankr.com/eth/d71a9cd8dd190bf86a472bb7c7211ec1d99f131c9739266c6420a2efcafe4325',
    8453: 'https://rpc.ankr.com/base/d71a9cd8dd190bf86a472bb7c7211ec1d99f131c9739266c6420a2efcafe4325'
};

const DEFAULT_ROUTER_EXCLUSIONS = [
    '0xd4F480965D2347d421F1bEC7F545682E5Ec2151D', // Pendle Router (Base)
    '0x888888888889758F76e7103c6CbF23ABbF58F946', // Pendle Reward Distributor
    '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',  // Aave Base Pool Configurator / Router
    '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB'  // Aave aBas USDC
];

const collectCompoundCometAddresses = () => {
    const seen = new Set<string>();
    const addresses: string[] = [];

    for (const chainConfig of Object.values(COMPOUND_MARKETS || {})) {
        if (!chainConfig?.markets) continue;
        for (const market of Object.values(chainConfig.markets)) {
            const comet = market?.comet;
            if (typeof comet !== 'string') continue;
            const normalized = comet.toLowerCase();
            if (seen.has(normalized)) continue;
            seen.add(normalized);
            addresses.push(comet);
        }
    }

    return addresses;
};

// Default exclusion list for internal router/adapter addresses used when
// computing wallet net transfers.
export const DEFAULT_TRANSFER_EXCLUSIONS = {
    global: [
        ...DEFAULT_ROUTER_EXCLUSIONS,
        ...collectCompoundCometAddresses()
    ]
};
