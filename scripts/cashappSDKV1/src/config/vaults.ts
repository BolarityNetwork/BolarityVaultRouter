/**
 * CashApp vault registry.
 *
 * Each entry simply links to an underlying protocol config (Compound, Aave, Pendle, ...)
 * so downstream services can look up full metadata using existing configuration files.
 *
 * Example usage:
 *   import { VAULTS } from './vaults';
 *   const vault = VAULTS.flexi.find(v => v.id === 'cashapp-compound-usdc-base');
 *   if (vault?.protocol === 'compound') {
 *       const market = compound.COMPOUND_MARKETS[vault.chain].markets[vault.market];
 *       // expose market metadata via RPC or API
 *   }
 */

export type VaultCategory = 'flexi' | 'time';

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
}

export type VaultCatalogue = Record<VaultCategory, VaultReference[]>;

export const VAULTS: VaultCatalogue = {
    flexi: [
        {
            id: 'cashapp-compound-usdc-base',
            riskLevel: 'low',
            protocol: 'compound',
            chain: 'base',
            market: 'usdc',
            note: 'Flexi vault pointing to Base USDC Compound market.'
        },
        {
            id: 'cashapp-aave-usdc-base',
            riskLevel: 'low',
            protocol: 'aave',
            chain: 'base',
            market: 'usdc',
            note: 'Flexi vault pointing to Aave Base USDC reserve.'
        }
    ],
    time: [
        {
            id: 'cashapp-pendle-usde-20251211',
            riskLevel: 'medium',
            protocol: 'pendle',
            chain: 'base',
            market: 'usde-base-20251211',
            note: 'Time vault referencing Pendle PT USDe Dec 2025 market.'
        }
    ]
};

export const VAULT_LIST: VaultReference[] = [...VAULTS.flexi, ...VAULTS.time];
