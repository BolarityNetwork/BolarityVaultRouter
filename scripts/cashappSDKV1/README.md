# DeFi SDK Suite v3.0

> "Good taste is a matter of eliminating special cases." - Linus Torvalds

A unified SDK suite for **Pendle Protocol** arbitrage and **Compound V3** lending, featuring real-time APY calculation, maturity tracking, and seamless CashApp integration. Built with Linux kernel design principles.

## Philosophy

- **Simplicity**: No unnecessary complexity
- **Good Taste**: Eliminate special cases
- **Data First**: Proper data structures over clever code
- **Real Problems**: Solve actual arbitrage needs
- **Real Data**: Live maturity and APY calculations

## 🚀 What's New in v3.0

### Pendle SDK Enhancements
✅ **Real-time Maturity Tracking** - Live PT token expiry dates from Pendle API
✅ **Automatic APY Calculation** - Compound interest rates based on actual time remaining
✅ **Multi-Token Arbitrage** - Support any ERC20 token with dynamic decimals
✅ **Enhanced Quote Data** - All financial metrics in one immutable object

### 🆕 Compound V3 Integration
✅ **Base Chain Support** - Full Compound V3 integration on Base network
✅ **Real APR Calculation** - Live supply rates from Compound protocol
✅ **COMP Rewards Tracking** - Automatic reward accumulation monitoring
✅ **CashApp Integration** - Savings dashboard ready APIs
✅ **ethers v6 Compatible** - Native BigInt support for precision
✅ **Interactive Examples** - Choose-your-own demonstration system

## Quick Start

### Pendle Protocol Arbitrage
```javascript
const { PendleSDK, CHAINS } = require('./PendleSDK');

const pendleSDK = new PendleSDK({
    chainId: CHAINS.base.id,
    rpcUrl: 'https://your-base-rpc.com',
    receiver: '0x...',
    privateKey: '0x...', // Optional for quotes
    slippage: 0.01
});

// Get enhanced quote with real-time APY
const quote = await pendleSDK.getQuote(
    CHAINS.base.usdc, '0xb04cee9901c0a8d783fe280ded66e60c13a4e296',
    100, '0x44e2b05b2c17a12b37f11de18000922e64e23faa'
);

console.log(`APY: ${quote.apyPercentage.toFixed(2)}%`);
console.log(`Days to maturity: ${quote.daysToMaturity.toFixed(1)}`);
```

### 🆕 Compound V3 Lending
```javascript
const { CompoundSDK } = require('./CompoundSDK');

const compoundSDK = new CompoundSDK({
    chainId: 8453,  // Base network
    rpcUrl: 'https://your-base-rpc.com',
    privateKey: '0x...', // Required for transactions
    slippage: 0.005
});

// Get current APR rates
const apr = await compoundSDK.getTotalAPR('USDC');
console.log(`Base APR: ${apr.baseAPRPercentage.toFixed(2)}%`);
console.log(`COMP APR: ${apr.compAPRPercentage.toFixed(2)}%`);
console.log(`Total APR: ${apr.totalAPRPercentage.toFixed(2)}%`);

// Supply to earn yield
const result = await compoundSDK.supply('USDC', 1000);
if (result.success) {
    console.log(`Supplied! Tx: ${result.hash}`);
}
```

## Core Classes

### PendleSDK
Main Pendle protocol interface. Handles PT token quotes, execution, and real-time maturity tracking.

### 🆕 CompoundSDK
Compound V3 lending protocol interface. Manages supply, withdraw, rewards, and APR calculations.

### SwapQuote (Enhanced v3.0)
Immutable Pendle quote data structure with computed properties:
- `profit`: Calculated profit amount
- `apyPercentage`: Real-time APY based on actual maturity ⭐
- `daysToMaturity`: Precise countdown to PT expiry ⭐
- `maturityDate`: Exact expiry date and time ⭐

### 🆕 CompoundAPR
Compound V3 APR data structure:
- `baseAPRPercentage`: Supply interest rate
- `compAPRPercentage`: COMP reward rate
- `totalAPRPercentage`: Combined APR

### 🆕 CompoundBalance
User balance information:
- `supplied`: Amount supplied to Compound
- `compRewards`: Accrued COMP rewards
- `totalValue`: Total value including interest

### CompoundResult / TxResult
Consistent transaction result format:
- `success`: Boolean
- `hash`: Transaction hash
- `receipt`: Transaction receipt
- `error`: Error message if failed

## API Reference

### Pendle SDK Methods

#### getMaturityInfo(market)
Returns: `{ maturityDate, daysToMaturity, maturityTimestamp }`

Get real-time PT token maturity information from Pendle API.

#### getQuote(tokenIn, tokenOut, amountIn, market) ⭐ Enhanced
Returns: `SwapQuote` with real-time APY data

#### arbitrageStablecoin(stablecoinAddress, amount, ptToken, market, options)
Returns: Arbitrage result object

