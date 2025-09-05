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
        uint256 invested = strategy != address(0) ? IStrategy(strategy).totalUnderlying() : 0;
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
        return convertToShares(assets);
    }

    function previewMint(uint256 shares) public view override returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? shares : (shares * totalAssets() + supply - 1) / supply;
    }

    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? assets : (assets * supply + totalAssets() - 1) / totalAssets();
    }

    function previewRedeem(uint256 shares) public view override returns (uint256) {
        return convertToAssets(shares);
    }

    function deposit(uint256 assets, address receiver) public override nonReentrant onlyWhenUnpaused returns (uint256 shares) {
        require(assets > 0, "BolarityVault: Zero assets");
        require(receiver != address(0), "BolarityVault: Invalid receiver");
        
        // Initialize lastP before first accrual
        if (lastP == 0 && totalSupply() == 0) {
            lastP = PRECISION;
        }
        
        _accruePerfFee(); // Accrue fees before calculating shares
        
        shares = previewDeposit(assets);
        require(shares > 0, "BolarityVault: Zero shares");
        
        _asset.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
        
        _afterDeposit(assets);
        
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant onlyWhenUnpaused returns (uint256 assets) {
        require(shares > 0, "BolarityVault: Zero shares");
        require(receiver != address(0), "BolarityVault: Invalid receiver");
        
        // Initialize lastP before first accrual
        if (lastP == 0 && totalSupply() == 0) {
            lastP = PRECISION;
        }
        
        _accruePerfFee(); // Accrue fees before calculating assets
        
        assets = previewMint(shares);
        require(assets > 0, "BolarityVault: Zero assets");
        
        _asset.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
        
        _afterDeposit(assets);
        
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public override nonReentrant onlyWhenUnpaused returns (uint256 shares) {
        require(assets > 0, "BolarityVault: Zero assets");
        require(receiver != address(0), "BolarityVault: Invalid receiver");
        
        shares = previewWithdraw(assets);
        
        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            if (allowed != type(uint256).max) {
                require(allowed >= shares, "BolarityVault: Insufficient allowance");
                _approve(owner, msg.sender, allowed - shares);
            }
        }
        
        _beforeWithdraw(assets);
        
        _burn(owner, shares);
        _asset.safeTransfer(receiver, assets);
        
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public override nonReentrant onlyWhenUnpaused returns (uint256 assets) {
        require(shares > 0, "BolarityVault: Zero shares");
        require(receiver != address(0), "BolarityVault: Invalid receiver");
        
        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            if (allowed != type(uint256).max) {
                require(allowed >= shares, "BolarityVault: Insufficient allowance");
                _approve(owner, msg.sender, allowed - shares);
            }
        }
        
        assets = previewRedeem(shares);
        require(assets > 0, "BolarityVault: Zero assets");
        
        _beforeWithdraw(assets);
        
        _burn(owner, shares);
        _asset.safeTransfer(receiver, assets);
        
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function _accruePerfFee() internal returns (uint256 feeShares) {
        uint256 S = totalSupply();
        if (S == 0 || perfFeeBps == 0) return 0;

        uint256 A = totalAssets();
        uint256 P0 = lastP;
        uint256 P1 = (A * PRECISION) / S;

        if (P1 <= P0) {
            lastP = P1;
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

    function crystallizeFees() external {
        _accruePerfFee();
    }

    function _afterDeposit(uint256 assets) internal {

        uint256 idle = _asset.balanceOf(address(this));
        uint256 toInvest = idle > assets ? assets : idle;
        
        if (toInvest > 0 && strategy != address(0)) {
            _asset.safeIncreaseAllowance(strategy, toInvest);
            IStrategy(strategy).invest(toInvest);
        }
    }

    function _beforeWithdraw(uint256 assets) internal {
        _accruePerfFee();
        
        uint256 idle = _asset.balanceOf(address(this));
        
        if (idle < assets && strategy != address(0)) {
            uint256 toWithdraw = assets - idle;
            IStrategy(strategy).divest(toWithdraw);
        }
    }

    // Strategy management
    function setStrategy(address newStrategy) external override onlyOwner {
        require(newStrategy != address(0), "BolarityVault: Invalid strategy");
        
        address oldStrategy = strategy;
        
        if (oldStrategy != address(0)) {
            uint256 invested = IStrategy(oldStrategy).totalUnderlying();
            if (invested > 0) {
                IStrategy(oldStrategy).divest(invested);
            }
        }
        
        strategy = newStrategy;
        
        uint256 idle = _asset.balanceOf(address(this));
        if (idle > 0) {
            _asset.safeIncreaseAllowance(newStrategy, idle);
            IStrategy(newStrategy).invest(idle);
        }
        
        emit StrategyChanged(oldStrategy, newStrategy);
    }

    function emergencyWithdraw() external onlyOwner {
        if (strategy != address(0)) {
            uint256 invested = IStrategy(strategy).totalUnderlying();
            if (invested > 0) {
                IStrategy(strategy).emergencyWithdraw(invested);
            }
        }
    }

    function emergencyWithdraw(uint256 amount) external override onlyOwner {
        if (strategy != address(0) && amount > 0) {
            IStrategy(strategy).emergencyWithdraw(amount);
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