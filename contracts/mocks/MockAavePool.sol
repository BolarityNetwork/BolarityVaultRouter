// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockAavePool {
    mapping(address => mapping(address => uint256)) public deposits;
    
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 /* referralCode */
    ) external {
        deposits[asset][onBehalfOf] += amount;
    }
    
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256) {
        deposits[asset][msg.sender] -= amount;
        return amount;
    }
}