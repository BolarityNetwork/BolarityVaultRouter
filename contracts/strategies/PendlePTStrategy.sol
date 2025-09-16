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
     * @notice Get the number of supported assets
     * @return The count of supported assets
     */
    function getSupportedAssetsCount() external view returns (uint256) {
        return supportedAssets.length;
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
        require(success, "PendlePTStrategy: Failed to read pendleMarkets from strategy storage");
        require(data.length == 64, "PendlePTStrategy: Invalid config data length, expected 64 bytes");
        (market, pt) = abi.decode(data, (address, address));
        return (market, pt);
    }
    
    
    /**
     * @notice Invest assets into Pendle PT (delegatecall from vault)
     * @param asset The asset to invest (e.g., USDC)
     * @param amountIn The amount of asset to invest
     * @return accounted The face value of PT received (for zero-coupon bonds)
     * @return entryGain The immediate gain from buying PT at discount
     * @dev According to design.md: Example 100 USDC → 108 PT returns (accounted = 108, entryGain = 8)
     */
    function investDelegate(
        address asset,
        uint256 amountIn,
        bytes calldata /* data */
    ) external override returns (uint256 accounted, uint256 entryGain) {
        if (amountIn == 0) {
            return (0, 0);
        }
        
        // Get market and PT from storage (using delegatecall-aware function)
        (address market, address pt) = _getPendleConfigInDelegateCall(asset);
        require(market != address(0), "PendlePTStrategy: Market not configured for asset. Call setPendleMarket() first");
        require(pt != address(0), "PendlePTStrategy: PT not configured for asset. Call setPendleMarket() first");
        
        // Verify PT is not expired
        require(!IPendlePT(pt).isExpired(), "PendlePTStrategy: PT has expired, cannot invest in expired PT");
        
        // Get current PT balance before swap
        uint256 ptBalanceBefore = IERC20(pt).balanceOf(address(this));
        
        // Check asset balance before approving
        uint256 assetBalance = IERC20(asset).balanceOf(address(this));
        require(assetBalance >= amountIn, "PendlePTStrategy: Insufficient asset balance in vault");
        
        // Approve Pendle router to spend asset
        IERC20(asset).safeIncreaseAllowance(address(pendleRouter), amountIn);
        
        // Calculate minimum PT output to prevent sandwich attacks
        uint256 minPtOut = 0;
        try pendleOracle.getPtToAssetRate(market, TWAP_DURATION) returns (uint256 ptRate) {
            if (ptRate > 0 && ptRate <= 1e18) {
                // Calculate expected PT amount based on oracle rate
                uint256 expectedPt = (amountIn * 1e18) / ptRate;
                // Apply 2% slippage tolerance (98% of expected)
                minPtOut = (expectedPt * 98) / 100;
            }
        } catch {
            // If oracle fails, use a conservative minimum
            // At least get back 95% of input amount in PT terms
            minPtOut = (amountIn * 95) / 100;
        }
        
        // Prepare swap parameters, default ApproxParams
        IPendleRouter.ApproxParams memory approxParams = IPendleRouter.ApproxParams({
            guessMin: 0,
            guessMax: type(uint256).max,
            guessOffchain: 0, // Can be provided via data for optimization
            maxIteration: 256,
            eps: 1e14
        });
        
        IPendleRouter.TokenInput memory tokenInput = IPendleRouter.TokenInput({
            tokenIn: asset,
            netTokenIn: amountIn,
            tokenMintSy: asset, // Use asset for minting SY
            pendleSwap: address(0),
            swapData: IPendleRouter.SwapData({
                swapType: IPendleRouter.SwapType.NONE,
                extRouter: address(0),
                extCalldata: "",
                needScale: false
            })
        });
        
        IPendleRouter.LimitOrderData memory limitData = IPendleRouter.LimitOrderData({
            limitRouter: address(0),
            epsSkipMarket: 0,
            normalFills: new IPendleRouter.FillOrderParams[](0),
            flashFills: new IPendleRouter.FillOrderParams[](0),
            optData: ""
        });
        
        // Swap asset for PT
        // In delegatecall context, this = vault
        try pendleRouter.swapExactTokenForPt(
            address(this), // receiver (vault)
            market,
            minPtOut, // Use calculated minimum PT output
            approxParams,
            tokenInput,
            limitData
        ) returns (uint256, uint256, uint256) {
            // Swap successful
        } catch Error(string memory reason) {
            revert(string(abi.encodePacked("PendlePTStrategy: Pendle swap failed - ", reason)));
        } catch (bytes memory) {
            revert("PendlePTStrategy: Pendle swap failed with unknown error");
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
     * @param amountOut The amount of asset to withdraw
     * @return accountedOut The amount withdrawn
     * @return exitGain Exit gain if any (for PT, could be from selling before maturity)
     */
    function divestDelegate(
        address asset,
        uint256 amountOut,
        bytes calldata /* data */
    ) external override returns (uint256 accountedOut, uint256 exitGain) {
        if (amountOut == 0) {
            return (0, 0);
        }
        
        // Get market and PT from storage (using delegatecall-aware function)
        (address market, address pt) = _getPendleConfigInDelegateCall(asset);
        require(market != address(0), "PendlePTStrategy.divestDelegate: Market not configured for asset");
        require(pt != address(0), "PendlePTStrategy.divestDelegate: PT not configured for asset");
        
        uint256 assetBalanceBefore = IERC20(asset).balanceOf(address(this));
        
        // Check if PT has matured
        if (IPendlePT(pt).isExpired()) {
            // PT has matured, redeem directly for underlying
            uint256 ptBalance = IERC20(pt).balanceOf(address(this));
            uint256 ptToRedeem = amountOut > ptBalance ? ptBalance : amountOut;
            
            if (ptToRedeem > 0) {
                // Redeem PT for underlying at 1:1 ratio after maturity
                uint256 redeemed = 0;
                try IPendlePT(pt).redeemPY(address(this), ptToRedeem) returns (uint256 _redeemed) {
                    redeemed = _redeemed;
                } catch Error(string memory reason) {
                    revert(string(abi.encodePacked("PendlePTStrategy.divestDelegate: PT redemption failed - ", reason)));
                } catch {
                    revert("PendlePTStrategy.divestDelegate: PT redemption failed with unknown error");
                }
                accountedOut = redeemed;
                exitGain = 0; // No exit gain when redeeming at maturity
            }
        } else {
            // PT not matured, need to sell on market
            uint256 ptBalance = IERC20(pt).balanceOf(address(this));
            
            // Estimate how much PT we need to sell to get amountOut
            // Account for the discount rate: PT trades at discount to underlying
            // If 1 PT = 0.9259 USDC, then to get X USDC we need X / 0.9259 PT
            uint256 ptRate = 0;
            try pendleOracle.getPtToAssetRate(market, TWAP_DURATION) returns (uint256 _rate) {
                ptRate = _rate;
                require(ptRate > 0, "PendlePTStrategy.divestDelegate: Invalid oracle rate");
            } catch {
                revert("PendlePTStrategy.divestDelegate: Oracle call failed, cannot determine PT rate");
            }
            uint256 ptToSell = (amountOut * 1e18) / ptRate;
            if (ptToSell > ptBalance) {
                ptToSell = ptBalance;
            }
            
            // Approve Pendle router to spend PT
            IERC20(pt).safeIncreaseAllowance(address(pendleRouter), ptToSell);
            
            // Calculate minimum token output to prevent sandwich attacks
            uint256 minTokenOut = 0;
            try pendleOracle.getPtToAssetRate(market, TWAP_DURATION) returns (uint256 _ptRate) {
                if (_ptRate > 0 && _ptRate <= 1e18) {
                    // Calculate expected asset amount based on oracle rate
                    uint256 expectedAsset = (ptToSell * _ptRate) / 1e18;
                    // Apply 2% slippage tolerance (98% of expected)
                    minTokenOut = (expectedAsset * 98) / 100;
                }
            } catch {
                // If oracle fails, use conservative minimum
                // At least get back 90% of PT face value in asset terms
                minTokenOut = (ptToSell * 90) / 100;
            }
            
            IPendleRouter.TokenOutput memory tokenOutput = IPendleRouter.TokenOutput({
                tokenOut: asset,
                minTokenOut: minTokenOut, // Use calculated minimum
                tokenRedeemSy: asset, // Use asset address for redeeming
                pendleSwap: address(0),
                swapData: IPendleRouter.SwapData({
                    swapType: IPendleRouter.SwapType.NONE,
                    extRouter: address(0),
                    extCalldata: "",
                    needScale: false
                })
            });
            
            IPendleRouter.LimitOrderData memory limitData = IPendleRouter.LimitOrderData({
                limitRouter: address(0),
                epsSkipMarket: 0,
                normalFills: new IPendleRouter.FillOrderParams[](0),
                flashFills: new IPendleRouter.FillOrderParams[](0),
                optData: ""
            });
            
            // Swap PT for asset
            uint256 netTokenOut = 0;
            try pendleRouter.swapExactPtForToken(
                address(this), // receiver (vault)
                market,
                ptToSell,
                tokenOutput,
                limitData
            ) returns (uint256 _netTokenOut, uint256, uint256) {
                netTokenOut = _netTokenOut;
            } catch Error(string memory reason) {
                revert(string(abi.encodePacked("PendlePTStrategy.divestDelegate: PT swap failed - ", reason)));
            } catch {
                revert("PendlePTStrategy.divestDelegate: PT swap failed with unknown error");
            }
            
            accountedOut = netTokenOut;
            
            // Calculate exit gain/loss
            // If we sold PT for more than its face value, that's a gain
            if (netTokenOut > ptToSell) {
                exitGain = netTokenOut - ptToSell;
            } else {
                exitGain = 0;
            }
        }
        
        uint256 assetBalanceAfter = IERC20(asset).balanceOf(address(this));
        uint256 actualReceived = assetBalanceAfter - assetBalanceBefore;
        
        return (actualReceived, exitGain);
    }
    
    /**
     * @notice Emergency withdraw from Pendle PT (delegatecall from vault)
     * @param asset The asset to withdraw
     * @param amount The amount to withdraw
     * @return withdrawn The amount actually withdrawn
     */
    function emergencyWithdrawDelegate(
        address asset,
        uint256 amount,
        bytes calldata /* data */
    ) external override returns (uint256 withdrawn) {
        if (amount == 0) {
            return 0;
        }
        
        // Get market and PT from storage (using delegatecall-aware function)
        (address market, address pt) = _getPendleConfigInDelegateCall(asset);
        if (market == address(0) || pt == address(0)) {
            return 0; // Asset not configured
        }
        
        uint256 ptBalance = IERC20(pt).balanceOf(address(this));
        if (ptBalance == 0) {
            return 0;
        }
        
        // Try to exit position
        try this.divestDelegate(asset, amount, "") returns (uint256 accountedOut, uint256) {
            return accountedOut;
        } catch {
            // If normal exit fails, try emergency redemption if matured
            if (IPendlePT(pt).isExpired()) {
                try IPendlePT(pt).redeemPY(address(this), ptBalance) returns (uint256 redeemed) {
                    return redeemed;
                } catch {
                    return 0;
                }
            }
            return 0;
        }
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
     * @notice Get total underlying value for a vault's PT position with market info
     * @param vault The vault address  
     * @param market The Pendle market address
     * @param pt The PT token address
     * @return The total underlying value
     */
    function totalUnderlyingWithMarket(
        address vault,
        address market,
        address pt
    ) external view returns (uint256) {
        uint256 ptBalance = IERC20(pt).balanceOf(vault);
        
        if (ptBalance == 0) {
            return 0;
        }
        
        if (IPendlePT(pt).isExpired()) {
            // If matured, PT is worth face value (1:1 with underlying)
            return ptBalance;
        } else {
            // If not matured, use oracle to get current value
            // This returns the current market value, not face value
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
        
        // Get market and PT from storage (using delegatecall-aware function)
        (address market, address pt) = _getPendleConfigInDelegateCall(asset);
        
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