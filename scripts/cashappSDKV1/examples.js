#!/usr/bin/env node
/**
 * Pendle SDK Usage Examples
 *
 * Linus Philosophy: "Show, don't tell"
 * These examples demonstrate real-world usage patterns
 */

const { PendleSDK, CHAINS } = require('./PendleSDK');

// ========== CONFIGURATION ==========
const config = {
    chainId: CHAINS.base.id,
    rpcUrl: process.env.RPC_URL_8453 || 'https://1rpc.io/base',
    receiver: process.env.PENDLE_RECEIVER_ADDRESS || '0x8271A5Fcb45066D77F88288f4c076E55fD61ffEA',
    privateKey: process.env.PRIVATE_KEY, // Optional for quotes
    slippage: 0.01,
    verbose: true
};

const MARKET = process.env.PENDLE_MARKET_ADDRESS || '0x44e2b05b2c17a12b37f11de18000922e64e23faa';
const PT_TOKEN = process.env.PENDLE_PT_ADDRESS || '0xb04cee9901c0a8d783fe280ded66e60c13a4e296';

// ========== EXAMPLE 1: ENHANCED QUOTE WITH APY ==========
async function example1_getQuote() {
    console.log('\n=== Example 1: Get Enhanced Quote ===');

    const sdk = new PendleSDK(config);

    try {
        const quote = await sdk.getQuote(
            CHAINS.base.usdc,  // USDC
            PT_TOKEN,          // PT Token
            100,               // 100 USDC
            MARKET
        );

        console.log('✅ Enhanced Quote Result:');
        console.log('├─ Input:', quote.amountIn, 'USDC');
        console.log('├─ Output:', quote.amountOut.toFixed(6), 'PT');
        console.log('├─ Profit:', quote.profit.toFixed(6), 'PT');
        console.log('├─ Yield Rate:', (quote.yieldRate * 100).toFixed(4) + '%');
        console.log('├─ Profitable:', quote.isprofitable ? 'Yes' : 'No');
        console.log('├─ Exchange Rate:', quote.exchangeRate.toFixed(6), 'PT/USDC');

        if (quote.daysToMaturity !== null) {
            console.log('├─ Days to Maturity:', quote.daysToMaturity.toFixed(1), 'days');
            console.log('├─ Maturity Date:', quote.maturityDate?.toLocaleDateString() || 'Unknown');
        }

        if (quote.apyPercentage !== null) {
            console.log('└─ Annual APY:', quote.apyPercentage.toFixed(2) + '%');
        } else {
            console.log('└─ APY: Unable to calculate');
        }

        return quote;

    } catch (error) {
        console.error('❌ Quote failed:', error.message);
    }
}

// ========== EXAMPLE 2: MATURITY AND APY ANALYSIS ==========
async function example2_maturityAndAPY() {
    console.log('\n=== Example 2: Maturity and APY Analysis ===');

    const sdk = new PendleSDK(config);

    try {
        // Get maturity information
        console.log('📅 Getting PT maturity information...');
        const maturityInfo = await sdk.getMaturityInfo(MARKET);

        console.log('✅ Maturity Information:');
        console.log('├─ Maturity Date:', maturityInfo.maturityDate?.toLocaleDateString() || 'Unknown');
        console.log('├─ Days to Maturity:', maturityInfo.daysToMaturity?.toFixed(1) || 'Unknown');
        console.log('└─ Timestamp:', maturityInfo.maturityTimestamp || 'N/A');

        // APY analysis for different amounts
        console.log('\n📊 APY Analysis for Different Amounts:');
        const amounts = [100, 1000, 10000];

        for (const amount of amounts) {
            try {
                const quote = await sdk.getQuote(CHAINS.base.usdc, PT_TOKEN, amount, MARKET);
                console.log(`\n💰 ${amount} USDC Investment:`);
                console.log('├─ Expected PT:', quote.amountOut.toFixed(6));
                console.log('├─ Profit:', quote.profit.toFixed(6), 'PT');
                console.log('├─ Yield Rate:', (quote.yieldRate * 100).toFixed(4) + '%');
                if (quote.apyPercentage !== null) {
                    console.log('└─ Annualized APY:', quote.apyPercentage.toFixed(2) + '%');
                } else {
                    console.log('└─ APY: Unable to calculate');
                }
            } catch (error) {
                console.log(`├─ ${amount} USDC: Quote failed -`, error.message);
            }
        }

        // Use the convenience method
        console.log('\n🎯 Using APY Example Method (100 USDC):');
        const exampleQuote = await sdk.getQuoteWithAPYExample(CHAINS.base.usdc, PT_TOKEN, MARKET, 100);
        console.log('├─ Example Amount:', exampleQuote.exampleAmount, 'USDC');
        console.log('├─ Example Profit:', exampleQuote.exampleProfit.toFixed(6), 'PT');
        console.log('└─ Example APY:', exampleQuote.exampleAPY?.toFixed(2) + '%' || 'N/A');

        return { maturityInfo, exampleQuote };

    } catch (error) {
        console.error('❌ Analysis failed:', error.message);
    }
}

