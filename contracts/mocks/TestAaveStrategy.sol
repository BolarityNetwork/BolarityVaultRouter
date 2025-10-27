// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../strategies/AaveStrategy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title TestAaveStrategy
 * @notice Test-specific AaveStrategy that can track deposits for testing
 * @dev Only for testing purposes
 */
contract TestAaveStrategy is AaveStrategy {
    constructor(address _aavePool, address _poolDataProvider) AaveStrategy(_aavePool, _poolDataProvider) {}

    /**
     * @notice Override totalUnderlying to work with MockAavePool for testing
     */
    function totalUnderlying(address vault) external view override returns (uint256) {
        // Get the asset from the vault
        try IBolarityVault(vault).asset() returns (address asset) {
            // Get the aToken address for the asset
            (address aTokenAddress,,) = poolDataProvider.getReserveTokensAddresses(asset);
            if (aTokenAddress == address(0)) {
                return 0;
            }
            // Return the vault's aToken balance (which includes any gains/losses)
            return IERC20(aTokenAddress).balanceOf(vault);
        } catch {
            return 0;
        }
    }
}