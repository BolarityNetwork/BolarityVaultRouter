# Pendle SDK Integration Guide

## 概述
本指南说明如何使用 Pendle's Hosted SDK 构造 calldata 来调用 `swapExactPtForToken` 和其他 Pendle 交换方法。

## Pendle SDK API

### 基础 URL
```
https://api-v2.pendle.finance/sdk/api/v1
```

### 主要端点

#### 1. swapExactPtForToken
将固定数量的 PT 换成 Token

**请求：**
```bash
POST https://api-v2.pendle.finance/sdk/api/v1/swapExactPtForToken

{
  "chainId": 42161,              // 链 ID (如 Arbitrum)
  "receiverAddr": "0x...",       // 接收地址
  "marketAddr": "0x...",         // Pendle 市场地址
  "amountPtIn": "1000000000000000000", // PT 数量 (wei)
  "tokenOut": "0x...",           // 输出 token 地址
  "slippage": 0.01,              // 滑点 (1%)
  "excludedSources": ""          // 排除的 DEX (可选)
}
```

**响应：**
```json
{
  "transaction": {
    "to": "0x...",        // Pendle Router 地址
    "data": "0x...",      // 编码的 calldata
    "value": "0",         // ETH value
    "gasLimit": "500000"  // 建议的 gas limit
  },
  "data": {
    "amountOut": "1000000",    // 预期输出
    "priceImpact": "0.0012",   // 价格影响
    "exchangeRate": "0.95",    // 汇率
    "route": []                // 路由详情
  }
}
```

#### 2. swapExactTokenForPt
将固定数量的 Token 换成 PT

**请求：**
```bash
POST https://api-v2.pendle.finance/sdk/api/v1/swapExactTokenForPt

{
  "chainId": 42161,
  "receiverAddr": "0x...",
  "marketAddr": "0x...",
  "tokenIn": "0x...",
  "amountTokenIn": "1000000",  // Token 数量 (考虑 decimals)
  "slippage": 0.01,
  "excludedSources": ""
}
```

## 使用示例

### 1. 直接使用 JavaScript/TypeScript

```typescript
import axios from "axios";
import { ethers } from "ethers";

async function swapPtForToken() {
  // 1. 准备参数
  const params = {
    chainId: 42161,  // Arbitrum
    receiverAddr: "0xYourAddress",
    marketAddr: "0xMarketAddress",
    amountPtIn: ethers.parseEther("100").toString(),
    tokenOut: "0xUSDCAddress",
    slippage: 0.01
  };

  // 2. 获取 calldata
  const response = await axios.post(
    "https://api-v2.pendle.finance/sdk/api/v1/swapExactPtForToken",
    params
  );

  // 3. 执行交易
  const signer = /* your signer */;
  const tx = await signer.sendTransaction({
    to: response.data.transaction.to,
    data: response.data.transaction.data,
    value: 0,
    gasLimit: response.data.transaction.gasLimit
  });

  await tx.wait();
}
```

### 2. 在策略合约中使用

```solidity
// 1. 获取 SDK calldata (链下)
const sdkResponse = await getPendleSDKCalldata(params);

// 2. 编码数据传递给合约
const strategyData = ethers.AbiCoder.defaultAbiCoder().encode(
  ["bytes", "address", "address"],
  [
    sdkResponse.transaction.data,  // SDK calldata
    marketAddress,                  // Market 地址
    ptAddress                       // PT 地址
  ]
);

// 3. 调用 vault
await vault.depositWithData(amount, receiver, strategyData);
```

### 3. 在合约中执行 SDK calldata

```solidity
contract PendleStrategy {
    function executeSDKSwap(bytes calldata sdkCalldata) external {
        // 执行 SDK 生成的 calldata
        (bool success, bytes memory result) = pendleRouter.call(sdkCalldata);
        require(success, "Swap failed");
        
        // 处理结果...
    }
}
```

## 获取市场信息

### 获取市场详情
```bash
GET https://api-v2.pendle.finance/core/v1/{chainId}/markets/{marketAddress}
```

### 获取 PT 汇率
```bash
GET https://api-v2.pendle.finance/sdk/api/v1/getPtToAssetRate?chainId={chainId}&marketAddr={marketAddress}
```

## 运行示例脚本

### 安装依赖
```bash
npm install axios ethers
```

### 运行 SDK 示例
```bash
npx hardhat run scripts/pendleSDKExample.ts --network arbitrum
```

### 运行辅助脚本
```bash
npx ts-node scripts/pendleSwapHelper.ts
```

## 注意事项

1. **滑点设置**：建议设置 0.5% - 2% 的滑点，根据市场流动性调整
2. **Gas 估算**：SDK 返回的 gasLimit 是估算值，实际执行时可能需要调整
3. **价格影响**：大额交易前检查 priceImpact，避免过大的价格滑点
4. **市场到期**：检查 PT 是否已到期，到期的 PT 需要通过 redeem 而不是 swap
5. **路由优化**：SDK 会自动选择最优路由，包括聚合多个流动性源

## 支持的链

- Ethereum (chainId: 1)
- Arbitrum (chainId: 42161)
- Optimism (chainId: 10)
- BNB Chain (chainId: 56)
- Avalanche (chainId: 43114)

## 错误处理

```typescript
try {
  const response = await axios.post(sdkUrl, params);
  // 处理成功响应
} catch (error) {
  if (error.response) {
    // API 返回错误
    console.error("API Error:", error.response.data);
  } else {
    // 网络或其他错误
    console.error("Request failed:", error.message);
  }
}
```

## 相关链接

- [Pendle 官方文档](https://docs.pendle.finance/)
- [Pendle SDK API 文档](https://api-v2.pendle.finance/sdk/docs)
- [Pendle 合约地址](https://docs.pendle.finance/Developers/Deployments)
- [Pendle GitHub](https://github.com/pendle-finance)