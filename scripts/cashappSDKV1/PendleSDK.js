#!/usr/bin/env node
/**
 * Pendle SDK - Linus Torvalds Design Philosophy
 *
 * Core Principles:
 * 1. "Good Taste" - Eliminate special cases
 * 2. Simplicity - Complexity is the root of all evil
 * 3. Pragmatism - Solve real problems, not theoretical ones
 * 4. Data structures first - Good APIs start with good data
 */

const axios = require('axios');
const { ethers } = require('ethers');

// ========== CONSTANTS (No magic numbers) ==========
const PENDLE_ROUTER = '0x888888888889758F76e7103c6CbF23ABbF58F946';
const MAX_UINT256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

const CHAINS = {
    ethereum: { id: 1, name: 'Ethereum', usdc: '0xA0b86a33E6441E1A1E5c87A3dC9E1e18e8f0b456' },
    bsc: { id: 56, name: 'BSC', usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' },
    polygon: { id: 137, name: 'Polygon', usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' },
    base: { id: 8453, name: 'Base', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    arbitrum: { id: 42161, name: 'Arbitrum', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' }
};

const ERC20_ABI = {
    decimals: '0x313ce567',
    allowance: '0xdd62ed3e',
    approve: '0x095ea7b3'
};

// ========== CORE DATA STRUCTURES ==========

/**
 * Swap Quote - The fundamental data structure
 * Linus: "Bad programmers worry about the code. Good programmers worry about data structures."
 */
class SwapQuote {
    constructor(data) {
        this.amountIn = data.amountIn;
        this.amountOut = data.amountOut;
        this.exchangeRate = data.amountOut / data.amountIn;
        this.priceImpact = data.priceImpact;
        this.slippage = data.slippage;
        this.calldata = data.calldata;
        this.approvals = data.approvals || [];
        this.gas = data.gas;

        // Maturity and APY data
        this.maturityDate = data.maturityDate;
        this.daysToMaturity = data.daysToMaturity;
        this.apy = data.apy;
    }

    get profit() {
        return this.amountOut - this.amountIn;
    }

    get isprofitable() {
        return this.profit > 0;
    }

    get yieldRate() {
        return this.profit / this.amountIn;
    }

    get apyPercentage() {
        return this.apy ? (this.apy * 100) : null;
    }

    toJSON() {
        return {
            amountIn: this.amountIn,
            amountOut: this.amountOut,
            exchangeRate: this.exchangeRate,
            priceImpact: this.priceImpact,
            profit: this.profit,
            isprofitable: this.isprofitable,
            yieldRate: this.yieldRate,
            daysToMaturity: this.daysToMaturity,
            apy: this.apy,
            apyPercentage: this.apyPercentage
        };
    }
}

/**
 * Transaction Result - Consistent return structure
 * Eliminates the need for special case handling
 */
class TxResult {
    constructor(success, data = {}) {
        this.success = success;
        this.hash = data.hash;
        this.receipt = data.receipt;
        this.gasUsed = data.gasUsed;
        this.error = data.error;
        this.timestamp = Date.now();
    }

    static success(data) {
        return new TxResult(true, data);
    }

    static failure(error) {
        return new TxResult(false, { error: error.message || error });
    }
}

// ========== PENDLE SDK CORE ==========

class PendleSDK {
    constructor(config = {}) {
        // Validate required config
        if (!config.chainId) throw new Error('chainId is required');
        if (!config.rpcUrl) throw new Error('rpcUrl is required');

        this.chainId = config.chainId;
        this.chain = this._getChain(config.chainId);
        this.rpcUrl = config.rpcUrl;
        this.slippage = config.slippage || 0.01;
        this.receiver = config.receiver;
        this.privateKey = config.privateKey;

        // Initialize provider (lazy)
        this._provider = null;
        this._wallet = null;

        // Simple logging
        this.verbose = config.verbose || false;
    }

    // ========== PUBLIC API ==========

    /**
     * Get PT token maturity information
     * Returns: { maturityDate, daysToMaturity }
     */
    async getMaturityInfo(market) {
        try {
            // Use the correct Pendle API endpoint for market info
            const url = `https://api-v2.pendle.finance/core/v1/${this.chainId}/markets`;
            const response = await axios.get(url);

            // Find the specific market
            const marketData = response.data.results?.find(m =>
                m.address.toLowerCase() === market.toLowerCase()
            );

            if (marketData && marketData.expiry) {
                const maturityDate = new Date(marketData.expiry); // Direct ISO string parsing
                const now = new Date();
                const daysToMaturity = (maturityDate - now) / (1000 * 60 * 60 * 24);
                const maturityTimestamp = Math.floor(maturityDate.getTime() / 1000);

                this._log(`Found real maturity: ${maturityDate.toLocaleDateString()}`);
                return {
                    maturityDate,
                    daysToMaturity: Math.max(0, daysToMaturity),
                    maturityTimestamp
                };
            }

            // If market not found in list, try direct market query
            const directUrl = `https://api-v2.pendle.finance/core/v1/${this.chainId}/markets/${market}`;
            const directResponse = await axios.get(directUrl);

            if (directResponse.data.expiry) {
                const maturityDate = new Date(directResponse.data.expiry); // Direct ISO string parsing
                const now = new Date();
                const daysToMaturity = (maturityDate - now) / (1000 * 60 * 60 * 24);
                const maturityTimestamp = Math.floor(maturityDate.getTime() / 1000);

                this._log(`Found real maturity via direct query: ${maturityDate.toLocaleDateString()}`);
                return {
                    maturityDate,
                    daysToMaturity: Math.max(0, daysToMaturity),
                    maturityTimestamp
                };
            }

            throw new Error('Maturity not found in API response');

        } catch (error) {
            this._log(`Real maturity query failed: ${error.message}`);

            // Return null values instead of fallback
            return {
                maturityDate: null,
                daysToMaturity: null,
                maturityTimestamp: null
            };
        }
    }

    /**
     * Calculate APY based on profit and time to maturity
     * Returns: APY as decimal (e.g., 0.35 = 35%)
     */
    calculateAPY(amountIn, amountOut, daysToMaturity) {
        if (!daysToMaturity || daysToMaturity <= 0) return null;

        const yieldRate = (amountOut / amountIn) - 1;
        const yearsToMaturity = daysToMaturity / 365.25;

        // Compound APY calculation: (1 + yield)^(1/years) - 1
        const apy = Math.pow(1 + yieldRate, 1 / yearsToMaturity) - 1;

        return apy;
    }

    /**
     * Get swap quote with enhanced maturity and APY data
     * Returns: SwapQuote object or throws
     */
    async getQuote(tokenIn, tokenOut, amountIn, market) {
        try {
            // Get token decimals dynamically
            const tokenInDecimals = await this._getTokenDecimals(tokenIn);
            console.log('Token In Decimals:', tokenInDecimals);
            const tokenOutDecimals = await this._getTokenDecimals(tokenOut);
            console.log('Token Out Decimals:', tokenOutDecimals);

            // Get swap quote
            const url = `https://api-v2.pendle.finance/core/v2/sdk/${this.chainId}/markets/${market}/swap`;
            const params = {
                receiver: this.receiver,
                slippage: this.slippage.toString(),
                tokenIn,
                tokenOut,
                amountIn: this._toWei(amountIn, tokenInDecimals),
                enableAggregator: 'true'
            };

            const response = await axios.get(url, { params });
            const { data, tx, tokenApprovals } = response.data;

            // Get maturity info
            const maturityInfo = await this.getMaturityInfo(market);

            // Calculate amounts
            const amountOut = this._fromWei(data.amountOut, tokenOutDecimals);

            // Calculate APY
            const apy = this.calculateAPY(amountIn, amountOut, maturityInfo.daysToMaturity);

            return new SwapQuote({
                amountIn,
                amountOut,
                priceImpact: data.priceImpact,
                slippage: this.slippage,
                calldata: tx,
                approvals: tokenApprovals,
                gas: tx.gasLimit,
                maturityDate: maturityInfo.maturityDate,
                daysToMaturity: maturityInfo.daysToMaturity,
                apy
            });

        } catch (error) {
            throw new Error(`Quote failed: ${error.message}`);
        }
    }

    /**
     * Get quote for specific amount with APY example
     * Useful for frontend display
     */
    async getQuoteWithAPYExample(tokenIn, tokenOut, market, exampleAmount = 100) {
        const quote = await this.getQuote(tokenIn, tokenOut, exampleAmount, market);

        return {
            ...quote.toJSON(),
            exampleAmount,
            exampleProfit: quote.profit,
            exampleAPY: quote.apyPercentage
        };
    }

    /**
     * Execute swap transaction
     * Returns: TxResult
     */
    async executeSwap(quote) {
        if (!this.privateKey) {
            throw new Error('privateKey required for execution');
        }

        try {
            const wallet = this._getWallet();

            // Handle approvals first
            await this._handleApprovals(wallet, quote.approvals);

            // Execute swap
            const tx = await wallet.sendTransaction({
                to: quote.calldata.to,
                data: quote.calldata.data,
                value: quote.calldata.value || '0'
            });

            this._log(`Transaction sent: ${tx.hash}`);

            const receipt = await tx.wait();

            return TxResult.success({
                hash: tx.hash,
                receipt,
                gasUsed: receipt?.gasUsed?.toString()
            });

        } catch (error) {
            return TxResult.failure(error);
        }
    }

    /**
     * Complete arbitrage flow: USDC -> PT -> profit extraction
     * This is the "good taste" API - no special cases
     */
    async arbitrage(usdcAmount, ptToken, market, options = {}) {
        const results = {
            step1: null, // USDC -> PT
            step2: null, // PT profit -> USDC
            totalProfit: 0,
            success: false
        };

        try {
            // Step 1: USDC -> PT
            this._log(`Step 1: Converting ${usdcAmount} USDC to PT`);
            const quote1 = await this.getQuote(this.chain.usdc, ptToken, usdcAmount, market);

            if (!quote1.isprofitable) {
                throw new Error('Not profitable');
            }

            if (options.dryRun) {
                results.step1 = { quote: quote1, dryRun: true };
                results.totalProfit = quote1.profit;
                results.success = true;
                return results;
            }

            const tx1 = await this.executeSwap(quote1);
            if (!tx1.success) {
                throw new Error(`Step 1 failed: ${tx1.error}`);
            }
            results.step1 = { quote: quote1, transaction: tx1 };

            // Step 2: Extract profit
            const profitPT = quote1.profit;
            if (profitPT > 0.01) { // Minimum profitable amount
                this._log(`Step 2: Converting ${profitPT} PT profit to USDC`);
                const quote2 = await this.getQuote(ptToken, this.chain.usdc, profitPT, market);
                const tx2 = await this.executeSwap(quote2);

                if (tx2.success) {
                    results.step2 = { quote: quote2, transaction: tx2 };
                    results.totalProfit = quote2.amountOut;
                }
            }

            results.success = true;
            return results;

        } catch (error) {
            results.error = error.message;
            return results;
        }
    }

    // ========== INTERNAL METHODS ==========

    _getChain(chainId) {
        const chain = Object.values(CHAINS).find(c => c.id === chainId);
        if (!chain) throw new Error(`Unsupported chain: ${chainId}`);
        return chain;
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

    async _handleApprovals(wallet, approvals) {
        if (!approvals || approvals.length === 0) return;

        for (const approval of approvals) {
            const spender = approval.spender || PENDLE_ROUTER;

            // Check current allowance
            const allowanceData = ERC20_ABI.allowance +
                ethers.zeroPadValue(wallet.address, 32).slice(2) +
                ethers.zeroPadValue(spender, 32).slice(2);

            const currentAllowance = await wallet.provider.call({
                to: approval.token,
                data: allowanceData
            });

            const required = BigInt(approval.amount);
            const current = BigInt(currentAllowance || '0');

            if (current >= required) {
                this._log(`Allowance sufficient for ${approval.token}`);
                continue;
            }

            // Execute approve
            this._log(`Approving ${approval.token} for ${spender}`);
            const approveData = ERC20_ABI.approve +
                ethers.zeroPadValue(spender, 32).slice(2) +
                ethers.toBeHex(MAX_UINT256, 32).slice(2);

            const approveTx = await wallet.sendTransaction({
                to: approval.token,
                data: approveData
            });

            await approveTx.wait();
            this._log(`Approval confirmed: ${approveTx.hash}`);
        }
    }

    async _getTokenDecimals(tokenAddress) {
        try {
            // Ensure proper address format
            const address = ethers.getAddress(tokenAddress);

            // decimals() function call - no parameters needed
            const result = await this._getProvider().call({
                to: address,
                data: ERC20_ABI.decimals
            });
            return parseInt(result, 16);
        } catch (error) {
            // Fail fast - never guess decimals in DeFi
            throw new Error(`Failed to get token decimals for ${tokenAddress}: ${error.message}`);
        }
    }

    _toWei(amount, decimals = 18) {
        return (BigInt(Math.floor(amount * 1e6)) * 10n ** BigInt(decimals - 6)).toString();
    }

    _fromWei(amount, decimals = 18) {
        return Number(amount) / (10 ** decimals);
    }

    _log(message) {
        if (this.verbose) {
            console.log(`[PendleSDK] ${message}`);
        }
    }
}

// ========== EXPORTS ==========
module.exports = {
    PendleSDK,
    SwapQuote,
    TxResult,
    CHAINS,
    PENDLE_ROUTER
};