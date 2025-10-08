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
const { pendle, common } = require('./config');

// Shared configuration
const {
    PENDLE_ROUTER,
    PENDLE_API_BASE,
    PENDLE_CHAINS,
    ERC20_ABI,
    PENDLE_MARKETS,
    resolvePendleMarket
} = pendle;
const { MAX_UINT256 } = common;

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
        this.chainKey = this.chain.key;
        this.rpcUrl = config.rpcUrl;
        this.slippage = config.slippage || 0.01;
        this.receiver = config.receiver;
        this.privateKey = config.privateKey;

        // Initialize provider (lazy)
        this._provider = null;
        this._wallet = null;

        // Market registry for configured markets on this chain
        this.markets = PENDLE_MARKETS[this.chainKey]?.markets || {};

        // Simple logging
        this.verbose = config.verbose || false;
    }

    // ========== PUBLIC API ==========

    /**
     * Return metadata for a configured Pendle market
     */
    getMarketConfig(market) {
        const meta = this._resolveMarket(market);
        return { ...meta };
    }

    /**
     * Convenience helper returning token addresses for a market
     */
    getMarketTokens(market) {
        const meta = this.getMarketConfig(market);
        return {
            underlying: meta.underlying,
            sy: meta.sy,
            pt: meta.pt,
            yt: meta.yt,
            maturity: meta.maturity
        };
    }

    /**
     * Get PT token balance for an account on a given market
     * @param {string} market - Market alias or address
     * @param {string|null} userAddress - Account address (defaults to wallet/receiver)
     * @returns {Promise<Object>} balance info with formatted amount
     */
    async getPtBalance(market, userAddress = null) {
        const marketMeta = this._resolveMarket(market);

        if (!marketMeta.pt) {
            throw new Error(`PT token not configured for market ${marketMeta.alias || marketMeta.address}`);
        }

        let account = userAddress;
        if (!account) {
            if (this.privateKey) {
                account = this._getWallet().address;
            } else if (this.receiver) {
                account = this.receiver;
            } else {
                throw new Error('userAddress is required when privateKey or receiver is not configured');
            }
        }

        const accountAddress = ethers.getAddress(account);
        const ptAddress = ethers.getAddress(marketMeta.pt);
        const decimals = await this._getTokenDecimals(ptAddress);

        const balanceData = await this._getProvider().call({
            to: ptAddress,
            data: ERC20_ABI.balanceOf + ethers.zeroPadValue(accountAddress, 32).slice(2)
        });

        const balanceRaw = balanceData && balanceData !== '0x'
            ? BigInt(balanceData)
            : 0n;

        const formatted = ethers.formatUnits(balanceRaw, decimals);

        return {
            market: marketMeta.alias || marketMeta.address,
            account: accountAddress,
            token: ptAddress,
            balance: formatted,
            balanceRaw: balanceRaw.toString(),
            decimals
        };
    }

    /**
     * Get PT token maturity information
     * Returns: { maturityDate, daysToMaturity }
     */
    async getMaturityInfo(market) {
        try {
            const marketMeta = this._resolveMarket(market, { optional: true });
            const marketAddress = marketMeta?.address || market;
            const targetChainId = marketMeta?.chainId || this.chainId;

            // Use the correct Pendle API endpoint for market info
            const url = `${PENDLE_API_BASE}/core/v1/${targetChainId}/markets`;
            const response = await axios.get(url);

            // Find the specific market
            const lowerAddress = marketAddress.toLowerCase();
            const marketData = response.data.results?.find(m =>
                m.address.toLowerCase() === lowerAddress
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
            const directUrl = `${PENDLE_API_BASE}/core/v1/${targetChainId}/markets/${marketAddress}`;
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
            const marketMeta = this._resolveMarket(market, { optional: true });
            const marketAddress = marketMeta?.address || market;
            const targetChainId = marketMeta?.chainId || this.chainId;
            const resolvedTokenIn = this._resolveMarketToken(tokenIn, marketMeta, 'underlying');
            const resolvedTokenOut = this._resolveMarketToken(tokenOut, marketMeta, 'pt');

            if (!resolvedTokenIn) {
                throw new Error('tokenIn is required – provide explicit address or configure underlying in config');
            }

            if (!resolvedTokenOut) {
                throw new Error('tokenOut is required – provide explicit address or configure PT in config');
            }

            // Get token decimals dynamically
            const tokenInDecimals = await this._getTokenDecimals(resolvedTokenIn);
            console.log('Token In Decimals:', tokenInDecimals);
            const tokenOutDecimals = await this._getTokenDecimals(resolvedTokenOut);
            console.log('Token Out Decimals:', tokenOutDecimals);

            // Get swap quote
            const url = `${PENDLE_API_BASE}/core/v2/sdk/${targetChainId}/markets/${marketAddress}/swap`;
            const params = {
                receiver: this.receiver,
                slippage: this.slippage.toString(),
                tokenIn: resolvedTokenIn,
                tokenOut: resolvedTokenOut,
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
     * Get redeem quote - Convert PT & YT back to underlying tokens
     * Based on Pendle API: /v2/sdk/{chainId}/redeem
     */
    async getRedeemQuote(yt, amountIn, tokenOut = null, aggregators = null, ytDecimals = null) {
        try {
            // Get token decimals - use provided or query dynamically
            const actualYtDecimals = ytDecimals || await this._getTokenDecimals(yt);
            const tokenOutDecimals = tokenOut ? await this._getTokenDecimals(tokenOut) : 18;

            const url = `${PENDLE_API_BASE}/core/v2/sdk/${this.chainId}/redeem`;
            const params = {
                receiver: this.receiver,
                slippage: this.slippage.toString(),
                enableAggregator: true,
                yt,
                amountIn: this._toWei(amountIn, actualYtDecimals)
            };

            // Optional parameters
            if (tokenOut) params.tokenOut = tokenOut;
            if (aggregators) params.aggregators = aggregators;

            this._log(`Getting redeem quote: ${amountIn} YT → ${tokenOut || 'underlying'}`);

            const response = await axios.get(url, { params });
            const { data, tx, tokenApprovals } = response.data;

            // Calculate amounts
            const amountOut = this._fromWei(data.amountOut, tokenOutDecimals);

            return new SwapQuote({
                amountIn,
                amountOut,
                priceImpact: data.priceImpact || 0,
                slippage: this.slippage,
                calldata: tx,
                approvals: tokenApprovals,
                gas: tx.gasLimit,
                maturityDate: null, // Not applicable for redeem
                daysToMaturity: null,
                apy: null
            });

        } catch (error) {
            throw new Error(`Redeem quote failed: ${error.message}`);
        }
    }

    /**
     * Execute redeem transaction - Convert PT & YT to underlying tokens
     * Returns: TxResult
     */
    async executeRedeem(redeemQuote) {
        if (!this.privateKey) {
            throw new Error('privateKey required for execution');
        }

        try {
            const wallet = this._getWallet();

            // Handle approvals first
            await this._handleApprovals(wallet, redeemQuote.approvals);

            // Execute redeem
            const tx = await wallet.sendTransaction({
                to: redeemQuote.calldata.to,
                data: redeemQuote.calldata.data,
                value: redeemQuote.calldata.value || '0'
            });

            this._log(`Redeem transaction sent: ${tx.hash}`);

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
     * Complete arbitrage flow: Stablecoin -> PT -> profit extraction
     * This is the "good taste" API - no special cases
     */
    async arbitrageStablecoin(stablecoinAddress, amount, ptToken, market, options = {}) {
        const results = {
            step1: null, // Stablecoin -> PT
            step2: null, // PT profit -> Stablecoin
            totalProfit: 0,
            success: false
        };

        try {
            const marketMeta = this._resolveMarket(market);
            const stablecoin = this._resolveMarketToken(stablecoinAddress, marketMeta, 'underlying');
            const ptAddress = this._resolveMarketToken(ptToken, marketMeta, 'pt');

            if (!stablecoin) {
                throw new Error('Stablecoin address required – configure underlying token or pass explicit address');
            }

            if (!ptAddress) {
                throw new Error('PT token address required – configure PT token or pass explicit address');
            }

            // Step 1: Stablecoin -> PT
            this._log(`Step 1: Converting ${amount} tokens to PT`);
            const quote1 = await this.getQuote(stablecoin, ptAddress, amount, market);

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
                this._log(`Step 2: Converting ${profitPT} PT profit back to tokens`);
                const quote2 = await this.getQuote(ptAddress, stablecoin, profitPT, market);
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

    /**
     * Backward compatibility: USDC arbitrage
     * @deprecated Use arbitrageStablecoin() instead
     */
    async arbitrage(usdcAmount, ptToken, market, options = {}) {
        return this.arbitrageStablecoin(this.chain.usdc, usdcAmount, ptToken, market, options);
    }

    // ========== INTERNAL METHODS ==========

    _getChain(chainId) {
        const entry = Object.entries(PENDLE_CHAINS).find(([, chain]) => chain.id === chainId);
        if (!entry) throw new Error(`Unsupported chain: ${chainId}`);
        const [key, chain] = entry;
        return { ...chain, key };
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

    _resolveMarketToken(token, marketMeta, role) {
        if (!marketMeta) {
            return token;
        }

        if (!token) {
            return marketMeta[role] || null;
        }

        if (typeof token !== 'string') {
            return token;
        }

        const normalized = token.trim().toLowerCase();

        if (normalized === role || normalized === `market:${role}`) {
            return marketMeta[role] || null;
        }

        if (role === 'underlying' && normalized === 'underlying') {
            return marketMeta.underlying || null;
        }

        if (role === 'pt' && normalized === 'pt') {
            return marketMeta.pt || null;
        }

        if (role === 'yt' && normalized === 'yt') {
            return marketMeta.yt || null;
        }

        if (role === 'sy' && normalized === 'sy') {
            return marketMeta.sy || null;
        }

        return token;
    }

    _resolveMarket(market, { optional = false } = {}) {
        if (!market) {
            if (optional) return null;
            throw new Error('Market identifier is required');
        }

        if (typeof market === 'object') {
            if (market.chainId && market.chainId !== this.chainId) {
                throw new Error(`Market belongs to chain ${market.chainId}, SDK configured for chain ${this.chainId}`);
            }
            return market;
        }

        if (typeof market !== 'string') {
            if (optional) return null;
            throw new Error(`Unsupported market identifier type: ${typeof market}`);
        }

        const trimmed = market.trim();
        const resolved = resolvePendleMarket(trimmed);

        if (!resolved) {
            if (optional) return null;
            throw new Error(`Unknown Pendle market: ${market}. Add it to src/sdk/config/pendle.js`);
        }

        if (resolved.chainId && resolved.chainId !== this.chainId) {
            throw new Error(`Pendle market ${market} is configured for chain ${resolved.chain}, SDK is using chain ${this.chain.name}`);
        }

        return resolved;
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
    CHAINS: PENDLE_CHAINS,
    PENDLE_ROUTER
};
