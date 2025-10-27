/**
 * Pendle SDK Usage Examples
 *
 * Linus Philosophy: "Show, don't tell"
 * These examples demonstrate real-world usage patterns
 */
import 'dotenv/config';
import * as readline from 'node:readline';
import { CHAINS, PendleSDK, resolvePendleMarket } from '../bolaritySDK';

// ========== CONFIGURATION ==========
const config = {
    chainId: CHAINS.base.id,
    rpcUrl: process.env.RPC_URL_8453 || 'https://mainnet.base.org',
    receiver: process.env.PENDLE_RECEIVER_ADDRESS || '0x8271A5Fcb45066D77F88288f4c076E55fD61ffEA',
    privateKey: process.env.PRIVATE_KEY, // Optional for quotes
    slippage: 0.01,
    verbose: true
};

const DEFAULT_MARKET = '0x8991847176b1d187e403dd92a4e55fc8d7684538';
const MARKET = DEFAULT_MARKET;
const MARKET_META = resolvePendleMarket(MARKET);

if (!MARKET_META?.address) {
    console.warn('⚠️  Pendle market not found in local config. Update src/config/pendle.ts to include it.');
}

const UNDERLYING_TOKEN = MARKET_META?.underlying || CHAINS.base.usdc;
const PT_TOKEN = MARKET_META?.pt;
const YT_TOKEN = MARKET_META?.yt;

if (!PT_TOKEN) {
    console.warn('⚠️  PT token not defined for selected market. Update src/config/pendle.ts.');
}

function formatMaturityDate(value: unknown): string {
    if (!value) return 'Unknown';
    if (value instanceof Date) {
        return value.toLocaleDateString();
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toLocaleDateString();
        }
    }
    return String(value);
}

