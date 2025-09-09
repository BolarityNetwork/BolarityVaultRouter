// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IStrategy.sol";
import "../interfaces/IAave.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AaveStrategy
 * @notice Stateless strategy for Aave protocol integration via delegatecall
 * @dev This contract is meant to be used via delegatecall from a vault
 * Since it's called via delegatecall, it cannot rely on its own storage (like mappings)
 */
contract AaveStrategy is IStrategy {
    using SafeERC20 for IERC20;
    
    IPool public immutable aavePool;
    IPoolDataProvider public immutable poolDataProvider;
    uint16 public constant REFERRAL_CODE = 0;

    constructor(address _aavePool, address _poolDataProvider) {
        require(_aavePool != address(0), "AaveStrategy: Invalid pool");
        require(_poolDataProvider != address(0), "AaveStrategy: Invalid data provider");
        aavePool = IPool(_aavePool);
        poolDataProvider = IPoolDataProvider(_poolDataProvider);
    }

    /**
     * @notice Invest assets into Aave (delegatecall from vault)
     * @param asset The asset to invest
     * @param amountIn The amount to invest
     * @return accounted The amount accounted for (same as input for Aave)
     * @return entryGain No entry gain for Aave
     */
    function investDelegate(
        address asset,
        uint256 amountIn,
        bytes calldata /* data */
    ) external override returns (uint256 accounted, uint256 entryGain) {
        if (amountIn == 0) {
            return (0, 0);
        }
        
        // Approve and supply to Aave
        // In delegatecall context, this = vault
        IERC20(asset).safeIncreaseAllowance(address(aavePool), amountIn);
        aavePool.supply(asset, amountIn, address(this), REFERRAL_CODE);
        
        // For Aave, there's no immediate entry gain
        return (amountIn, 0);
    }

    /**
     * @notice Withdraw assets from Aave (delegatecall from vault)
     * @param asset The asset to withdraw
     * @param amountOut The amount to withdraw
     * @return accountedOut The amount withdrawn
     * @return exitGain No exit gain for Aave
     */
    function divestDelegate(
        address asset,
        uint256 amountOut,
        bytes calldata /* data */
    ) external override returns (uint256 accountedOut, uint256 exitGain) {
        if (amountOut == 0) {
            return (0, 0);
        }
        
        // Withdraw from Aave
        // In delegatecall context, this = vault
        uint256 withdrawn = aavePool.withdraw(asset, amountOut, address(this));
        
        // For Aave, there's no exit gain fee
        return (withdrawn, 0);
    }

    /**
     * @notice Emergency withdraw from Aave (delegatecall from vault)
     * @param asset The asset to withdraw
     * @param amount The amount to withdraw
     * @return withdrawn The amount actually withdrawn
     */
    function emergencyWithdrawDelegate(
        address asset,
        uint256 amount,
        bytes calldata /* data */
    ) external override returns (uint256 withdrawn) {
        if (amount == 0) {
            return 0;
        }
        
        // Try to withdraw from Aave
        // If it fails, return 0
        try aavePool.withdraw(asset, amount, address(this)) returns (uint256 withdrawnAmount) {
            return withdrawnAmount;
        } catch {
            return 0;
        }
    }

    /**
     * @notice Get total underlying assets for a vault in Aave
     * @param vault The vault address to check balance for
     * @return The total underlying assets (aToken balance) in the protocol
     * @dev Queries the aToken address from PoolDataProvider and returns the balance
     */
    function totalUnderlying(address vault) external view virtual override returns (uint256) {
        // Get the asset address from the vault
        address asset = IBolarityVault(vault).asset();
        
        // Get the aToken address from PoolDataProvider
        (address aTokenAddress, , ) = poolDataProvider.getReserveTokensAddresses(asset);
        
        // Return the aToken balance of the vault
        if (aTokenAddress != address(0)) {
            return IAToken(aTokenAddress).balanceOf(vault);
        }
        
        return 0;
    }
    
    /**
     * @notice Preview investment without executing (view function)
     * @param asset The asset to invest
     * @param amountIn The amount to invest
     * @return accounted The amount that would be accounted for
     * @return entryGain The entry gain (0 for Aave)
     */
    function previewInvest(
        address asset,
        uint256 amountIn
    ) external view override returns (uint256 accounted, uint256 entryGain) {
        // For Aave, accounted equals amountIn and there's no entry gain
        return (amountIn, 0);
    }
}

// Interface for BolarityVault to get the asset
interface IBolarityVault {
    function asset() external view returns (address);
}