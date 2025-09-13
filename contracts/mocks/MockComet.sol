// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockComet
 * @notice Mock implementation of Compound V3 Comet for testing
 */
contract MockComet {
    using SafeERC20 for IERC20;
    
    address public immutable baseToken;
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;
    uint256 public totalBorrow;
    
    // Interest rate model parameters (simplified)
    uint256 public constant SUPPLY_RATE = 5e15; // 0.5% APR simplified
    uint256 public lastAccrualTime;
    uint256 public accumulatedInterest;
    
    constructor(address _baseToken) {
        baseToken = _baseToken;
        lastAccrualTime = block.timestamp;
    }
    
    function supply(address asset, uint256 amount) external {
        require(asset == baseToken, "MockComet: Wrong asset");
        require(amount > 0, "MockComet: Zero amount");
        
        // Transfer tokens from sender
        IERC20(baseToken).safeTransferFrom(msg.sender, address(this), amount);
        
        // Update balance
        balanceOf[msg.sender] += amount;
        totalSupply += amount;
        
        _accrueInterest();
    }
    
    function withdraw(address asset, uint256 amount) external {
        require(asset == baseToken, "MockComet: Wrong asset");
        require(amount > 0, "MockComet: Zero amount");
        require(balanceOf[msg.sender] >= amount, "MockComet: Insufficient balance");
        
        // Update balance
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        
        // Transfer tokens to sender
        IERC20(baseToken).safeTransfer(msg.sender, amount);
        
        _accrueInterest();
    }
    
    function supplyTo(address to, address asset, uint256 amount) external {
        require(asset == baseToken, "MockComet: Wrong asset");
        require(amount > 0, "MockComet: Zero amount");
        
        // Transfer tokens from sender
        IERC20(baseToken).safeTransferFrom(msg.sender, address(this), amount);
        
        // Update balance
        balanceOf[to] += amount;
        totalSupply += amount;
        
        _accrueInterest();
    }
    
    function withdrawTo(address to, address asset, uint256 amount) external {
        require(asset == baseToken, "MockComet: Wrong asset");
        require(amount > 0, "MockComet: Zero amount");
        require(balanceOf[msg.sender] >= amount, "MockComet: Insufficient balance");
        
        // Update balance
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        
        // Transfer tokens to recipient
        IERC20(baseToken).safeTransfer(to, amount);
        
        _accrueInterest();
    }
    
    function collateralBalanceOf(address account, address /* asset */) external view returns (uint128) {
        // Simplified: treat all balance as collateral
        return uint128(balanceOf[account]);
    }
    
    function baseTokenPriceFeed() external pure returns (address) {
        // Return a dummy address for testing
        return address(0x1);
    }
    
    function getSupplyRate(uint256 /* utilization */) external pure returns (uint64) {
        return uint64(SUPPLY_RATE);
    }
    
    function getBorrowRate(uint256 /* utilization */) external pure returns (uint64) {
        return uint64(SUPPLY_RATE * 2); // Borrow rate is typically higher
    }
    
    function getUtilization() external view returns (uint256) {
        if (totalSupply == 0) return 0;
        return (totalBorrow * 1e18) / totalSupply;
    }
    
    function isAssetAllowed(address asset) external view returns (bool) {
        return asset == baseToken;
    }
    
    function getAssetInfo(uint8 /* i */) external view returns (
        uint8 offset,
        address asset,
        address priceFeed,
        uint64 scale,
        uint64 borrowCollateralFactor,
        uint64 liquidateCollateralFactor,
        uint64 liquidationFactor,
        uint128 supplyCap
    ) {
        // Return mock data for the base asset
        return (
            0, // offset
            baseToken, // asset
            address(0x1), // priceFeed
            1e6, // scale
            8e17, // borrowCollateralFactor (80%)
            85e16, // liquidateCollateralFactor (85%)
            95e16, // liquidationFactor (95%)
            type(uint128).max // supplyCap (unlimited)
        );
    }
    
    function getPrice(address /* priceFeed */) external pure returns (uint256) {
        // Return a fixed price for testing (1 USD)
        return 1e8; // 8 decimals for price
    }
    
    // Simulate interest accrual
    function _accrueInterest() internal {
        if (block.timestamp > lastAccrualTime && totalSupply > 0) {
            uint256 timeElapsed = block.timestamp - lastAccrualTime;
            uint256 interest = (totalSupply * SUPPLY_RATE * timeElapsed) / (365 days * 1e18);
            accumulatedInterest += interest;
            lastAccrualTime = block.timestamp;
        }
    }
    
    // Function to simulate interest distribution (for testing)
    function accrueInterest() external {
        _accrueInterest();
        if (accumulatedInterest > 0 && totalSupply > 0) {
            // Distribute interest proportionally
            uint256 interestPerToken = (accumulatedInterest * 1e18) / totalSupply;
            // In real implementation, this would update each user's balance
            // For testing, we just reset accumulated interest
            accumulatedInterest = 0;
        }
    }
}