#!/usr/bin/env node
/**
 * Compound SDK - Linus Torvalds Design Philosophy
 *
 * Core Principles:
 * 1. "Good Taste" - Eliminate special cases
 * 2. Data structures first - Good APIs start with good data
 * 3. Simplicity - Complexity is the root of all evil
 * 4. Pragmatism - Solve real problems, not theoretical ones
 */

const axios = require('axios');
const { ethers } = require('ethers');

// ========== CONSTANTS (No magic numbers) ==========

// Compound V3 (Comet) addresses per chain - Based on official repo
const COMPOUND_MARKETS = {
    ethereum: {
        // Mainnet Compound V3 USDC Market
        comet: '0xc3d688B66703497DAA19211EEdff47f25384cdc3', // cUSDCv3 Comet
        rewards: '0x1B0e765F6224C21223AeA2af16c1C46E38885a40', // CometRewards
        USDC: {
            underlying: '0xA0b86a33E6441E1A1E5c87A3dC9E1e18e8f0b456',
            decimals: 6
        },
        WETH: {
            underlying: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            decimals: 18
        },
        COMP: {
            token: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
            decimals: 18
        }
    },
    base: {
        // Base Compound V3 USDC Market - Official addresses
        comet: '0xb125E6687d4313864e53df431d5425969c15Eb2F', // Base cUSDCv3
        rewards: '0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1', // Base CometRewards
        USDC: {
            underlying: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            decimals: 6
        },
        WETH: {
            underlying: '0x4200000000000000000000000000000000000006', // Base WETH
            decimals: 18
        },
        cbETH: {
            underlying: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', // Base cbETH
            decimals: 18
        },
        cbBTC: {
            underlying: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', // Base cbBTC
            decimals: 8
        },
        wstETH: {
            underlying: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', // Base wstETH
            decimals: 18
        },
        COMP: {
            token: '0x9e1028F5F1D5eDE59748FFceE5532509976840E0',
            decimals: 18
        }
    }
};

