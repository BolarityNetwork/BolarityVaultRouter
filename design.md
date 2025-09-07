# Introduction

Bolarity provides users with access to multiple vaults listed in our application. However, we currently lack a standardized and scalable mechanism to charge service fees when users interact directly with the vaults. In addition, frontend integration is complex and inconsistent. We need to design a scalable, stable, and efficient system that enables seamless vault access while reducing integration complexity.

# Objectives

- **For Users**: Provide a simple, unified ABI to interact with any vault. Users should be able to deposit, earn yield, and withdraw funds efficiently and accurately.
- **For Bolarity**: Enable effortless service fee collection across different vaults using a unified structure, with scalability to support newly added vaults.
- **For Frontend**: Simplify integration by exposing a unified set of function calls. Developers should be able to easily query user account status, including balances, daily revenue, and portfolio information.

# Scope

**In scope**

- ERC-4626–compatible wrapper vaults per underlying asset.
- A unified Router contract as the single frontend entry point.
- Pluggable **Strategy** adapters for major yield sources (Aave, Compound, etc.).
- Pre-action performance fee crystallization using asset-per-share (APS)–based minting.
- Standardized events and preview APIs for balances, daily revenue approximation, and portfolio views.

**Out of scope**

- The investment strategies of the underlying protocols themselves.
- Price oracles and off-chain analytics pipelines (only on-chain accounting/events are defined here).

# System Design Principles

- Scalability: unified interface to add new vault into system any time
- Stability: a comprehensive design that can make sure every part works as expected
- Efficiency: succinct design that less code more function
- Security: high level code design that can natively pass any audit

# Proposed Solution

This section specifies the target architecture, module responsibilities, key interfaces, fee model, and end-to-end flows. It is written to be immediately actionable for smart-contract implementation, frontend integration, and audit.

## 1. High-Level Architecture

Single entry for users → per-(asset, market) ERC-4626 vaults → protocol-specific strategies.

