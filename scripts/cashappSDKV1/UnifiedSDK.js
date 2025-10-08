#!/usr/bin/env node
/**
 * Unified DeFi SDK - Cross protocol convenience helpers
 *
 * Linus Torvalds inspired philosophy:
 * 1. Fewer special cases produce better APIs
 * 2. Put data front and center
 * 3. Keep the surface small, grow capabilities incrementally
 */

const axios = require('axios');
const { ethers } = require('ethers');
const { CompoundSDK } = require('./CompoundSDK');
const { PendleSDK } = require('./PendleSDK');
const { pendle, common, portfolio } = require('./config');

const DEFAULT_STABLECOIN_SYMBOLS = new Set([
    'USDC', 'USDT', 'DAI', 'USDBC', 'USDP', 'USDS', 'PAX', 'BUSD', 'TUSD',
    'FRAX', 'LUSD', 'GUSD', 'SUSD', 'USD+', 'YOUUSD', 'PYUSD', 'USDE',
    'USDL', 'USX', 'USDD'
]);

const DEFI_LLAMA_CHAIN_IDS = {
    1: 'ethereum',
    10: 'optimism',
    56: 'bsc',
    137: 'polygon',
    8453: 'base',
    42161: 'arbitrum',
    43114: 'avax',
    59144: 'linea'
};

class DefaultPriceOracle {
    constructor(options = {}) {
        this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
        this.http = options.httpClient || axios.create({ timeout: options.timeoutMs ?? 10_000 });
        this.cache = new Map();
    }

    async getUsdPrice({ chainId, address, symbol, skipCache = false }) {
        if (!chainId) {
            throw new Error('chainId is required for price lookup');
        }

        if (symbol && DEFAULT_STABLECOIN_SYMBOLS.has(symbol.toUpperCase())) {
            return 1;
        }

        if (!address) {
            throw new Error('Token address is required for price lookup');
        }

        const cacheKey = `${chainId}:${address.toLowerCase()}`;
        const cached = this.cache.get(cacheKey);
        const now = Date.now();

        if (!skipCache && cached && (now - cached.timestamp) < this.cacheTtlMs) {
            return cached.value;
        }

        const chainKey = DEFI_LLAMA_CHAIN_IDS[chainId];
        if (!chainKey) {
            throw new Error(`Unsupported chain ${chainId} for default price oracle`);
        }

        const identifier = `${chainKey}:${address.toLowerCase()}`;
        const url = `https://coins.llama.fi/prices/current/${identifier}`;

        const response = await this.http.get(url);
        const price = response?.data?.coins?.[identifier]?.price;

        if (price == null) {
            throw new Error(`Unable to resolve USD price for ${identifier}`);
        }

        this.cache.set(cacheKey, { value: price, timestamp: now });
        return price;
    }
}

class UnifiedSDK {
    constructor(config = {}) {
        this.defaultChainId = config.chainId ?? null;
        this.defaultAccount = config.account ?? null;
        this.priceOracle = config.priceOracle || new DefaultPriceOracle(config.priceConfig);
        this.verbose = !!config.verbose;

        this.protocols = {
            aave: config.aave || {},
            compound: config.compound || null,
            pendle: config.pendle || null
        };

        this.portfolioTokens = config.portfolioTokens || portfolio.PORTFOLIO_TOKENS || {};
        this.rpcUrls = { ...(common.DEFAULT_RPCS || {}), ...(config.rpcUrls || {}) };
        this._providerCache = new Map();

        this.globalStableSymbols = new Set(DEFAULT_STABLECOIN_SYMBOLS);
        if (Array.isArray(config.extraStableSymbols)) {
            for (const symbol of config.extraStableSymbols) {
                if (!symbol) continue;
                this.globalStableSymbols.add(symbol.toUpperCase());
            }
        }

        this.globalStableAddresses = new Map();
        if (config.stableTokenMap) {
            for (const [chainKey, addresses] of Object.entries(config.stableTokenMap)) {
                const id = Number(chainKey);
                if (!Number.isFinite(id)) continue;
                this.globalStableAddresses.set(id, new Set((addresses || []).map(addr => addr.toLowerCase())));
            }
        }

        for (const [chainKey, tokens] of Object.entries(this.portfolioTokens || {})) {
            const stableList = tokens?.stable || [];
            if (!Array.isArray(stableList) || !stableList.length) continue;
            const chainId = Number(chainKey);
            if (!Number.isFinite(chainId)) continue;
            let set = this.globalStableAddresses.get(chainId);
            if (!set) {
                set = new Set();
                this.globalStableAddresses.set(chainId, set);
            }
            for (const token of stableList) {
                if (token?.symbol) {
                    this.globalStableSymbols.add(String(token.symbol).toUpperCase());
                }
                if (token?.address) {
                    set.add(token.address.toLowerCase());
                }
            }
        }
    }

