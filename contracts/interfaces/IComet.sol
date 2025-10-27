// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IComet
 * @notice Interface for Compound V3 (Comet) protocol
 * @dev The main contract for Compound V3 lending and borrowing
 */
interface IComet {
    // Supply functions
    function supply(address asset, uint256 amount) external;
    function supplyTo(address to, address asset, uint256 amount) external;
    function supplyFrom(address src, address to, address asset, uint256 amount) external;
    
    // Withdraw functions  
    function withdraw(address asset, uint256 amount) external;
    function withdrawTo(address to, address asset, uint256 amount) external;
    function withdrawFrom(address src, address to, address asset, uint256 amount) external;
    
    // Balance functions
    function balanceOf(address account) external view returns (uint256);
    
    // Get collateral balance for a specific asset
    function collateralBalanceOf(address account, address asset) external view returns (uint128);
    
    // Get the base token address
    function baseToken() external view returns (address);
    
    // Get the base token price feed
    function baseTokenPriceFeed() external view returns (address);
    
    // Get total supply
    function totalSupply() external view returns (uint256);
    
    // Get total borrow
    function totalBorrow() external view returns (uint256);
    
    // Get supply rate
    function getSupplyRate(uint256 utilization) external view returns (uint64);
    
    // Get borrow rate
    function getBorrowRate(uint256 utilization) external view returns (uint64);
    
    // Get utilization
    function getUtilization() external view returns (uint256);
    
    // Check if an asset is allowed as collateral
    function isAssetAllowed(address asset) external view returns (bool);
    
    // Get asset info
    function getAssetInfo(uint8 i) external view returns (
        uint8 offset,
        address asset,
        address priceFeed,
        uint64 scale,
        uint64 borrowCollateralFactor,
        uint64 liquidateCollateralFactor,
        uint64 liquidationFactor,
        uint128 supplyCap
    );
    
    // Get price of an asset in USD
    function getPrice(address priceFeed) external view returns (uint256);
}