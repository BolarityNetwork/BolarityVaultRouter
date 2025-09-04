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