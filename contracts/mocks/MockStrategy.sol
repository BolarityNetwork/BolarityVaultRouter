// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IStrategy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockStrategy is IStrategy {
    using SafeERC20 for IERC20;

    address public immutable asset;
    uint256 private mockTotalAssets;
    uint256 public lastHarvestTime;

    constructor(address _asset) {
        asset = _asset;
    }

    function underlying() external view override returns (address) {
        return asset;
    }

    function totalUnderlying() external view override returns (uint256) {
        return mockTotalAssets;
    }

    function invest(uint256 amount) external override {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        mockTotalAssets += amount;
    }

    function divest(uint256 amount) external override {
        require(amount <= mockTotalAssets, "MockStrategy: Insufficient balance");
        mockTotalAssets -= amount;
        IERC20(asset).safeTransfer(msg.sender, amount);
    }

    function emergencyWithdraw(uint256 amount) external override {
        require(amount <= mockTotalAssets, "MockStrategy: Insufficient balance");
        mockTotalAssets -= amount;
        IERC20(asset).safeTransfer(msg.sender, amount);
    }

    // Additional helper functions not in interface
    function totalAssets() external view returns (uint256) {
        return mockTotalAssets;
    }

    function harvest() external returns (uint256) {
        // Simulate harvest by minting 10% profit
        uint256 profit = mockTotalAssets / 10;
        lastHarvestTime = block.timestamp;
        return profit;
    }

    // Helper function to simulate profit
    function simulateProfit(uint256 profitAmount) external {
        mockTotalAssets += profitAmount;
    }

    // Helper function to simulate loss
    function simulateLoss(uint256 lossAmount) external {
        require(lossAmount <= mockTotalAssets, "MockStrategy: Loss too large");
        mockTotalAssets -= lossAmount;
    }
}