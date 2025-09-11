// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IStrategy.sol";
import "../interfaces/ICompound.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title CompoundStrategy
 * @notice Stateless strategy for Compound protocol integration via delegatecall
 * @dev This contract is meant to be used via delegatecall from a vault
 * Since it's called via delegatecall, it cannot rely on its own storage
 * The cToken address must be passed via the data parameter
 */
contract CompoundStrategy is IStrategy {
    using SafeERC20 for IERC20;
    
    uint256 public constant MANTISSA = 1e18;
    
    // Immutable variables are stored in bytecode, not storage
    // This maintains the stateless property
    address public immutable comptroller;
    
    constructor(address _comptroller) {
        require(_comptroller != address(0), "CompoundStrategy: Invalid comptroller");
        comptroller = _comptroller;
    }
    
    /**
     * @notice Decode cToken address from calldata
     * @param data The encoded cToken address
     * @return cToken The decoded cToken address
     */
    function _decodeCToken(bytes calldata data) internal pure returns (address cToken) {
        if (data.length >= 32) {
            cToken = abi.decode(data, (address));
        }
        require(cToken != address(0), "CompoundStrategy: Invalid cToken in data");
    }

    /**
     * @notice Invest assets into Compound (delegatecall from vault)
     * @param asset The asset to invest  
     * @param amountIn The amount to invest
     * @param data Encoded cToken address
     * @return accounted The amount accounted for (same as input for Compound)
     * @return entryGain No entry gain for Compound
     */
    function investDelegate(
        address asset,
        uint256 amountIn,
        bytes calldata data
    ) external override returns (uint256 accounted, uint256 entryGain) {
        if (amountIn == 0) {
            return (0, 0);
        }
        
        address cToken = _decodeCToken(data);
        
        // Verify cToken matches the asset
        require(ICToken(cToken).underlying() == asset, "CompoundStrategy: Mismatched underlying");
        
        // Approve and mint cTokens
        // In delegatecall context, this = vault
        IERC20(asset).safeIncreaseAllowance(cToken, amountIn);
        uint256 mintResult = ICToken(cToken).mint(amountIn);
        require(mintResult == 0, "CompoundStrategy: Mint failed");
        
        // For Compound, there's no immediate entry gain
        return (amountIn, 0);
    }

    /**
     * @notice Withdraw assets from Compound (delegatecall from vault)
     * @param asset The asset to withdraw
     * @param amountOut The amount to withdraw
     * @param data Encoded cToken address
     * @return accountedOut The amount withdrawn
     * @return exitGain No exit gain for Compound
     */
    function divestDelegate(
        address asset,
        uint256 amountOut,
        bytes calldata data
    ) external override returns (uint256 accountedOut, uint256 exitGain) {
        if (amountOut == 0) {
            return (0, 0);
        }
        
        address cToken = _decodeCToken(data);
        
        // Verify cToken matches the asset
        require(ICToken(cToken).underlying() == asset, "CompoundStrategy: Mismatched underlying");
        
        // Redeem underlying from Compound
        // In delegatecall context, this = vault
        uint256 redeemResult = ICToken(cToken).redeemUnderlying(amountOut);
        require(redeemResult == 0, "CompoundStrategy: Redeem failed");
        
        // For Compound, there's no exit gain fee
        return (amountOut, 0);
    }

    /**
     * @notice Emergency withdraw from Compound (delegatecall from vault)
     * @param asset The asset to withdraw
     * @param amount The amount to withdraw
     * @param data Encoded cToken address
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
        
        address cToken = _decodeCToken(data);
        
        // Verify cToken matches the asset
        require(ICToken(cToken).underlying() == asset, "CompoundStrategy: Mismatched underlying");
        
        uint256 cTokenBalance = ICToken(cToken).balanceOf(address(this));
        if (cTokenBalance > 0) {
            uint256 exchangeRate = ICToken(cToken).exchangeRateStored();
            uint256 underlyingBalance = (cTokenBalance * exchangeRate) / MANTISSA;
            
            if (underlyingBalance > 0) {
                uint256 toRedeem = amount > underlyingBalance ? underlyingBalance : amount;
                uint256 redeemResult = ICToken(cToken).redeemUnderlying(toRedeem);
                if (redeemResult == 0) {
                    withdrawn = toRedeem;
                }
            }
        }
        
        return withdrawn;
    }

    /**
     * @notice Get total underlying assets for a vault in Compound
     * @param vault The vault address
     * @return The total underlying assets (cToken balance * exchange rate)
     * @dev This uses the vault's lastStrategyData to get the cToken address
     */
    function totalUnderlying(address vault) external view override returns (uint256) {
        // Try to get last strategy data from vault
        (bool success, bytes memory data) = vault.staticcall(
            abi.encodeWithSignature("lastStrategyData()")
        );
        
        if (!success || data.length < 32) {
            return 0;
        }
        
        // Decode the data to get cToken address
        bytes memory strategyData = abi.decode(data, (bytes));
        if (strategyData.length >= 32) {
            address cToken = abi.decode(strategyData, (address));
            if (cToken != address(0)) {
                uint256 cTokenBalance = ICToken(cToken).balanceOf(vault);
                if (cTokenBalance > 0) {
                    uint256 exchangeRate = ICToken(cToken).exchangeRateStored();
                    return (cTokenBalance * exchangeRate) / MANTISSA;
                }
            }
        }
        
        return 0;
    }
    
    /**
     * @notice Get total underlying with cToken address provided
     * @param vault The vault address
     * @param cToken The cToken address
     * @return The total underlying assets
     */
    function totalUnderlyingWithCToken(
        address vault,
        address cToken
    ) external view returns (uint256) {
        uint256 cTokenBalance = ICToken(cToken).balanceOf(vault);
        if (cTokenBalance == 0) {
            return 0;
        }
        
        uint256 exchangeRate = ICToken(cToken).exchangeRateStored();
        return (cTokenBalance * exchangeRate) / MANTISSA;
    }
    
    /**
     * @notice Preview investment without executing (view function)
     * @param amountIn The amount to invest
     * @return accounted The amount that would be accounted for
     * @return entryGain The entry gain (0 for Compound)
     */
    function previewInvest(
        address /* asset */,
        uint256 amountIn
    ) external pure override returns (uint256 accounted, uint256 entryGain) {
        // For Compound, minting cTokens is a 1:1 operation with the underlying asset
        // The protocol tracks your deposited balance and yields accumulate over time
        // There's no immediate entry gain at deposit time
        // Therefore: accounted = amountIn, entryGain = 0
        return (amountIn, 0);
    }
}

// Interface to get asset from vault
interface IBolarityVault {
    function asset() external view returns (address);
}