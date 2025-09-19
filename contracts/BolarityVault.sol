// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "./interfaces/IBolarityVault.sol";
import "./interfaces/IStrategy.sol";

contract BolarityVault is IBolarityVault, ERC20, Ownable, ReentrancyGuard, Pausable, Initializable {
    using SafeERC20 for IERC20;

    IERC20 private _asset;
    address public override strategy;
    address public override router;
    address public override feeCollector;
    uint16 public override perfFeeBps;
    uint256 public override lastP;
    uint256 public constant FEE_BPS_MAX = 3000;
    uint256 public constant BPS_DIVISOR = 10000;
    uint256 public constant PRECISION = 1e18;

    bool private _initialized;
    
    // Storage for name and symbol when using proxy pattern
    string private _storedName;
    string private _storedSymbol;

    // Events are inherited from IERC4626 (Deposit and Withdraw)
    // StrategyChanged and FeeCrystallized events are inherited from IBolarityVault
    event PerformanceFeeUpdated(uint16 newFeeBps);
    event FeeCollectorUpdated(address indexed newCollector);
    event RouterUpdated(address indexed newRouter);

    modifier onlyWhenUnpaused() {
        require(!paused(), "BolarityVault: Paused");
        _;
    }

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address strategy_,
        address feeCollector_,
        uint16 perfFeeBps_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        if (address(asset_) != address(0)) {
            require(strategy_ != address(0), "BolarityVault: Invalid strategy");
            require(feeCollector_ != address(0), "BolarityVault: Invalid fee collector");
            require(perfFeeBps_ <= FEE_BPS_MAX, "BolarityVault: Fee too high");
            
            _asset = asset_;
            strategy = strategy_;
            feeCollector = feeCollector_;
            perfFeeBps = perfFeeBps_;
            router = msg.sender; // Initially set router to deployer
            _storedName = name_;
            _storedSymbol = symbol_;
            _initialized = true;
        }
    }

    function initialize(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address strategy_,
        address feeCollector_,
        uint16 perfFeeBps_
    ) external initializer {
        require(address(asset_) != address(0), "BolarityVault: Invalid asset");
        require(strategy_ != address(0), "BolarityVault: Invalid strategy");
        require(feeCollector_ != address(0), "BolarityVault: Invalid fee collector");
        require(perfFeeBps_ <= FEE_BPS_MAX, "BolarityVault: Fee too high");
        
        _asset = asset_;
        strategy = strategy_;
        feeCollector = feeCollector_;
        perfFeeBps = perfFeeBps_;
        router = msg.sender; // Initially set router to deployer
        
        // Store name and symbol for proxy pattern
        _storedName = name_;
        _storedSymbol = symbol_;
        
        _transferOwnership(msg.sender);
        _initialized = true;
    }

    // Override name to use stored value when initialized
    function name() public view virtual override(ERC20, IERC20Metadata) returns (string memory) {
        if (_initialized) {
            return _storedName;
        }
        return super.name();
    }
    
    // Override symbol to use stored value when initialized
    function symbol() public view virtual override(ERC20, IERC20Metadata) returns (string memory) {
        if (_initialized) {
            return _storedSymbol;
        }
        return super.symbol();
    }

    function asset() public view override returns (address) {
        return address(_asset);
    }

    function decimals() public view virtual override(ERC20, IERC20Metadata) returns (uint8) {
        return IERC20Metadata(address(_asset)).decimals();
    }

    function totalAssets() public view override returns (uint256) {
        uint256 idle = _asset.balanceOf(address(this));
        uint256 invested = 0;
        // Call totalUnderlying(vault) on strategy
        (bool success, bytes memory data) = strategy.staticcall(
            abi.encodeWithSignature("totalUnderlying(address)", address(this))
        );
        if (success && data.length >= 32) {
            invested = abi.decode(data, (uint256));
        }
        return idle + invested;
    }

    function convertToShares(uint256 assets) public view override returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? assets : (assets * supply) / totalAssets();
    }

    function convertToAssets(uint256 shares) public view override returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? shares : (shares * totalAssets()) / supply;
    }

    function maxDeposit(address) public view override returns (uint256) {
        return paused() ? 0 : type(uint256).max;
    }

    function maxMint(address) public view override returns (uint256) {
        return paused() ? 0 : type(uint256).max;
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        return paused() ? 0 : convertToAssets(balanceOf(owner));
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        return paused() ? 0 : balanceOf(owner);
    }

    function previewDeposit(uint256 assets) public view override returns (uint256) {
        // Simulate pre-action fee crystallization
        (uint256 simulatedTotalAssets, uint256 simulatedTotalSupply) = _simulateAccruePerfFee();
        
        // If this would be first deposit
        if (simulatedTotalSupply == 0) {
            return assets;
        }
        
        // Simulate strategy investment accounting if strategy exists
        uint256 accounted = assets;
        uint256 entryGain = 0;
        
        // Try to get preview from strategy (read-only simulation)
        (bool success, bytes memory data) = strategy.staticcall(
            abi.encodeWithSignature("previewInvest(address,uint256)", asset(), assets)
        );
        
        if (success && data.length >= 64) {
            (accounted, entryGain) = abi.decode(data, (uint256, uint256));
        }
        
        // Calculate fee on entry gain
        uint256 feeAssetsOnEntry = 0;
        if (entryGain > 0 && perfFeeBps > 0) {
            feeAssetsOnEntry = (entryGain * perfFeeBps) / BPS_DIVISOR;
        }
        
        // Calculate net accounted assets after fee
        uint256 netAccounted = accounted > feeAssetsOnEntry ? accounted - feeAssetsOnEntry : 0;
        
        // Calculate user shares at current baseline
        return (netAccounted * simulatedTotalSupply) / simulatedTotalAssets;
    }

    function previewMint(uint256 shares) public view override returns (uint256) {
        // Simulate pre-action fee crystallization
        (uint256 simulatedTotalAssets, uint256 simulatedTotalSupply) = _simulateAccruePerfFee();
        
        // If this would be first mint
        if (simulatedTotalSupply == 0) {
            return shares;
        }
        
        // Calculate assets needed for shares (rounding up)
        uint256 assets = (shares * simulatedTotalAssets + simulatedTotalSupply - 1) / simulatedTotalSupply;
        
        // Simulate strategy investment accounting if strategy exists
        uint256 accounted = assets;
        uint256 entryGain = 0;
        
        // Try to get preview from strategy (read-only simulation)
        (bool success, bytes memory data) = strategy.staticcall(
            abi.encodeWithSignature("previewInvest(address,uint256)", asset(), assets)
        );
        
        if (success && data.length >= 64) {
            (accounted, entryGain) = abi.decode(data, (uint256, uint256));
        }
        
        // Account for entry gain fees
        if (entryGain > 0 && perfFeeBps > 0) {
            uint256 feeAssetsOnEntry = (entryGain * perfFeeBps) / BPS_DIVISOR;
            uint256 feeShares = (feeAssetsOnEntry * simulatedTotalSupply) / simulatedTotalAssets;
            // User needs to provide more assets to get desired shares after fees
            assets = ((shares + feeShares) * simulatedTotalAssets + simulatedTotalSupply - 1) / simulatedTotalSupply;
        }
        
        return assets;
    }

    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        // Simulate pre-action fee crystallization
        (uint256 simulatedTotalAssets, uint256 simulatedTotalSupply) = _simulateAccruePerfFee();
        
        if (simulatedTotalSupply == 0 || simulatedTotalAssets == 0) {
            return assets;
        }
        
        // Calculate shares needed (rounding up)
        return (assets * simulatedTotalSupply + simulatedTotalAssets - 1) / simulatedTotalAssets;
    }

    function previewRedeem(uint256 shares) public view override returns (uint256) {
        // Simulate pre-action fee crystallization
        (uint256 simulatedTotalAssets, uint256 simulatedTotalSupply) = _simulateAccruePerfFee();
        
        if (simulatedTotalSupply == 0 || simulatedTotalAssets == 0) {
            return shares;
        }
        
        // Calculate assets for shares (rounding down)
        return (shares * simulatedTotalAssets) / simulatedTotalSupply;
    }

    function deposit(uint256 assets, address receiver) public override nonReentrant onlyWhenUnpaused returns (uint256 shares) {
        return _depositWithData(assets, receiver, "");
    }
    
    function depositWithData(uint256 assets, address receiver, bytes memory strategyData) public nonReentrant onlyWhenUnpaused returns (uint256 shares) {
        return _depositWithData(assets, receiver, strategyData);
    }
    
    function _depositWithData(uint256 assets, address receiver, bytes memory strategyData) internal returns (uint256 shares) {
        require(receiver != address(0), "BolarityVault: Invalid receiver");
        require(assets > 0, "BolarityVault: Zero assets");
        
        // Initialize lastP before first accrual
        if (lastP == 0 && totalSupply() == 0) {
            lastP = PRECISION;
        }
        
        // Step 1: Pre-action fee crystallization (skip if sender is feeCollector to avoid circular fee generation)
        if (msg.sender != feeCollector) {
            _accruePerfFee();
        }
        
        // Step 2: Snapshot baseline after crystallization
        uint256 A0 = totalAssets();
        uint256 S0 = totalSupply();
        
        // Step 3: Pull assets from user
        _asset.safeTransferFrom(msg.sender, address(this), assets);
        
        // Step 4: Execute strategy investment
        shares = _executeDeposit(assets, receiver, A0, S0, strategyData);
        
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant onlyWhenUnpaused returns (uint256 assets) {
        return _mintWithData(shares, receiver, "");
    }
    
    function mintWithData(uint256 shares, address receiver, bytes memory strategyData) public nonReentrant onlyWhenUnpaused returns (uint256 assets) {
        return _mintWithData(shares, receiver, strategyData);
    }
    
    function _mintWithData(uint256 shares, address receiver, bytes memory strategyData) internal returns (uint256 assets) {
        require(shares > 0, "BolarityVault: Zero shares");
        require(receiver != address(0), "BolarityVault: Invalid receiver");
        
        // Initialize lastP before first accrual
        if (lastP == 0 && totalSupply() == 0) {
            lastP = PRECISION;
        }
        
        // Calculate assets needed for shares BEFORE fee crystallization
        assets = previewMint(shares);
        require(assets > 0, "BolarityVault: Zero assets");
        
        // Step 1: Pre-action fee crystallization (skip if sender is feeCollector to avoid circular fee generation)
        if (msg.sender != feeCollector) {
            _accruePerfFee();
        }
        
        // Step 2: Snapshot baseline after crystallization
        uint256 A0 = totalAssets();
        uint256 S0 = totalSupply();
        
        // Step 3: Pull assets from user
        _asset.safeTransferFrom(msg.sender, address(this), assets);
        
        // Step 4: Execute strategy investment and mint shares
        uint256 actualShares = _executeDeposit(assets, receiver, A0, S0, strategyData);
        require(actualShares >= shares, "BolarityVault: Insufficient shares minted");
        
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public override nonReentrant onlyWhenUnpaused returns (uint256 shares) {
        return _withdrawWithData(assets, receiver, owner, "");
    }
    
    function withdrawWithData(
        uint256 assets,
        address receiver,
        address owner,
        bytes memory strategyData
    ) public nonReentrant onlyWhenUnpaused returns (uint256 shares) {
        return _withdrawWithData(assets, receiver, owner, strategyData);
    }
    
    function _withdrawWithData(
        uint256 assets,
        address receiver,
        address owner,
        bytes memory strategyData
    ) internal returns (uint256 shares) {
        require(receiver != address(0), "BolarityVault: Invalid receiver");
        
        // Handle max withdrawal: if assets == type(uint256).max, withdraw all
        if (assets == type(uint256).max) {
            // When user wants to withdraw all, we use redeem logic internally
            // This avoids rounding issues from previewWithdraw's upward rounding
            
            // Get all shares of the owner
            shares = balanceOf(owner);
            require(shares > 0, "BolarityVault: Zero shares");
            
            // Step 1: Pre-action fee crystallization (skip if owner is feeCollector)
            if (owner != feeCollector) {
                _accruePerfFee();
            }
            
            // Calculate assets using convertToAssets (handles the calculation properly)
            assets = convertToAssets(shares);
            // For max withdrawal, allow withdrawal even if assets is 0 (user might be withdrawing 0 value shares)
            // The actual withdrawal will handle if there are no assets to transfer
        } else {
            require(assets > 0, "BolarityVault: Zero assets");
            
            // Calculate shares needed BEFORE fee crystallization for accurate preview
            shares = previewWithdraw(assets);
            
            // Step 1: Pre-action fee crystallization (skip if owner is feeCollector)
            if (owner != feeCollector) {
                _accruePerfFee();
            }
        }
        
        // Check allowance if not owner
        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            if (allowed != type(uint256).max) {
                require(allowed >= shares, "BolarityVault: Insufficient allowance");
                _approve(owner, msg.sender, allowed - shares);
            }
        }
        
        // Execute withdrawal from strategy if needed
        _executeWithdraw(assets, strategyData);
        
        // Check balance after withdrawal from strategy
        uint256 balance = _asset.balanceOf(address(this));
        
        // Allow for small rounding errors (0.01% tolerance)
        uint256 tolerance = (assets * 1) / 10000; // 0.01%
        if (balance < assets) {
            // If balance is insufficient but within tolerance, adjust the withdrawal amount
            if (assets - balance <= tolerance) {
                assets = balance; // Adjust to actual balance
            } else {
                revert("BolarityVault: Insufficient balance after withdrawal");
            }
        }
        
        // Burn shares and transfer assets
        _burn(owner, shares);
        
        _asset.safeTransfer(receiver, assets);
        
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public override nonReentrant onlyWhenUnpaused returns (uint256 assets) {
        return _redeemWithData(shares, receiver, owner, "");
    }
    
    function redeemWithData(
        uint256 shares,
        address receiver,
        address owner,
        bytes memory strategyData
    ) public nonReentrant onlyWhenUnpaused returns (uint256 assets) {
        return _redeemWithData(shares, receiver, owner, strategyData);
    }
    
    function _redeemWithData(
        uint256 shares,
        address receiver,
        address owner,
        bytes memory strategyData
    ) internal returns (uint256 assets) {
        require(receiver != address(0), "BolarityVault: Invalid receiver");
        
        // Handle max redeem: if shares == type(uint256).max, redeem all shares
        if (shares == type(uint256).max) {
            shares = balanceOf(owner);
            require(shares > 0, "BolarityVault: No shares to redeem");
        } else {
            require(shares > 0, "BolarityVault: Zero shares");
        }
        
        // Step 1: Pre-action fee crystallization (skip if owner is feeCollector)
        if (owner != feeCollector) {
            _accruePerfFee();
        }
        
        // Check allowance if not owner
        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            if (allowed != type(uint256).max) {
                require(allowed >= shares, "BolarityVault: Insufficient allowance");
                _approve(owner, msg.sender, allowed - shares);
            }
        }
        
        // Calculate assets for shares after fee crystallization
        uint256 supply = totalSupply();
        uint256 allAssets = totalAssets();
        
        // If redeeming all shares in the vault, take all assets to avoid rounding issues
        if (shares == supply) {
            assets = allAssets;
        } else {
            assets = convertToAssets(shares);
        }
        require(assets > 0, "BolarityVault: Zero assets");
        
        // Execute withdrawal from strategy if needed
        _executeWithdraw(assets, strategyData);
        
        // Check balance after withdrawal from strategy
        uint256 balance = _asset.balanceOf(address(this));
        
        // Allow for small rounding errors (0.01% tolerance)
        uint256 tolerance = (assets * 1) / 10000; // 0.01%
        if (balance < assets) {
            // If balance is insufficient but within tolerance, adjust the withdrawal amount
            if (assets - balance <= tolerance) {
                assets = balance; // Adjust to actual balance
            } else {
                revert("BolarityVault: Insufficient balance after withdrawal");
            }
        }
        
        // Burn shares and transfer assets
        _burn(owner, shares);
        
        _asset.safeTransfer(receiver, assets);
        
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function _simulateAccruePerfFee() internal view returns (uint256 simulatedTotalAssets, uint256 simulatedTotalSupply) {
        uint256 S = totalSupply();
        uint256 A = totalAssets();
        
        if (S == 0 || perfFeeBps == 0) {
            return (A, S);
        }
        
        uint256 P0 = lastP;
        uint256 P1 = (A * PRECISION) / S;
        
        if (P1 <= P0) {
            return (A, S);
        }
        
        uint256 dP = P1 - P0;
        uint256 numerator = S * perfFeeBps * dP;
        uint256 denominator = (P1 * BPS_DIVISOR) - (perfFeeBps * dP);
        
        if (denominator == 0) {
            return (A, S);
        }
        
        uint256 feeShares = numerator / denominator;
        
        // Return simulated values after fee mint
        return (A, S + feeShares);
    }
    
    function _accruePerfFee() internal returns (uint256 feeShares) {
        uint256 S = totalSupply();
        if (S == 0 || perfFeeBps == 0) return 0;

        uint256 A = totalAssets();
        uint256 P0 = lastP;
        uint256 P1 = (A * PRECISION) / S;

        if (P1 <= P0) {
            // Don't update lastP on loss to maintain high water mark
            return 0;
        }

        uint256 dP = P1 - P0;

        uint256 numerator = S * perfFeeBps * dP;
        uint256 denominator = (P1 * BPS_DIVISOR) - (perfFeeBps * dP);
        
        if (denominator == 0) return 0;

        feeShares = numerator / denominator;
        
        if (feeShares > 0) {
            _mint(feeCollector, feeShares);
            lastP = (A * PRECISION) / (S + feeShares);
            emit FeeCrystallized(P0, P1, dP, perfFeeBps, feeShares);
        }
        
        return feeShares;
    }

    function setRouter(address newRouter) external override onlyOwner {
        require(newRouter != address(0), "BolarityVault: Invalid router");
        router = newRouter;
        emit RouterUpdated(newRouter);
    }

    function crystallizeFees() external {
        _accruePerfFee();
    }

    function _executeDeposit(uint256 assets, address receiver, uint256 A0, uint256 S0, bytes memory strategyData) internal returns (uint256 shares) {
        uint256 toInvest = assets;
        
        // Execute strategy via delegatecall
        (bool success, bytes memory returnData) = strategy.delegatecall(
            abi.encodeWithSignature("investDelegate(address,uint256,bytes)", asset(), toInvest, strategyData)
        );
        
        if (!success) {
            // Forward the actual revert reason from the strategy
            if (returnData.length > 0) {
                assembly {
                    let returnDataSize := mload(returnData)
                    revert(add(32, returnData), returnDataSize)
                }
            } else {
                revert("BolarityVault: Strategy invest failed");
            }
        }
        require(returnData.length >= 64, "BolarityVault: Invalid return data");
        
        // Decode return values: (accounted, entryGain)
        (uint256 accounted, uint256 entryGain) = abi.decode(returnData, (uint256, uint256));
        
        // Calculate fee on entry gain
        uint256 feeAssetsOnEntry = 0;
        uint256 feeShares = 0;
        if (entryGain > 0 && perfFeeBps > 0) {
            feeAssetsOnEntry = (entryGain * perfFeeBps) / BPS_DIVISOR;
            
            // Calculate net accounted assets after fee
            uint256 netAccounted = accounted > feeAssetsOnEntry ? accounted - feeAssetsOnEntry : 0;
            
            if (S0 == 0) {
                // First deposit - fee shares equal fee assets
                feeShares = feeAssetsOnEntry;
                shares = netAccounted;
            } else {
                // Subsequent deposits - calculate proportionally
                // Prevent division by zero
                if (A0 == 0) {
                    feeShares = feeAssetsOnEntry;
                    shares = netAccounted;
                } else {
                    feeShares = (feeAssetsOnEntry * S0) / A0;
                    shares = (netAccounted * S0) / A0;
                }
            }
            
            // Mint fee shares if any
            if (feeShares > 0) {
                _mint(feeCollector, feeShares);
            }
        } else {
            // No entry gain or no performance fee
            if (S0 == 0 || A0 == 0) {
                shares = accounted;
            } else {
                shares = (accounted * S0) / A0;
            }
        }
        
        // Mint shares to receiver
        _mint(receiver, shares);
        
        // Update lastP only if it's higher (maintain high water mark)
        if (totalSupply() > 0) {
            uint256 newP = (totalAssets() * PRECISION) / totalSupply();
            if (newP > lastP) {
                lastP = newP;
            }
        }
        
        emit Invested(strategy, toInvest);
        
        return shares;
    }

    function _executeWithdraw(uint256 assets, bytes memory strategyData) internal {
        uint256 idle = _asset.balanceOf(address(this));
        
        if (idle < assets) {
            uint256 toWithdraw = assets - idle;
            
            // Execute strategy via delegatecall
            (bool success, bytes memory returnData) = strategy.delegatecall(
                abi.encodeWithSignature("divestDelegate(address,uint256,bytes)", asset(), toWithdraw, strategyData)
            );
            
            require(success, "BolarityVault: Strategy divest failed");
            require(returnData.length >= 64, "BolarityVault: Invalid return data");
            
            // Decode return values (accountedOut is used for validation, exitGain for fees)
            (, uint256 exitGain) = abi.decode(returnData, (uint256, uint256));
            
            // Handle exit gain fee if any
            if (exitGain > 0 && perfFeeBps > 0) {
                uint256 feeAssetsOnExit = (exitGain * perfFeeBps) / BPS_DIVISOR;
                uint256 S0 = totalSupply();
                uint256 A0 = totalAssets();
                
                if (S0 > 0 && feeAssetsOnExit > 0) {
                    uint256 feeShares = (feeAssetsOnExit * S0) / A0;
                    if (feeShares > 0) {
                        _mint(feeCollector, feeShares);
                        // Update lastP only if it's higher (maintain high water mark)
                        uint256 newP = (totalAssets() * PRECISION) / totalSupply();
                        if (newP > lastP) {
                            lastP = newP;
                        }
                    }
                }
            }
            
            emit Divested(strategy, toWithdraw);
        }
    }

    // Strategy management
    function setStrategy(address newStrategy) external override onlyOwner nonReentrant {
        require(newStrategy != address(0), "BolarityVault: Invalid strategy");
        require(!paused(), "BolarityVault: Paused");
        
        // Crystallize fees before strategy change
        _accruePerfFee();
        
        address oldStrategy = strategy;
        
        // Withdraw all funds from old strategy if exists
        if (oldStrategy != address(0)) {
            // Get total invested amount
            (bool success, bytes memory data) = oldStrategy.staticcall(
                abi.encodeWithSignature("totalUnderlying(address)", address(this))
            );
            
            if (success && data.length >= 32) {
                uint256 invested = abi.decode(data, (uint256));
                
                if (invested > 0) {
                    // Divest all funds via delegatecall
                    bytes memory emptyData;
                    (success, ) = oldStrategy.delegatecall(
                        abi.encodeWithSignature("divestDelegate(address,uint256,bytes)", asset(), invested, emptyData)
                    );
                    
                    if (!success) {
                        // Emit event for failed divestment but continue with strategy change
                        emit Divested(oldStrategy, 0);
                    } else {
                        emit Divested(oldStrategy, invested);
                    }
                }
            }
        }
        
        // Set new strategy
        strategy = newStrategy;
        
        // Invest idle funds into new strategy
        uint256 idle = _asset.balanceOf(address(this));
        if (idle > 0) {
            bytes memory emptyData;
            (bool investSuccess, bytes memory returnData) = newStrategy.delegatecall(
                abi.encodeWithSignature("investDelegate(address,uint256,bytes)", asset(), idle, emptyData)
            );
            
            if (investSuccess && returnData.length >= 64) {
                (uint256 accounted, ) = abi.decode(returnData, (uint256, uint256));
                emit Invested(newStrategy, accounted);
            } else {
                // Emit event for failed investment
                emit Invested(newStrategy, 0);
            }
        }
        
        emit StrategyChanged(oldStrategy, newStrategy);
    }

    function emergencyWithdraw() external onlyOwner {
        require(strategy != address(0), "BolarityVault: No strategy set");
        
        // Get total invested amount
        (bool success, bytes memory data) = strategy.staticcall(
            abi.encodeWithSignature("totalUnderlying(address)", address(this))
        );
        
        if (success && data.length >= 32) {
            uint256 invested = abi.decode(data, (uint256));
            
            if (invested > 0) {
                // Emergency withdraw via delegatecall using divestDelegate
                bytes memory emptyData;
                (bool emergencySuccess, ) = strategy.delegatecall(
                    abi.encodeWithSignature("divestDelegate(address,uint256,bytes)", asset(), invested, emptyData)
                );
                
                if (emergencySuccess) {
                    emit Divested(strategy, invested);
                }
            }
        }
    }

    function emergencyWithdraw(uint256 amount) external override onlyOwner {
        require(strategy != address(0), "BolarityVault: No strategy set");
        require(amount > 0, "BolarityVault: Zero amount");
        
        // Verify amount doesn't exceed invested amount
        (bool success, bytes memory data) = strategy.staticcall(
            abi.encodeWithSignature("totalUnderlying(address)", address(this))
        );
        
        uint256 invested = 0;
        if (success && data.length >= 32) {
            invested = abi.decode(data, (uint256));
        }
        
        uint256 toWithdraw = amount > invested ? invested : amount;
        
        if (toWithdraw > 0) {
            // Emergency withdraw specific amount via delegatecall using divestDelegate
            bytes memory emptyData;
            (bool emergencySuccess, ) = strategy.delegatecall(
                abi.encodeWithSignature("divestDelegate(address,uint256,bytes)", asset(), toWithdraw, emptyData)
            );
            
            if (emergencySuccess) {
                emit Divested(strategy, toWithdraw);
            }
        }
    }

    function setPerfFeeBps(uint16 newFeeBps) external override onlyOwner {
        require(newFeeBps <= FEE_BPS_MAX, "BolarityVault: Fee too high");
        _accruePerfFee();
        perfFeeBps = newFeeBps;
        emit PerformanceFeeUpdated(newFeeBps);
    }

    function setFeeCollector(address newCollector) external override onlyOwner {
        require(newCollector != address(0), "BolarityVault: Invalid collector");
        _accruePerfFee();
        feeCollector = newCollector;
        emit FeeCollectorUpdated(newCollector);
    }

    function pause() external override onlyOwner {
        _pause();
    }

    function unpause() external override onlyOwner {
        _unpause();
    }
}