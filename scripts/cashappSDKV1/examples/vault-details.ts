import 'dotenv/config';
import { compound } from '../src/config';
import { PENDLE_MARKETS } from '../src/config/pendle';
import { VAULTS, VAULT_LIST, VaultReference } from '../src/config/vaults';

function getCategory(vault: VaultReference): 'flexi' | 'time' {
  return VAULTS.flexi.includes(vault) ? 'flexi' : 'time';
}

function describeCompound(vault: VaultReference) {
  const chainConfig = compound.COMPOUND_MARKETS[vault.chain];
  if (!chainConfig) {
    throw new Error(`Compound chain config not found: ${vault.chain}`);
  }
  const market = chainConfig.markets[vault.market];
  if (!market) {
    throw new Error(`Compound market config not found: ${vault.chain}.${vault.market}`);
  }

  return {
    protocol: 'compound',
    chain: vault.chain,
    marketKey: vault.market,
    comet: market.comet,
    rewards: market.rewards,
    assets: market.assets
  };
}

function describePendle(vault: VaultReference) {
  const chainMarkets = PENDLE_MARKETS[vault.chain];
  if (!chainMarkets) {
    throw new Error(`Pendle chain config not found: ${vault.chain}`);
  }
  const market = chainMarkets.markets?.[vault.market];
  if (!market) {
    throw new Error(`Pendle market config not found: ${vault.chain}.${vault.market}`);
  }

  return {
    protocol: 'pendle',
    chain: vault.chain,
    marketKey: vault.market,
    address: market.address,
    tokens: {
      underlying: market.underlying,
      sy: market.sy,
      pt: market.pt,
      yt: market.yt,
      maturity: market.maturity
    }
  };
}

function describeAave(vault: VaultReference) {
  return {
    protocol: 'aave',
    chain: vault.chain,
    marketKey: vault.market,
    note: 'Use @aave/client to fetch dynamic reserve data at runtime.'
  };
}

function describeVault(vault: VaultReference) {
  switch (vault.protocol) {
    case 'compound':
      return describeCompound(vault);
    case 'pendle':
      return describePendle(vault);
    case 'aave':
      return describeAave(vault);
    default:
      throw new Error(`Unsupported vault protocol: ${vault.protocol}`);
  }
}

function formatVault(vault: VaultReference) {
  console.log('------------------------------');
  console.log('Vault ID:', vault.id);
  console.log('Category:', getCategory(vault));
  console.log('Protocol:', vault.protocol);
  console.log('Chain:', vault.chain);
  console.log('Market:', vault.market);
  if (vault.note) console.log('Note:', vault.note);
  if (vault.icon) console.log('Icon:', vault.icon);

  try {
    const details = describeVault(vault);
    console.dir(details, { depth: null });
  } catch (error) {
    console.error('Failed to build details:', (error as Error).message);
  }
}

async function main() {
  for (const vault of VAULT_LIST) {
    formatVault(vault);
  }
}

main().catch((error) => {
  console.error('vault-details failed:', error);
  process.exit(1);
});
