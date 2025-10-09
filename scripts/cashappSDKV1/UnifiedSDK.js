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

const DEFAULT_TRANSFER_EXCLUSIONS = common.DEFAULT_TRANSFER_EXCLUSIONS || {};

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

const ERC20_TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const ERC20_METADATA_ABI = [
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)'
];

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

        this.transferExclusions = this._normalizeTransferExclusions([
            DEFAULT_TRANSFER_EXCLUSIONS,
            config.transferExclusions,
            config.excludeAddresses,
            config.exclude_addresses,
            config.transferConfig?.excludeAddresses,
            config.transferConfig?.exclude_addresses
        ]);
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

    async getNetTransfer({
        chainId,
        userAddress,
        accountAddress,
        startTime,
        endTime,
        tokens,
        excludeAddresses,
        includeBreakdown = false,
        maxBlockSpan,
        options = {}
    } = {}) {
        const resolvedChainId = chainId ?? this.defaultChainId;
        if (!resolvedChainId) {
            throw new Error('chainId is required');
        }

        const account = this._resolveAccount(userAddress || accountAddress);
        const checksumAccount = this._toChecksumAddress(account);
        const normalizedAccount = checksumAccount ? checksumAccount.toLowerCase() : null;
        if (!normalizedAccount) {
            throw new Error('user address is required');
        }

        const startSeconds = this._normalizeTimestampInput(startTime, 'start');
        const endSeconds = this._normalizeTimestampInput(endTime ?? Date.now(), 'end');

        if (startSeconds == null || endSeconds == null) {
            throw new Error('startTime and endTime are required');
        }

        if (endSeconds <= startSeconds) {
            throw new Error('endTime must be greater than startTime');
        }

        const provider = this._getRpcProvider(resolvedChainId);
        if (!provider) {
            throw new Error(`No RPC URL configured for chain ${resolvedChainId}`);
        }

        const blockSpanLimit = Math.max(50, Number(maxBlockSpan ?? options.maxBlockSpan ?? 5000));

        const tokenConfigs = await this._resolveTransferTokens({
            chainId: resolvedChainId,
            tokens,
            provider
        });

        if (!tokenConfigs.length) {
            throw new Error(`No stable tokens available for chain ${resolvedChainId}`);
        }

        const exclusionSet = this._getTransferExclusionSet(resolvedChainId, excludeAddresses);

        const fromBlock = await this._findBlockByTimestamp(provider, startSeconds, { preference: 'floor' });
        const toBlock = await this._findBlockByTimestamp(provider, endSeconds, { preference: 'ceil' });

        if (toBlock < fromBlock) {
            throw new Error('Unable to resolve block range for requested timestamps');
        }

        const blockTimestampCache = new Map();
        const breakdown = [];

        let inboundUsd = 0;
        let outboundUsd = 0;
        let totalLogs = 0;

        for (const token of tokenConfigs) {
            const { address, symbol, decimals } = token;
            let tokenInbound = 0;
            let tokenOutbound = 0;
            const tokenDetails = [];

            const logs = await this._collectTransferLogs({
                provider,
                tokenAddress: address,
                fromBlock,
                toBlock,
                maxBlockSpan: blockSpanLimit
            });

            totalLogs += logs.length;

            for (const log of logs) {
                if (!log?.topics || log.topics.length < 3) continue;

                const timestamp = await this._getBlockTimestamp(provider, log.blockNumber, blockTimestampCache);
                if (timestamp == null || timestamp < startSeconds || timestamp >= endSeconds) {
                    continue;
                }

                const from = this._addressFromTopic(log.topics[1]);
                const to = this._addressFromTopic(log.topics[2]);

                const normalizedFrom = from?.toLowerCase() || null;
                const normalizedTo = to?.toLowerCase() || null;

                if ((normalizedFrom && exclusionSet.has(normalizedFrom))
                    || (normalizedTo && exclusionSet.has(normalizedTo))) {
                    continue;
                }

                const isInbound = normalizedTo === normalizedAccount;
                const isOutbound = normalizedFrom === normalizedAccount;

                if (!isInbound && !isOutbound) {
                    continue;
                }

                if (isInbound && isOutbound) {
                    // Self-transfer, ignore since it nets to zero
                    continue;
                }

                const rawAmount = this._decodeTransferAmount(log.data);
                if (rawAmount <= 0) {
                    continue;
                }

                const amount = Number(ethers.formatUnits(rawAmount, decimals));
                if (!Number.isFinite(amount) || amount === 0) {
                    continue;
                }

                if (isInbound) {
                    tokenInbound += amount;
                } else if (isOutbound) {
                    tokenOutbound += amount;
                }

                if (includeBreakdown) {
                    tokenDetails.push({
                        direction: isInbound ? 'in' : 'out',
                        counterparty: isInbound ? normalizedFrom : normalizedTo,
                        amount,
                        blockNumber: log.blockNumber,
                        transactionHash: log.transactionHash,
                        timestamp
                    });
                }
            }

            inboundUsd += tokenInbound;
            outboundUsd += tokenOutbound;

            if (includeBreakdown) {
                breakdown.push({
                    symbol,
                    address,
                    decimals,
                    inboundUsd: this._roundDecimal(tokenInbound, 6),
                    outboundUsd: this._roundDecimal(tokenOutbound, 6),
                    transfers: tokenDetails
                });
            }
        }

        const netTransfer = inboundUsd - outboundUsd;

        return {
            chainId: resolvedChainId,
            account: checksumAccount,
            startTime: startSeconds,
            endTime: endSeconds,
            inboundUsd: this._roundDecimal(inboundUsd, 6),
            outboundUsd: this._roundDecimal(outboundUsd, 6),
            netTransfer: this._roundDecimal(netTransfer, 6),
            tokensEvaluated: tokenConfigs.length,
            fromBlock,
            toBlock,
            logsEvaluated: totalLogs,
            breakdown: includeBreakdown ? breakdown : undefined
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

    _normalizeTimestampInput(value, role = 'timestamp') {
        if (value == null) {
            return null;
        }

        let numeric;
        if (value instanceof Date) {
            numeric = value.getTime();
        } else if (typeof value === 'string' && value.trim()) {
            numeric = Number(value);
        } else {
            numeric = Number(value);
        }

        if (!Number.isFinite(numeric) || numeric < 0) {
            throw new Error(`Invalid ${role}: ${value}`);
        }

        // Treat millisecond inputs as seconds by scaling down
        if (numeric > 1e12) {
            numeric = Math.floor(numeric / 1000);
        }

        return Math.floor(numeric);
    }

    _roundDecimal(value, precision = 6) {
        if (!Number.isFinite(value)) {
            return 0;
        }
        const factor = 10 ** precision;
        return Math.round((value + Number.EPSILON) * factor) / factor;
    }

    _decodeTransferAmount(data) {
        if (!data) {
            return 0n;
        }
        try {
            return ethers.getBigInt(data);
        } catch (error) {
            if (this.verbose) {
                console.warn('⚠️  Failed to decode transfer amount:', error?.message || error);
            }
            return 0n;
        }
    }

    _addressFromTopic(topic) {
        if (!topic || topic === '0x') {
            return null;
        }
        const value = `0x${topic.slice(-40)}`;
        try {
            return ethers.getAddress(value);
        } catch (error) {
            return value.toLowerCase();
        }
    }

    _toChecksumAddress(address) {
        if (!address) {
            return null;
        }
        try {
            return ethers.getAddress(address);
        } catch (error) {
            if (typeof address === 'string' && address.startsWith('0x') && address.length === 42) {
                return address;
            }
            return null;
        }
    }

    _normalizeAddressLower(address) {
        const checksum = this._toChecksumAddress(address);
        return checksum ? checksum.toLowerCase() : null;
    }

    _getTransferExclusionSet(chainId, extra) {
        const set = new Set();
        const sources = [];

        if (this.transferExclusions instanceof Map) {
            const globalSet = this.transferExclusions.get('global');
            if (globalSet) {
                for (const addr of globalSet) {
                    set.add(addr);
                }
            }
            const chainSet = this.transferExclusions.get(chainId);
            if (chainSet) {
                for (const addr of chainSet) {
                    set.add(addr);
                }
            }
        }

        if (extra) {
            sources.push(extra);
        }

        const extraMap = this._normalizeTransferExclusions(sources);
        if (extraMap instanceof Map) {
            const extraGlobal = extraMap.get('global');
            if (extraGlobal) {
                for (const addr of extraGlobal) {
                    set.add(addr);
                }
            }
            const extraChain = extraMap.get(chainId);
            if (extraChain) {
                for (const addr of extraChain) {
                    set.add(addr);
                }
            }
        }

        return set;
    }

    async _resolveTransferTokens({ chainId, tokens, provider }) {
        const candidates = new Map();

        const addCandidate = (entry) => {
            if (!entry) return;
            if (typeof entry === 'string') {
                const normalized = this._normalizeAddressLower(entry);
                if (!normalized) return;
                if (!candidates.has(normalized)) {
                    candidates.set(normalized, { address: normalized });
                }
                return;
            }
            if (typeof entry === 'object') {
                const address = this._normalizeAddressLower(entry.address || entry.token || entry.addr || entry);
                if (!address) return;
                const symbol = entry.symbol ? String(entry.symbol).toUpperCase() : null;
                const decimals = entry.decimals != null ? Number(entry.decimals) : null;
                const current = candidates.get(address) || { address };
                candidates.set(address, {
                    address,
                    symbol: symbol || current.symbol || null,
                    decimals: decimals ?? current.decimals ?? null
                });
            }
        };

        if (Array.isArray(tokens)) {
            for (const token of tokens) {
                addCandidate(token);
            }
        } else if (tokens && typeof tokens === 'object') {
            for (const [key, value] of Object.entries(tokens)) {
                if (typeof value === 'string') {
                    addCandidate({ symbol: key, address: value });
                } else {
                    addCandidate({ symbol: value?.symbol || key, address: value?.address, decimals: value?.decimals });
                }
            }
        }

        const stableList = this.portfolioTokens?.[chainId]?.stable;
        if (Array.isArray(stableList)) {
            for (const token of stableList) {
                addCandidate(token);
            }
        }

        const stableSet = this.globalStableAddresses.get(chainId);
        if (stableSet) {
            for (const address of stableSet) {
                addCandidate(address);
            }
        }

        if (!candidates.size) {
            return [];
        }

        const metadata = await Promise.all(
            Array.from(candidates.values()).map(candidate => this._loadTokenMetadata(provider, candidate))
        );

        return metadata.filter(Boolean);
    }

    async _loadTokenMetadata(provider, candidate) {
        if (!candidate?.address) {
            return null;
        }

        const address = this._toChecksumAddress(candidate.address);
        if (!address) {
            return null;
        }

        let symbol = candidate.symbol ? String(candidate.symbol).toUpperCase() : null;
        let decimals = candidate.decimals != null && Number.isFinite(Number(candidate.decimals))
            ? Number(candidate.decimals)
            : null;

        if (!provider) {
            return {
                address: address.toLowerCase(),
                symbol: symbol || address,
                decimals: decimals ?? 18
            };
        }

        if (symbol && decimals != null) {
            return {
                address: address.toLowerCase(),
                symbol,
                decimals
            };
        }

        const contract = new ethers.Contract(address, ERC20_METADATA_ABI, provider);

        if (decimals == null) {
            try {
                decimals = Number(await contract.decimals());
            } catch (error) {
                decimals = 18;
                if (this.verbose) {
                    console.warn(`⚠️  Failed to read decimals for token ${address}:`, error?.message || error);
                }
            }
        }

        if (!symbol) {
            try {
                const rawSymbol = await contract.symbol();
                symbol = rawSymbol ? String(rawSymbol).toUpperCase() : null;
            } catch (error) {
                symbol = candidate.symbol ? String(candidate.symbol).toUpperCase() : address;
                if (this.verbose) {
                    console.warn(`⚠️  Failed to read symbol for token ${address}:`, error?.message || error);
                }
            }
        }

        return {
            address: address.toLowerCase(),
            symbol: symbol || address,
            decimals: decimals ?? 18
        };
    }

    async _collectTransferLogs({ provider, tokenAddress, fromBlock, toBlock, maxBlockSpan = 5000 }) {
        if (fromBlock > toBlock) {
            return [];
        }

        const logs = [];
        let span = Math.max(1, Math.floor(maxBlockSpan));
        let start = fromBlock;

        while (start <= toBlock) {
            const end = Math.min(start + span - 1, toBlock);
            try {
                const chunk = await provider.getLogs({
                    address: tokenAddress,
                    topics: [ERC20_TRANSFER_TOPIC],
                    fromBlock: start,
                    toBlock: end
                });
                logs.push(...chunk);
                start = end + 1;
            } catch (error) {
                if (span <= 20) {
                    throw new Error(`Unable to fetch logs for ${tokenAddress} between blocks ${start}-${end}: ${error?.message || error}`);
                }
                span = Math.max(20, Math.floor(span / 2));
                if (this.verbose) {
                    console.warn(`⚠️  Reducing block span to ${span} for ${tokenAddress}:`, error?.message || error);
                }
            }
        }

        return logs;
    }

    async _getBlockTimestamp(provider, blockNumber, cache = new Map()) {
        if (cache.has(blockNumber)) {
            return cache.get(blockNumber);
        }
        const block = await provider.getBlock(blockNumber);
        if (!block) {
            return null;
        }
        cache.set(blockNumber, block.timestamp);
        return block.timestamp;
    }

    async _findBlockByTimestamp(provider, targetTimestamp, { preference = 'floor' } = {}) {
        if (targetTimestamp == null) {
            throw new Error('targetTimestamp is required');
        }

        const latestNumber = await provider.getBlockNumber();
        let low = 0;
        let high = latestNumber;
        let floorBlock = 0;
        let ceilBlock = latestNumber;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const block = await provider.getBlock(mid);
            if (!block) {
                break;
            }
            if (block.timestamp === targetTimestamp) {
                return mid;
            }
            if (block.timestamp < targetTimestamp) {
                floorBlock = mid;
                low = mid + 1;
            } else {
                ceilBlock = mid;
                high = mid - 1;
            }
        }

        if (preference === 'ceil') {
            if (ceilBlock == null) {
                return latestNumber;
            }
            return Math.min(Math.max(ceilBlock, floorBlock), latestNumber);
        }

        return Math.max(0, Math.min(floorBlock, latestNumber));
    }

    _normalizeTransferExclusions(source) {
        const map = new Map();

        const register = (chainKey, value) => {
            const normalizedAddress = this._normalizeAddressLower(value);
            if (!normalizedAddress) return;
            const numericChain = Number(chainKey);
            const key = Number.isFinite(numericChain) ? numericChain : 'global';
            if (!map.has(key)) {
                map.set(key, new Set());
            }
            map.get(key).add(normalizedAddress);
        };

        const process = (payload, chainHint = null) => {
            if (!payload) return;
            if (payload instanceof Map) {
                for (const [key, value] of payload.entries()) {
                    process(value, key);
                }
                return;
            }
            if (Array.isArray(payload)) {
                for (const entry of payload) {
                    if (typeof entry === 'string') {
                        register(chainHint ?? 'global', entry);
                    } else {
                        process(entry, chainHint);
                    }
                }
                return;
            }
            if (typeof payload === 'object') {
                for (const [key, value] of Object.entries(payload)) {
                    process(value, key);
                }
                return;
            }
            if (typeof payload === 'string') {
                register(chainHint ?? 'global', payload);
            }
        };

        const sources = Array.isArray(source) ? source : [source];
        for (const entry of sources) {
            process(entry, null);
        }

        if (!map.has('global')) {
            map.set('global', new Set());
        }

        return map;
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

            // PT tokens represent par value at maturity; treat amount as USD value (price = 1)
            const price = 1;
            const usdValue = amount;

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