    async getUserBalance({
        chainId,
        protocol,
        accountAddress,
        currency = 'usd',
        includeItems = true,
        options = {}
    }) {
        const resolvedChainId = chainId ?? this.defaultChainId;
        if (!resolvedChainId) {
            throw new Error('chainId is required');
        }

        const normalizedProtocol = (protocol || '').toString().toLowerCase();
        if (!normalizedProtocol) {
            throw new Error('protocol is required');
        }

        const account = this._resolveAccount(accountAddress);

        let result;
        switch (normalizedProtocol) {
            case 'aave':
                result = await this._getAaveBalances({ chainId: resolvedChainId, account, options });
                break;
            case 'compound':
                result = await this._getCompoundBalances({ chainId: resolvedChainId, account, options });
                break;
            case 'pendle':
                result = await this._getPendleBalances({ chainId: resolvedChainId, account, options });
                break;
            default:
                throw new Error(`Unsupported protocol: ${protocol}`);
        }

        const items = includeItems ? result.items : [];
        const totals = this._summarize(items, currency);

        return {
            protocol: normalizedProtocol,
            chainId: resolvedChainId,
            account,
            currency,
            totals,
            items,
            metadata: result.metadata || {},
            timestamp: Date.now()
        };
    }

    async getUnifiedBalanceSummary({
        chainId,
        accountAddress,
        protocols,
        currency = 'usd',
        includeItems = true
    } = {}) {
        const resolvedChainId = chainId ?? this.defaultChainId;
        if (!resolvedChainId) {
            throw new Error('chainId is required');
        }

        const account = this._resolveAccount(accountAddress);

        const requestedProtocols = Array.isArray(protocols) && protocols.length
            ? protocols.map(value => value.toString().toLowerCase())
            : ['aave', 'compound', 'pendle'];

        const responses = [];
        const failures = [];
        let depositsUsd = 0;

        for (const protocol of requestedProtocols) {
            let isConfigured = false;
            try {
                switch (protocol) {
                    case 'aave':
                        isConfigured = !!this._resolveAaveConfig(resolvedChainId);
                        break;
                    case 'compound':
                        isConfigured = !!this._resolveCompoundConfig(resolvedChainId);
                        break;
                    case 'pendle':
                        isConfigured = !!this._resolvePendleConfig(resolvedChainId);
                        break;
                    default:
                        failures.push({ protocol, error: 'Unsupported protocol' });
                        continue;
                }
            } catch (error) {
                failures.push({ protocol, error: error?.message || error });
                continue;
            }

            if (!isConfigured) {
                failures.push({ protocol, error: 'Protocol not configured for requested chain' });
                continue;
            }

            try {
                const result = await this.getUserBalance({
                    chainId: resolvedChainId,
                    protocol,
                    accountAddress: account,
                    currency,
                    includeItems
                });

                responses.push(result);
                depositsUsd += Number(result?.totals?.usd || 0);
            } catch (error) {
                failures.push({ protocol, error: error?.message || error });
            }
        }

        let wallet = {
            stable: [],
            assets: [],
            totals: { usd: 0, stableUsd: 0, assetUsd: 0 },
            failures: [],
            metadata: {}
        };

        try {
            wallet = await this._getWalletPortfolioBalances({
                chainId: resolvedChainId,
                account,
                includeItems
            });
        } catch (error) {
            failures.push({ protocol: 'wallet', error: error?.message || error });
        }

        const walletUsd = wallet?.totals?.usd || 0;
        const grandTotal = depositsUsd + walletUsd;

        if (Array.isArray(wallet?.failures)) {
            for (const entry of wallet.failures) {
                failures.push({ protocol: 'wallet', token: entry?.token, error: entry?.error });
            }
        }

        return {
            account,
            chainId: resolvedChainId,
            currency,
            totals: {
                usd: grandTotal,
                depositsUsd,
                walletUsd
            },
            protocols: responses,
            wallet,
            failures,
            timestamp: Date.now()
        };
    }

