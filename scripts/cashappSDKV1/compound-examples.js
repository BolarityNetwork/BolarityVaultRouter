#!/usr/bin/env node
/**
 * Compound SDK Usage Examples
 *
 * Linus Philosophy: "Show, don't tell"
 * These examples demonstrate real-world CashApp integration patterns
 */

require('dotenv').config();
const { CompoundSDK } = require('./CompoundSDK');

// ========== CONFIGURATION ==========
const config = {
    chainId: 8453, // Base mainnet
    rpcUrl: process.env.RPC_URL_8453 || 'https://1rpc.io/base',
    privateKey: process.env.PRIVATE_KEY, // Optional for read operations
    slippage: 0.005, // 0.5%
    verbose: true
};

// ========== EXAMPLE 1: GET APR INFORMATION ==========
async function example1_getAPRs() {
    console.log('\n=== Example 1: Get APR Information ===');

    const sdk = new CompoundSDK(config);

    try {
        // Get comprehensive APR data for USDC
        console.log('📊 Getting USDC yield information...');
        const aprData = await sdk.getTotalAPR('USDC');

        console.log('✅ USDC APR Breakdown:');
        console.log('├─ Base Interest APR:', aprData.baseAPRPercentage.toFixed(2) + '%');
        console.log('├─ COMP Rewards APR:', aprData.compAPRPercentage.toFixed(2) + '%');
        console.log('├─ Total APR:', aprData.totalAPRPercentage.toFixed(2) + '%');
        console.log('└─ Data Timestamp:', new Date(aprData.timestamp).toLocaleString());

        // Individual APR queries
        console.log('\n🔍 Individual APR Queries:');
        const baseAPR = await sdk.getInterestAPR('USDC');
        const compAPR = await sdk.getCompAPR('USDC');

        console.log('├─ Base APR (direct):', (baseAPR * 100).toFixed(2) + '%');
        console.log('└─ COMP APR (direct):', (compAPR * 100).toFixed(2) + '%');

        return aprData;

    } catch (error) {
        console.error('❌ APR retrieval failed:', error.message);
    }
}

// ========== EXAMPLE 2: GET USER BALANCE ==========
async function example2_getBalance() {
    console.log('\n=== Example 2: Get User Balance ===');

    const sdk = new CompoundSDK(config);
    const userAddress = sdk.privateKey ? sdk._getWallet().address : '0x8271A5Fcb45066D77F88288f4c076E55fD61ffEA';

    try {
        console.log('💰 Getting user balance for USDC...');
        const balance = await sdk.getBalance('USDC', userAddress);

        console.log('✅ User Balance Information:');
        console.log('├─ Asset:', balance.asset);
        console.log('├─ Supplied Amount:', balance.supplied.toFixed(6), 'USDC');
        console.log('├─ cToken Balance:', balance.cTokenBalance.toFixed(8), 'cUSDC');
        console.log('├─ Exchange Rate:', balance.exchangeRate.toFixed(8));
        console.log('├─ COMP Rewards:', balance.compRewards.toFixed(6), 'COMP');
        console.log('├─ Total Value:', balance.totalValue.toFixed(6), 'USDC');
        console.log('└─ Last Updated:', new Date(balance.timestamp).toLocaleString());

        return balance;

    } catch (error) {
        console.error('❌ Balance retrieval failed:', error.message);
    }
}

// ========== EXAMPLE 3: SUPPLY OPERATION ==========
async function example3_supply() {
    console.log('\n=== Example 3: Supply to Compound ===');

    if (!config.privateKey) {
        console.log('⚠️  Skipping supply - PRIVATE_KEY not provided');
        return;
    }

    const sdk = new CompoundSDK(config);
    const userAddress = sdk._getWallet().address;

    try {
        console.log('📤 Supplying 10 USDC to Compound...');
        const result = await sdk.supply('USDC', 10);

        if (result.success) {
            console.log('✅ Supply successful:');
            console.log('├─ Transaction Hash:', result.hash);
            console.log('├─ Amount Supplied:', result.amount, 'USDC');
            console.log('├─ Gas Used:', result.gasUsed || 'N/A');
            console.log('└─ Timestamp:', new Date(result.timestamp).toLocaleString());
        } else {
            console.log('❌ Supply failed:', result.error);
        }

        return result;

    } catch (error) {
        console.error('❌ Supply operation failed:', error.message);
    }
}

