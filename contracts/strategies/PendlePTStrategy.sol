// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IStrategy.sol";
import "../interfaces/IPendle.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PendlePTStrategy
 * @notice Strategy for Pendle PT (Principal Token) integration via delegatecall
 * @dev This contract is meant to be used via delegatecall from a vault
 * The storage variables (pendleMarkets mapping) are only used for configuration management
 * When called via delegatecall, it uses staticcall to read its own storage
 * According to design.md: Pendle PT is a zero-coupon bond with entry gain
 * 
 * Optimizations:
 * - Reduced code duplication across invest/divest functions
 */
contract PendlePTStrategy is IStrategy, Ownable {
    using SafeERC20 for IERC20;
    
    // Immutable variables are stored in bytecode, not storage
    IPendleRouter public immutable pendleRouter;
    IPendleOracle public immutable pendleOracle;
    uint32 public constant TWAP_DURATION = 900; // 15 minutes TWAP for oracle
    
    // Storage for market and PT configuration per asset
    struct PendleConfig {
        address market;  // Pendle market address
        address pt;      // PT token address
    }
    
    // Mapping from asset (base token) to Pendle configuration
    mapping(address => PendleConfig) public pendleMarkets;
    
    // Array to track all supported assets
    address[] public supportedAssets;
    mapping(address => bool) public isAssetSupported;
    
    // Events
    event PendleMarketSet(address indexed asset, address indexed market, address indexed pt);
    event PendleMarketRemoved(address indexed asset);
    
    constructor(address _pendleRouter, address _pendleOracle) Ownable(msg.sender) {
        require(_pendleRouter != address(0), "PendlePTStrategy: Invalid router");
        require(_pendleOracle != address(0), "PendlePTStrategy: Invalid oracle");
        pendleRouter = IPendleRouter(_pendleRouter);
        pendleOracle = IPendleOracle(_pendleOracle);
    }
    
    /**
     * @notice Set or update a Pendle market for an asset
     * @param asset The base token address (e.g., USDC)
     * @param market The Pendle market address
     * @param pt The PT token address
     */
    function setPendleMarket(address asset, address market, address pt) external onlyOwner {
        require(asset != address(0), "PendlePTStrategy: Invalid asset");
        require(market != address(0), "PendlePTStrategy: Invalid market");
        require(pt != address(0), "PendlePTStrategy: Invalid PT");
        
        // Verify PT is not expired
        require(!IPendlePT(pt).isExpired(), "PendlePTStrategy: PT expired");
        
        // If this is a new asset, add to supported assets array
        if (!isAssetSupported[asset]) {
            supportedAssets.push(asset);
            isAssetSupported[asset] = true;
        }
        
        pendleMarkets[asset] = PendleConfig({
            market: market,
            pt: pt
        });
        
        emit PendleMarketSet(asset, market, pt);
    }
    
    /**
     * @notice Remove a Pendle market for an asset
     * @param asset The base token address to remove
     */
    function removePendleMarket(address asset) external onlyOwner {
        require(isAssetSupported[asset], "PendlePTStrategy: Asset not supported");
        
        // Remove from mapping
        delete pendleMarkets[asset];
        isAssetSupported[asset] = false;
        
        // Remove from array
        for (uint256 i = 0; i < supportedAssets.length; i++) {
            if (supportedAssets[i] == asset) {
                // Move last element to this position and pop
                supportedAssets[i] = supportedAssets[supportedAssets.length - 1];
                supportedAssets.pop();
                break;
            }
        }
        
        emit PendleMarketRemoved(asset);
    }
    
    /**
     * @notice Get Pendle configuration for a specific asset
     * @param asset The asset to query
     * @return market The Pendle market address
     * @return pt The PT token address
     */
    function getPendleConfig(address asset) public view returns (address market, address pt) {
        PendleConfig memory config = pendleMarkets[asset];
        market = config.market;
        pt = config.pt;
    }
    
    /**
     * @notice Internal function to get Pendle config in delegatecall context
     * @param asset The asset address
     * @return market The Pendle market address
     * @return pt The PT token address
     */
    function _getPendleConfigInDelegateCall(address asset) internal view returns (address market, address pt) {
        // In delegatecall context, we need to read the strategy address from vault's storage
        // and make a static call to get the correct config
        address strategyAddress;
        assembly {
            // Strategy is at storage slot 8 in BolarityVault
            // Slots 0-6 are used by inherited contracts (ERC20, Ownable, ReentrancyGuard, Pausable, Initializable)
            // Slot 7: _asset, Slot 8: strategy
            strategyAddress := sload(8)
        }
        
        // Static call to strategy's pendleMarkets function
        (bool success, bytes memory data) = strategyAddress.staticcall(
            abi.encodeWithSignature("pendleMarkets(address)", asset)
        );
        
        if (success && data.length == 64) {
            (market, pt) = abi.decode(data, (address, address));
            if (market != address(0) && pt != address(0)) {
                return (market, pt);
            }
        }
        
        // If not found, return zero addresses (will be checked by caller)
        return (address(0), address(0));
    }
    
    // Note: _savePendleConfigToStrategy function removed
    // Configuration cannot be saved during delegatecall execution
    // Admin must manually call setPendleMarket on the strategy contract
    
    /**
     * @notice Internal function to get PT from market using readTokens
     * @param market The Pendle market address
     * @return pt The PT token address
     */
    function _getPTFromMarket(address market) internal view returns (address pt) {
        try IPendleMarket(market).readTokens() returns (address, address _pt, address) {
            pt = _pt;
        } catch {
            pt = address(0);
        }
        return pt;
    }
    
    
    /**
     * @notice Invest assets into Pendle PT (delegatecall from vault)
     * @param asset The asset to invest (e.g., USDC)
     * @param amountIn The amount of asset to invest
     * @param data Complete calldata for swapExactTokenForPt call
     * @return accounted The face value of PT received (for zero-coupon bonds)
     * @return entryGain The immediate gain from buying PT at discount
     * @dev Requires complete swapExactTokenForPt calldata
     */
    function investDelegate(
        address asset,
        uint256 amountIn,
        bytes calldata data
    ) external override returns (uint256 accounted, uint256 entryGain) {
        if (amountIn == 0) {
            return (0, 0);
        }
        
        require(data.length >= 68, "PendlePTStrategy: Calldata required for swapExactTokenForPt");
        
        address market;
        address pt;
        
        // Parse market address from swapExactTokenForPt calldata
        // Function signature: swapExactTokenForPt(address,address,uint256,ApproxParams,TokenInput,LimitOrderData)
        // The second parameter (offset 36-68) is the market address
        assembly {
            market := calldataload(add(data.offset, 36))
        }
        
        require(market != address(0), "PendlePTStrategy: Invalid market address in calldata");
        
        // Try to get PT from stored config first
        (address storedMarket, address storedPt) = _getPendleConfigInDelegateCall(asset);
        
        if (storedMarket == market && storedPt != address(0)) {
            // Use stored PT if market matches
            pt = storedPt;
        } else {
            // Fetch PT from market using readTokens()
            pt = _getPTFromMarket(market);
            require(pt != address(0), "PendlePTStrategy: Failed to get PT from market");
            
            // Note: Cannot save configuration during delegatecall
            // Admin must call setPendleMarket directly on the strategy contract
        }
        
        // Verify PT is not expired
        require(!IPendlePT(pt).isExpired(), "PendlePTStrategy: PT has expired, cannot invest in expired PT");
        
        // Get current PT balance before swap
        uint256 ptBalanceBefore = IERC20(pt).balanceOf(address(this));
        
        // Check asset balance before approving
        uint256 assetBalance = IERC20(asset).balanceOf(address(this));
        require(assetBalance >= amountIn, "PendlePTStrategy: Insufficient asset balance in vault");
        
        // Approve Pendle router to spend asset
        IERC20(asset).safeIncreaseAllowance(address(pendleRouter), amountIn);
        
        // Call Pendle router with the provided calldata
        (bool success, bytes memory result) = address(pendleRouter).call(data);
        
        if (!success) {
            // Try to decode revert reason
            if (result.length > 0) {
                assembly {
                    let resultSize := mload(result)
                    revert(add(32, result), resultSize)
                }
            } else {
                revert("PendlePTStrategy: Pendle swap failed");
            }
        }
        
        // Calculate actual PT received
        uint256 ptBalanceAfter = IERC20(pt).balanceOf(address(this));
        require(ptBalanceAfter > ptBalanceBefore, "PendlePTStrategy: No PT received from swap");
        uint256 ptReceived = ptBalanceAfter - ptBalanceBefore;
        
        // For zero-coupon bonds like Pendle PT:
        // - accounted = face value of PT (what it will be worth at maturity)
        // - entryGain = discount captured (face value - amount paid)
        // Since 1 PT = 1 underlying at maturity, ptReceived is the face value
        accounted = ptReceived;
        
        // Calculate entry gain: if we got more PT than USDC spent, that's the gain
        // Example: 100 USDC → 108 PT means entryGain = 8
        if (ptReceived > amountIn) {
            entryGain = ptReceived - amountIn;
        } else {
            entryGain = 0; // No gain if PT is at or above par
        }
        
        return (accounted, entryGain);
    }
    
    /**
     * @notice Withdraw assets from Pendle PT (delegatecall from vault)
     * @param asset The asset to withdraw (e.g., USDC)
     * @param amountOut The amount of asset to withdraw (not used when calldata provided)
     * @param data Complete calldata for swapExactPtForToken call
     * @return accountedOut The amount withdrawn
     * @return exitGain Exit gain if any (for PT, could be from selling before maturity)
     * @dev Requires complete swapExactPtForToken calldata
     */
    function divestDelegate(
        address asset,
        uint256 amountOut,
        bytes calldata data
    ) external override returns (uint256 accountedOut, uint256 exitGain) {
        if (data.length == 0 && amountOut == 0) {
            return (0, 0);
        }
        
        require(data.length >= 100, "PendlePTStrategy: Calldata required for swapExactPtForToken");
        
        address market;
        address pt;
        uint256 ptToSell;
        
        // Parse market address and PT amount from swapExactPtForToken calldata
        // Function signature: swapExactPtForToken(address,address,uint256,TokenOutput,LimitOrderData)
        // The second parameter (offset 36-68) is the market address
        // The third parameter (offset 68-100) is the PT amount
        assembly {
            market := calldataload(add(data.offset, 36))
            ptToSell := calldataload(add(data.offset, 68))
        }
        
        require(market != address(0), "PendlePTStrategy: Invalid market address in calldata");
        require(ptToSell > 0, "PendlePTStrategy: Invalid PT amount in calldata");
        
        // Try to get PT from stored config first
        (address storedMarket, address storedPt) = _getPendleConfigInDelegateCall(asset);
        
        if (storedMarket == market && storedPt != address(0)) {
            // Use stored PT if market matches
            pt = storedPt;
        } else {
            // Fetch PT from market using readTokens()
            pt = _getPTFromMarket(market);
            require(pt != address(0), "PendlePTStrategy: Failed to get PT from market");
            
            // Note: Cannot save configuration during delegatecall
            // Admin must call setPendleMarket directly on the strategy contract
        }
        
        // Get balances before swap
        uint256 assetBalanceBefore = IERC20(asset).balanceOf(address(this));
        uint256 ptBalanceBefore = IERC20(pt).balanceOf(address(this));
        
        require(ptBalanceBefore >= ptToSell, "PendlePTStrategy: Insufficient PT balance");
        
        // Approve router to spend PT
        IERC20(pt).safeIncreaseAllowance(address(pendleRouter), ptToSell);
        
        // Call Pendle router with the provided calldata
        (bool success, bytes memory result) = address(pendleRouter).call(data);
        
        if (!success) {
            // Try to decode revert reason
            if (result.length > 0) {
                assembly {
                    let resultSize := mload(result)
                    revert(add(32, result), resultSize)
                }
            } else {
                revert("PendlePTStrategy: Pendle swap failed");
            }
        }
        
        // Calculate actual asset received
        uint256 assetBalanceAfter = IERC20(asset).balanceOf(address(this));
        uint256 actualReceived = assetBalanceAfter - assetBalanceBefore;
        
        accountedOut = actualReceived;
        
        // Calculate exit gain/loss
        // If PT has matured, exitGain is 0 since we're redeeming at face value
        // If not matured, calculate based on the amount received vs PT sold
        if (!IPendlePT(pt).isExpired() && actualReceived > ptToSell) {
            exitGain = actualReceived - ptToSell;
        } else {
            exitGain = 0;
        }
        
        return (accountedOut, exitGain);
    }
    
    /**
     * @notice Get total underlying value for a vault's PT position
     * @param vault The vault address
     * @return The total underlying value (face value of PT holdings)
     * @dev This function now uses the stored market/PT configuration
     */
    function totalUnderlying(address vault) external view override returns (uint256) {
        // Get the vault's asset
        (bool success, bytes memory data) = vault.staticcall(
            abi.encodeWithSignature("asset()")
        );
        
        if (!success || data.length < 32) {
            return 0;
        }
        
        address asset = abi.decode(data, (address));
        
        // Get market and PT from storage directly (NOT using delegatecall-aware function)
        // Because totalUnderlying is called via staticcall, not delegatecall
        PendleConfig memory config = pendleMarkets[asset];
        address market = config.market;
        address pt = config.pt;
        if (market == address(0) || pt == address(0)) {
            return 0; // Asset not configured
        }
        
        uint256 ptBalance = IERC20(pt).balanceOf(vault);
        
        if (ptBalance == 0) {
            return 0;
        }
        
        if (IPendlePT(pt).isExpired()) {
            // If matured, PT is worth face value (1:1 with underlying)
            return ptBalance;
        } else {
            // If not matured, use oracle to get current value
            try pendleOracle.getPtToAssetRate(market, TWAP_DURATION) returns (uint256 rate) {
                return (ptBalance * rate) / 1e18;
            } catch {
                // Fallback to face value if oracle fails
                return ptBalance;
            }
        }
    }
    
    /**
     * @notice Preview investment without executing (view function)
     * @param asset The asset to invest
     * @param amountIn The amount to invest
     * @return accounted The amount that would be accounted for
     * @return entryGain The entry gain (positive for PT bought at discount)
     * @dev Production-ready version that queries actual market rates
     */
    function previewInvest(
        address asset,
        uint256 amountIn
    ) external view override returns (uint256 accounted, uint256 entryGain) {
        if (amountIn == 0) {
            return (0, 0);
        }
        
        // Get market and PT from storage directly (this is a view function, not delegatecall)
        PendleConfig memory config = pendleMarkets[asset];
        address market = config.market;
        address pt = config.pt;
        
        if (market == address(0) || pt == address(0)) {
            // Asset not configured, use conservative estimate
            // Assume 3% average discount for PT (100 USDC -> 103 PT)
            accounted = (amountIn * 103) / 100;
            entryGain = accounted > amountIn ? accounted - amountIn : 0;
            return (accounted, entryGain);
        }
        
        // Check if PT is expired
        if (IPendlePT(pt).isExpired()) {
            // PT expired, no entry gain possible
            return (amountIn, 0);
        }
        
        // Query oracle for current PT rate
        try pendleOracle.getPtToAssetRate(market, TWAP_DURATION) returns (uint256 ptRate) {
            if (ptRate > 0 && ptRate <= 1e18) {
                // Calculate expected PT amount based on oracle rate
                // If 1 PT = 0.9259 USDC, then 100 USDC buys 100/0.9259 = 108 PT
                uint256 expectedPt = (amountIn * 1e18) / ptRate;
                
                // Account for potential slippage (use 99% of expected)
                accounted = (expectedPt * 99) / 100;
                
                // Calculate entry gain
                if (accounted > amountIn) {
                    entryGain = accounted - amountIn;
                } else {
                    entryGain = 0;
                }
                
                return (accounted, entryGain);
            }
        } catch {
            // Oracle failed, use fallback
        }
        
        // Fallback: conservative estimate
        // Assume 3% average discount for PT (100 USDC -> 103 PT)
        accounted = (amountIn * 103) / 100;
        entryGain = accounted > amountIn ? accounted - amountIn : 0;
        return (accounted, entryGain);
    }
}