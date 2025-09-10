// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockComptroller {
    mapping(address => bool) public markets;
    
    function enterMarkets(address[] memory cTokens) external returns (uint256[] memory) {
        uint256[] memory results = new uint256[](cTokens.length);
        for (uint256 i = 0; i < cTokens.length; i++) {
            markets[cTokens[i]] = true;
            results[i] = 0; // Success
        }
        return results;
    }
    
    function exitMarket(address cToken) external returns (uint256) {
        markets[cToken] = false;
        return 0; // Success
    }
    
    function checkMembership(address account, address cToken) external view returns (bool) {
        return markets[cToken];
    }
}