// ========== EXAMPLE 4: WITHDRAW OPERATION ==========
async function example4_withdraw() {
    console.log('\n=== Example 4: Withdraw from Compound ===');

    if (!config.privateKey) {
        console.log('⚠️  Skipping withdraw - PRIVATE_KEY not provided');
        return;
    }

    const sdk = new CompoundSDK(config);
    const userAddress = sdk._getWallet().address;

    try {
        console.log('📥 Withdrawing 5 USDC from Compound...');
        const result = await sdk.withdraw('USDC', 5);

        if (result.success) {
            console.log('✅ Withdraw successful:');
            console.log('├─ Transaction Hash:', result.hash);
            console.log('├─ Amount Withdrawn:', result.amount, 'USDC');
            console.log('├─ Gas Used:', result.gasUsed || 'N/A');
            console.log('└─ Timestamp:', new Date(result.timestamp).toLocaleString());
        } else {
            console.log('❌ Withdraw failed:', result.error);
        }

        return result;

    } catch (error) {
        console.error('❌ Withdraw operation failed:', error.message);
    }
}

// ========== EXAMPLE 5: CLAIM COMP REWARDS ==========
async function example5_claimRewards() {
    console.log('\n=== Example 5: Claim COMP Rewards ===');

    if (!config.privateKey) {
        console.log('⚠️  Skipping claim - PRIVATE_KEY not provided');
        return;
    }

    const sdk = new CompoundSDK(config);
    const userAddress = sdk._getWallet().address;

    try {
        console.log('🎁 Claiming COMP rewards...');
        const result = await sdk.claimRewards(userAddress);

        if (result.success) {
            console.log('✅ Claim successful:');
            console.log('├─ Transaction Hash:', result.hash || 'N/A');
            console.log('├─ COMP Rewards:', result.rewards?.toFixed(6) || '0', 'COMP');
            console.log('├─ Gas Used:', result.gasUsed || 'N/A');
            console.log('└─ Timestamp:', new Date(result.timestamp).toLocaleString());

            if (result.rewards === 0) {
                console.log('💡 No rewards available to claim');
            }
        } else {
            console.log('❌ Claim failed:', result.error);
        }

        return result;

    } catch (error) {
        console.error('❌ Claim operation failed:', error.message);
    }
}

