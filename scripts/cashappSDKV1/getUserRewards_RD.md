

---
🧾 CashApp 每日收益计算逻辑（MVP 版本 · 含内部移动排除）
1. 背景与目标
CashApp 以稳定币（USDC/USDT/DAI 等）为结算单位，用户资金分布于：
- 钱包可用余额
- Aave 协议
- Compound 协议
- Pendle 协议
目标：
 快速实现「每日收益计算」逻辑，以展示用户在一定时间段内的收益变化。

---
2. 基本原则
3. 收益口径：
 [
 \text{DailyYield} = (\text{总余额变化}) - (\text{当日净转入})
 ]
4. 统一计价单位：稳定币（USDC/USDT/DAI）
5. 每日切点：UTC 00:00
6. 内部搬砖交易排除：排除钱包与协议内部交互（如供应/赎回、swap、router 交互）带来的伪流入流出。
7. 结果可复算：同样输入条件应生成相同结果。

---
8. 数据定义
This content is only supported in a Lark Docs

---
9. 计算公式
[
 \text{DailyYield}{n} = (B{n} - B_{n-1}) - \text{NetTransfer}_{n}
 ]
- ( B_n )：n 日 00:00 总余额
- ( \text{NetTransfer}_n )：(n−1 日 00:00, n 日 00:00] 区间内的稳定币净转入金额

---
10. 内部移动排除逻辑（Internal Exclusion）
为避免内部资金移动被误计为流入流出，需在净转入计算中排除以下交互：
This content is only supported in a Lark Docs
✅ 逻辑说明
- 当检测到交易 from 或 to 地址在排除列表中 → 忽略该笔流入/流出；
- 若用户与这些地址交互，视为内部资金移动，不计入净流；
- 该列表应支持 config 文件配置与动态更新。

---
11. 可配置排除列表（Config）
{
  "exclude_addresses": {
    "compound": ["<all comet addresses>"],
    "pendle": [
      "0xd4F480965D2347d421F1bEC7F545682E5Ec2151D",
      "0x888888888889758F76e7103c6CbF23ABbF58F946"
    ],
    "aave": [
      "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"
    ]
  }
}
开发时可通过环境变量或 JSON 文件动态加载，便于热更新。

---
12. 开发任务：计算净流入函数
函数定义
async function getNetTransfer(
  chainId: number,
  userAddress: string,
  startTime: number,  // timestamp
  endTime: number     // timestamp
): Promise<number>
功能说明
- 统计指定时间窗口内（startTime → endTime）的稳定币净转入量；
- 自动排除内部交互（根据配置文件中的地址列表）；
- 返回以 USD 计价的净流入金额。
逻辑步骤
1. 查询 userAddress 的所有稳定币转账记录；
2. 过滤出：
  - asset ∈ {USDC, USDT, DAI}；
  - timestamp ∈ [startTime, endTime)；
3. 过滤排除项：
  - 若交易 from 或 to 在排除列表中 → 忽略；
4. 汇总净流入：
net_in = Σ(amount where to=user)
net_out = Σ(amount where from=user)
net_transfer = net_in - net_out
1. 返回结果（decimal，6位精度）。

---
2. 数据结构参考
transfers
This content is only supported in a Lark Docs

---
3. 示例返回
{
  "chainId": 1,
  "user": "0x1234...",
  "startTime": 1730000000,
  "endTime": 1730086400,
  "netTransfer": 150.25
}

---

