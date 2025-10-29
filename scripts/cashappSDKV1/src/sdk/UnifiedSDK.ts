// @ts-nocheck

/**
 * Unified DeFi SDK - Cross protocol convenience helpers
 *
 * Linus Torvalds inspired philosophy:
 * 1. Fewer special cases produce better APIs
 * 2. Put data front and center
 * 3. Keep the surface small, grow capabilities incrementally
 */

import axios, { AxiosInstance } from 'axios';
import {
    Contract,
    JsonRpcProvider,
    formatUnits,
    getAddress,
    getBigInt,
    id
} from 'ethers';
import { CompoundSDK } from './CompoundSDK';
import { PendleSDK } from './PendleSDK';
import { DEFAULT_RPCS, DEFAULT_TRANSFER_EXCLUSIONS } from '../config/common';
import { PORTFOLIO_TOKENS } from '../config/portfolio';
import axios from 'axios';
import { TokenTransfer } from './types';

const DEFAULT_STABLECOIN_SYMBOLS = new Set<string>([
    'USDC', 'USDT', 'DAI', 'USDBC', 'USDP', 'USDS', 'PAX', 'BUSD', 'TUSD',
    'FRAX', 'LUSD', 'GUSD', 'SUSD', 'USD+', 'YOUUSD', 'PYUSD', 'USDE',
    'USDL', 'USX', 'USDD'
]);

const TRANSFER_EXCLUSIONS_BASE = DEFAULT_TRANSFER_EXCLUSIONS || {};

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

const ERC20_TRANSFER_TOPIC = id('Transfer(address,address,uint256)');
const ERC20_METADATA_ABI = [
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)'
];

export class DefaultPriceOracle {
    cacheTtlMs: number;
    http: AxiosInstance;
    cache: Map<string, { value: number; timestamp: number }>;

    constructor(options: any = {}) {
        this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
        this.http = options.httpClient || axios.create({ timeout: options.timeoutMs ?? 10_000 });
        this.cache = new Map();
    }

    async getUsdPrice({
        chainId,
        address,
        symbol,
        skipCache = false
    }: {
        chainId: number;
        address: string;
        symbol?: string;
        skipCache?: boolean;
    }) {
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

export class UnifiedSDK {
    defaultChainId: number | null;
    defaultAccount: string | null;
    priceOracle: any;
    verbose: boolean;
    protocols: any;
    portfolioTokens: Record<string, any>;
    rpcUrls: Record<number | string, string>;
    private _providerCache: Map<number, JsonRpcProvider>;
    globalStableSymbols: Set<string>;
    globalStableAddresses: Map<number, Set<string>>;
    transferExclusions: any;
    timestampToBlock: Map<number, number>;

    constructor(config: any = {}) {
        this.defaultChainId = config.chainId ?? null;
        this.defaultAccount = config.account ?? null;
        this.priceOracle = config.priceOracle || new DefaultPriceOracle(config.priceConfig);
        this.verbose = !!config.verbose;

        this.protocols = {
            aave: config.aave || {},
            compound: config.compound || null,
            pendle: config.pendle || null
        };

        this.portfolioTokens = config.portfolioTokens || PORTFOLIO_TOKENS || {};
        this.rpcUrls = { ...DEFAULT_RPCS, ...(config.rpcUrls || {}) };
        this._providerCache = new Map();
        this.timestampToBlock = new Map();

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
            TRANSFER_EXCLUSIONS_BASE,
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
        const stableUsd = depositsUsd + wallet?.totals?.stableUsd || 0;

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
                walletUsd,
                stableUsd
            },
            protocols: responses,
            wallet,
            failures,
            timestamp: Date.now()
        };
    }

    async getNetTransfer(options = {}) {
        const context = await this._computeNetTransfers({ ...options, expectPrimary: true });
        const { base, accountSummaries, accountInfo } = context;

        const targetNormalized = accountInfo.primaryNormalized
            || accountInfo.ordered[0]?.normalized;

        if (!targetNormalized) {
            throw new Error('At least one account is required');
        }

        const summary = accountSummaries.get(targetNormalized);
        if (!summary) {
            throw new Error('Unable to compute net transfer summary for target account');
        }

        return {
            chainId: base.chainId,
            account: summary.account,
            startTime: base.startTime,
            endTime: base.endTime,
            inboundUsd: summary.inboundUsd,
            outboundUsd: summary.outboundUsd,
            netTransfer: summary.netTransfer,
            tokensEvaluated: base.tokensEvaluated,
            fromBlock: base.fromBlock,
            toBlock: base.toBlock,
            logsEvaluated: base.logsEvaluated,
            breakdown: summary.breakdown
        };
    }

