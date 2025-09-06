// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IStrategy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockStrategy is IStrategy {
    using SafeERC20 for IERC20;

    address public immutable asset;
    uint256 public lastHarvestTime;

    constructor(address _asset) {
        asset = _asset;
    }

    function underlying() external view override returns (address) {
        return asset;
    }

    function totalUnderlying() external view override returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }
    
    // Overloaded version with vault parameter for delegatecall
    function totalUnderlying(address vault) external view override returns (uint256) {
        // In delegatecall context, 'this' will be the vault
        // For mock, just return 0 since we're not actually investing
        // In a real strategy, this would return the invested amount
        return 0;
    }

    function invest(uint256 amount) external override {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
    }

    function divest(uint256 amount) external override {
        uint256 balance = IERC20(asset).balanceOf(address(this));
        require(amount <= balance, "MockStrategy: Insufficient balance");
        IERC20(asset).safeTransfer(msg.sender, amount);
    }

    function emergencyWithdraw(uint256 amount) external override {
        uint256 balance = IERC20(asset).balanceOf(address(this));
        require(amount <= balance, "MockStrategy: Insufficient balance");
        IERC20(asset).safeTransfer(msg.sender, amount);
    }
    
    // Delegatecall interface for invest - returns (accounted, entryGain)
    function investDelegate(
        address, // asset parameter (unused in mock)
        uint256 amountIn,
        bytes calldata // data parameter (unused in mock)
    ) external pure override returns (uint256 accounted, uint256 entryGain) {
        // For mock strategy in delegatecall mode, return 0 to force fallback to regular invest
        // This ensures tokens are actually moved to the strategy for testing
        accounted = 0;
        entryGain = 0;
    }
    
    // Delegatecall interface for divest - returns (accountedOut, exitGain)
    function divestDelegate(
        address, // asset parameter (unused in mock)
        uint256 amountOut,
        bytes calldata // data parameter (unused in mock)
    ) external pure override returns (uint256 accountedOut, uint256 exitGain) {
        // For mock strategy in delegatecall mode, return 0 to force fallback to regular divest
        // This ensures tokens are actually moved from the strategy for testing
        accountedOut = 0;
        exitGain = 0;
    }

    // Additional helper functions not in interface
    function totalAssets() external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    function harvest() external returns (uint256) {
        // Simulate harvest by minting 10% profit
        uint256 balance = IERC20(asset).balanceOf(address(this));
        uint256 profit = balance / 10;
        lastHarvestTime = block.timestamp;
        return profit;
    }

    // Helper function to simulate profit - not used since balance is tracked directly
    function simulateProfit(uint256 profitAmount) external {
        // This function is deprecated - just send tokens directly to the strategy
    }

    // Helper function to simulate loss - not used since balance is tracked directly  
    function simulateLoss(uint256 lossAmount) external {
        // This function is deprecated - just transfer tokens out of the strategy
    }
}