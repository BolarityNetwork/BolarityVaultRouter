// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IStrategy.sol";
import "../interfaces/IWstETH.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title WstETHStrategy
 * @notice Stateless strategy for wstETH (wrapped staked ETH) integration via delegatecall
 * @dev This contract is meant to be used via delegatecall from a vault
 * Since it's called via delegatecall, it cannot rely on its own storage
 * According to design.md: wstETH is a wrapped yield-bearing asset with no entry gain
 */
contract WstETHStrategy is IStrategy {
    using SafeERC20 for IERC20;
    
    // Immutable variables are stored in bytecode, not storage
    IWstETH public immutable wstETH;
    IStETH public immutable stETH;
    
    constructor(address _wstETH) {
        require(_wstETH != address(0), "WstETHStrategy: Invalid wstETH");
        wstETH = IWstETH(_wstETH);
        // Get stETH address from wstETH contract
        stETH = IStETH(wstETH.stETH());
        require(address(stETH) != address(0), "WstETHStrategy: Invalid stETH");
    }
    
    /**
     * @notice Invest stETH into wstETH (delegatecall from vault)
     * @param asset The asset to invest (should be stETH)
     * @param amountIn The amount of stETH to wrap
     * @return accounted The amount accounted for (same as input for wstETH)
     * @return entryGain No entry gain for wstETH (wrapped yield-bearing)
     * @dev According to design.md: wstETH returns (accounted = amountIn, entryGain = 0)
     */
    function investDelegate(
        address asset,
        uint256 amountIn,
        bytes calldata /* data */
    ) external override returns (uint256 accounted, uint256 entryGain) {
        require(asset == address(stETH), "WstETHStrategy: Asset must be stETH");
        
        if (amountIn == 0) {
            return (0, 0);
        }
        
        // Approve wstETH contract to spend vault's stETH
        // In delegatecall context, this = vault
        IERC20(asset).safeIncreaseAllowance(address(wstETH), amountIn);
        
        // Wrap stETH to wstETH
        uint256 wstETHReceived = wstETH.wrap(amountIn);
        require(wstETHReceived > 0, "WstETHStrategy: Wrap failed");
        
        // For wstETH, there's no immediate entry gain
        // It's a wrapped yield-bearing asset
        return (amountIn, 0);
    }
    
    /**
     * @notice Withdraw stETH from wstETH (delegatecall from vault)
     * @param asset The asset to withdraw (should be stETH)
     * @param amountOut The amount of stETH to withdraw
     * @return accountedOut The amount withdrawn
     * @return exitGain No exit gain for wstETH
     */
    function divestDelegate(
        address asset,
        uint256 amountOut,
        bytes calldata /* data */
    ) external override returns (uint256 accountedOut, uint256 exitGain) {
        require(asset == address(stETH), "WstETHStrategy: Asset must be stETH");
        
        if (amountOut == 0) {
            return (0, 0);
        }
        
        // Calculate how much wstETH we need to unwrap to get amountOut stETH
        uint256 wstETHBalance = wstETH.balanceOf(address(this));
        uint256 stETHBalance = wstETH.getStETHByWstETH(wstETHBalance);
        
        require(stETHBalance >= amountOut, "WstETHStrategy: Insufficient balance");
        
        // Calculate wstETH amount to unwrap (round up to ensure we get enough stETH)
        uint256 wstETHToUnwrap = wstETH.getWstETHByStETH(amountOut);
        if (wstETH.getStETHByWstETH(wstETHToUnwrap) < amountOut) {
            wstETHToUnwrap += 1; // Round up
        }
        
        // Ensure we don't unwrap more than we have
        if (wstETHToUnwrap > wstETHBalance) {
            wstETHToUnwrap = wstETHBalance;
        }
        
        // Unwrap wstETH to stETH
        uint256 stETHReceived = wstETH.unwrap(wstETHToUnwrap);
        
        // For wstETH, there's no exit gain fee
        return (stETHReceived, 0);
    }
    
    /**
     * @notice Get total underlying stETH value for a vault's wstETH position
     * @param vault The vault address
     * @return The total underlying stETH value
     * @dev According to design.md: totalUnderlying returns the stETH value using protocol's native exchange rate
     */
    function totalUnderlying(address vault) external view override returns (uint256) {
        // Get wstETH balance of the vault
        uint256 wstETHBalance = wstETH.balanceOf(vault);
        
        if (wstETHBalance == 0) {
            return 0;
        }
        
        // Convert wstETH to stETH value using protocol's native exchange rate
        // This matches design.md: IWstETH.getStETHByWstETH(wstETH.balanceOf(vault))
        return wstETH.getStETHByWstETH(wstETHBalance);
    }
    
    /**
     * @notice Preview investment without executing (view function)
     * @param asset The asset to invest (should be stETH)
     * @param amountIn The amount of stETH to invest
     * @return accounted The amount that would be accounted for
     * @return entryGain The entry gain (0 for wstETH)
     */
    function previewInvest(
        address asset,
        uint256 amountIn
    ) external view override returns (uint256 accounted, uint256 entryGain) {
        require(asset == address(stETH), "WstETHStrategy: Asset must be stETH");
        
        // For wstETH, we wrap stETH at a 1:1 accounting basis
        // The actual wstETH amount received will be less due to the rebasing mechanism,
        // but we account for the full stETH value as that's what will be returned at unwrap
        // wstETH is a wrapped yield-bearing asset, so there's no entry gain
        return (amountIn, 0);
    }
}