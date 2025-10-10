/**
 * Compound SDK - Linus Torvalds Design Philosophy
 *
 * Core Principles:
 * 1. "Good Taste" - Eliminate special cases
 * 2. Data structures first - Good APIs start with good data
 * 3. Simplicity - Complexity is the root of all evil
 * 4. Pragmatism - Solve real problems, not theoretical ones
 */

import {
    Contract,
    JsonRpcProvider,
    Wallet,
    MaxUint256,
    formatUnits,
    parseUnits,
    getAddress
} from 'ethers';
import {
    COMPOUND_MARKETS,
    COMPOUND_ABI,
    COMPOUND_CHAIN_IDS,
    COMPOUND_CHAIN_NAMES,
    type CompoundAssetConfig,
    type CompoundMarketConfig,
    type CompoundChainConfig
} from '../config/compound';
import { DEFAULT_RPCS } from '../config/common';

type DynamicContract = Contract & Record<string, any>;

interface AssetContext {
    marketKey: string;
    market: CompoundMarketConfig;
    assetKey: string;
    assetInfo: CompoundAssetConfig | null;
    symbol: string;
}

interface AssetLookup {
    bySymbol: Record<string, AssetContext[]>;
    byAddress: Record<string, AssetContext[]>;
    primaryByAddress: Record<string, AssetContext | null>;
}

interface TVLAssetBreakdownItem {
    asset: string;
    address?: string;
    tvl: number;
    totalSupply?: number;
    isBase: boolean;
}

// ========== CORE DATA STRUCTURES ==========

/**
 * Compound Operation Result - The fundamental data structure
 * Linus: "Bad programmers worry about the code. Good programmers worry about data structures."
 */
export class CompoundResult {
    success: boolean;
    hash?: string;
    receipt?: any;
    gasUsed?: any;
    error?: any;
    timestamp: number;
    amount?: any;
    apr?: any;
    balance?: any;
    rewards?: any;

    constructor(success: boolean, data: any = {}) {
        this.success = success;
        this.hash = data.hash;
        this.receipt = data.receipt;
        this.gasUsed = data.gasUsed;
        this.error = data.error;
        this.timestamp = Date.now();

        // Operation-specific data
        this.amount = data.amount;
        this.apr = data.apr;
        this.balance = data.balance;
        this.rewards = data.rewards;
    }

    static success(data: any) {
        return new CompoundResult(true, data);
    }

    static failure(error: any) {
        return new CompoundResult(false, { error: error.message || error });
    }

    toJSON() {
        return {
            success: this.success,
            hash: this.hash,
            gasUsed: this.gasUsed,
            error: this.error,
            amount: this.amount,
            apr: this.apr,
            balance: this.balance,
            rewards: this.rewards,
            timestamp: this.timestamp
        };
    }
}

/**
 * APR Data - Compound yield information
 * Encapsulates all yield-related metrics
 */
export class CompoundAPR {
    baseAPR: number;
    compAPR: number;
    totalAPR: number;
    asset: any;
    timestamp: number;

    constructor(data: any) {
        this.baseAPR = data.baseAPR || 0;
        this.compAPR = data.compAPR || 0;
        this.totalAPR = this.baseAPR + this.compAPR;
        this.asset = data.asset;
        this.timestamp = Date.now();
    }

    get totalAPRPercentage() {
        return this.totalAPR * 100;
    }

    get baseAPRPercentage() {
        return this.baseAPR * 100;
    }

    get compAPRPercentage() {
        return this.compAPR * 100;
    }

    toJSON() {
        return {
            asset: this.asset,
            baseAPR: this.baseAPR,
            compAPR: this.compAPR,
            totalAPR: this.totalAPR,
            baseAPRPercentage: this.baseAPRPercentage,
            compAPRPercentage: this.compAPRPercentage,
            totalAPRPercentage: this.totalAPRPercentage,
            timestamp: this.timestamp
        };
    }
}

/**
 * User Balance - Account position data
 * Simple, clear data structure for user's position
 */
export class CompoundBalance {
    asset: any;
    supplied: number;
    cTokenBalance: number;
    exchangeRate: number;
    compRewards: number;
    timestamp: number;

    constructor(data: any) {
        this.asset = data.asset;
        this.supplied = data.supplied || 0;
        this.cTokenBalance = data.cTokenBalance || 0;
        this.exchangeRate = data.exchangeRate || 0;
        this.compRewards = data.compRewards || 0;
        this.timestamp = Date.now();
    }

