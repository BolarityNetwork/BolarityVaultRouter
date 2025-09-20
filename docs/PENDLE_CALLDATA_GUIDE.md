# Pendle Router Calldata 构造指南

## 概述
Pendle 提供了两种方式来构造交换的 calldata：
1. 使用官方 SDK (`@pendle/sdk-v2`)
2. 直接构造合约调用数据

## 方法一：使用 Pendle SDK V2

### 安装
```bash
npm install @pendle/sdk-v2
```

### 使用示例
```typescript
import { Router } from "@pendle/sdk-v2";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("YOUR_RPC_URL");

// 创建 Router 实例
const router = new Router({
  chainId: 42161, // Arbitrum
  provider: provider
});

// 构造 swap 交易
const transaction = await router.swapExactPtForToken(
  marketAddress,
  ptAmount,
  tokenOut,
  minTokenOut,
  {
    receiver: userAddress,
    slippage: 0.01,
    deadline: Math.floor(Date.now() / 1000) + 3600
  }
);

// 执行交易
const tx = await signer.sendTransaction(transaction);
```

## 方法二：直接构造 Calldata（推荐）

不需要安装额外的包，直接通过合约接口构造。

### Pendle Router V3 地址
- **所有链统一地址**: `0x0000000001E4ef00d069e71d6bA041b0A16F7eA0`

### 核心函数

#### 1. swapExactPtForToken (简化版)
```solidity
function swapExactPtForTokenSimple(
  address receiver,
  address market,
  uint256 exactPtIn,
  address tokenOut,
  uint256 minTokenOut
) external returns (uint256 netTokenOut, uint256 netSyFee)
```

#### 2. swapExactPtForToken (完整版)
```solidity
function swapExactPtForToken(
  address receiver,
  address market,
  uint256 exactPtIn,
  TokenOutput tokenOutput,
  LimitOrderData limit
) external returns (uint256 netTokenOut, uint256 netSyFee, uint256 netSyInterm)
```

### 构造 Calldata 示例

```typescript
import { ethers } from "ethers";

// Router 地址
const PENDLE_ROUTER = "0x0000000001E4ef00d069e71d6bA041b0A16F7eA0";

// 构造简单的 swap calldata
function buildSwapCalldata(
  market: string,
  ptAmount: string,
  tokenOut: string,
  minTokenOut: string,
  receiver: string
): string {
  const iface = new ethers.Interface([
    "function swapExactPtForTokenSimple(address,address,uint256,address,uint256)"
  ]);

  return iface.encodeFunctionData("swapExactPtForTokenSimple", [
    receiver,
    market,
    ptAmount,
    tokenOut,
    minTokenOut
  ]);
}

// 使用
const calldata = buildSwapCalldata(
  "0xMarketAddress",
  ethers.parseEther("100").toString(),
  "0xTokenAddress", 
  ethers.parseEther("95").toString(), // 5% 滑点
  userAddress
);

// 发送交易
const tx = await signer.sendTransaction({
  to: PENDLE_ROUTER,
  data: calldata,
  gasLimit: 500000
});
```

## 获取必要参数

### 1. 获取 PT 到资产的汇率
```typescript
async function getPtToAssetRate(provider, marketAddress) {
  const router = new ethers.Contract(
    PENDLE_ROUTER,
    ["function getPtToAssetRate(address) view returns (uint256)"],
    provider
  );
  
  return await router.getPtToAssetRate(marketAddress);
}
```

### 2. 获取市场的 PT 地址
```typescript
async function getMarketTokens(provider, marketAddress) {
  const market = new ethers.Contract(
    marketAddress,
    ["function readTokens() view returns (address pt, address yt, address sy)"],
    provider
  );
  
  return await market.readTokens();
}
```

### 3. 计算最小输出（滑点保护）
```typescript
function calculateMinOutput(ptAmount, rate, slippageBps = 100) {
  const expected = (BigInt(ptAmount) * BigInt(rate)) / BigInt(1e18);
  const minOutput = (expected * BigInt(10000 - slippageBps)) / BigInt(10000);
  return minOutput;
}
```

## 完整执行流程

```typescript
async function swapPtForToken(signer, params) {
  const provider = signer.provider;
  const userAddress = await signer.getAddress();
  
  // 1. 获取市场信息
  const tokens = await getMarketTokens(provider, params.market);
  const rate = await getPtToAssetRate(provider, params.market);
  
  // 2. 计算最小输出
  const minOutput = calculateMinOutput(
    params.ptAmount,
    rate,
    params.slippageBps || 100
  );
  
  // 3. 授权 PT 给 Router
  const pt = new ethers.Contract(
    tokens.pt,
    ["function approve(address,uint256)"],
    signer
  );
  await pt.approve(PENDLE_ROUTER, params.ptAmount);
  
  // 4. 构造并执行 swap
  const calldata = buildSwapCalldata(
    params.market,
    params.ptAmount,
    params.tokenOut,
    minOutput.toString(),
    userAddress
  );
  
  const tx = await signer.sendTransaction({
    to: PENDLE_ROUTER,
    data: calldata,
    gasLimit: 500000
  });
  
  return await tx.wait();
}
```

## 在策略合约中使用

```solidity
contract PendleStrategy {
    address constant PENDLE_ROUTER = 0x0000000001E4ef00d069e71d6bA041b0A16F7eA0;
    
    function executeSwap(bytes calldata swapCalldata) external {
        // 直接执行 calldata
        (bool success, bytes memory result) = PENDLE_ROUTER.call(swapCalldata);
        require(success, "Swap failed");
        
        // 解码结果
        (uint256 netTokenOut, uint256 netSyFee) = abi.decode(
            result, 
            (uint256, uint256)
        );
        
        // 处理输出...
    }
}
```

## 主要市场地址（Arbitrum）

| 市场 | 地址 |
|------|------|
| PT-weETH-26DEC24 | 0xE11f9786B06438456b044B3E21712228ADcAA0D1 |
| PT-USDE-27MAR25 | 0x2Dfaf9a5E4F293BceedE49f2dBa29aACDD88E0C4 |
| PT-rsETH-26DEC24 | 0x6F02C88650837C8dfe89F66723c4743E9cF833cd |

## 注意事项

1. **授权**：执行 swap 前需要先授权 PT 给 Router
2. **滑点**：建议设置 0.5% - 2% 的滑点保护
3. **Gas**：PT swap 通常需要 300k-500k gas
4. **到期检查**：确保 PT 未到期，到期的 PT 需要通过 `redeemPyToToken` 赎回
5. **汇率查询**：使用 `getPtToAssetRate` 获取实时汇率

## 错误处理

```typescript
try {
  const receipt = await swapPtForToken(signer, params);
  console.log("Swap successful:", receipt.transactionHash);
} catch (error) {
  if (error.code === 'CALL_EXCEPTION') {
    console.error("Swap failed - check slippage and balance");
  } else if (error.code === 'INSUFFICIENT_FUNDS') {
    console.error("Insufficient balance");
  } else {
    console.error("Unknown error:", error);
  }
}
```

## 相关资源

- [Pendle 文档](https://docs.pendle.finance/)
- [Pendle SDK GitHub](https://github.com/pendle-finance/pendle-sdk-core-v2-public)
- [合约地址](https://docs.pendle.finance/Developers/Deployments/V2)
- [Router 接口](https://github.com/pendle-finance/pendle-core-v2-public/blob/main/contracts/router/ActionSwapPT.sol)