    _resolveAccount(accountAddress) {
        const account = accountAddress || this.defaultAccount;
        if (!account) {
            throw new Error('accountAddress is required');
        }
        return account;
    }

    _summarize(items, currency) {
        const totalUsd = items.reduce((acc, item) => acc + (Number(item.usdValue) || 0), 0);
        const bySymbol = {};
        for (const item of items) {
            const key = (item.symbol || item.address || 'unknown').toUpperCase();
            if (!bySymbol[key]) {
                bySymbol[key] = { amount: 0, usdValue: 0 };
            }
            bySymbol[key].amount += Number(item.amount) || 0;
            bySymbol[key].usdValue += Number(item.usdValue) || 0;
        }
        return {
            [currency]: totalUsd,
            usd: totalUsd,
            breakdown: bySymbol
        };
    }

    async _getWalletPortfolioBalances({ chainId, account, includeItems }) {
        const tokens = this.portfolioTokens?.[chainId];

        const empty = {
            stable: [],
            assets: [],
            totals: { usd: 0, stableUsd: 0, assetUsd: 0 },
            failures: [],
            metadata: { tokensEvaluated: 0 }
        };

        if (!tokens) {
            return empty;
        }

        const provider = this._getRpcProvider(chainId);
        if (!provider) {
            return {
                ...empty,
                failures: [{ token: null, error: `No RPC URL configured for chain ${chainId}` }]
            };
        }

        const stableItems = [];
        const assetItems = [];
        const failures = [];

        let stableTotal = 0;
        let assetTotal = 0;
        let evaluated = 0;

        const stableList = Array.isArray(tokens.stable) ? tokens.stable : [];
        for (const token of stableList) {
            evaluated += 1;
            try {
                const item = await this._readTokenBalance({
                    provider,
                    token,
                    account,
                    chainId,
                    treatAsStable: true
                });

                if (!item) continue;
                stableTotal += item.usdValue;
                if (includeItems) stableItems.push(item);
            } catch (error) {
                failures.push({ token: token?.symbol || token?.address, error: error?.message || error });
            }
        }

        const assetList = Array.isArray(tokens.assets) ? tokens.assets : [];
        for (const token of assetList) {
            evaluated += 1;
            try {
                const item = await this._readTokenBalance({
                    provider,
                    token,
                    account,
                    chainId,
                    treatAsStable: false
                });

                if (!item) continue;
                assetTotal += item.usdValue;
                if (includeItems) assetItems.push(item);
            } catch (error) {
                failures.push({ token: token?.symbol || token?.address, error: error?.message || error });
            }
        }

        const totals = {
            usd: stableTotal + assetTotal,
            stableUsd: stableTotal,
            assetUsd: assetTotal
        };

        return {
            stable: includeItems ? stableItems : [],
            assets: includeItems ? assetItems : [],
            totals,
            failures,
            metadata: {
                tokensEvaluated: evaluated
            }
        };
    }

    async _readTokenBalance({ provider, token, account, chainId, treatAsStable }) {
        if (!token) return null;

        const symbol = token.symbol ? String(token.symbol).toUpperCase() : null;
        let decimals = token.decimals != null ? Number(token.decimals) : undefined;
        let balanceRaw;

        if (token.isNative) {
            balanceRaw = await provider.getBalance(account);
            decimals = decimals ?? 18;
        } else {
            if (!token.address) {
                throw new Error(`Token ${symbol || 'unknown'} missing address`);
            }
            const contract = new ethers.Contract(token.address, [
                'function balanceOf(address) view returns (uint256)',
                'function decimals() view returns (uint8)'
            ], provider);

            balanceRaw = await contract.balanceOf(account);
            if (decimals == null) {
                try {
                    decimals = Number(await contract.decimals());
                } catch (error) {
                    decimals = 18;
                }
            }
        }

        if (balanceRaw == null) return null;

        const amount = Number(ethers.formatUnits(balanceRaw, decimals ?? 18));
        if (!amount) return null;

        let price = treatAsStable ? 1 : null;
        let usdValue = amount;

        if (!treatAsStable) {
            if (typeof token.price === 'number') {
                price = token.price;
            } else {
                const priceSymbol = token.priceSymbol || symbol;
                const priceAddress = token.priceAddress || token.address;
                price = this._resolvePriceOverride({ priceOverrides: token.priceOverrides, symbol: priceSymbol, address: priceAddress })
                    ?? await this.priceOracle.getUsdPrice({ chainId, address: priceAddress, symbol: priceSymbol });
            }

            usdValue = amount * (price ?? 0);
        }

        return {
            protocol: 'wallet',
            category: treatAsStable ? 'stable' : 'asset',
            symbol,
            address: token.address ? token.address.toLowerCase() : null,
            amount,
            usdValue,
            price,
            decimals,
            isStable: treatAsStable
        };
    }