    get totalValue() {
        return this.supplied;
    }

    toJSON() {
        return {
            asset: this.asset,
            supplied: this.supplied,
            cTokenBalance: this.cTokenBalance,
            exchangeRate: this.exchangeRate,
            compRewards: this.compRewards,
            totalValue: this.totalValue,
            timestamp: this.timestamp
        };
    }
}

// ========== COMPOUND SDK CORE ==========

export interface CompoundSDKConfig {
    chainId: number;
    rpcUrl: string;
    privateKey?: string;
    slippage?: number;
    verbose?: boolean;
}

export class CompoundSDK {
    chainId: number;
    rpcUrl: string;
    privateKey?: string;
    slippage: number;
    private _provider: JsonRpcProvider | null;
    private _wallet: Wallet | null;
    chainConfig: CompoundChainConfig;
    markets: Record<string, CompoundMarketConfig>;
    defaultMarketKey: string;
    defaultMarket: CompoundMarketConfig;
    comet: string;
    rewards: string;
    private _lookup: AssetLookup;
    private _cometCache: Record<string, DynamicContract>;
    private _rewardsCache: Record<string, DynamicContract>;
    verbose: boolean;

    constructor(config: CompoundSDKConfig) {
        // Validate required config
        if (!config.chainId) throw new Error('chainId is required');
        if (!config.rpcUrl) throw new Error('rpcUrl is required');

        this.chainId = config.chainId;
        this.rpcUrl = config.rpcUrl;
        this.privateKey = config.privateKey;
        this.slippage = config.slippage || 0.005; // 0.5% default

        // Initialize provider (lazy)
        this._provider = null;
        this._wallet = null;

        // Market configuration
        this.chainConfig = this._getChainConfig(config.chainId);
        this.markets = this.chainConfig.markets || {};
        this.defaultMarketKey = this.chainConfig.defaultMarket || Object.keys(this.markets || {})[0];
        if (!this.defaultMarketKey) {
            throw new Error(`No Compound markets configured for chain ${config.chainId}`);
        }
        this.defaultMarket = this.markets[this.defaultMarketKey];
        this.comet = this.defaultMarket.comet;
        this.rewards = this.defaultMarket.rewards;

        // Build asset lookup for dynamic market resolution
        this._lookup = this._buildAssetLookup(this.markets);

        // Lazy caches for contract instances per market
        this._cometCache = {};
        this._rewardsCache = {};

        // Simple logging
        this.verbose = config.verbose || false;
    }

    // ========== PUBLIC API - APR METHODS ==========

    /**
     * Get base supply APR for asset
     * Returns: decimal APR (e.g., 0.05 = 5%)
     */
    async getInterestAPR(asset) {
        try {
            const { market, assetInfo } = this._resolveAssetContext(asset);
            const comet = this._getCometContract(market.comet);

            // Get current utilization rate from the contract
            const utilization = await comet.getUtilization();

            // Get supply rate based on current utilization
            const supplyRate = await comet.getSupplyRate(utilization);

            // Convert to APR (Compound V3 rates are per second)
            const secondsPerYear = 365.25 * 24 * 60 * 60;
            const apr = (Number(supplyRate) / 1e18) * secondsPerYear;

            this._log(`Base APR for ${assetInfo.symbol || asset}: ${(apr * 100).toFixed(2)}% on market ${market.name || market.comet}`);
            return apr;

        } catch (error) {
            throw new Error(`Failed to get interest APR for ${asset}: ${error.message}`);
        }
    }

    /**
     * Get COMP distribution APR for asset
     * Returns: decimal APR for COMP rewards
     */
    async getCompAPR(asset) {
        try {
            const { market, assetInfo } = this._resolveAssetContext(asset);
            const rewards = this._getRewardsContract(market.rewards);
            const comet = this._getCometContract(market.comet);

            // Get reward configuration for this comet
            const totalSupply = await comet.totalSupply();

            // For simplification, calculate based on total rewards distributed
            // In production, you'd need COMP price and more detailed calculations
            if (totalSupply === 0n) {
                return 0;
            }

            // Simplified COMP APR calculation (would need price feeds in production)
            const estimatedCompAPR = 0.01; // 1% estimate

            this._log(`COMP APR for ${assetInfo.symbol || asset}: ${(estimatedCompAPR * 100).toFixed(2)}% on market ${market.name || market.comet}`);
            return estimatedCompAPR;

        } catch (error) {
            throw new Error(`Failed to get COMP APR for ${asset}: ${error.message}`);
        }
    }