    async getNetTransfers(options = {}) {
        const context = await this._computeNetTransfers(options);
        const { base, accountSummaries, accountInfo } = context;

        const accounts = accountInfo.ordered.map(entry => {
            const summary = accountSummaries.get(entry.normalized);
            if (!summary) {
                return {
                    account: entry.checksum,
                    inboundUsd: 0,
                    outboundUsd: 0,
                    netTransfer: 0,
                    breakdown: undefined
                };
            }
            return summary;
        });

        return {
            chainId: base.chainId,
            startTime: base.startTime,
            endTime: base.endTime,
            tokensEvaluated: base.tokensEvaluated,
            fromBlock: base.fromBlock,
            toBlock: base.toBlock,
            logsEvaluated: base.logsEvaluated,
            accounts
        };
    }

    async _computeNetTransfers({
        chainId,
        userAddress,
        accountAddress,
        userAddresses,
        accountAddresses,
        accounts,
        startTime,
        endTime,
        tokens,
        excludeAddresses,
        includeBreakdown = false,
        maxBlockSpan,
        options = {},
        expectPrimary = false
    } = {}) {
        const resolvedChainId = chainId ?? this.defaultChainId;
        if (!resolvedChainId) {
            throw new Error('chainId is required');
        }

        let primaryCandidate = userAddress || accountAddress;
        if (expectPrimary) {
            primaryCandidate = this._resolveAccount(primaryCandidate);
        }

        const accountInfo = this._normalizeAccountList({
            primaryAddress: primaryCandidate,
            fallbackDefault: this.defaultAccount,
            userAddress,
            accountAddress,
            userAddresses,
            accountAddresses,
            accounts
        });

        if (!accountInfo.ordered.length) {
            throw new Error('At least one account is required for net transfer analysis');
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
        let  fromBlock = this.timestampToBlock.get(startSeconds);
        console.log("from block:" + fromBlock);
        if(fromBlock == 0 || fromBlock == undefined) {
            fromBlock = await this._findBlockByTimestamp(resolvedChainId, startSeconds, { preference: 'floor' });
            this.timestampToBlock.set(startSeconds, fromBlock);
        }
        let  toBlock = this.timestampToBlock.get(endSeconds);
        console.log("to block:" + toBlock);
        if(toBlock == 0 || toBlock == undefined) {
            toBlock = await this._findBlockByTimestamp(resolvedChainId, endSeconds, { preference: 'ceil' });
            this.timestampToBlock.set(endSeconds, toBlock);
        }

        if (toBlock < fromBlock) {
            throw new Error('Unable to resolve block range for requested timestamps');
        }
        const accountSummaries = new Map();
        for (const entry of accountInfo.ordered) {
            accountSummaries.set(entry.normalized, {
                account: entry.checksum,
                inboundUsd: 0,
                outboundUsd: 0,
                tokens: includeBreakdown ? new Map() : null
            });
        }

        const accountSet = new Set(accountInfo.ordered.map(entry => entry.normalized));
        const blockTimestampCache = new Map();
        let totalLogs = 0;

        for (const token of tokenConfigs) {
            const logs = await this._collectTransferLogs({
                chainId: resolvedChainId,
                tokenAddress: token.address,
                userAddress: Array.from(accountSet)[0],
                fromBlock,
                toBlock,
                maxBlockSpan: blockSpanLimit
            });

            totalLogs += logs.length;

            for (const log of logs) {
                if (!log?.topics || log.topics.length < 3) continue;

                // const timestamp = await this._getBlockTimestamp(provider, log.blockNumber, blockTimestampCache);
                const timestamp = parseInt(log.timeStamp, 16);
                if (timestamp == null || timestamp < startSeconds || timestamp >= endSeconds) {
                    continue;
                }

                const from = this._addressFromTopic(log.topics[1]);
                const to = this._addressFromTopic(log.topics[2]);

                const normalizedFrom = this._normalizeAddressLower(from);
                const normalizedTo = this._normalizeAddressLower(to);

                if ((normalizedFrom && exclusionSet.has(normalizedFrom))
                    || (normalizedTo && exclusionSet.has(normalizedTo))) {
                    continue;
                }

                if (normalizedFrom && normalizedTo && normalizedFrom === normalizedTo) {
                    continue;
                }

                const rawAmount = this._decodeTransferAmount(log.data);
                if (rawAmount <= 0n) {
                    continue;
                }

                const amount = Number(formatUnits(rawAmount, token.decimals));
                if (!Number.isFinite(amount) || amount === 0) {
                    continue;
                }

                if (normalizedTo && accountSet.has(normalizedTo)) {
                    const summary = accountSummaries.get(normalizedTo);
                    this._applyNetTransferDelta(summary, {
                        direction: 'in',
                        amount,
                        token,
                        includeBreakdown,
                        counterparty: from,
                        blockNumber: log.blockNumber,
                        transactionHash: log.transactionHash,
                        timestamp
                    });
                }

                if (normalizedFrom && accountSet.has(normalizedFrom)) {
                    const summary = accountSummaries.get(normalizedFrom);
                    this._applyNetTransferDelta(summary, {
                        direction: 'out',
                        amount,
                        token,
                        includeBreakdown,
                        counterparty: to,
                        blockNumber: log.blockNumber,
                        transactionHash: log.transactionHash,
                        timestamp
                    });
                }
            }
        }

        const finalizedSummaries = new Map();
        for (const [normalized, summary] of accountSummaries.entries()) {
            const inboundUsd = this._roundDecimal(summary.inboundUsd, 6);
            const outboundUsd = this._roundDecimal(summary.outboundUsd, 6);
            const netTransfer = this._roundDecimal(inboundUsd - outboundUsd, 6);
            const breakdown = includeBreakdown
                ? this._finalizeNetTransferBreakdown(summary.tokens)
                : undefined;

            finalizedSummaries.set(normalized, {
                account: summary.account,
                inboundUsd,
                outboundUsd,
                netTransfer,
                breakdown
            });
        }

        return {
            base: {
                chainId: resolvedChainId,
                startTime: startSeconds,
                endTime: endSeconds,
                tokensEvaluated: tokenConfigs.length,
                fromBlock,
                toBlock,
                logsEvaluated: totalLogs
            },
            accountSummaries: finalizedSummaries,
            accountInfo
        };
    }

   async _fetchTokenTransfers({
        chainId,
        userAddress,
        startTime,
        endTime,
        options = {},
    } = {}, page, size) {
        const resolvedChainId = chainId ?? this.defaultChainId;
        if (!resolvedChainId) {
            throw new Error('chainId is required');
        }

        const provider = this._getRpcProvider(resolvedChainId);
        if (!provider) {
            throw new Error(`No RPC URL configured for chain ${resolvedChainId}`);
        }

        const tokenConfigs = await this._resolveTransferTokens({
            chainId: resolvedChainId,
            tokens: this.portfolioTokens?.[chainId]?.assets,
            provider:provider,
        });

        if (!tokenConfigs.length) {
            throw new Error(`No stable tokens available for chain ${resolvedChainId}`);
        }

        let  fromBlock = 0;
        let  toBlock = 0;

        if(startTime != 0 && startTime != undefined) {
            fromBlock = this.timestampToBlock.get(startTime);
            if(fromBlock == 0 || fromBlock == undefined) {
                fromBlock = await this._findBlockByTimestamp(resolvedChainId, startTime, { preference: 'floor' });
                this.timestampToBlock.set(startTime, fromBlock);
            }
        }

        if(endTime != 0 && endTime != undefined) {
            toBlock = this.timestampToBlock.get(endTime);
            if(toBlock == 0 || toBlock == undefined) {
                toBlock = await this._findBlockByTimestamp(resolvedChainId, endTime, { preference: 'ceil' });
                this.timestampToBlock.set(endTime, toBlock);
            }

            if (toBlock < fromBlock) {
                throw new Error('Unable to resolve block range for requested timestamps');
            }
        }

        let tranfers:TokenTransfer[] = await this._collectTokenTransfers({
                chainId: resolvedChainId,
                userAddress,
                fromBlock,
                toBlock,
                page,
                size,
                tokenConfigs,
        });
        return tranfers;
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
            return getBigInt(data);
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
            return getAddress(value);
        } catch (error) {
            return value.toLowerCase();
        }
    }

