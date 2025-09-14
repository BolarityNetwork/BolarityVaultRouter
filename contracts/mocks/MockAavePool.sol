// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./MockAaveDataProvider.sol";

contract MockAavePool {
    mapping(address => mapping(address => uint256)) public deposits;
    mapping(address => address) public aTokens;
    MockPoolDataProvider public poolDataProvider;
    
    // Simple mock pool that receives tokens via transferFrom
    // Used for testing purposes only
    
    constructor() {
        poolDataProvider = new MockPoolDataProvider();
    }
    
    function initReserve(address asset, address aToken) external {
        aTokens[asset] = aToken;
        poolDataProvider.setATokenAddress(asset, aToken);
    }
    
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 /* referralCode */
    ) external {
        // Transfer tokens from caller to the aToken contract (not this pool)
        // This allows the aToken to properly track underlying for gain/loss simulation
        if (aTokens[asset] != address(0)) {
            IERC20(asset).transferFrom(msg.sender, aTokens[asset], amount);
            MockAToken(aTokens[asset]).mint(onBehalfOf, amount);
        } else {
            // If no aToken configured, transfer to pool
            IERC20(asset).transferFrom(msg.sender, address(this), amount);
        }
        
        // Track deposits for the beneficiary
        deposits[asset][onBehalfOf] += amount;
    }
    
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256) {
        // Check and decrease the deposit balance
        // For testing purposes with gains/losses, we need to be more flexible
        // The aToken balance is the real source of truth for what can be withdrawn
        if (aTokens[asset] != address(0)) {
            // Check aToken balance instead of deposits mapping when aToken exists
            uint256 aTokenBalance = MockAToken(aTokens[asset]).balanceOf(msg.sender);
            require(aTokenBalance >= amount, "Insufficient aToken balance");
            // Adjust deposits mapping to reflect the withdrawal
            if (deposits[asset][msg.sender] > amount) {
                deposits[asset][msg.sender] -= amount;
            } else {
                deposits[asset][msg.sender] = 0;
            }
        } else {
            require(deposits[asset][msg.sender] >= amount, "Insufficient deposit");
            deposits[asset][msg.sender] -= amount;
        }
        
        // Transfer tokens from aToken contract if configured
        if (aTokens[asset] != address(0)) {
            // Burn aTokens and transfer underlying
            MockAToken(aTokens[asset]).burnAndTransfer(msg.sender, amount, to);
        } else {
            // Transfer tokens from pool if no aToken
            IERC20(asset).transfer(to, amount);
        }
        
        return amount;
    }
    
    function getDeposit(address asset, address user) external view returns (uint256) {
        return deposits[asset][user];
    }
}