// ========== EXAMPLE 6: GET COMPLETE TVL ==========
async function example6_getTVL() {
    console.log('\n=== Example 6: Get Complete Total Value Locked (TVL) ===');
    console.log('📖 API Usage: getTVL(chainName, cometAddress)');
    console.log('├─ chainName: "ethereum" | "base" | null (current)');
    console.log('├─ cometAddress: Comet contract address | null (use default)');
    console.log('└─ Returns: {totalTVL, baseTVL, collateralTVL, assets, chain, cometAddress}');
    console.log('🎯 Calculates complete TVL like official Compound example (base + collateral)');

    const sdk = new CompoundSDK(config);

    try {
        console.log('\n📊 Getting complete TVL for Comet markets...');

        // Example 1: Default (current chain, default comet)
        console.log('\n1️⃣ await sdk.getTVL() // Default: current chain default comet');
        const defaultTVL = await sdk.getTVL();
        console.log('✅ Complete TVL Result:');
        console.log(`├─ Chain: ${defaultTVL.chain}`);
        console.log(`├─ Comet: ${defaultTVL.cometAddress}`);
        console.log(`├─ Base TVL: $${defaultTVL.baseTVL.toLocaleString()}`);
        console.log(`├─ Collateral TVL: $${defaultTVL.collateralTVL.toLocaleString()}`);
        console.log(`├─ Total TVL: $${defaultTVL.totalTVL.toLocaleString()}`);
        console.log(`└─ Assets Count: ${defaultTVL.assets.length}`);

        // Example 2: Specific chain (Base)
        console.log('\n2️⃣ await sdk.getTVL("base") // Base chain default comet');
        const baseTVL = await sdk.getTVL('base');
        console.log('✅ Base Chain Complete TVL:');
        console.log(`├─ Total TVL: $${baseTVL.totalTVL.toLocaleString()}`);
        console.log(`├─ Base (USDC): $${baseTVL.baseTVL.toLocaleString()}`);
        console.log(`├─ Collateral: $${baseTVL.collateralTVL.toLocaleString()}`);
        console.log('└─ Asset Breakdown:');
        baseTVL.assets.forEach((asset, index) => {
            const prefix = index === baseTVL.assets.length - 1 ? '   └─' : '   ├─';
            console.log(`${prefix} ${asset.asset}: $${asset.tvl.toLocaleString()}`);
        });

        // Example 3: Ethereum (might have higher TVL)
        console.log('\n3️⃣ await sdk.getTVL("ethereum") // Ethereum mainnet');
        try {
            const ethTVL = await sdk.getTVL('ethereum');
            console.log('✅ Ethereum Complete TVL:');
            console.log(`├─ Total TVL: $${ethTVL.totalTVL.toLocaleString()}`);
            console.log(`├─ Base (USDC): $${ethTVL.baseTVL.toLocaleString()}`);
            console.log(`├─ Collateral: $${ethTVL.collateralTVL.toLocaleString()}`);
            console.log(`└─ Assets: ${ethTVL.assets.length} total`);
        } catch (error) {
            console.log('❌ Error:', error.message);
        }

        // Example 4: Specific comet address
        console.log('\n4️⃣ await sdk.getTVL("base", "0xb125E6687d4313864e53df431d5425969c15Eb2F")');
        try {
            const specificComet = await sdk.getTVL('base', '0xb125E6687d4313864e53df431d5425969c15Eb2F');
            console.log('✅ Specific Comet TVL:');
            console.log(`├─ Comet: ${specificComet.cometAddress}`);
            console.log(`└─ Total TVL: $${specificComet.totalTVL.toLocaleString()}`);
        } catch (error) {
            console.log('❌ Error:', error.message);
        }

        // Frontend Integration Examples
        console.log('\n📱 Frontend Integration Examples:');
        console.log(`
// Dashboard - Multiple Chain TVLs
const tvlData = await Promise.all([
    sdk.getTVL('base'),      // Base chain complete TVL
    sdk.getTVL('ethereum')   // Ethereum chain complete TVL
]);

const totalProtocolTVL = tvlData.reduce((sum, tvl) => sum + tvl.totalTVL, 0);

// Chart Data for Asset Breakdown
const allAssets = tvlData.flatMap(tvl =>
    tvl.assets.map(asset => ({
        name: \`\${tvl.chain} \${asset.asset}\`,
        value: asset.tvl,
        chain: tvl.chain
    }))
);

// Compare Base vs Collateral across chains
const tvlComparison = tvlData.map(tvl => ({
    chain: tvl.chain,
    baseTVL: tvl.baseTVL,
    collateralTVL: tvl.collateralTVL,
    totalTVL: tvl.totalTVL,
    breakdown: tvl.assets
}));

// Specific Comet Selection
const cometAddresses = {
    'base-usdc': '0xb125E6687d4313864e53df431d5425969c15Eb2F',
    'eth-usdc': '0xc3d688B66703497DAA19211EEdff47f25384cdc3'
};
const selectedTVL = await sdk.getTVL('base', cometAddresses['base-usdc']);
        `);

        console.log(`\n🕐 Complete TVL query completed at: ${new Date().toLocaleString()}`);
        return defaultTVL;

    } catch (error) {
        console.error('❌ Complete TVL retrieval failed:', error.message);
    }
}