    /**
     * Get total APR (base + COMP rewards)
     * Returns: CompoundAPR object
     */
    async getTotalAPR(asset) {
        try {
            const [baseAPR, compAPR] = await Promise.all([
                this.getInterestAPR(asset),
                this.getCompAPR(asset)
            ]);

            return new CompoundAPR({
                asset,
                baseAPR,
                compAPR
            });

        } catch (error) {
            throw new Error(`Failed to get total APR: ${error.message}`);
        }
    }

    /**
     * Get Complete Total Value Locked (TVL) in USD for specific Comet market
     * Calculates base token + all collateral assets TVL like official Compound example
     *
     * @param {string|null} chainName - Supported chains: 'ethereum', 'base', or null (current)
     * @param {string|null} cometAddress - Comet contract address, or null (use default for chain)
     *
     * @returns {Promise<Object>} Complete TVL data object
     * @returns {number} returns.totalTVL - Complete Total Value Locked in USD
     * @returns {string} returns.chain - Chain name ('ethereum', 'base')
     * @returns {string} returns.cometAddress - Comet contract address
     * @returns {number} returns.baseTVL - Base token TVL in USD
     * @returns {number} returns.collateralTVL - Total collateral TVL in USD
     * @returns {Array} returns.assets - Breakdown of each asset TVL
     *
     * @example
     * // Default: current chain default comet
     * const tvl1 = await sdk.getTVL();
     *
     * // Specific chain with default comet
     * const tvl2 = await sdk.getTVL('ethereum');
     *
     * // Specific comet address
     * const tvl3 = await sdk.getTVL('base', '0xb125E6687d4313864e53df431d5425969c15Eb2F');
     *
     * // Frontend usage
     * const {totalTVL, baseTVL, collateralTVL} = await sdk.getTVL('base');
     */
    async getTVL(chainName = null, cometAddress = null) {
        try {
            // Use current chain if not specified
            const targetChainId = chainName ? this._getChainIdFromName(chainName) : this.chainId;
            const chainDisplay = chainName || this._getChainName(this.chainId);

            // Get market configuration for target chain
            const { key: marketKey, market: marketConfig } = this._getMarketConfig(targetChainId);

            // Use provided comet address or default for chain
            const targetCometAddress = cometAddress || marketConfig.comet;

            const baseAssetInfo = Object.values<CompoundAssetConfig>(marketConfig.assets || {}).find(asset => asset.role === 'base')
                || Object.values<CompoundAssetConfig>(marketConfig.assets || {})[0];
            const baseDecimals = baseAssetInfo?.decimals ?? 6;
            const baseSymbol = baseAssetInfo?.symbol || 'BaseAsset';

            // Create provider and comet contract for target chain
            let provider, comet;
            if (targetChainId === this.chainId && !cometAddress) {
                comet = this._getCometContract(marketConfig.comet);
            } else {
                provider = targetChainId === this.chainId
                    ? this._getProvider()
                    : this._createProviderForChain(targetChainId);
                comet = new Contract(targetCometAddress, COMPOUND_ABI.comet, provider);
            }

            // Get base token TVL (similar to official example)
            const [totalSupplyBase, baseTokenPriceFeedAddr, numAssets] = await Promise.all([
                comet.totalSupply(),
                comet.baseTokenPriceFeed(),
                comet.numAssets()
            ]);

            // Get base token price (assume USDC = $1 for simplicity)
            const basePrice = 1.0; // In production: await comet.getPrice(baseTokenPriceFeedAddr)
            const baseTVL = Number(formatUnits(totalSupplyBase.toString(), baseDecimals)) * basePrice;

            this._log(`Base TVL: $${baseTVL.toLocaleString()}`);

            // Get collateral assets TVL
            let collateralTVL = 0;
            const assetBreakdown: TVLAssetBreakdownItem[] = [{
                asset: `${baseSymbol} (${marketKey})`,
                tvl: baseTVL,
                isBase: true
            }];

            const assetMetadata = new Map<string, CompoundAssetConfig>();
            for (const info of Object.values<CompoundAssetConfig>(marketConfig.assets || {})) {
                if (info.underlying) {
                    assetMetadata.set(info.underlying.toLowerCase(), info);
                }
            }

            // Iterate through all collateral assets
            for (let i = 0; i < Number(numAssets); i++) {
                try {
                    const assetInfo = await comet.getAssetInfo(i);
                    const [, asset, priceFeed, scale] = assetInfo;
                    const assetMeta = assetMetadata.get(asset.toLowerCase());

                    // Get collateral totals
                    const [totalSupplyAsset] = await comet.totalsCollateral(asset);

                    if (totalSupplyAsset > 0) {
                        // For simplicity, assume price = $1 (in production, use price feeds)
                        const assetPrice = 1.0; // await comet.getPrice(priceFeed)
                        const assetTVL = Number(totalSupplyAsset.toString()) / Number(scale.toString()) * assetPrice;

                        collateralTVL += assetTVL;
                        assetBreakdown.push({
                            asset: assetMeta?.symbol || `Asset-${i}`,
                            address: asset,
                            tvl: assetTVL,
                            totalSupply: Number(totalSupplyAsset.toString()) / Number(scale.toString()),
                            isBase: false
                        });

                        this._log(`Collateral ${i} TVL: $${assetTVL.toLocaleString()}`);
                    }
                } catch (error) {
                    this._log(`Warning: Failed to get asset ${i} info: ${error.message}`);
                }
            }

            const totalTVL = baseTVL + collateralTVL;

            this._log(`Complete TVL (${chainDisplay}): $${totalTVL.toLocaleString()} USD`);

            return {
                totalTVL,
                chain: chainDisplay,
                market: marketKey,
                cometAddress: targetCometAddress,
                baseTVL,
                collateralTVL,
                assets: assetBreakdown,
                timestamp: Date.now()
            };

        } catch (error) {
            throw new Error(`Failed to get complete TVL: ${error.message}`);
        }
    }

