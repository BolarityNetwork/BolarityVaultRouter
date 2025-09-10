// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockCToken is ERC20 {
    using SafeERC20 for IERC20;
    
    address public underlying;
    uint256 public exchangeRateStored = 2e18; // 1 cToken = 2 underlying initially
    
    constructor(address _underlying, string memory _name, string memory _symbol) 
        ERC20(_name, _symbol) {
        underlying = _underlying;
    }
    
    function mint(uint256 mintAmount) external returns (uint256) {
        // Transfer underlying tokens from sender
        IERC20(underlying).safeTransferFrom(msg.sender, address(this), mintAmount);
        
        // Calculate cTokens to mint based on exchange rate
        uint256 cTokenAmount = (mintAmount * 1e18) / exchangeRateStored;
        _mint(msg.sender, cTokenAmount);
        
        return 0; // Success
    }
    
    function redeem(uint256 redeemTokens) external returns (uint256) {
        // Burn cTokens
        _burn(msg.sender, redeemTokens);
        
        // Calculate underlying to return
        uint256 underlyingAmount = (redeemTokens * exchangeRateStored) / 1e18;
        
        // Transfer underlying tokens back
        IERC20(underlying).safeTransfer(msg.sender, underlyingAmount);
        
        return 0; // Success
    }
    
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256) {
        // Calculate cTokens to burn
        uint256 cTokenAmount = (redeemAmount * 1e18) / exchangeRateStored;
        
        // Burn cTokens
        _burn(msg.sender, cTokenAmount);
        
        // Transfer underlying tokens back
        IERC20(underlying).safeTransfer(msg.sender, redeemAmount);
        
        return 0; // Success
    }
    
    function exchangeRateCurrent() external view returns (uint256) {
        return exchangeRateStored;
    }
    
    // Mock function to simulate interest accrual
    function accrueInterest() external {
        exchangeRateStored = (exchangeRateStored * 101) / 100; // 1% increase
    }
}