    _getRpcProvider(chainId) {
        if (!this._providerCache) {
            this._providerCache = new Map();
        }
        if (this._providerCache.has(chainId)) {
            return this._providerCache.get(chainId);
        }
        const rpcUrl = this.rpcUrls?.[chainId];
        if (!rpcUrl) {
            return null;
        }
        const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
        this._providerCache.set(chainId, provider);
        return provider;
    }

    async _getAaveBalances({ chainId, account, options }) {
        const config = this._resolveAaveConfig(chainId);
        if (!config) {
            throw new Error(`Aave configuration not provided for chain ${chainId}`);
        }

        const { markets, client, stableSymbols = [], stableAddresses = [], priceOverrides = {} } = config;
        if (!client) {
            throw new Error('Aave client instance is required');
        }
        if (!Array.isArray(markets) || markets.length === 0) {
            throw new Error('Aave requires at least one market address');
        }

        let userSupplies; let fetchMarkets; let evmAddress; let asChainId;
        try {
            ({ userSupplies, markets: fetchMarkets } = require('@aave/client/actions'));
            ({ evmAddress, chainId: asChainId } = require('@aave/client'));
        } catch (error) {
            throw new Error('Please install @aave/client to enable Aave balance queries');
        }

        const user = evmAddress(account);
        const customStable = new Set(stableSymbols.map(symbol => symbol.toUpperCase()));
        const stableAddressSet = new Set(stableAddresses.map(addr => addr.toLowerCase()));
        const normalizedMarkets = markets.map(address => address.toLowerCase());
        const targetMarkets = new Set(normalizedMarkets);

        const items = [];
        let usedMarketsAction = false;

        if (fetchMarkets && typeof fetchMarkets === 'function' && typeof asChainId === 'function') {
            try {
                const marketResult = await fetchMarkets(client, {
                    chainIds: [asChainId(chainId)],
                    user
                });

                if (marketResult && typeof marketResult.isErr === 'function' && typeof marketResult.isOk === 'function') {
                    if (marketResult.isErr()) {
                        if (this.verbose) {
                            console.warn('Aave markets action error, falling back to userSupplies:', marketResult.error);
                        }
                    } else {
                        const marketsData = Array.isArray(marketResult.value) ? marketResult.value : [];
                        for (const marketInfo of marketsData) {
                            const marketAddress = (marketInfo?.address || marketInfo?.marketAddress || '').toLowerCase();
                            if (targetMarkets.size && !targetMarkets.has(marketAddress)) {
                                continue;
                            }

                            const reserves = Array.isArray(marketInfo?.supplyReserves) ? marketInfo.supplyReserves : [];
                            for (const reserve of reserves) {
                                const userState = reserve?.userState || {};
                                const amount = this._extractNumeric(
                                    userState?.balance
                                    ?? userState?.supplyBalance
                                    ?? userState?.aTokenBalance
                                    ?? userState?.walletBalance
                                );

                                if (!amount) {
                                    continue;
                                }

                                const reserveAddress = (reserve?.underlyingToken?.address || reserve?.market?.underlyingTokenAddress || '').toLowerCase();
                                const symbol = (reserve?.underlyingToken?.symbol || reserve?.market?.symbol || reserve?.symbol || '').toUpperCase();
                                const decimals = reserve?.underlyingToken?.decimals
                                    ?? reserve?.decimals
                                    ?? null;

                                const usdCandidate = this._extractNumeric(
                                    userState?.usdValue
                                    ?? userState?.balanceUsd
                                    ?? userState?.balanceUSD
                                    ?? userState?.supplyBalanceUsd
                                );

                                const isStable = this._isStableAsset(
                                    { symbol, address: reserveAddress, chainId },
                                    { customSymbolSet: customStable, customAddressSet: stableAddressSet }
                                );

                                let price = null;
                                let usdValue = usdCandidate;

                                if (!usdValue) {
                                    if (isStable) {
                                        usdValue = amount;
                                        price = 1;
                                    } else if (reserveAddress) {
                                        price = this._resolvePriceOverride({ priceOverrides, symbol, address: reserveAddress })
                                            ?? await this.priceOracle.getUsdPrice({ chainId, address: reserveAddress, symbol });
                                        usdValue = amount * price;
                                    }
                                } else if (!isStable) {
                                    price = usdValue / amount;
                                }

                                items.push({
                                    protocol: 'aave',
                                    market: marketInfo?.address || marketInfo?.marketAddress || null,
                                    symbol,
                                    address: reserveAddress,
                                    amount,
                                    usdValue,
                                    decimals,
                                    price,
                                    isStable,
                                    raw: {
                                        marketName: marketInfo?.name,
                                        reserve
                                    }
                                });
                            }
                        }

                        if (items.length) {
                            usedMarketsAction = true;
                        }
                    }
                }
            } catch (error) {
                if (this.verbose) {
                    console.warn('Aave markets action threw, falling back to userSupplies:', error?.message || error);
                }
            }
        }

        if (!usedMarketsAction) {
            const result = await userSupplies(client, { markets, user });

            let positions = [];
            if (result && typeof result.isErr === 'function' && typeof result.isOk === 'function') {
                if (result.isErr()) {
                    const reason = result.error?.message || result.error || 'unknown error';
                    throw new Error(`Aave userSupplies error: ${reason}`);
                }
                positions = Array.isArray(result.value) ? result.value : [];
            } else if (Array.isArray(result?.value)) {
                positions = result.value;
            } else if (Array.isArray(result)) {
                positions = result;
            }

            for (const position of positions) {
                const reserve = position.reserve || position.underlyingReserve || {};
                const symbol = (reserve.symbol || reserve.ticker || position.symbol || '').toUpperCase();
                const address = (reserve.address || reserve.underlyingAsset || reserve.underlyingAddress || '').toLowerCase();
                const decimals = reserve.decimals ?? position.decimals ?? null;

                const amount = this._extractNumeric(
                    position?.balance
                    ?? position?.underlyingBalance
                    ?? position?.supplyBalance
                    ?? reserve?.aTokenBalance
                    ?? position
                );

                if (!amount) {
                    continue;
                }

                const usdCandidate = this._extractNumeric(
                    position?.balanceUsd
                    ?? position?.balanceUSD
                    ?? position?.underlyingBalanceUSD
                    ?? position?.valueUsd
                    ?? position?.valueUSD
                    ?? reserve?.balanceUSD
                    ?? reserve?.balanceUsd
                );

                const isStable = this._isStableAsset({ symbol, address, chainId }, { customSymbolSet: customStable, customAddressSet: stableAddressSet });

                let price = null;
                let usdValue = usdCandidate;

                if (!usdValue) {
                    if (isStable) {
                        usdValue = amount;
                        price = 1;
                    } else {
                        price = this._resolvePriceOverride({ priceOverrides, symbol, address })
                            ?? await this.priceOracle.getUsdPrice({ chainId, address, symbol });
                        usdValue = amount * price;
                    }
                } else if (!isStable) {
                    price = usdValue / amount;
                }

                items.push({
                    protocol: 'aave',
                    market: position.market?.address || position.marketAddress || reserve.market || null,
                    symbol,
                    address,
                    amount,
                    usdValue,
                    decimals,
                    price,
                    isStable,
                    raw: {
                        aToken: reserve.aTokenAddress || reserve.aToken,
                        reserveAddress: address,
                        market: position.market?.address || position.marketAddress || reserve.market || null
                    }
                });
            }
        }

        return {
            items,
            metadata: {
                protocol: 'aave',
                markets,
                positionsCount: items.length
            }
        };
    }

