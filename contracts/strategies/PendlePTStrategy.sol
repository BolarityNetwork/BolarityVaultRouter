// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IStrategy.sol";
import "../interfaces/IPendle.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PendlePTStrategy
 * @notice Stateless strategy for Pendle PT (Principal Token) integration via delegatecall
 * @dev This contract is meant to be used via delegatecall from a vault
 * Since it's called via delegatecall, it cannot rely on its own storage
 * According to design.md: Pendle PT is a zero-coupon bond with entry gain
 */
contract PendlePTStrategy is IStrategy {
    using SafeERC20 for IERC20;
    
    // Immutable variables are stored in bytecode, not storage
    IPendleRouter public immutable pendleRouter;
    IPendleOracle public immutable pendleOracle;
    uint32 public constant TWAP_DURATION = 900; // 15 minutes TWAP for oracle
    
    constructor(address _pendleRouter, address _pendleOracle) {
        require(_pendleRouter != address(0), "PendlePTStrategy: Invalid router");
        require(_pendleOracle != address(0), "PendlePTStrategy: Invalid oracle");
        pendleRouter = IPendleRouter(_pendleRouter);
        pendleOracle = IPendleOracle(_pendleOracle);
    }
    
    /**
     * @notice Decode market and PT addresses from calldata
     * @param data The encoded market and PT addresses
     * @return market The Pendle market address
     * @return pt The PT token address
     */
    function _decodeAddresses(bytes calldata data) internal pure returns (address market, address pt) {
        require(data.length >= 64, "PendlePTStrategy: Invalid data length");
        (market, pt) = abi.decode(data, (address, address));
        require(market != address(0) && pt != address(0), "PendlePTStrategy: Invalid addresses");
    }
    
    /**
     * @notice Invest assets into Pendle PT (delegatecall from vault)
     * @param asset The asset to invest (e.g., USDC)
     * @param amountIn The amount of asset to invest
     * @param data Encoded market and PT addresses, plus optional swap params
     * @return accounted The face value of PT received (for zero-coupon bonds)
     * @return entryGain The immediate gain from buying PT at discount
     * @dev According to design.md: Example 100 USDC → 108 PT returns (accounted = 108, entryGain = 8)
     */
    function investDelegate(
        address asset,
        uint256 amountIn,
        bytes calldata data
    ) external override returns (uint256 accounted, uint256 entryGain) {
        if (amountIn == 0) {
            return (0, 0);
        }
        
        (address market, address pt) = _decodeAddresses(data);
        
        // Verify PT is not expired
        require(!IPendlePT(pt).isExpired(), "PendlePTStrategy: PT expired");
        
        // Get current PT balance before swap
        uint256 ptBalanceBefore = IERC20(pt).balanceOf(address(this));
        
        // Approve Pendle router to spend asset
        IERC20(asset).safeIncreaseAllowance(address(pendleRouter), amountIn);
        
        // Prepare swap parameters
        IPendleRouter.ApproxParams memory approxParams = IPendleRouter.ApproxParams({
            guessMin: 0,
            guessMax: type(uint256).max,
            guessOffchain: 0, // Can be provided via data for optimization
            maxIteration: 256,
            eps: 1e15 // 0.1% precision
        });
        
        IPendleRouter.TokenInput memory tokenInput = IPendleRouter.TokenInput({
            tokenIn: asset,
            netTokenIn: amountIn,
            tokenMintSy: pt, // PT address for minting
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
        (uint256 netPtOut, , ) = pendleRouter.swapExactTokenForPt(
            address(this), // receiver (vault)
            market,
            0, // minPtOut - should be calculated properly in production
            approxParams,
            tokenInput,
            limitData
        );
        
        // Calculate actual PT received
        uint256 ptBalanceAfter = IERC20(pt).balanceOf(address(this));
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
     * @param data Encoded market and PT addresses
     * @return accountedOut The amount withdrawn
     * @return exitGain Exit gain if any (for PT, could be from selling before maturity)
     */
    function divestDelegate(
        address asset,
        uint256 amountOut,
        bytes calldata data
    ) external override returns (uint256 accountedOut, uint256 exitGain) {
        if (amountOut == 0) {
            return (0, 0);
        }
        
        (address market, address pt) = _decodeAddresses(data);
        
        uint256 assetBalanceBefore = IERC20(asset).balanceOf(address(this));
        
        // Check if PT has matured
        if (IPendlePT(pt).isExpired()) {
            // PT has matured, redeem directly for underlying
            uint256 ptBalance = IERC20(pt).balanceOf(address(this));
            uint256 ptToRedeem = amountOut > ptBalance ? ptBalance : amountOut;
            
            if (ptToRedeem > 0) {
                // Redeem PT for underlying at 1:1 ratio after maturity
                uint256 redeemed = IPendlePT(pt).redeemPY(address(this), ptToRedeem);
                accountedOut = redeemed;
                exitGain = 0; // No exit gain when redeeming at maturity
            }
        } else {
            // PT not matured, need to sell on market
            uint256 ptBalance = IERC20(pt).balanceOf(address(this));
            
            // Estimate how much PT we need to sell to get amountOut
            // Account for the discount rate: PT trades at discount to underlying
            // If 1 PT = 0.9259 USDC, then to get X USDC we need X / 0.9259 PT
            uint256 ptToSell = (amountOut * 1e18) / pendleOracle.getPtToAssetRate(market, TWAP_DURATION);
            if (ptToSell > ptBalance) {
                ptToSell = ptBalance;
            }
            
            // Approve Pendle router to spend PT
            IERC20(pt).safeIncreaseAllowance(address(pendleRouter), ptToSell);
            
            IPendleRouter.TokenOutput memory tokenOutput = IPendleRouter.TokenOutput({
                tokenOut: asset,
                minTokenOut: 0, // Should be calculated properly in production
                tokenRedeemSy: pt, // PT address for redeeming
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
            (uint256 netTokenOut, , ) = pendleRouter.swapExactPtForToken(
                address(this), // receiver (vault)
                market,
                ptToSell,
                tokenOutput,
                limitData
            );
            
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
     * @param data Encoded market and PT addresses
     * @return withdrawn The amount actually withdrawn
     */
    function emergencyWithdrawDelegate(
        address asset,
        uint256 amount,
        bytes calldata data
    ) external override returns (uint256 withdrawn) {
        if (amount == 0) {
            return 0;
        }
        
        (address market, address pt) = _decodeAddresses(data);
        
        uint256 ptBalance = IERC20(pt).balanceOf(address(this));
        if (ptBalance == 0) {
            return 0;
        }
        
        // Try to exit position
        try this.divestDelegate(asset, amount, data) returns (uint256 accountedOut, uint256) {
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
     * @dev This uses the vault's lastStrategyData to get the market and PT addresses
     */
    function totalUnderlying(address vault) external view override returns (uint256) {
        // Try to get last strategy data from vault
        (bool success, bytes memory data) = vault.staticcall(
            abi.encodeWithSignature("lastStrategyData()")
        );
        
        if (!success || data.length < 32) {
            return 0;
        }
        
        // Decode the data to get market and PT addresses
        bytes memory strategyData = abi.decode(data, (bytes));
        if (strategyData.length >= 64) {
            (address market, address pt) = abi.decode(strategyData, (address, address));
            if (market != address(0) && pt != address(0)) {
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
        }
        
        return 0;
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
     * @dev This is a simplified preview that cannot query actual market rates
     *      since it lacks the market and PT addresses needed for accurate calculation.
     *      In production, consider passing market data through BolarityVault's
     *      pending strategy data for more accurate previews.
     */
    function previewInvest(
        address asset,
        uint256 amountIn
    ) external pure override returns (uint256 accounted, uint256 entryGain) {
        // Without market and PT addresses, we cannot query actual rates
        // This is a limitation of the current design where preview functions
        // don't receive the strategy data parameter
        // 
        // For now, return conservative estimates:
        // - Assume PT trades at a small discount (e.g., 2-5%)
        // - This means 100 USDC might buy 102-105 PT
        // 
        // In reality, the discount varies based on:
        // - Time to maturity
        // - Market conditions
        // - Interest rate expectations
        
        // Conservative estimate: 2% discount (100 USDC -> 102 PT)
        accounted = (amountIn * 102) / 100;
        entryGain = accounted > amountIn ? accounted - amountIn : 0;
        return (accounted, entryGain);
    }
}