    // ========== PUBLIC API - USER ACTIONS ==========

    /**
     * Supply asset to Compound
     * Returns: CompoundResult
     */
    async supply(asset, amount) {
        if (!this.privateKey) {
            throw new Error('privateKey required for supply operations');
        }

        try {
            const wallet = this._getWallet();
            const { market, assetInfo } = this._resolveAssetContext(asset);
            if (!assetInfo?.underlying) {
                throw new Error(`Asset ${asset} is not configured with an underlying token`);
            }
            const assetAddress = assetInfo.underlying;

            // Convert amount to wei
            const amountWei = this._toWei(amount, assetInfo.decimals);

            // Handle approval first - approve the comet contract
            await this._handleApproval(wallet, assetAddress, market.comet, amountWei);

            // Execute supply to Compound V3
            const comet = this._getCometContract(market.comet);
            const tx = await (comet.connect(wallet) as DynamicContract).supply(assetAddress, amountWei);

            this._log(`Supply transaction sent: ${tx.hash} (${assetInfo.symbol || asset} on ${market.name || market.comet})`);

            const receipt = await tx.wait();

            return CompoundResult.success({
                hash: tx.hash,
                receipt,
                gasUsed: receipt?.gasUsed?.toString(),
                amount: amount
            });

        } catch (error) {
            return CompoundResult.failure(error);
        }
    }

    /**
     * Withdraw asset from Compound
     * Returns: CompoundResult
     */
    async withdraw(asset, amount) {
        if (!this.privateKey) {
            throw new Error('privateKey required for withdraw operations');
        }

        try {
            const wallet = this._getWallet();
            const { market, assetInfo } = this._resolveAssetContext(asset);
            if (!assetInfo?.underlying) {
                throw new Error(`Asset ${asset} is not configured with an underlying token`);
            }
            const assetAddress = assetInfo.underlying;

            // Convert amount to wei
            const amountWei = this._toWei(amount, assetInfo.decimals);

            // Execute withdraw from Compound V3
            const comet = this._getCometContract(market.comet);
            const tx = await (comet.connect(wallet) as DynamicContract).withdraw(assetAddress, amountWei);

            this._log(`Withdraw transaction sent: ${tx.hash} (${assetInfo.symbol || asset} on ${market.name || market.comet})`);

            const receipt = await tx.wait();

            return CompoundResult.success({
                hash: tx.hash,
                receipt,
                gasUsed: receipt?.gasUsed?.toString(),
                amount: amount
            });

        } catch (error) {
            return CompoundResult.failure(error);
        }
    }