    async _getCompoundBalances({ chainId, account, options }) {
        const context = this._resolveCompoundConfig(chainId);
        if (!context) {
            throw new Error(`Compound configuration not provided for chain ${chainId}`);
        }

        const sdk = context.sdk || context.instance || context;
        if (!(sdk instanceof CompoundSDK)) {
            throw new Error('Compound SDK instance is required');
        }

        const customStable = new Set((context.stableSymbols || []).map(symbol => symbol.toUpperCase()));
        const stableAddressSet = new Set((context.stableAddresses || []).map(addr => addr.toLowerCase()));
        const priceOverrides = context.priceOverrides || {};

        const marketEntries = Object.entries(sdk.markets || {});
        const allowedSymbols = new Set((context.assets || []).map(symbol => symbol.toUpperCase()));

        const items = [];
        const failures = [];

        for (const [marketKey, market] of marketEntries) {
            if (!market?.comet) continue;

            const assets = market?.assets || {};
            const baseAssetEntry = Object.entries(assets).find(([, info]) => (info?.role || '').toLowerCase() === 'base');
            if (!baseAssetEntry) continue;

            const [baseKey, baseInfo] = baseAssetEntry;
            const symbol = (baseInfo?.symbol || baseKey || '').toUpperCase();
            if (!symbol) continue;

            if (allowedSymbols.size && !allowedSymbols.has(symbol)) {
                continue;
            }

            const decimals = baseInfo?.decimals ?? 18;
            const address = baseInfo?.underlying ? baseInfo.underlying.toLowerCase() : null;

            let amount = 0;
            try {
                const comet = sdk._getCometContract(market.comet);
                const balanceRaw = await comet.balanceOf(account);
                amount = Number(ethers.formatUnits(balanceRaw, decimals));
            } catch (error) {
                if (this.verbose) {
                    console.warn(`Compound comet balance failed for market ${marketKey}:`, error?.message || error);
                }
                failures.push({ market: marketKey, asset: symbol, error: error?.message || error });
                continue;
            }

            if (!amount) continue;

            const isStable = this._isStableAsset(
                { symbol, address, chainId },
                { customSymbolSet: customStable, customAddressSet: stableAddressSet }
            );

            let price = null;
            let usdValue = null;
            if (isStable) {
                usdValue = amount;
                price = 1;
            } else {
                price = this._resolvePriceOverride({ priceOverrides, symbol, address })
                    ?? await this.priceOracle.getUsdPrice({ chainId, address, symbol });
                usdValue = amount * price;
            }

            items.push({
                protocol: 'compound',
                market: marketKey,
                symbol,
                address,
                amount,
                usdValue,
                decimals,
                price,
                isStable
            });
        }

        return {
            items,
            metadata: {
                protocol: 'compound',
                markets: marketEntries.map(([key]) => key),
                failures
            }
        };
    }