// ========== CASHAPP INTEGRATION EXAMPLE ==========
function cashAppIntegrationExample() {
    console.log('\n=== CashApp Integration Example ===');
    console.log(`
// CashApp Frontend Integration:

import { CompoundSDK } from './CompoundSDK';

const compoundSDK = new CompoundSDK({
    chainId: 1,
    rpcUrl: 'https://eth.llamarpc.com',
    privateKey: userPrivateKey, // From wallet connect
    slippage: 0.005
});

// Savings Dashboard - Get current yields
async function getDashboardData() {
    try {
        const apr = await compoundSDK.getTotalAPR('USDC');
        const balance = await compoundSDK.getBalance('USDC', userAddress);

        return {
            currentAPR: apr.totalAPRPercentage,
            baseYield: apr.baseAPRPercentage,
            bonusYield: apr.compAPRPercentage,
            savedAmount: balance.supplied,
            earnedRewards: balance.compRewards,
            totalValue: balance.totalValue
        };
    } catch (error) {
        console.error('Dashboard error:', error);
        return null;
    }
}

// Deposit Flow
async function depositToSavings(amount) {
    try {
        setLoading(true);
        const result = await compoundSDK.supply('USDC', amount);

        if (result.success) {
            showSuccess(\`Deposited \${amount} USDC to savings!\`);
            setTransactionHash(result.hash);
            refreshBalance();
        } else {
            showError(\`Deposit failed: \${result.error}\`);
        }
    } catch (error) {
        showError(\`Deposit error: \${error.message}\`);
    } finally {
        setLoading(false);
    }
}

// Withdraw Flow
async function withdrawFromSavings(amount) {
    try {
        setLoading(true);
        const result = await compoundSDK.withdraw('USDC', amount);

        if (result.success) {
            showSuccess(\`Withdrew \${amount} USDC from savings!\`);
            setTransactionHash(result.hash);
            refreshBalance();
        } else {
            showError(\`Withdraw failed: \${result.error}\`);
        }
    } catch (error) {
        showError(\`Withdraw error: \${error.message}\`);
    } finally {
        setLoading(false);
    }
}

// Claim Rewards Flow
async function claimEarnedRewards() {
    try {
        setLoading(true);
        const result = await compoundSDK.claimRewards(userAddress);

        if (result.success && result.rewards > 0) {
            showSuccess(\`Claimed \${result.rewards.toFixed(4)} COMP rewards!\`);
            setTransactionHash(result.hash);
            refreshBalance();
        } else if (result.rewards === 0) {
            showInfo('No rewards available to claim');
        } else {
            showError(\`Claim failed: \${result.error}\`);
        }
    } catch (error) {
        showError(\`Claim error: \${error.message}\`);
    } finally {
        setLoading(false);
    }
}
    `);
}

// ========== INTERACTIVE MENU ==========
function showMenu() {
    console.log('\n🏦 Compound SDK Interactive Examples');
    console.log('='.repeat(50));
    console.log('Choose an example to run:');
    console.log('1️⃣  View APR Information');
    console.log('2️⃣  View User Balance');
    console.log('3️⃣  Supply USDC to Compound');
    console.log('4️⃣  Withdraw USDC from Compound');
    console.log('5️⃣  Claim COMP Rewards');
    console.log('6️⃣  Get Total Value Locked (TVL)');
    console.log('7️⃣  Show CashApp Integration Code');
    console.log('0️⃣  Exit');
    console.log('='.repeat(50));
}

async function handleChoice(choice) {
    try {
        switch (choice) {
            case '1':
                await example1_getAPRs();
                break;
            case '2':
                await example2_getBalance();
                break;
            case '3':
                await example3_supply();
                break;
            case '4':
                await example4_withdraw();
                break;
            case '5':
                await example5_claimRewards();
                break;
            case '6':
                await example6_getTVL();
                break;
            case '7':
                cashAppIntegrationExample();
                break;
            case '0':
                console.log('👋 Goodbye!');
                process.exit(0);
                break;
            default:
                console.log('❌ Invalid choice, please enter 0-7');
        }
    } catch (error) {
        console.error('💥 Example execution failed:', error.message);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const choice = args[0];

    if (!choice) {
        showMenu();
        console.log('\nUsage: node compound-examples.js [option]');
        console.log('Example: node compound-examples.js 6  # Get TVL');
        console.log('         node compound-examples.js 1  # View APR');
        return;
    }

    await handleChoice(choice);
}

// Export for testing
module.exports = {
    example1_getAPRs,
    example2_getBalance,
    example3_supply,
    example4_withdraw,
    example5_claimRewards,
    example6_getTVL
};

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}