    _addressToTopic(address) {
        let cleanAddress = address.toLowerCase();
        if (cleanAddress.startsWith("0x")) {
            cleanAddress = cleanAddress.slice(2);
        }
        if (cleanAddress.length !== 40) {
            throw new Error("Invalid address length");
        }
        const padded = "0".repeat(24) + cleanAddress;
        return "0x" + padded;
    }

    _toChecksumAddress(address) {
        if (!address) {
            return null;
        }
        try {
            return getAddress(address);
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

    _normalizeAccountList({
        primaryAddress,
        fallbackDefault,
        userAddress,
        accountAddress,
        userAddresses,
        accountAddresses,
        accounts
    } = {}) {
        const ordered = [];
        const normalizedSet = new Set();

        const addAddress = (value) => {
            if (!value) return;
            if (Array.isArray(value)) {
                for (const entry of value) {
                    addAddress(entry);
                }
                return;
            }
            if (typeof value === 'object' && value) {
                if (value.address) {
                    addAddress(value.address);
                    return;
                }
                if (value.account) {
                    addAddress(value.account);
                    return;
                }
            }
            const checksum = this._toChecksumAddress(value);
            if (!checksum) return;
            const normalized = checksum.toLowerCase();
            if (!normalizedSet.has(normalized)) {
                normalizedSet.add(normalized);
                ordered.push({ normalized, checksum });
            }
        };

        addAddress(primaryAddress);
        addAddress(userAddress);
        addAddress(accountAddress);
        addAddress(userAddresses);
        addAddress(accountAddresses);
        addAddress(accounts);

        if (!ordered.length && fallbackDefault) {
            addAddress(fallbackDefault);
        }

        return {
            ordered,
            normalizedSet,
            primaryNormalized: ordered[0]?.normalized || null
        };
    }

    _applyNetTransferDelta(summary, {
        direction,
        amount,
        token,
        includeBreakdown,
        counterparty,
        blockNumber,
        transactionHash,
        timestamp
    }) {
        if (!summary) return;
        if (direction === 'in') {
            summary.inboundUsd += amount;
        } else {
            summary.outboundUsd += amount;
        }

        if (!includeBreakdown || !summary.tokens) {
            return;
        }

        const key = token.address;
        let detail = summary.tokens.get(key);
        if (!detail) {
            detail = {
                symbol: token.symbol,
                address: token.address,
                decimals: token.decimals,
                inboundUsd: 0,
                outboundUsd: 0,
                transfers: []
            };
            summary.tokens.set(key, detail);
        }

        if (direction === 'in') {
            detail.inboundUsd += amount;
        } else {
            detail.outboundUsd += amount;
        }

        detail.transfers.push({
            direction,
            counterparty: counterparty ? (this._toChecksumAddress(counterparty) || counterparty) : null,
            amount,
            blockNumber,
            transactionHash,
            timestamp
        });
    }

    _finalizeNetTransferBreakdown(tokenMap) {
        if (!tokenMap || !(tokenMap instanceof Map)) {
            return undefined;
        }

        const breakdown = [];
        for (const detail of tokenMap.values()) {
            breakdown.push({
                symbol: detail.symbol,
                address: detail.address,
                decimals: detail.decimals,
                inboundUsd: this._roundDecimal(detail.inboundUsd, 6),
                outboundUsd: this._roundDecimal(detail.outboundUsd, 6),
                transfers: detail.transfers.map(entry => ({
                    ...entry,
                    amount: this._roundDecimal(entry.amount, 6),
                    counterparty: entry.counterparty ? (this._toChecksumAddress(entry.counterparty) || entry.counterparty) : null
                }))
            });
        }

        return breakdown;
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

        const contract = new Contract(address, ERC20_METADATA_ABI, provider);

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

    async _collectTransferLogs({ chainId, tokenAddress, userAddress, fromBlock, toBlock, maxBlockSpan = 5000 }) {
        if (fromBlock > toBlock) {
            return [];
        }
        const address_topic = this._addressToTopic(userAddress);
        const logs = [];
        let span = Math.max(1, Math.floor(maxBlockSpan));
        let start = fromBlock;

        while (start < toBlock) {
            const end = Math.min(start + span - 1, toBlock);
            try {
                // const chunk = await provider.getLogs({
                //     address: tokenAddress,
                //     topics: [ERC20_TRANSFER_TOPIC],
                //     fromBlock: start,
                //     toBlock: end
                // });
                let page = 1;
                while(true) {
                    let url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=logs&action=getLogs&fromBlock=${start}&toBlock=${end}&address=${tokenAddress}&topic0=${ERC20_TRANSFER_TOPIC}&topic1=${address_topic}&topic1_2_opr=or&topic2=${address_topic}&page=${page}&offset=1000&apikey=${process.env.API_KEY}`;
                    const response = await axios.get(url);
                    const data = response.data || {};
                    if (typeof data?.result === 'object') {
                        const chunk = data?.result;
                        if(chunk != null) {
                            logs.push(...chunk);
                            if(chunk.length == 1000 ) {
                                page += 1;
                                continue;
                            } else {
                                break;
                            }
                        } else {
                            console.log(data);
                            break;
                        }
                    } else {
                        break;
                    }
                }
                start = end;
            } catch (error) {
                console.log(error);
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

    async _collectTokenTransfers({ chainId, userAddress, fromBlock, toBlock, page, size, tokenConfigs }) {
        if (fromBlock > toBlock) {
            return [];
        }
        const MAX_OFFSET = 10000;
        const transfers:TokenTransfer[] = [];
        let curPage = 1;
        let curOffset = MAX_OFFSET;
        while(true) {
            try {
                let url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=tokentx`
                if(fromBlock != 0) {
                    url += `&startblock=${fromBlock}`
                }
                if(toBlock != 0) {
                    url += `&endblock=${toBlock}`
                }
                url += `&offset=${curOffset}&apikey=${process.env.API_KEY}&address=${userAddress}&page=${curPage}&sort=desc`;
                const response = await axios.get(url);
                const data = response.data || {};
                if (typeof data?.result === 'object') {
                    const chunk = data?.result;
                    if(chunk != null) {
                        for(const tx of chunk){
                            for (const token of tokenConfigs) {
                                if(token.address.toLowerCase() != tx.contractAddress.toLowerCase()) {
                                    continue;
                                }
                                transfers.push({
                                    from: tx.from,
                                    to: tx.to,
                                    contractAddress: tx.contractAddress,
                                    input: tx.to==userAddress,
                                    value: String(tx.value),
                                    decimal: Number(tx.tokenDecimal),
                                    timestamp: Number(tx.timeStamp),
                                });
                            }
                        }
                        // Result window is too large, PageNo x Offset size must be less than or equal to 10000
                        break;
                        // TODO:If you need to search for values ​​greater than MAX_OFFSET
                        // if(chunk.length == MAX_OFFSET ) {
                        //     curPage += 1;
                        //     continue;
                        // } else {
                        //     break;
                        // }
                    } else {
                        console.log(data);
                        break;
                    }
                } else {
                    break;
                }
            } catch (error) {
                throw new Error(`Unable to fetch token transfers between blocks ${fromBlock}-${toBlock}: ${error?.message || error}`);
            }
        }
        const start = (page - 1) * size; // page 从 1 开始
        return transfers.slice(start, start + size);
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

    async _findBlockByTimestamp(chainId, targetTimestamp, { preference = 'floor' } = {}) {
        if (targetTimestamp == null) {
            throw new Error('targetTimestamp is required');
        }

        // const latestNumber = await provider.getBlockNumber();
        // let low = 0;
        // let high = latestNumber;
        // let floorBlock = 0;
        // let ceilBlock = latestNumber;

        // while (low <= high) {
        //     const mid = Math.floor((low + high) / 2);
        //     const block = await provider.getBlock(mid);
        //     if (!block) {
        //         break;
        //     }
        //     if (block.timestamp === targetTimestamp) {
        //         return mid;
        //     }
        //     if (block.timestamp < targetTimestamp) {
        //         floorBlock = mid;
        //         low = mid + 1;
        //     } else {
        //         ceilBlock = mid;
        //         high = mid - 1;
        //     }
        // }

        // if (preference === 'ceil') {
        //     if (ceilBlock == null) {
        //         return latestNumber;
        //     }
        //     return Math.min(Math.max(ceilBlock, floorBlock), latestNumber);
        // }

        // return Math.max(0, Math.min(floorBlock, latestNumber));
        let latestNumber = 0;
        try {
            const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=block&action=getblocknobytime&timestamp=${targetTimestamp}&closest=before&apikey=${process.env.API_KEY}`;
            const response = await axios.get(url);
            const data = response.data || {};
            if (typeof data?.result === 'string') {
                latestNumber = Number(data.result);
            }
        } catch (error) {
            console.error(`Fetch block number failed:`, (error as Error).message);
        }
        return latestNumber;
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
            const contract = new Contract(token.address, [
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

        const amount = Number(formatUnits(balanceRaw, decimals ?? 18));
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
        const provider = new JsonRpcProvider(rpcUrl, chainId);
        this._providerCache.set(chainId, provider);
        return provider;
    }

    async _getAaveBalances({ chainId, account, options }) {
        const config = this._resolveAaveConfig(chainId);
        if (!config) {
            throw new Error(`Aave configuration not provided for chain ${chainId}`);
        }

        const { markets = [], client, stableSymbols = [], stableAddresses = [], priceOverrides = {} } = config;
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
        const chainIdentifier = asChainId(chainId);

        const customStable = new Set(stableSymbols.map(symbol => symbol.toUpperCase()));
        const stableAddressSet = new Set(stableAddresses.map(addr => addr.toLowerCase()));

        const marketMeta = new Map<string, any>();
        if (fetchMarkets && typeof fetchMarkets === 'function') {
            try {
                const marketResult = await fetchMarkets(client, {
                    chainIds: [chainIdentifier],
                    user
                });

                if (marketResult && typeof marketResult.isOk === 'function' && marketResult.isOk()) {
                    const marketsData = Array.isArray(marketResult.value) ? marketResult.value : [];
                    for (const info of marketsData) {
                        const address = (info?.address || info?.marketAddress || '').toLowerCase();
                        if (!address) continue;
                        marketMeta.set(address, info);
                    }
                }
            } catch (error) {
                if (this.verbose) {
                    console.warn('Aave markets metadata fetch failed:', error?.message || error);
                }
            }
        }

        const normalizedMarkets = new Set(markets.map(address => (address || "").toLowerCase()).filter(Boolean));

        const supplyRequestMarkets = markets
            .map(address => address && evmAddress(address))
            .filter(Boolean)
            .map(address => ({ chainId: chainIdentifier, address }));

        const positions: any[] = [];
        try {
            const suppliesResult = await userSupplies(client, {
                markets: supplyRequestMarkets,
                user
            });

            if (suppliesResult && typeof suppliesResult.isErr === 'function' && suppliesResult.isErr()) {
                const reason = suppliesResult.error?.message || suppliesResult.error || 'unknown error';
                throw new Error(`Aave userSupplies error: ${reason}`);
            }

            if (Array.isArray(suppliesResult?.value)) {
                positions.push(...suppliesResult.value);
            } else if (Array.isArray(suppliesResult)) {
                positions.push(...suppliesResult);
            }
        } catch (error) {
            throw new Error(`Aave userSupplies error: ${error.message || error}`);
        }

        const items = [];

        for (const position of positions) {
            const marketAddress = (position?.market?.address || position?.marketAddress || '').toLowerCase();
            if (!marketAddress) continue;
            if (normalizedMarkets.size && !normalizedMarkets.has(marketAddress)) continue;

            const reserve = position?.currency || position?.reserve || position?.underlyingReserve || {};
            const address = (reserve?.address || reserve?.underlyingAsset || '').toLowerCase();

            const symbolRaw = reserve?.symbol || position?.symbol || position?.reserve?.symbol;
            const symbol = symbolRaw ? symbolRaw.toUpperCase() : address || 'UNKNOWN';
            const decimals = reserve?.decimals ?? position?.decimals ?? null;

            const amount = this._extractNumeric(
                position?.balance?.amount
                ?? position?.balance
                ?? position?.supplyBalance
                ?? position?.underlyingBalance
                ?? position?.principalBalance
                ?? position?.aTokenBalance
            );

            if (!amount) {
                continue;
            }

            const usdCandidate = this._extractNumeric(
                position?.balance?.usd
                ?? position?.balanceUsd
                ?? position?.balanceUSD
                ?? position?.underlyingBalanceUSD
                ?? position?.valueUsd
                ?? position?.valueUSD
            );

            const isStable = this._isStableAsset(
                { symbol, address, chainId },
                { customSymbolSet: customStable, customAddressSet: stableAddressSet }
            );

            let price = null;
            let usdValue = usdCandidate;

            if (isStable) {
                price = 1;
                usdValue = amount;
            } else {
                if (!usdValue) {
                    price = this._resolvePriceOverride({ priceOverrides, symbol, address })
                        ?? await this.priceOracle.getUsdPrice({ chainId, address, symbol });
                    usdValue = amount * price;
                } else {
                    price = usdValue / amount;
                }
            }

            const meta = marketMeta.get(marketAddress) || {};

            items.push({
                protocol: 'aave',
                market: marketAddress || meta?.address || null,
                symbol,
                address,
                amount,
                usdValue,
                decimals,
                price,
                isStable,
                raw: {
                    market: meta,
                    position
                }
            });
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
                amount = Number(formatUnits(balanceRaw, decimals));
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

export { UnifiedSDK, DefaultPriceOracle };
