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

import fs from 'fs';
import path from 'path';

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
    /** Optional icon path resolved relative to the package root */
    icon?: string;
}

export type VaultCatalogue = Record<VaultCategory, VaultReference[]>;

// Resolve icon assets whether we run from source (ts-node) or compiled dist output.
const ICON_ROOT_CANDIDATES = [
    path.join(__dirname, '../../assets/logos'),
    path.join(__dirname, '../../../assets/logos')
];

const ICON_ROOT =
    ICON_ROOT_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ??
    ICON_ROOT_CANDIDATES[0];

const resolveIcon = (fileName: string) => path.join(ICON_ROOT, fileName);

export const VAULTS: VaultCatalogue = {
    flexi: [
        {
            id: 'Compound-USDC-Base',
            riskLevel: 'low',
            protocol: 'compound',
            chain: 'base',
            market: 'usdc',
            note: 'USDC Compound market on Base',
            icon: resolveIcon('compound.png')
        },
        {
            id: 'Aave-USDC-Base',
            riskLevel: 'low',
            protocol: 'aave',
            chain: 'base',
            market: 'usdc',
            note: 'USDC Aave market on Base',
            icon: resolveIcon('aave.png')
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
            icon: resolveIcon('pendle.png')
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
