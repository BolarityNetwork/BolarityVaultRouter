// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IStrategy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockStrategy
 * @notice Mock strategy for testing purposes (stateless, delegatecall compatible)
 * @dev This contract simulates a yield strategy for testing
 * Since this is called via delegatecall, it doesn't maintain state - it simulates behavior
 */
contract MockStrategy is IStrategy {
    using SafeERC20 for IERC20;
    
    // Simulate a 10% yield
    uint256 public constant YIELD_BPS = 1000; // 10%
    uint256 public constant BPS_DIVISOR = 10000;
    
    /**
     * @notice Invest assets (delegatecall from vault)
     * @param amountIn The amount to invest
     * @return accounted The amount accounted for
     * @return entryGain Simulated entry gain for testing
     */
    function investDelegate(
        address /* asset */,
        uint256 amountIn,
        bytes calldata /* data */
    ) external pure override returns (uint256 accounted, uint256 entryGain) {
        // In delegatecall context, this = vault
        // For mock strategy, we don't simulate any entry gain for testing simplicity
        // In real implementation, this would interact with a protocol
        
        // No entry gain for testing
        entryGain = 0;
        accounted = amountIn;
        
        return (accounted, entryGain);
    }

    /**
     * @notice Withdraw assets (delegatecall from vault)
     * @param amountOut The amount to withdraw
     * @return accountedOut The amount withdrawn
     * @return exitGain No exit gain for mock
     */
    function divestDelegate(
        address /* asset */,
        uint256 amountOut,
        bytes calldata /* data */
    ) external pure override returns (uint256 accountedOut, uint256 exitGain) {
        // In delegatecall context, this = vault
        // For mock strategy, we just return the requested amount
        // In real implementation, this would withdraw from a protocol
        
        accountedOut = amountOut;
        // No exit gain for mock strategy
        return (accountedOut, 0);
    }

    /**
     * @notice Emergency withdraw (delegatecall from vault)
     * @param amount The amount to withdraw
     * @return withdrawn The amount actually withdrawn
     */
    function emergencyWithdrawDelegate(
        address /* asset */,
        uint256 amount,
        bytes calldata /* data */
    ) external pure override returns (uint256 withdrawn) {
        // In delegatecall context, this = vault
        // For mock strategy, we just return the requested amount
        // In real implementation, this would perform emergency withdrawal from a protocol
        
        withdrawn = amount;
        return withdrawn;
    }

    /**
     * @notice Get total underlying assets for a vault
     * @return The total underlying assets (simulated)
     */
    function totalUnderlying(address /* vault */) external pure override returns (uint256) {
        // For mock strategy, we simulate that the vault has no invested assets
        // In real implementation, this would query the actual protocol balance
        // Since this is stateless, we can't track balances here
        // The vault should track its own invested amounts if needed for testing
        return 0;
    }
}