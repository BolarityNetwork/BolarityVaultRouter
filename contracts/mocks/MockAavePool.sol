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
        // Transfer tokens from caller to this pool
        // The caller should have approved this pool
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        
        // Track deposits for the beneficiary
        deposits[asset][onBehalfOf] += amount;
        
        // Mint aTokens if configured
        if (aTokens[asset] != address(0)) {
            MockAToken(aTokens[asset]).mint(onBehalfOf, amount);
        }
    }
    
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256) {
        // Check and decrease the deposit balance
        require(deposits[asset][msg.sender] >= amount, "Insufficient deposit");
        deposits[asset][msg.sender] -= amount;
        
        // Burn aTokens if configured
        if (aTokens[asset] != address(0)) {
            MockAToken(aTokens[asset]).burn(msg.sender, amount);
        }
        
        // Transfer tokens back to the recipient
        IERC20(asset).transfer(to, amount);
        
        return amount;
    }
    
    function getDeposit(address asset, address user) external view returns (uint256) {
        return deposits[asset][user];
    }
}