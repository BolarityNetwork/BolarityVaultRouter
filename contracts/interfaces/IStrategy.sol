// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IStrategy {
    // New delegatecall interface methods according to design
    // Accounting A: returns (accounted, entryGain)
    function investDelegate(
        address asset,
        uint256 amountIn,
        bytes calldata data
    ) external returns (uint256 accounted, uint256 entryGain);
    
    // Returns (accountedOut, exitGain)
    function divestDelegate(
        address asset,
        uint256 amountOut,
        bytes calldata data
    ) external returns (uint256 accountedOut, uint256 exitGain);
    
    // External view for valuation, needs vault address
    function totalUnderlying(address vault) external view returns (uint256);
    
    // Preview function for read-only simulation of investment
    // Returns (accounted, entryGain) without actually executing the investment
    function previewInvest(
        address asset,
        uint256 amountIn
    ) external view returns (uint256 accounted, uint256 entryGain);
}