    async _getPendleBalances({ chainId, account, options }) {
        const context = this._resolvePendleConfig(chainId);
        if (!context) {
            throw new Error(`Pendle configuration not provided for chain ${chainId}`);
        }

        const sdk = context.sdk || context.instance || context;
        if (!(sdk instanceof PendleSDK)) {
            throw new Error('Pendle SDK instance is required');
        }

        const markets = Array.isArray(context.markets) && context.markets.length
            ? context.markets
            : Object.keys(sdk.markets || {});

        if (!markets.length) {
            throw new Error('No Pendle markets configured');
        }

        const customStable = new Set((context.stableSymbols || []).map(symbol => symbol.toUpperCase()));
        const stableAddressSet = new Set((context.stableAddresses || []).map(addr => addr.toLowerCase()));
        const priceOverrides = context.priceOverrides || {};

        const items = [];
        for (const market of markets) {
            const balance = await sdk.getPtBalance(market, account);
            const amount = Number(balance?.balance || 0);
            if (!amount) continue;

            const marketConfig = sdk.getMarketConfig(market) || {};
            const underlyingAddress = marketConfig.underlying?.toLowerCase() || null;
            const underlyingSymbol = (context.underlyingSymbols?.[market]
                || marketConfig.underlyingSymbol
                || marketConfig.symbol
                || marketConfig.name
                || 'PT').toUpperCase();

            const isStable = this._isStableAsset(
                { symbol: underlyingSymbol, address: underlyingAddress, chainId },
                { customSymbolSet: customStable, customAddressSet: stableAddressSet }
            );

            let price = null;
            let usdValue = null;
            if (isStable) {
                usdValue = amount;
                price = 1;
            } else if (underlyingAddress) {
                price = this._resolvePriceOverride({ priceOverrides, symbol: underlyingSymbol, address: underlyingAddress })
                    ?? await this.priceOracle.getUsdPrice({ chainId, address: underlyingAddress, symbol: underlyingSymbol });
                usdValue = amount * price;
            }

            items.push({
                protocol: 'pendle',
                market: marketConfig.address || market,
                symbol: underlyingSymbol,
                address: underlyingAddress,
                ptToken: marketConfig.pt,
                amount,
                usdValue,
                decimals: balance?.decimals ?? null,
                price,
                isStable
            });
        }

        return {
            items,
            metadata: {
                protocol: 'pendle',
                markets: markets.map(m => sdk.getMarketConfig(m)?.address || m)
            }
        };
    }