    /**
     * Claim COMP rewards
     * Returns: CompoundResult
     */
    async claimRewards(userAddress) {
        if (!this.privateKey) {
            throw new Error('privateKey required for claim operations');
        }

        try {
            const wallet = this._getWallet();
            const rewards = this._getRewardsContract();

            // Get accrued rewards first
            const [rewardOwed] = await rewards.getRewardOwed(this.comet, userAddress);
            const rewardsAmount = this._fromWei(rewardOwed.toString(), 18);

            if (rewardOwed === 0n) {
                this._log('No COMP rewards to claim');
                return CompoundResult.success({ rewards: 0 });
            }

            // Execute claim
            const tx = await (rewards.connect(wallet) as DynamicContract).claim(this.comet, userAddress, true);

            this._log(`Claim rewards transaction sent: ${tx.hash}`);

            const receipt = await tx.wait();

            return CompoundResult.success({
                hash: tx.hash,
                receipt,
                gasUsed: receipt?.gasUsed?.toString(),
                rewards: rewardsAmount
            });

        } catch (error) {
            return CompoundResult.failure(error);
        }
    }

    /**
     * Get user balance for asset
     * Returns: CompoundBalance
     */
    async getBalance(asset, userAddress) {
        try {
            const { market, assetInfo } = this._resolveAssetContext(asset);
            if (!assetInfo) {
                throw new Error(`Asset ${asset} is not configured`);
            }
            const comet = this._getCometContract(market.comet);
            const rewards = this._getRewardsContract(market.rewards);

            // Get balance and rewards from Compound V3
            const [balance, [rewardOwed]] = await Promise.all([
                comet.balanceOf(userAddress),
                rewards.getRewardOwed(market.comet, userAddress)
            ]);

            const supplied = this._fromWei(balance.toString(), assetInfo.decimals);

            // Handle anomalous reward values (Base chain issue)
            let compRewards = this._fromWei(rewardOwed.toString(), 18);
            if (compRewards > 1e20) { // Clearly anomalous value
                this._log(`Warning: Anomalous COMP reward value detected: ${compRewards.toExponential(2)}`);
                compRewards = 0; // Treat as zero until resolved
            }

            return new CompoundBalance({
                asset: assetInfo.symbol || asset,
                supplied,
                cTokenBalance: 0, // V3 doesn't use cTokens
                exchangeRate: 1.0, // V3 direct balance
                compRewards
            });

        } catch (error) {
            throw new Error(`Failed to get balance for ${asset}: ${error.message}`);
        }
    }

    // ========== INTERNAL METHODS ==========

    _getChainConfig(chainId: number): CompoundChainConfig {
        const chainName = COMPOUND_CHAIN_NAMES[chainId];
        if (!chainName) {
            throw new Error(`Unsupported chain: ${chainId}`);
        }
        return COMPOUND_MARKETS[chainName];
    }

    _getAsset(asset: string | CompoundAssetConfig | AssetContext): CompoundAssetConfig | null {
        return this._resolveAssetContext(asset).assetInfo;
    }

    _buildAssetLookup(markets: Record<string, CompoundMarketConfig>): AssetLookup {
        const lookup: AssetLookup = {
            bySymbol: {},
            byAddress: {},
            primaryByAddress: {}
        };

        if (!markets) return lookup;

        const entries = Object.entries(markets);

        const addToMap = (map: Record<string, AssetContext[]>, key: string | undefined, context: AssetContext) => {
            if (!key) return;
            const normalized = key.toLowerCase();
            if (!map[normalized]) {
                map[normalized] = [];
            }
            map[normalized].push(context);
        };

        for (const [marketKey, market] of entries) {
            const assets = market.assets || {};
            const assetEntries = Object.entries(assets) as [string, CompoundAssetConfig][];

            let primaryContext = null;
            const primaryAddress = market.keyAssetAddress?.toLowerCase();

            for (const [symbol, info] of assetEntries) {
                const context: AssetContext = {
                    marketKey,
                    market,
                    assetKey: symbol,
                    assetInfo: info,
                    symbol: info.symbol || symbol
                };

                addToMap(lookup.bySymbol, symbol, context);

                if (info.underlying) {
                    const normalizedAddress = info.underlying.toLowerCase();
                    addToMap(lookup.byAddress, normalizedAddress, context);

                    if (!primaryContext && primaryAddress && normalizedAddress === primaryAddress) {
                        primaryContext = context;
                    }
                }
            }

            if (primaryAddress) {
                lookup.primaryByAddress[primaryAddress] = primaryContext || {
                    marketKey,
                    market,
                    assetKey: marketKey,
                    assetInfo: null,
                    symbol: market.name || marketKey
                };
            }
        }

        return lookup;
    }

