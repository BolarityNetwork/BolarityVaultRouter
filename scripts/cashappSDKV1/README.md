# Pendle SDK v2.0

> "Good taste is a matter of eliminating special cases." - Linus Torvalds

A clean, simple SDK for Pendle protocol arbitrage with **real-time APY calculation** and **maturity tracking**. Built with Linux kernel design principles.

## Philosophy

- **Simplicity**: No unnecessary complexity
- **Good Taste**: Eliminate special cases
- **Data First**: Proper data structures over clever code
- **Real Problems**: Solve actual arbitrage needs
- **Real Data**: Live maturity and APY calculations

## 🚀 What's New in v2.0

✅ **Real-time Maturity Tracking** - Live PT token expiry dates
✅ **Automatic APY Calculation** - Compound interest rates based on actual time remaining
✅ **Enhanced Quote Data** - All financial metrics in one object
✅ **Timezone Support** - Accurate countdown to PT expiry

## Quick Start

```javascript
const { PendleSDK, CHAINS } = require('./PendleSDK');

const sdk = new PendleSDK({
    chainId: CHAINS.base.id,
    rpcUrl: 'https://1rpc.io/base',
    receiver: '0x...',
    privateKey: '0x...', // Optional for quotes
    slippage: 0.01
});

// Get enhanced quote with APY
const quote = await sdk.getQuote(
    CHAINS.base.usdc,  // From token
    ptToken,           // To token
    100,               // Amount
    market             // Market address
);

console.log(`Profit: ${quote.profit.toFixed(6)} PT`);
console.log(`APY: ${quote.apyPercentage.toFixed(2)}%`);
console.log(`Days to maturity: ${quote.daysToMaturity.toFixed(1)}`);
console.log(`Expires: ${quote.maturityDate.toLocaleDateString()}`);

// Execute arbitrage
const result = await sdk.arbitrage(100, ptToken, market);
```

## Core Classes

### PendleSDK
Main SDK interface. Handles quotes, execution, and maturity tracking.

### SwapQuote (Enhanced v2.0)
Immutable quote data structure with computed properties:
- `profit`: Calculated profit amount
- `isprofitable`: Boolean profitability check
- `exchangeRate`: Automatic rate calculation
- **`apyPercentage`**: Real-time APY based on actual maturity ⭐
- **`daysToMaturity`**: Precise countdown to PT expiry ⭐
- **`maturityDate`**: Exact expiry date and time ⭐
- **`yieldRate`**: Simple yield percentage ⭐

### TxResult
Consistent transaction result format:
- `success`: Boolean
- `hash`: Transaction hash
- `receipt`: Transaction receipt
- `error`: Error message if failed

## API Reference

### 🆕 getMaturityInfo(market)
Returns: `{ maturityDate, daysToMaturity, maturityTimestamp }`

Get real-time PT token maturity information from Pendle API.

### getQuote(tokenIn, tokenOut, amountIn, market) ⭐ Enhanced
Returns: `SwapQuote` with APY data

Get swap quote with automatic APY calculation and maturity tracking.

### 🆕 calculateAPY(amountIn, amountOut, daysToMaturity)
Returns: APY as decimal (e.g., 0.35 = 35%)

Calculate compound annual percentage yield.

### 🆕 getQuoteWithAPYExample(tokenIn, tokenOut, market, exampleAmount = 100)
Returns: Frontend-ready object with APY example

Perfect for UI display - shows APY for a standard amount.

### executeSwap(quote)
Returns: `TxResult`

Execute a single swap transaction.

### arbitrage(usdcAmount, ptToken, market, options)
Returns: Arbitrage result object

Complete USDC→PT→profit extraction flow.

Options:
- `dryRun: true` - Simulation only

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

// Execute transaction
async function executeTransaction() {
    const result = await sdk.arbitrage(amount, pt, market);
    if (result.success) {
        setTxHash(result.step1.transaction.hash);
    }
}
```

## Examples

Run the examples:

```bash
node src/sdk/examples.js
```

This will demonstrate:
1. **Enhanced quotes** with APY calculation
2. **Maturity analysis** for different amounts
3. **Dry run arbitrage** simulation
4. **Single swap execution**
5. **Full arbitrage flow**

## Configuration

Required environment variables:

```bash
# RPC endpoint
RPC_URL_8453=https://1rpc.io/base

# Wallet (for execution)
PRIVATE_KEY=0x...

# Contract addresses
PENDLE_MARKET_ADDRESS=0x...
PENDLE_PT_ADDRESS=0x...
PENDLE_RECEIVER_ADDRESS=0x...
```

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

Result: Clean, predictable, maintainable code with **accurate financial data**.