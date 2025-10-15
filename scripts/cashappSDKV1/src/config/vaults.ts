/**
 * CashApp vault registry.
 *
 * Each entry simply links to an underlying protocol config (Compound, Aave, Pendle, ...)
 * so downstream services can look up full metadata using existing configuration files.
 *
 * Example usage:
 *   import { VAULTS } from './vaults';
 *   const vault = VAULTS.flexi.find(v => v.id === 'Compound-USDC-Base');
 *   if (vault?.protocol === 'compound') {
 *       const market = compound.COMPOUND_MARKETS[vault.chain].markets[vault.market];
 *       // expose market metadata via RPC or API
 *   }
 */

export type VaultCategory = 'flexi' | 'time';

export interface VaultCategoryInfo {
    id: VaultCategory;
    name: string;
    description: string;
    icon?: string;
}

export interface VaultReference {
    riskLevel: 'low' | 'medium' | 'high';
    /** Unique identifier for this vault within CashApp */
    id: string;
    /** Underlying protocol config to reference */
    protocol: 'compound' | 'aave' | 'pendle';
    /** Chain key used in the protocol configuration (e.g. `base`, `ethereum`) */
    chain: string;
    /** Market identifier (e.g. `usdc`, `usde-base-20251211`) */
    market: string;
    /** Optional notes/docs for humans; runtime systems should ignore */
    note?: string;
    /** Optional icon path (relative to repo root, e.g., assets/logos/...) */
    icon?: string;
}

export type VaultCatalogue = Record<VaultCategory, VaultReference[]>;

export const VAULTS: VaultCatalogue = {
    flexi: [
        {
            id: 'Compound-USDC-Base',
            riskLevel: 'low',
            protocol: 'compound',
            chain: 'base',
            market: 'usdc',
            note: 'USDC Compound market on Base',
            icon: 'assets/logos/compound.png'
        },
        {
            id: 'Aave-USDC-Base',
            riskLevel: 'low',
            protocol: 'aave',
            chain: 'base',
            market: 'usdc',
            note: 'USDC Aave market on Base',
            icon: 'assets/logos/aave.png'
        }
    ],
    time: [
        {
            id: 'Pendle-USDe20251211-Base',
            riskLevel: 'medium',
            protocol: 'pendle',
            chain: 'base',
            market: 'usde-base-20251211',
            note: 'USDe Base market maturing on 11 Dec 2025',
            icon: 'assets/logos/pendle.png'
        }
    ]
};

export const VAULT_LIST: VaultReference[] = [...VAULTS.flexi, ...VAULTS.time];

export const VAULT_CATEGORY_INFO: VaultCategoryInfo[] = [
    {
        id: 'flexi',
        name: 'FlexiVault',
        description: 'Flexible access anytime',
        icon: ''
    },
    {
        id: 'time',
        name: 'TimeVault Pro',
        description: 'Higher returns, fixed term',
        icon: ''
    }
];