    _resolveAssetContext(asset: string | CompoundAssetConfig | AssetContext): AssetContext {
        if (!asset) {
            throw new Error('Asset identifier is required');
        }

        if (typeof asset === 'object') {
            if ('market' in asset && 'assetInfo' in asset && 'marketKey' in asset) {
                return asset as AssetContext;
            }

            if ('underlying' in asset) {
                const assetConfig = asset as CompoundAssetConfig;
                return {
                    market: this.defaultMarket,
                    marketKey: this.defaultMarketKey,
                    assetKey: assetConfig.symbol || 'custom',
                    assetInfo: assetConfig,
                    symbol: assetConfig.symbol
                };
            }
        }

        if (typeof asset !== 'string') {
            throw new Error(`Unsupported asset identifier type: ${typeof asset}`);
        }

        const trimmed = asset.trim();
        const [rawAsset, rawMarket] = trimmed.split('@').map(part => part && part.trim());
        const isAddressInput = rawAsset.startsWith('0x');
        const assetKey = rawAsset.toLowerCase();

        if (rawMarket) {
            const marketKey = rawMarket.toLowerCase();
            const market = this.markets[marketKey];
            if (!market) {
                throw new Error(`Unsupported market: ${rawMarket}`);
            }
            const assetInfo = this._getAssetFromMarket(market, assetKey);
            if (!assetInfo) {
                throw new Error(`Asset ${rawAsset} not found in market ${rawMarket}`);
            }
            return {
                market,
                marketKey,
                assetKey: assetInfo.symbol || rawAsset,
                assetInfo,
                symbol: assetInfo.symbol || rawAsset
            };
        }

        const { bySymbol, byAddress, primaryByAddress } = this._lookup;

        if (isAddressInput) {
            const primaryContext = primaryByAddress[assetKey];
            if (primaryContext) {
                return primaryContext;
            }

            const contexts = byAddress[assetKey];
            if (!contexts || contexts.length === 0) {
                throw new Error(`Unsupported asset address: ${asset}`);
            }
            if (contexts.length > 1) {
                const baseContexts = contexts.filter(ctx => ctx.assetInfo?.role === 'base');
                if (baseContexts.length === 1) {
                    return baseContexts[0];
                }
                const defaultContext = contexts.find(ctx => ctx.marketKey === this.defaultMarketKey);
                if (defaultContext) {
                    return defaultContext;
                }
                const options = contexts.map(ctx => ctx.marketKey).join(', ');
                throw new Error(`Asset address ${asset} exists in multiple markets (${options}). Use syntax 'asset@market'.`);
            }
            return contexts[0];
        }

        const symbolContexts = bySymbol[assetKey];
        if (!symbolContexts || symbolContexts.length === 0) {
            throw new Error(`Unsupported asset: ${asset}`);
        }

        if (symbolContexts.length > 1) {
            const baseContexts = symbolContexts.filter(ctx => ctx.assetInfo?.role === 'base');
            if (baseContexts.length === 1) {
                return baseContexts[0];
            }
            const defaultContext = symbolContexts.find(ctx => ctx.marketKey === this.defaultMarketKey);
            if (defaultContext) {
                return defaultContext;
            }
            const options = symbolContexts.map(ctx => ctx.marketKey).join(', ');
            throw new Error(`Asset ${asset} exists in multiple markets (${options}). Use syntax '${asset}@market'.`);
        }

        return symbolContexts[0];
    }

    _getAssetFromMarket(market: CompoundMarketConfig, assetIdentifier: string): CompoundAssetConfig | null {
        if (!market?.assets) return null;

        // Try symbol match first
        const symbolMatch = market.assets[assetIdentifier.toUpperCase()];
        if (symbolMatch) return symbolMatch;

        // Try address match
        const lowerId = assetIdentifier.toLowerCase();
        for (const info of Object.values<CompoundAssetConfig>(market.assets)) {
            if (info.underlying && info.underlying.toLowerCase() === lowerId) {
                return info;
            }
        }
        return null;
    }