// ========== EXAMPLE 3: DRY RUN ARBITRAGE ==========
async function example3_dryRunArbitrage() {
    console.log('\n=== Example 3: Dry Run Arbitrage ===');

    const sdk = new PendleSDK(config);

    try {
        const result = await sdk.arbitrage(
            100,        // 100 USDC
            PT_TOKEN,   // PT Token
            MARKET,
            { dryRun: true }  // No actual transactions
        );

        console.log('✅ Arbitrage Simulation:');
        console.log('├─ Success:', result.success);
        console.log('├─ Step 1 Profit:', result.step1.quote.profit.toFixed(6), 'PT');
        console.log('├─ Total Profit:', result.totalProfit.toFixed(6), 'PT');
        console.log('└─ Profitable:', result.step1.quote.isprofitable ? 'Yes' : 'No');

        return result;

    } catch (error) {
        console.error('❌ Simulation failed:', error.message);
    }
}

// ========== EXAMPLE 4: EXECUTE SINGLE SWAP ==========
async function example4_executeSwap() {
    console.log('\n=== Example 4: Execute Swap ===');

    if (!config.privateKey) {
        console.log('⚠️  Skipping execution - PRIVATE_KEY not provided');
        return;
    }

    const sdk = new PendleSDK(config);

    try {
        // Get quote first
        const quote = await sdk.getQuote(CHAINS.base.usdc, PT_TOKEN, 1, MARKET);

        if (!quote.isprofitable) {
            console.log('⚠️  Not profitable, skipping execution');
            return;
        }

        console.log('📊 Executing swap...');
        console.log('├─ Amount:', quote.amountIn, 'USDC');
        console.log('├─ Expected:', quote.amountOut.toFixed(6), 'PT');
        console.log('└─ Profit:', quote.profit.toFixed(6), 'PT');

        const result = await sdk.executeSwap(quote);

        if (result.success) {
            console.log('✅ Swap successful:');
            console.log('├─ Hash:', result.hash);
            console.log('├─ Gas Used:', result.gasUsed || 'N/A');
            console.log('└─ Block:', result.receipt?.blockNumber || 'N/A');
        } else {
            console.log('❌ Swap failed:', result.error);
        }

        return result;

    } catch (error) {
        console.error('❌ Execution failed:', error.message);
    }
}

// ========== EXAMPLE 5: FULL ARBITRAGE ==========
async function example5_fullArbitrage() {
    console.log('\n=== Example 5: Full Arbitrage ===');

    if (!config.privateKey) {
        console.log('⚠️  Skipping arbitrage - PRIVATE_KEY not provided');
        return;
    }

    const sdk = new PendleSDK(config);

    try {
        const result = await sdk.arbitrage(
            10,         // 10 USDC (small amount for testing)
            PT_TOKEN,
            MARKET
        );

        console.log('📊 Arbitrage Results:');
        console.log('├─ Success:', result.success);

        if (result.step1) {
            console.log('├─ Step 1 (USDC→PT):');
            console.log('│  ├─ Input:', result.step1.quote.amountIn, 'USDC');
            console.log('│  ├─ Output:', result.step1.quote.amountOut.toFixed(6), 'PT');
            console.log('│  └─ Hash:', result.step1.transaction?.hash || 'Simulation');
        }

        if (result.step2) {
            console.log('├─ Step 2 (PT→USDC):');
            console.log('│  ├─ Input:', result.step2.quote.amountIn.toFixed(6), 'PT');
            console.log('│  ├─ Output:', result.step2.quote.amountOut.toFixed(6), 'USDC');
            console.log('│  └─ Hash:', result.step2.transaction?.hash || 'N/A');
        }

        console.log('└─ Total Profit:', result.totalProfit.toFixed(6), 'USDC/PT');

        if (result.error) {
            console.log('❌ Error:', result.error);
        }

        return result;

    } catch (error) {
        console.error('❌ Arbitrage failed:', error.message);
    }
}

// ========== FRONTEND INTEGRATION EXAMPLE ==========
function frontendExample() {
    console.log('\n=== Frontend Integration Example ===');
    console.log(`
// React/Vue/Angular usage:

import { PendleSDK, CHAINS } from './PendleSDK';

const sdk = new PendleSDK({
    chainId: CHAINS.base.id,
    rpcUrl: 'https://1rpc.io/base',
    receiver: userWalletAddress,
    privateKey: userPrivateKey, // From wallet connect
    slippage: 0.01
});

// Get quote for UI
async function getQuote(amount) {
    try {
        const quote = await sdk.getQuote(
            CHAINS.base.usdc,
            PT_TOKEN,
            amount,
            MARKET
        );

        return {
            input: quote.amountIn,
            output: quote.amountOut,
            profit: quote.profit,
            profitable: quote.isprofitable,
            rate: quote.exchangeRate
        };
    } catch (error) {
        throw new Error(\`Quote failed: \${error.message}\`);
    }
}

// Execute transaction
async function executeArbitrage(amount) {
    try {
        const result = await sdk.arbitrage(amount, PT_TOKEN, MARKET);

        if (result.success) {
            return {
                success: true,
                step1Hash: result.step1?.transaction?.hash,
                step2Hash: result.step2?.transaction?.hash,
                totalProfit: result.totalProfit
            };
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}
    `);
}

// ========== MAIN EXECUTION ==========
async function main() {
    console.log('🚀 Pendle SDK Examples');
    console.log('='.repeat(50));

    try {
        // Run all examples
        await example1_getQuote();
        await example2_maturityAndAPY();
        await example3_dryRunArbitrage();
        await example4_executeSwap();
        await example5_fullArbitrage();

        frontendExample();

        console.log('\n✅ All examples completed');

    } catch (error) {
        console.error('💥 Example failed:', error.message);
    }
}

// Export for testing
module.exports = {
    example1_getQuote,
    example2_maturityAndAPY,
    example3_dryRunArbitrage,
    example4_executeSwap,
    example5_fullArbitrage
};

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}