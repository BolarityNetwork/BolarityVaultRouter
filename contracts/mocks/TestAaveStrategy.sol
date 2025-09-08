// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../strategies/AaveStrategy.sol";

/**
 * @title TestAaveStrategy
 * @notice Test-specific AaveStrategy that can track deposits for testing
 * @dev Only for testing purposes - uses MockAavePool's getDeposit function
 */
contract TestAaveStrategy is AaveStrategy {
    constructor(address _aavePool, address _poolDataProvider) AaveStrategy(_aavePool, _poolDataProvider) {}

    /**
     * @notice Override totalUnderlying to work with MockAavePool for testing
     */
    function totalUnderlying(address vault) external view override returns (uint256) {
        // For testing, check MockAavePool's deposits
        try IBolarityVault(vault).asset() returns (address asset) {
            try IMockAavePool(address(aavePool)).getDeposit(asset, vault) returns (uint256 deposited) {
                return deposited;
            } catch {
                return 0;
            }
        } catch {
            return 0;
        }
    }
}

// Interfaces for testing
interface IMockAavePool {
    function getDeposit(address asset, address user) external view returns (uint256);
}