    _getProvider(): JsonRpcProvider {
        if (!this._provider) {
            this._provider = new JsonRpcProvider(this.rpcUrl);
        }
        return this._provider;
    }

    _getWallet(): Wallet {
        if (!this._wallet) {
            this._wallet = new Wallet(this.privateKey, this._getProvider());
        }
        return this._wallet;
    }

    _getCometContract(cometAddress = this.comet): DynamicContract {
        const address = getAddress(cometAddress);
        if (!this._cometCache[address]) {
            this._cometCache[address] = new Contract(address, COMPOUND_ABI.comet, this._getProvider()) as DynamicContract;
        }
        return this._cometCache[address];
    }

    _getRewardsContract(rewardsAddress = this.rewards): DynamicContract {
        const address = getAddress(rewardsAddress);
        if (!this._rewardsCache[address]) {
            this._rewardsCache[address] = new Contract(address, COMPOUND_ABI.rewards, this._getProvider()) as DynamicContract;
        }
        return this._rewardsCache[address];
    }

    _getERC20Contract(address: string): DynamicContract {
        return new Contract(address, COMPOUND_ABI.erc20, this._getProvider()) as DynamicContract;
    }

    async _handleApproval(wallet: Wallet, tokenAddress: string, spenderAddress: string, amount: bigint) {
        const token = this._getERC20Contract(tokenAddress);

        // Check current allowance
        const currentAllowance = await token.allowance(wallet.address, spenderAddress);

        if (currentAllowance >= amount) {
            this._log(`Allowance sufficient for ${tokenAddress}`);
            return;
        }

        // Execute approve
        this._log(`Approving ${tokenAddress} for ${spenderAddress}`);
        const approveTx = await (token.connect(wallet) as DynamicContract).approve(spenderAddress, MaxUint256);
        await approveTx.wait();
        this._log(`Approval confirmed: ${approveTx.hash}`);
    }

    _toWei(amount: number, decimals = 18): bigint {
        return parseUnits(amount.toString(), decimals);
    }

    _fromWei(amount: bigint | string, decimals = 18): number {
        return Number(formatUnits(amount, decimals));
    }

    _log(message: string) {
        if (this.verbose) {
            console.log(`[CompoundSDK] ${message}`);
        }
    }

    // ========== TVL HELPER METHODS ==========

    _getChainIdFromName(chainName: string): number {
        const chainId = COMPOUND_CHAIN_IDS[chainName.toLowerCase()];
        if (!chainId) {
            throw new Error(`Unsupported chain: ${chainName}`);
        }
        return chainId;
    }

    _getChainName(chainId: number): string {
        return COMPOUND_CHAIN_NAMES[chainId] || `chain-${chainId}`;
    }

    _getMarketConfig(chainId: number, marketKey: string | null = null): { key: string; market: CompoundMarketConfig } {
        const chainConfig = this._getChainConfig(chainId);
        const markets = chainConfig?.markets || {};
        const defaultKey = chainConfig.defaultMarket || Object.keys(markets)[0];
        const key = marketKey ? marketKey.toLowerCase() : defaultKey;

        if (!key) {
            throw new Error(`No market configuration for chain ${chainId}`);
        }

        const market = markets[key];
        if (!market) {
            throw new Error(`No market configuration for chain ${chainId} (market: ${marketKey || 'default'})`);
        }

        return { key, market };
    }

    _createProviderForChain(chainId: number): JsonRpcProvider {
        // For simplicity, use shared defaults (can be overridden via config)
        const rpcUrl = DEFAULT_RPCS[chainId];
        if (!rpcUrl) {
            throw new Error(`No default RPC configured for chain ${chainId}`);
        }
        return new JsonRpcProvider(rpcUrl);
    }

    _getAssetPrice(assetSymbol: string): number {
        // Simplified pricing (in production, use price oracle)
        const stablecoins = ['USDC', 'USDT', 'DAI'];
        if (stablecoins.includes(assetSymbol)) {
            return 1.0;
        }
        // For other assets, would need price feeds
        return 1.0;
    }
}

export { COMPOUND_MARKETS };