![img](https://qsg9trd9ijbs.sg.larksuite.com/space/api/box/stream/download/asynccode/?code=MzZlYjYwZTA1ZTE5NzFjZjJlM2YyZDRjZDg5MzY0MzdfYlNaWUhYc2FLOThVUGdXb1Vad3J0clduc2Q2dmFYY0pfVG9rZW46R1FjY2I0Y3ZsbzN2Ykd4ZG5oSGxiVEtFZ1VlXzE3NTcxNDA0MDE6MTc1NzE0NDAwMV9WNA)

- Users call the Router only.
- The Router resolves {asset, market} → vault via the Registry and forwards the call.
- Each Vault is ERC-4626 compatible and implements pre-action fee crystallization.
- Each Vault executes its pluggable Strategy via **delegatecall**, so the Vault is the caller (msg.sender) to the protocol; all assets/receipt tokens stay under the Vault.
- `totalAssets()` at the Vault level = idle principal token + `strategy.totalUnderlying(vault)` (both in the same principal unit).

## 2. Modules & Responsibilities

### 2.1 Router (single entry point)

**Purpose**

- Provide a uniform ABI to the frontend.
- Resolve the correct Vault for a given (asset, market) and forward standard ERC-4626 calls.
- Expose read paths for previews and portfolio queries (by delegating to vaults).

**Core ABI**

```Solidity
interface IBolarityRouter {
    // -------- Write (with data) --------
    function deposit(
        address asset,
        bytes32 market,
        uint256 assets,
        address receiver,
        bytes calldata data
    ) external returns (uint256 shares);

    function withdraw(
        address asset,
        bytes32 market,
        uint256 assets,
        address receiver,
        address owner,
        bytes calldata data
    ) external returns (uint256 shares);

    function mint(
        address asset,
        bytes32 market,
        uint256 shares,
        address receiver,
        bytes calldata data
    ) external returns (uint256 assets);

    function redeem(
        address asset,
        bytes32 market,
        uint256 shares,
        address receiver,
        address owner,
        bytes calldata data
    ) external returns (uint256 assets);

    // -------- Read (unchanged) --------
    function vaultFor(address asset, bytes32 market) external view returns (address);
    function previewDeposit(address asset, bytes32 market, uint256 assets) external view returns (uint256 shares);
    function previewWithdraw(address asset, bytes32 market, uint256 assets) external view returns (uint256 shares);
    function previewMint(address asset, bytes32 market, uint256 shares) external view returns (uint256 assets);
    function previewRedeem(address asset, bytes32 market, uint256 shares) external view returns (uint256 assets);
}
```

**Behavior**

- Looks up the Vault address from the Registry.
- Before calling a write method on the Vault, the Router sets a per-call data blob: `vault.setStrategyCallData(data)`. **`data`** **MAY be empty (****`0x`****).**
- Vault pulls tokens from the user (pull model) (use permit/Permit2 inside `data` if desired); Router never holds funds.
- For all preview* calls, the Router forwards to the Vault (Vault must internally simulate fee crystallization to keep previews accurate).

### 2.2 Registry

**Purpose**

- Canonical mapping of (asset, market) → vault.
- Optional: (vault → strategy, metadata) for analytics and health checks.

**Admin**

- `registerVault(asset, market, vault)`
- `setPreferredMarket(asset, market)` (optional convenience for a “default” market per asset)

**Events**

- `VaultRegistered(asset, market, vault)`
- `PreferredMarketSet(asset, market)`

### 2.3 ERC-4626 Wrapper Vault (per asset × market)

**Purpose**

- ERC-4626 share accounting and **pre-action performance fee crystallization**（通道 A：基于 ΔAPS）。
- Executes a single Strategy via **delegatecall** (the Strategy is a stateless logic module).
- Keeps all assets/receipts under the Vault address (users never receive protocol tokens directly).
- **Event-based crystallization on entry**（通道 B）：当策略返回“入场即确定利润”（如 Pendle PT）时，即时以**份额方式**抽成。

**Key State**

- `IERC20 asset` — the principal unit used for accounting & fees (e.g., USDC, ETH, stETH).
- `address strategy` — logic contract executed via delegatecall.
- `address router` — authorized Router allowed to pass per-call data.
- `bytes _pendingStrategyData` — per-call data set by Router and consumed once in hooks (MAY be empty).
- `address feeCollector`
- `uint16 perfFeeBps` — e.g., 2000 = 20%.
- `uint256 lastP` — last recorded assets-per-share baseline (APS, scaled 1e18).
- Optional: `uint256 minAccrual` (fee dust threshold).

**totalAssets()**

```Solidity
function totalAssets() public view override returns (uint256) {
    uint256 idle = IERC20(asset()).balanceOf(address(this));
    uint256 invested = IStrategy(strategy).totalUnderlying(address(this)); // principal unit
    return idle + invested;
}
```

**Fee model — Pre-action crystallization（ΔAPS）**

- Triggered at the very beginning of every deposit/mint/withdraw/redeem.
- Guarantees “new entrants never diluted; exiting holders always share fees.”
- APS: `P = totalAssets / totalSupply (1e18)`
- If `ΔP = P_now − lastP > 0`, mint fee-shares `x` to feeCollector: `x = S * f * ΔP / (P_now − f * ΔP)` where `S = totalSupply (before mint)`, `f = perfFeeBps / 10_000`.

**Reference implementation (pseudocode)**

```Solidity
function _accruePerfFee() internal returns (uint256 feeShares) {
    uint256 S = totalSupply();
    if (S == 0 || perfFeeBps == 0) return 0;

    uint256 A  = totalAssets();
    uint256 P0 = lastP;
    uint256 P1 = (A * 1e18) / S;

    if (P1 <= P0) { lastP = P1; return 0; }
    uint256 dP = P1 - P0;

    uint256 numerator   = S * perfFeeBps * dP;
    uint256 denominator = (P1 * 10_000) - (perfFeeBps * dP);
    if (denominator == 0) return 0;

    uint256 x = numerator / denominator; // floor
    if (x > 0) {
        _mint(feeCollector, x);
        lastP = (A * 1e18) / (S + x);
        emit FeeCrystallized(P0, P1, dP, perfFeeBps, x);
    }
    return x;
}
```

**Calldata plumbing (Router → Vault → Strategy)**

```Solidity
function setStrategyCallData(bytes calldata data) external {
    if (msg.sender != router) revert NotRouter();
    _pendingStrategyData = data; // MAY be empty (0x)
}

function _consumeStrategyCallData() internal returns (bytes memory data) {
    data = _pendingStrategyData;
    delete _pendingStrategyData; // clear after use
}
```

**ERC-4626 hooks（delegatecall + 入场事件式结晶 on entry）**

> 说明：**预动作 ΔAPS 结晶在 Vault 的入口函数里已执行**；这里不再重复结晶，只处理“入场即确定利润”的抽成与用户份额铸造。

```Solidity
function afterDeposit(uint256 assets, uint256 /*shares*/) internal override {
    // Baseline after pre-action crystallization
    uint256 A0 = totalAssets();
    uint256 S0 = totalSupply();

    // Strategy returns accounting under Accounting A:
    // accounted = 本次应计入金库的面值/可赎回价值（主币单位）
    // entryGain = 本次入场即时确定的利润（主币单位）
    bytes memory data = _consumeStrategyCallData(); // MAY be empty
    (uint256 accounted, uint256 entryGain) =
        IStrategy(strategy).investDelegate(asset(), assets, data);

    // Fee on entryGain via fee-shares (no need to realize cash)
    uint256 feeAssetsOnEntry = (entryGain * perfFeeBps) / 10_000;
    uint256 feeShares = (S0 == 0 || feeAssetsOnEntry == 0) ? 0 : (feeAssetsOnEntry * S0) / A0;
    if (feeShares > 0) _mint(feeCollector, feeShares);

    // Net accounted to user
    uint256 netAccounted = accounted > feeAssetsOnEntry ? accounted - feeAssetsOnEntry : 0;
    uint256 userShares   = (S0 == 0) ? netAccounted : (netAccounted * S0) / A0;
    _mint(_receiver(), userShares); // 实际实现中由 4626 传入 receiver

    emit Invested(strategy, assets);

    // Refresh baseline to avoid double-charging later
    lastP = (totalAssets() * 1e18) / totalSupply();
}

function beforeWithdraw(uint256 assets, uint256 /*shares*/) internal override {
    // 可选：若需要对“退出即时利润”收费，可扩展 divestDelegate 返回 exitGain
    bytes memory data = _consumeStrategyCallData(); // MAY be empty
    (bool ok, bytes memory ret) = address(strategy).delegatecall(
        abi.encodeWithSelector(IStrategy.divestDelegate.selector, asset(), assets, data)
    );
    require(ok, "STRAT_DIVEST_FAIL");
    // 若实现了 (accountedOut, exitGain) 返回值，可在此解析并以 fee-shares 抽成，然后再执行 4626 的 burn/transfer
    emit Divested(strategy, assets);
}
```

**User entry order (all 4626 entries)**

1. `_accruePerfFee()`（pre-action / ΔAPS）
2. ERC-4626 bookkeeping（transfer/mint/burn）；Vault pulls tokens from user on deposit
3. `afterDeposit / beforeWithdraw` → **delegatecall Strategy with** **`data`**
4. （Deposit）对 `entryGain` 以 **fee-shares** 抽成，再给用户铸份额；刷新 `lastP`

**Preview parity**

- preview* must simulate step (1) in memory, then simulate `(accounted, entryGain)` per Strategy (read-only), calculate fee-shares & user-shares at the same baseline.

**Events (minimum)**

- `FeeCrystallized(uint256 P0, uint256 P1, uint256 dP, uint16 perfFeeBps, uint256 feeShares)`
- `Invested(address strategy, uint256 amount)`
- `Divested(address strategy, uint256 amount)`
- `StrategyChanged(address oldStrategy, address newStrategy)`
- Standard ERC-20 / ERC-4626 events apply.

**Admin & safety**

- `setStrategy(address newStrategy)` (timelock/multisig; safe migration).
- `setPerfFeeBps(uint16 newBps)`, `setFeeCollector(address)`.
- `setRouter(address)` (governance).
- pause/unpause, `emergencyWithdraw(amount)`.
- ReentrancyGuard, approval hygiene, fee caps.

### 2.4 Strategy (protocol adapter, per vault)

**Purpose**

- Encapsulate protocol differences (Aave, Compound, Curve, Lido, Pendle, …).
- Report position value in the same principal unit as `asset()`.
- Stateless logic executed via delegatecall (never holds funds).

**Minimal interface（Accounting A ready）**

```Solidity
interface IStrategy {
    // Accounting A:
    // accounted  —— 本次应计入金库的“面值/可赎回价值”（主币单位）
    // entryGain  —— 本次入场即时确定的利润（主币单位）
    function investDelegate(
        address asset,
        uint256 amountIn,
        bytes calldata data
    ) external returns (uint256 accounted, uint256 entryGain);

    // Optional: 返回 (accountedOut, exitGain) 以支持“退出即时利润”抽成；不需要时可返回 (accountedOut, 0)
    function divestDelegate(
        address asset,
        uint256 amountOut,
        bytes calldata data
    ) external returns (uint256 accountedOut, uint256 exitGain);

    // 外部 view 估值，统一以主币单位返回；需传入 vault 地址
    function totalUnderlying(address vault) external view returns (uint256);
}
```

**Examples（口径与返回）**

- **Aave/Compound（yield-bearing）**
  - `investDelegate`: `(accounted = amountIn, entryGain = 0)`
  - `divestDelegate`: `(accountedOut = amountOut, exitGain = 0)`
  - `totalUnderlying(vault)`: aToken/cToken 余额×汇率
- **wstETH（Wrapped）**
  - `investDelegate`: `(accounted = amountIn, entryGain = 0)`
  - `totalUnderlying(vault)`: `IWstETH.getStETHByWstETH(wstETH.balanceOf(vault))`（协议原生汇率）
- **Pendle PT（Zero-Coupon Bond）**
  - 示例：100 USDC → 108 PT（PS **按面值**计入）
  - `investDelegate`: `(accounted = 108, entryGain = 8)`
  - `divestDelegate`: 如需对退出即时价差抽成，返回 `(accountedOut, exitGain>0)`；否则 `(accountedOut, 0)`

> 因为使用 `delegatecall`，对协议的外部调用所见 `msg.sender = Vault`，凭证与资产始终归 Vault。

### 2.5 Factory (deployment hygiene)

**Purpose**

- Deploy minimal-proxy clones of the Vault implementation for each (asset, market).
- Initialize with asset, strategy, feeCollector, perfFeeBps, and metadata (name/symbol).

**Admin ops**

- `createVault(asset, market, strategy, feeCollector, perfFeeBps, name, symbol)`
- Emits `VaultDeployed(asset, market, vault)`; registers into the Registry.

## 3. End-to-End Flows (canonical)

### 3.1 Deposit

1. Router resolves `vault = registry[asset, market]`.
2. Router: `vault.setStrategyCallData(data)` → `vault.deposit(assets, receiver)`. (`data` MAY be empty)
3. Vault `deposit(assets, receiver)`:
   1. `_accruePerfFee()` (pre-action APS crystallization)
   2. Snapshot `A0, S0` (post-crystallization baseline)
   3. **delegatecall** `strategy.investDelegate(asset, assets, data)` → returns `(accounted, entryGain)`（PS: 按**面值/可赎回价值**与**入场即时利润**）
   4. `feeAssetsOnEntry = entryGain * perfFeeBps / 10_000`
   5. Mint **fee-shares** to feeCollector at baseline APS
   6. `netAccounted = accounted - feeAssetsOnEntry`
   7. Mint `userShares` to receiver at baseline APS
   8. Update `lastP` to current APS (avoid double-charging)
4. Return `shares`.

### 3.2 Withdraw（

- `Keep (accountedOut, 0)` Process exectuion as usual

### 3.3 Mint / Redeem

- Same as deposit/withdraw but target is shares instead of assets.
- `_accruePerfFee()` always runs first.

### 3.4 Previews (read-only)

- Simulate pre-action crystallization in memory, then simulate `(accounted, entryGain)` per Strategy (read-only) to compute fee-shares & user-shares at baseline.

## 4. Accounting & Valuation Rules

- Principal unit: Vault’s `asset()` defines the accounting/fee unit (e.g., USDC, ETH, stETH).
- `totalAssets()`: value in the principal unit; **matches actual redeemable/face value** by Strategy’s `totalUnderlying(vault)`.
- APS = `totalAssets * 1e18 / totalSupply`.
- Two fee channels:
  - **ΔAPS crystallization** (pre-action) — for yield-bearing & wrapped-yield.
  - **Event-based crystallization on entry** — for upfront/zero-coupon style (e.g., PT), using fee-shares on `entryGain`.
- Always refresh `lastP` after event-based fee mint to avoid double-charging.

**Edge guards**

- If `totalSupply == 0` or `P_now <= lastP` → no ΔAPS fee.
- Floor minting to avoid rounding overcharge.
- Optional `minAccrual` to skip dust fees.

## 5. Markets & Multi-Strategy Options

- Per-(asset, market) vaults（USDC-Aave, USDC-Compound, USDC-Curve …）。
- Optional Meta-Vault (later).

## 6. Events & Observability

- `FeeCrystallized(uint256 P0, uint256 P1, uint256 dP, uint16 perfFeeBps, uint256 feeShares)`
- `Invested(address strategy, uint256 amount)`
- `Divested(address strategy, uint256 amount)`
- `StrategyChanged(address oldStrategy, address newStrategy)`
- Standard ERC-20/4626 events

Frontends can derive:

- Daily revenue ≈ ΔAPS × userShares.
- Entry-fee events reflected via fee-shares minting + logs.

## 7. Security Considerations

- Governance-only: `setStrategy`, `setPerfFeeBps`, `setFeeCollector`, `setRouter`, `pause`.
- Reentrancy guards; CEI pattern.
- Approval hygiene; clear approvals on strategy change.
- Fee caps (e.g., ≤ 30%).
- Strategy is stateless/library-style for delegatecall safety.
- **If raw low-level calls are used**: target/selector whitelists + deadline/nonce checks.

## 8. Upgrade & Migration

- Strategy replacement: pause → emergencyWithdraw(all) → setStrategy(new) → reinvest; emit `StrategyChanged`.
- Market migration via Router convenience `migrate(...)`.

## 9. Testing & Acceptance

- Invariants: `convertToAssets(convertToShares(x)) ≈ x`, no fee over-accrual, APS monotonicity under profit + fee.
- Scenarios: Aave, Lido/wstETH, Pendle/PT (Accounting A), frequent in/out, preview parity, strategy swap & emergency.

## 10. Frontend Integration Notes

- Integrate Router only.
- Use `vaultFor` → standard 4626 views (`totalAssets`, `convertTo*`, `preview*`).
- Show `FeeCrystallized` and fee-share mints (entry gains).
- If asset vs. receipt differ (e.g., stETH/wstETH, PT), clarify payout asset on withdraw UI.

Sequence diagram (updated to reflect delegatecall + data)

Deposit

```Plain
sequenceDiagram
    autonumber
    actor U as User / dApp
    participant R as Router
    participant V as ERC4626 Vault (asset,market)
    participant S as Strategy (delegatecall logic)
    participant P as Protocol (Aave/Compound/Curve…)

    U->>R: deposit(asset, market, assets, receiver, data)
    R->>R: resolve vault = registry[asset][market]
    R->>V: setStrategyCallData(data)
    R->>V: deposit(assets, receiver)

    Note over V: ① accruePerfFee() (APS-based fee mint)
    V->>V: _accruePerfFee()

    V->>V: A0 = totalAssets(); S0 = totalSupply()
    V->>V: pull assets from U (supports fee-on-transfer)

    Note over V,S: ② delegatecall Strategy.investDelegate(...)
    V->>S: investDelegate(asset, received, data)
    S->>P: supply/mint/add_liquidity/...
    P-->>S: position updated (tokens/receipts to V)

    V->>V: A1 = totalAssets(); credited = A1 - A0
    V->>V: shares = (S0==0) ? credited : floor(credited * S0 / A0)
    V->>V: _mint(receiver, shares)

    V-->>R: return shares
    R-->>U: return shares
```

Withdrawal

```Plain
sequenceDiagram
    autonumber
    actor U as User / dApp
    participant R as Router
    participant V as ERC4626 Vault (asset,market)
    participant S as Strategy (delegatecall logic)
    participant P as Protocol

    U->>R: withdraw(asset, market, assets, receiver, owner, data)
    R->>R: resolve vault = registry[asset][market]
    R->>V: setStrategyCallData(data)
    R->>V: withdraw(assets, receiver, owner)

    Note over V: ① accruePerfFee() first
    V->>V: _accruePerfFee()

    Note over V,S: ② delegatecall Strategy.divestDelegate(...)
    V->>S: divestDelegate(asset, assets, data)
    S->>P: withdraw/redeem/remove_liquidity/...
    P-->>S: assets returned to V

    V->>V: burn shares from owner
    V->>U: transfer assets to receiver

    V-->>R: return sharesBurned
    R-->>U: return sharesBurned
```