    _resolveAaveConfig(chainId) {
        const config = this.protocols.aave || {};
        return config[chainId] || config.default || null;
    }

    _resolveCompoundConfig(chainId) {
        const config = this.protocols.compound;
        if (!config) return null;
        if (config instanceof CompoundSDK) {
            return { sdk: config };
        }
        if (config.sdk instanceof CompoundSDK) {
            return config;
        }
        return config[chainId] || config.default || null;
    }

    _resolvePendleConfig(chainId) {
        const config = this.protocols.pendle;
        if (!config) return null;
        if (config instanceof PendleSDK) {
            return { sdk: config };
        }
        if (config.sdk instanceof PendleSDK) {
            return config;
        }
        return config[chainId] || config.default || null;
    }

    _resolvePriceOverride({ priceOverrides, symbol, address }) {
        if (!priceOverrides) return null;
        if (symbol && priceOverrides[symbol]) {
            return priceOverrides[symbol];
        }
        if (address && priceOverrides[address]) {
            return priceOverrides[address];
        }
        if (address && priceOverrides[address.toLowerCase()]) {
            return priceOverrides[address.toLowerCase()];
        }
        return null;
    }

    _isStableAsset({ symbol, address, chainId }, { customSymbolSet = new Set(), customAddressSet = new Set() } = {}) {
        if (symbol && (customSymbolSet.has(symbol.toUpperCase()) || this.globalStableSymbols.has(symbol.toUpperCase()))) {
            return true;
        }

        if (address) {
            const normalized = address.toLowerCase();
            if (customAddressSet.has(normalized)) {
                return true;
            }
            const globalSet = this.globalStableAddresses.get(chainId);
            if (globalSet && globalSet.has(normalized)) {
                return true;
            }
        }

        return false;
    }

    _extractCompoundAssetMetadata(sdk) {
        const map = {};
        const markets = sdk.markets || {};
        for (const [marketKey, market] of Object.entries(markets)) {
            const assets = market.assets || {};
            for (const [assetKey, info] of Object.entries(assets)) {
                const symbol = (info.symbol || assetKey || '').toUpperCase();
                map[symbol.toLowerCase()] = {
                    symbol,
                    underlying: info.underlying,
                    decimals: info.decimals,
                    role: info.role,
                    marketKey
                };
            }
        }
        return map;
    }

    _extractNumeric(value) {
        if (value == null) return 0;
        if (typeof value === 'number') return value;
        if (typeof value === 'bigint') return Number(value);
        if (typeof value === 'string') {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : 0;
        }
        if (typeof value === 'object') {
            if (value.amount != null) return this._extractNumeric(value.amount);
            if (value.balance != null) return this._extractNumeric(value.balance);
            if (value.tokenBalance != null) return this._extractNumeric(value.tokenBalance);
            if (value.value != null) return this._extractNumeric(value.value);
            if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
                return this._extractNumeric(value.toString());
            }
        }
        return 0;
    }
}

module.exports = {
    UnifiedSDK,
    DefaultPriceOracle
};