// ========== EXAMPLE 1: ENHANCED QUOTE WITH APY ==========
export async function example1_getQuote() {
    console.log('\n=== Example 1: Get Enhanced Quote ===');

    const sdk = new PendleSDK(config);

    try {
        const quote = await sdk.getQuote(
            UNDERLYING_TOKEN,
            PT_TOKEN,
            100,
            MARKET
        );

        console.log('✅ Enhanced Quote Result:');
        console.log('├─ Input:', quote.amountIn, 'USDC');
        console.log('├─ Output:', quote.amountOut.toFixed(6), 'PT');
        console.log('├─ Profit:', quote.profit.toFixed(6), 'PT');
        console.log('├─ Yield Rate:', (quote.yieldRate * 100).toFixed(4) + '%');
        console.log('├─ Profitable:', quote.isprofitable ? 'Yes' : 'No');
        console.log('├─ Exchange Rate:', quote.exchangeRate.toFixed(6), 'PT/USDC');

        if (typeof quote.daysToMaturity === 'number') {
            console.log('├─ Days to Maturity:', quote.daysToMaturity.toFixed(1), 'days');
        }
        console.log('├─ Maturity Date:', formatMaturityDate(quote.maturityDate));

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
export async function example2_maturityAndAPY() {
    console.log('\n=== Example 2: Maturity and APY Analysis ===');

    const sdk = new PendleSDK(config);

    try {
        // Get maturity information
        console.log('📅 Getting PT maturity information...');
        const maturityInfo = await sdk.getMaturityInfo(MARKET);

        console.log('✅ Maturity Information:');
        if (typeof maturityInfo.daysToMaturity === 'number') {
            console.log('├─ Days to Maturity:', maturityInfo.daysToMaturity.toFixed(1), 'days');
        }
        console.log('├─ Maturity Date:', formatMaturityDate(maturityInfo.maturityDate));
        console.log('├─ Days to Maturity:', maturityInfo.daysToMaturity?.toFixed(1) || 'Unknown');
        console.log('└─ Timestamp:', maturityInfo.maturityTimestamp || 'N/A');

        // APY analysis for different amounts
        console.log('\n📊 APY Analysis for Different Amounts:');
        const amounts = [100];

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
        const exampleQuote = await sdk.getQuoteWithAPYExample(UNDERLYING_TOKEN, PT_TOKEN, MARKET, 100);
        console.log('├─ Example Amount:', exampleQuote.exampleAmount, 'USDC');
        console.log('├─ Example Profit:', exampleQuote.exampleProfit.toFixed(6), 'PT');
        console.log('└─ Example APY:', exampleQuote.exampleAPY?.toFixed(2) + '%' || 'N/A');

        return { maturityInfo, exampleQuote };

    } catch (error) {
        console.error('❌ Analysis failed:', error.message);
    }
}

// ========== EXAMPLE 3: DRY RUN ARBITRAGE ==========
export async function example3_dryRunArbitrage() {
    console.log('\n=== Example 3: Dry Run Arbitrage ===');

    const sdk = new PendleSDK(config);

    try {
        const result = await sdk.arbitrageStablecoin(
            UNDERLYING_TOKEN,
            100,
            PT_TOKEN,
            MARKET,
            { dryRun: true }
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
export async function example4_executeSwap() {
    console.log('\n=== Example 4: Execute Swap ===');

    if (!config.privateKey) {
        console.log('⚠️  Skipping execution - PRIVATE_KEY not provided');
        return;
    }

    const sdk = new PendleSDK(config);

    try {
        // Get quote first
        const quote = await sdk.getQuote(CHAINS.base.usdc , PT_TOKEN, 1, MARKET);

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
export async function example5_fullArbitrage() {
    console.log('\n=== Example 5: Full Arbitrage ===');

    if (!config.privateKey) {
        console.log('⚠️  Skipping arbitrage - PRIVATE_KEY not provided');
        return;
    }

    const sdk = new PendleSDK(config);

    try {
        const result = await sdk.arbitrageStablecoin(
            UNDERLYING_TOKEN,
            100,
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

// ========== EXAMPLE 6: REDEEM PT & YT ==========
export async function example6_redeemTokens() {
    console.log('\n=== Example 6: Redeem PT & YT to Underlying ===');

    const sdk = new PendleSDK(config);

    try {
        if (!YT_TOKEN) {
            console.log('❌ YT token address not configured in local pendle config');
            console.log('💡 Update src/config/pendle.ts for this market to include a yt address');
            return;
        }

        console.log('📊 Getting redeem quote...');

        // Option 1: Redeem to USDC (exact match of your working request)
        const redeemQuote = await sdk.getRedeemQuote(
            YT_TOKEN,
            0.1,
            UNDERLYING_TOKEN,
            'kyberswap,okx',             // aggregators
            6                            // YT token decimals (known value)
        );

        console.log('✅ Redeem Quote:');
        console.log('├─ YT Input:', redeemQuote.amountIn, 'YT');
        console.log('├─ USDC Output:', redeemQuote.amountOut.toFixed(6), 'USDC');
        console.log('├─ Exchange Rate:', redeemQuote.exchangeRate.toFixed(6));
        console.log('├─ Price Impact:', (redeemQuote.priceImpact * 100).toFixed(4) + '%');
        console.log('└─ Gas Limit:', redeemQuote.gas);

        console.log('\n💡 This redeem converts 0.1 YT to USDC using your exact working parameters');
        console.log('💡 To test different amounts, modify the 0.1 value in the code');

        // Execute redeem if private key is available
        if (config.privateKey) {
            console.log('\n🔄 Executing redeem transaction...');
            const result = await sdk.executeRedeem(redeemQuote);

            if (result.success) {
                console.log('✅ Redeem successful:');
                console.log('├─ Hash:', result.hash);
                console.log('├─ Gas Used:', result.gasUsed || 'N/A');
                console.log('└─ Block:', result.receipt?.blockNumber || 'N/A');
            } else {
                console.log('❌ Redeem failed:', result.error);
            }

            return result;
        } else {
            console.log('⚠️  Skipping execution - PRIVATE_KEY not provided');
            return { quote: redeemQuote, dryRun: true };
        }

    } catch (error) {
        console.error('❌ Redeem failed:', error.message);
        console.log('💡 Note: Make sure YT_TOKEN address is valid');
        console.log('💡 You can get YT token address from the market data');
    }
}

// ========== EXAMPLE 7: SHOW PT BALANCE ==========
export async function example7_showPtBalance() {
    console.log('\n=== Example 7: Show PT Balance ===');

    const sdk = new PendleSDK(config);

    try {
        const targetAddress = process.env.PENDLE_BALANCE_ADDRESS || null;
        const balanceInfo = await sdk.getPtBalance(MARKET, targetAddress);

        console.log('✅ PT Balance Information:');
        console.log('├─ Market:', balanceInfo.market);
        console.log('├─ Account:', balanceInfo.account);
        console.log('├─ PT Token:', balanceInfo.token);
        console.log('├─ Decimals:', balanceInfo.decimals);
        console.log('└─ Balance:', balanceInfo.balance);

        return balanceInfo;

    } catch (error) {
        console.error('❌ Failed to fetch PT balance:', error.message);
        console.log('💡 Hint: Ensure the market has a PT token configured and you provided a wallet (private key, receiver, or PENDLE_BALANCE_ADDRESS).');
    }
}

// ========== FRONTEND INTEGRATION EXAMPLE ==========
function frontendExample() {
    console.log('\n=== Frontend Integration Example ===');
    console.log(`
// React/Vue/Angular usage:

import { PendleSDK, CHAINS, resolvePendleMarket } from 'bolaritySDK';

const sdk = new PendleSDK({
    chainId: CHAINS.base.id,
    rpcUrl: 'https://1rpc.io/base',
    receiver: userWalletAddress,
    privateKey: userPrivateKey, // From wallet connect
    slippage: 0.01
});

const MARKET = '0x44e2b05b2c17a12b37f11de18000922e64e23faa';
const marketMeta = resolvePendleMarket(MARKET);

// Get quote for UI
async function getQuote(amount) {
    try {
        const quote = await sdk.getQuote(
            marketMeta.underlying,
            marketMeta.pt,
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
async function executeArbitrage(tokenAddress, amount) {
    try {
        const result = await sdk.arbitrageStablecoin(tokenAddress, amount, marketMeta.pt, MARKET);

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

// ========== INTERACTIVE MENU ==========
async function showMenu() {
    console.log('\n🚀 Pendle SDK Examples - Interactive Menu');
    console.log('='.repeat(50));
    console.log('1️⃣  Get Enhanced Quote with APY');
    console.log('2️⃣  Maturity and APY Analysis');
    console.log('3️⃣  Dry Run Arbitrage Simulation');
    console.log('4️⃣  Execute Single Swap (requires private key)');
    console.log('5️⃣  Full Arbitrage (requires private key)');
    console.log('6️⃣  Redeem PT & YT to Underlying (requires private key)');
    console.log('7️⃣  Show PT Balance');
    console.log('8️⃣  Show Frontend Integration Code');
    console.log('9️⃣  Run All Examples');
    console.log('0️⃣  Exit');
    console.log('='.repeat(50));
}

async function executeChoice(choice: string) {
    switch (choice) {
        case '1':
            return await example1_getQuote();
        case '2':
            return await example2_maturityAndAPY();
        case '3':
            return await example3_dryRunArbitrage();
        case '4':
            return await example4_executeSwap();
        case '5':
            return await example5_fullArbitrage();
        case '6':
            return await example6_redeemTokens();
        case '7':
            return await example7_showPtBalance();
        case '8':
            return frontendExample();
        case '9':
            return await runAllExamples();
        case '0':
            console.log('👋 Goodbye!');
            process.exit(0);
        default:
            console.log('❌ Invalid choice. Please select 0-9.');
            return null;
    }
}

export async function runAllExamples() {
    console.log('\n🔄 Running All Examples...');
    try {
        await example1_getQuote();
        await example2_maturityAndAPY();
        await example3_dryRunArbitrage();
        await example4_executeSwap();
        await example5_fullArbitrage();
        await example6_redeemTokens();
        await example7_showPtBalance();
        frontendExample();
        console.log('\n✅ All examples completed');
    } catch (error) {
        console.error('💥 Example failed:', error.message);
    }
}

export async function main() {
    console.log('🚀 Pendle SDK Examples');
    console.log('Current Configuration:');
    console.log('├─ Chain:', CHAINS.base.name, `(${CHAINS.base.id})`);
    console.log('├─ Market:', MARKET.slice(0, 10) + '...');
    console.log('├─ PT Token:', PT_TOKEN.slice(0, 10) + '...');
    console.log('└─ Has Private Key:', config.privateKey ? 'Yes ✅' : 'No ⚠️ (read-only mode)');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (prompt: string) => new Promise<string>((resolve) => rl.question(prompt, resolve));

    try {
        while (true) {
            await showMenu();
            const choice = await question('\nSelect an option (0-9): ');

            console.log('\n' + '='.repeat(50));
            const trimmedChoice = choice.trim();
            await executeChoice(trimmedChoice);

            if (trimmedChoice === '0') break;

            console.log('\n' + '='.repeat(50));
            const continueChoice = await question('Press Enter to continue or type "exit" to quit: ');
            if (continueChoice.trim().toLowerCase() === 'exit') break;
        }
    } catch (error) {
        console.error('💥 Application error:', error.message);
    } finally {
        rl.close();
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}