Complete multi-token arbitrage flow with dynamic decimals support.

### 🆕 Compound SDK Methods

#### getTotalAPR(asset)
Returns: `CompoundAPR` object with base + COMP rewards

Get comprehensive APR breakdown for lending pools.

#### getBalance(asset, userAddress)
Returns: `CompoundBalance` with supplied amount and rewards

Query user's lending position and accrued rewards.

#### supply(asset, amount)
Returns: `CompoundResult`

Supply tokens to Compound V3 to start earning yield.

#### withdraw(asset, amount)
Returns: `CompoundResult`

Withdraw supplied tokens plus accrued interest.

#### claimRewards(userAddress)
Returns: `CompoundResult`

Claim accumulated COMP rewards.

## Supported Chains

```javascript
CHAINS.ethereum   // Ethereum mainnet
CHAINS.bsc        // BSC
CHAINS.polygon    // Polygon
CHAINS.base       // Base
CHAINS.arbitrum   // Arbitrum
```

## Error Handling

The SDK follows the "errors are values" principle:

```javascript
const result = await sdk.executeSwap(quote);

if (result.success) {
    console.log('Hash:', result.hash);
} else {
    console.error('Error:', result.error);
}
```

## 🎯 Real-World Example

Based on current Base chain data (2025-09-23):

```javascript
const quote = await sdk.getQuote(
    CHAINS.base.usdc,
    '0xb04cee9901c0a8d783fe280ded66e60c13a4e296', // PT token
    100,
    '0x44e2b05b2c17a12b37f11de18000922e64e23faa'  // Market
);

console.log(quote.toJSON());
// Output:
{
  amountIn: 100,
  amountOut: 100.142451,
  exchangeRate: 1.001425,
  profit: 0.142451,
  yieldRate: 0.001425,
  daysToMaturity: 1.8,        // Real-time countdown
  apy: 0.3386,               // 33.86% APY
  apyPercentage: 33.86       // Ready for UI display
}
```

**PT expires**: September 25, 2025 at 8:00 AM Beijing Time (1.8 days remaining)

## Frontend Integration

Perfect for React/Vue/Angular with enhanced APY display:

```javascript
// Component state
const [quote, setQuote] = useState(null);
const [loading, setLoading] = useState(false);

// Get enhanced quote for UI
async function updateQuote(amount) {
    setLoading(true);
    try {
        const quote = await sdk.getQuote(usdc, pt, amount, market);
        setQuote(quote);
    } catch (error) {
        setError(error.message);
    } finally {
        setLoading(false);
    }
}

// Render enhanced UI
return (
    <div className="pendle-quote">
        <div>投入: {quote.amountIn} USDC</div>
        <div>获得: {quote.amountOut.toFixed(6)} PT</div>
        <div>利润: {quote.profit.toFixed(6)} PT</div>
        <div className="highlight">
            年化收益率: {quote.apyPercentage?.toFixed(2)}% 🚀
        </div>
        <div className="countdown">
            到期时间: {quote.daysToMaturity?.toFixed(1)} 天
        </div>
        <div className="expiry">
            到期日期: {quote.maturityDate?.toLocaleDateString()}
        </div>
    </div>
);

// Execute transaction with any token
async function executeTransaction(tokenAddress, amount) {
    const result = await sdk.arbitrageStablecoin(tokenAddress, amount, pt, market);
    if (result.success) {
        setTxHash(result.step1.transaction.hash);
    }
}
```

## 🚀 Interactive Examples

Run the **choice-based demonstration system**:

```bash
# Show menu
node src/sdk/compound-examples.js

# Run specific examples
node src/sdk/compound-examples.js 1  # APR Information
node src/sdk/compound-examples.js 2  # User Balance
node src/sdk/compound-examples.js 3  # Supply Operation
node src/sdk/compound-examples.js 4  # Withdraw Operation
node src/sdk/compound-examples.js 5  # Claim Rewards
node src/sdk/compound-examples.js 6  # CashApp Integration Code
```

### Menu Options:
1️⃣  **查看 APR 信息** - Live Compound V3 supply rates and COMP rewards
2️⃣  **查看用户余额** - Current lending position and accrued rewards
3️⃣  **供应 USDC** - Deposit tokens to start earning yield
4️⃣  **提取 USDC** - Withdraw supplied tokens plus interest
5️⃣  **领取 COMP 奖励** - Claim accumulated protocol rewards
6️⃣  **CashApp 集成代码** - Frontend integration examples

### Pendle Examples
```bash
node src/sdk/examples.js  # Original Pendle arbitrage examples
```

## Configuration

### Environment Variables

```bash
# Base Chain RPC (required for both Pendle & Compound)
RPC_URL_8453=https://your-base-rpc.com

# Wallet private key (required for transactions)
PRIVATE_KEY=0x...

# Pendle Protocol (optional - for arbitrage)
PENDLE_MARKET_ADDRESS=0x44e2b05b2c17a12b37f11de18000922e64e23faa
PENDLE_PT_ADDRESS=0xb04cee9901c0a8d783fe280ded66e60c13a4e296
PENDLE_RECEIVER_ADDRESS=0x...
```

