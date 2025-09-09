// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IStrategy.sol";
import "../interfaces/IAave.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockStrategy
 * @notice Mock strategy that simulates Aave-like behavior for testing
 * @dev This contract simulates a yield strategy similar to AaveStrategy
 * Since this is called via delegatecall, it operates in the vault's context
 * and MUST be stateless - no storage variables
 */
contract MockStrategy is IStrategy {
    using SafeERC20 for IERC20;
    
    // Mock pool address (simulates Aave pool)
    IPool public immutable mockPool;
    uint16 public constant REFERRAL_CODE = 0;

    constructor(address _mockPool) {
        require(_mockPool != address(0), "MockStrategy: Invalid pool");
        mockPool = IPool(_mockPool);
    }
    

    /**
     * @notice Invest assets into mock pool (delegatecall from vault)
     * @param asset The asset to invest  
     * @param amountIn The amount to invest
     * @return accounted The amount accounted for (same as input for mock)
     * @return entryGain No entry gain for mock (similar to Aave)
     */
    function investDelegate(
        address asset,
        uint256 amountIn,
        bytes calldata /* data */
    ) external override returns (uint256 accounted, uint256 entryGain) {
        // Remove aToken check since we're in delegatecall context
        if (amountIn > 0) {
            // Approve the pool to spend vault's tokens
            IERC20(asset).safeIncreaseAllowance(address(mockPool), amountIn);
            
            // Call supply on the mock pool (similar to real Aave)
            // This will transfer tokens from vault to pool
            mockPool.supply(asset, amountIn, address(this), REFERRAL_CODE);
        }
        
        return (amountIn, 0);
    }

    /**
     * @notice Withdraw assets from mock pool (delegatecall from vault)
     * @param asset The asset to withdraw
     * @param amountOut The amount to withdraw
     * @return accountedOut The amount withdrawn
     * @return exitGain No exit gain for mock (similar to Aave)
     */
    function divestDelegate(
        address asset,
        uint256 amountOut,
        bytes calldata /* data */
    ) external override returns (uint256 accountedOut, uint256 exitGain) {
        if (amountOut > 0) {
            // Call withdraw on the pool
            // The pool will transfer tokens back to vault
            uint256 withdrawn = mockPool.withdraw(asset, amountOut, address(this));
            return (withdrawn, 0);
        }
        
        return (0, 0);
    }

    /**
     * @notice Emergency withdraw from mock pool (delegatecall from vault)
     * @param asset The asset to withdraw
     * @param amount The amount to withdraw
     * @return withdrawn The amount actually withdrawn
     */
    function emergencyWithdrawDelegate(
        address asset,
        uint256 amount,
        bytes calldata /* data */
    ) external override returns (uint256 withdrawn) {
        if (amount > 0) {
            // Try to withdraw from pool
            try mockPool.withdraw(asset, amount, address(this)) returns (uint256 withdrawnAmount) {
                return withdrawnAmount;
            } catch {
                // If withdraw fails, return 0
                return 0;
            }
        }
        
        return 0;
    }

    /**
     * @notice Get total underlying assets for a vault
     * @return The total underlying assets in the protocol
     */
    function totalUnderlying(address vault) external view override returns (uint256) {
        // Get the vault's asset
        try IBolarityVault(vault).asset() returns (address asset) {
            // Check how much the pool has for this vault
            // In real Aave, this would check aToken balance
            // For mock, we check the deposits in the pool
            try IMockAavePool(address(mockPool)).getDeposit(asset, vault) returns (uint256 deposited) {
                return deposited;
            } catch {
                return 0;
            }
        } catch {
            return 0;
        }
    }
    
    /**
     * @notice Preview investment without executing (view function)
     * @param amountIn The amount to invest
     * @return accounted The amount that would be accounted for
     * @return entryGain The entry gain (0 for Mock)
     */
    function previewInvest(
        address /* asset */,
        uint256 amountIn
    ) external pure override returns (uint256 accounted, uint256 entryGain) {
        // For Mock strategy, accounted equals amountIn and there's no entry gain
        return (amountIn, 0);
    }
}

// Interface to get asset from vault
interface IBolarityVault {
    function asset() external view returns (address);
}

// Interface for MockAavePool
interface IMockAavePool {
    function getDeposit(address asset, address user) external view returns (uint256);
}