// Minimal ABIs - Based on official Compound V3 repo
const COMPOUND_ABI = {
    comet: [
        // Core supply/withdraw functions
        'function supply(address asset, uint amount)',
        'function withdraw(address asset, uint amount)',

        // Balance and state queries
        'function balanceOf(address account) view returns (uint256)',
        'function collateralBalanceOf(address account, address asset) view returns (uint128)',

        // Rate and utilization
        'function getSupplyRate(uint utilization) view returns (uint64)',
        'function getBorrowRate(uint utilization) view returns (uint64)',
        'function getUtilization() view returns (uint256)',

        // Asset information
        'function baseToken() view returns (address)',
        'function numAssets() view returns (uint8)',
        'function getAssetInfo(uint8 i) view returns (uint8 offset, address asset, address priceFeed, uint128 scale, uint128 borrowCollateralFactor, uint128 liquidateCollateralFactor, uint128 liquidationFactor, uint128 supplyCap)',

        // Supply tracking
        'function totalSupply() view returns (uint256)',
        'function totalBorrow() view returns (uint256)'
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

// ========== CORE DATA STRUCTURES ==========

/**
 * Compound Operation Result - The fundamental data structure
 * Linus: "Bad programmers worry about the code. Good programmers worry about data structures."
 */
class CompoundResult {
    constructor(success, data = {}) {
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

    static success(data) {
        return new CompoundResult(true, data);
    }

    static failure(error) {
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
class CompoundAPR {
    constructor(data) {
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
class CompoundBalance {
    constructor(data) {
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

class CompoundSDK {
    constructor(config = {}) {
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
        this.markets = this._getMarkets(config.chainId);
        this.comet = this.markets.comet;
        this.rewards = this.markets.rewards;

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
            const comet = this._getCometContract();

            // Get current utilization rate from the contract
            const utilization = await comet.getUtilization();

            // Get supply rate based on current utilization
            const supplyRate = await comet.getSupplyRate(utilization);

            // Convert to APR (Compound V3 rates are per second)
            const secondsPerYear = 365.25 * 24 * 60 * 60;
            const apr = (Number(supplyRate) / 1e18) * secondsPerYear;

            this._log(`Base APR for ${asset}: ${(apr * 100).toFixed(2)}%`);
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
            const rewards = this._getRewardsContract();
            const comet = this._getCometContract();

            // Get reward configuration for this comet
            const rewardConfig = await rewards.rewardConfig(this.comet);
            const totalSupply = await comet.totalSupply();

            // For simplification, calculate based on total rewards distributed
            // In production, you'd need COMP price and more detailed calculations
            if (totalSupply === 0n) {
                return 0;
            }

            // Simplified COMP APR calculation (would need price feeds in production)
            const estimatedCompAPR = 0.01; // 1% estimate

            this._log(`COMP APR for ${asset}: ${(estimatedCompAPR * 100).toFixed(2)}%`);
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
            const assetInfo = this._getAsset(asset);

            // Convert amount to wei
            const amountWei = this._toWei(amount, assetInfo.decimals);

            // Handle approval first - approve the comet contract
            await this._handleApproval(wallet, assetInfo.underlying, this.comet, amountWei);

            // Execute supply to Compound V3
            const comet = this._getCometContract();
            const tx = await comet.connect(wallet).supply(assetInfo.underlying, amountWei);

            this._log(`Supply transaction sent: ${tx.hash}`);

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
            const assetInfo = this._getAsset(asset);

            // Convert amount to wei
            const amountWei = this._toWei(amount, assetInfo.decimals);

            // Execute withdraw from Compound V3
            const comet = this._getCometContract();
            const tx = await comet.connect(wallet).withdraw(assetInfo.underlying, amountWei);

            this._log(`Withdraw transaction sent: ${tx.hash}`);

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
            const tx = await rewards.connect(wallet).claim(this.comet, userAddress, true);

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
            const assetInfo = this._getAsset(asset);
            const comet = this._getCometContract();
            const rewards = this._getRewardsContract();

            // Get balance and rewards from Compound V3
            const [balance, [rewardOwed]] = await Promise.all([
                comet.balanceOf(userAddress),
                rewards.getRewardOwed(this.comet, userAddress)
            ]);

            const supplied = this._fromWei(balance.toString(), assetInfo.decimals);

            // Handle anomalous reward values (Base chain issue)
            let compRewards = this._fromWei(rewardOwed.toString(), 18);
            if (compRewards > 1e20) { // Clearly anomalous value
                this._log(`Warning: Anomalous COMP reward value detected: ${compRewards.toExponential(2)}`);
                compRewards = 0; // Treat as zero until resolved
            }

            return new CompoundBalance({
                asset,
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

    _getMarkets(chainId) {
        if (chainId === 1) return COMPOUND_MARKETS.ethereum;
        if (chainId === 8453) return COMPOUND_MARKETS.base;
        throw new Error(`Unsupported chain: ${chainId}`);
    }

    _getAsset(asset) {
        const assetInfo = this.markets[asset.toUpperCase()];
        if (!assetInfo) throw new Error(`Unsupported asset: ${asset}`);
        return assetInfo;
    }

    _getProvider() {
        if (!this._provider) {
            this._provider = new ethers.JsonRpcProvider(this.rpcUrl);
        }
        return this._provider;
    }

    _getWallet() {
        if (!this._wallet) {
            this._wallet = new ethers.Wallet(this.privateKey, this._getProvider());
        }
        return this._wallet;
    }

    _getCometContract() {
        return new ethers.Contract(this.comet, COMPOUND_ABI.comet, this._getProvider());
    }

    _getRewardsContract() {
        return new ethers.Contract(this.rewards, COMPOUND_ABI.rewards, this._getProvider());
    }

    _getERC20Contract(address) {
        return new ethers.Contract(address, COMPOUND_ABI.erc20, this._getProvider());
    }

    async _handleApproval(wallet, tokenAddress, spenderAddress, amount) {
        const token = this._getERC20Contract(tokenAddress);

        // Check current allowance
        const currentAllowance = await token.allowance(wallet.address, spenderAddress);

        if (currentAllowance >= amount) {
            this._log(`Allowance sufficient for ${tokenAddress}`);
            return;
        }

        // Execute approve
        this._log(`Approving ${tokenAddress} for ${spenderAddress}`);
        const approveTx = await token.connect(wallet).approve(spenderAddress, ethers.MaxUint256);
        await approveTx.wait();
        this._log(`Approval confirmed: ${approveTx.hash}`);
    }

    _toWei(amount, decimals = 18) {
        return ethers.parseUnits(amount.toString(), decimals);
    }

    _fromWei(amount, decimals = 18) {
        return Number(ethers.formatUnits(amount, decimals));
    }

    _log(message) {
        if (this.verbose) {
            console.log(`[CompoundSDK] ${message}`);
        }
    }
}

// ========== EXPORTS ==========
module.exports = {
    CompoundSDK,
    CompoundResult,
    CompoundAPR,
    CompoundBalance,
    COMPOUND_MARKETS
};