### 🆕 Built-in Contract Addresses

#### Compound V3 (Base Chain)
- **Comet (cUSDCv3)**: `0xb125E6687d4313864e53df431d5425969c15Eb2F`
- **CometRewards**: `0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1`
- **USDC Token**: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

#### Pendle Protocol (Base Chain)
- **Router V4**: `0x888888888889758F76e7103c6CbF23ABbF58F946`
- **Sample Market**: `0x44e2b05b2c17a12b37f11de18000922e64e23faa`
- **Sample PT**: `0xb04cee9901c0a8d783fe280ded66e60c13a4e296`

*No manual configuration needed - addresses are built into the SDK.*

## 📊 APY Calculation Details

The SDK uses **compound interest formula** for accurate APY:

```
APY = (1 + yieldRate)^(365.25 / daysToMaturity) - 1
```

**Example calculation** (Base chain, 2025-09-23):
- Yield Rate: 0.1425% (1.425 days profit)
- Days to Maturity: 1.8 days
- APY = (1 + 0.001425)^(365.25 / 1.8) - 1 = **33.86%**

This accounts for the **time value of money** - shorter duration = higher annualized rate.

## Design Principles Applied

### 1. Good Taste ⭐ Enhanced
No special cases - all operations return consistent data structures with computed APY.

### 2. Simplicity
- 3 core classes only
- Minimal configuration
- Clear API surface
- **Automatic APY calculation**

### 3. Data Structures First
`SwapQuote` contains all computed properties including real-time APY. No manual calculations needed.

### 4. Real Problems
Solves actual arbitrage workflows with **real market data**, not theoretical use cases.

### 5. 🆕 Real Data Priority
Uses live Pendle API data for accurate maturity tracking and APY calculations.

## Why This Design?

As Linus says: *"I'm a great believer in 'simple is beautiful'. The simpler the design, the more likely it is to work and the easier it is to understand and maintain."*

This SDK eliminates:
- Complex inheritance hierarchies
- Magic configuration
- Hidden state mutations
- Unclear error handling
- Special case handling
- **Manual APY calculations** ⭐
- **Hardcoded maturity dates** ⭐
- **🆕 Token-specific hardcoding** - Works with any ERC20
- **🆕 Decimal assumptions** - Dynamic precision query

Result: Clean, predictable, maintainable code with **accurate financial data**.

## 🎯 Real-World Performance (Base Chain)

Current live data from production environment:

### Compound V3 Performance
```
Base Chain USDC Lending:
├─ Supply APR: ~6.50% (variable rate)
├─ COMP Rewards: ~1.00% (estimated)
├─ Total APR: ~7.50%
└─ Utilization: 70%+ (healthy)
```

### Pendle Arbitrage Example
```
PT Token: 0xb04cee9901c0a8d783fe280ded66e60c13a4e296
├─ Current Profit: 0.14 PT per 100 USDC
├─ APY: 33.86% (1.8 days to maturity)
├─ Expires: Sept 25, 2025
└─ Risk Level: Low (established market)
```

## 🏦 CashApp Integration Ready

The SDK is **production-ready** for savings applications:

### Dashboard Integration
```javascript
const { CompoundSDK } = require('./CompoundSDK');

// Initialize for Base chain
const savings = new CompoundSDK({
    chainId: 8453,
    rpcUrl: process.env.BASE_RPC,
    privateKey: userWallet.privateKey
});

// Get savings dashboard data
async function getSavingsDashboard(userAddress) {
    const [apr, balance] = await Promise.all([
        savings.getTotalAPR('USDC'),
        savings.getBalance('USDC', userAddress)
    ]);

    return {
        currentAPR: apr.totalAPRPercentage,     // 7.50%
        baseYield: apr.baseAPRPercentage,      // 6.50%
        bonusYield: apr.compAPRPercentage,     // 1.00%
        savedAmount: balance.supplied,          // User's deposits
        earnedRewards: balance.compRewards,     // COMP rewards
        totalValue: balance.totalValue          // Total including interest
    };
}
```

### Transaction Flows
```javascript
// Deposit flow (CashApp → Compound)
async function depositSavings(amount) {
    const result = await savings.supply('USDC', amount);
    return {
        success: result.success,
        txHash: result.hash,
        gasUsed: result.gasUsed
    };
}

// Withdraw flow (Compound → CashApp)
async function withdrawSavings(amount) {
    const result = await savings.withdraw('USDC', amount);
    return {
        success: result.success,
        txHash: result.hash
    };
}
```

### Frontend Components Ready
- Real-time APR display
- Transaction status tracking
- Error handling with user-friendly messages
- Dynamic address resolution from private keys
- Interactive testing suite