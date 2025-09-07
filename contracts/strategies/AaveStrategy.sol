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
 */
contract AaveStrategy is IStrategy {
    using SafeERC20 for IERC20;
    
    IPool public immutable aavePool;
    uint16 public constant REFERRAL_CODE = 0;
    
    // Mapping from underlying asset to its aToken
    mapping(address => address) public aTokens;
    
    // Owner for admin functions
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "AaveStrategy: Not owner");
        _;
    }

    constructor(address _aavePool) {
        require(_aavePool != address(0), "AaveStrategy: Invalid pool");
        aavePool = IPool(_aavePool);
        owner = msg.sender; // Set deployer as owner
    }
    
    /**
     * @notice Register aToken for an asset
     * @param asset The underlying asset address
     * @param aToken The corresponding aToken address
     */
    function registerAToken(address asset, address aToken) external onlyOwner {
        require(asset != address(0), "AaveStrategy: Invalid asset");
        require(aToken != address(0), "AaveStrategy: Invalid aToken");
        require(IAToken(aToken).UNDERLYING_ASSET_ADDRESS() == asset, "AaveStrategy: Mismatched underlying");
        aTokens[asset] = aToken;
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
        require(aTokens[asset] != address(0), "AaveStrategy: Asset not registered");
        
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
        require(aTokens[asset] != address(0), "AaveStrategy: Asset not registered");
        
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
        require(aTokens[asset] != address(0), "AaveStrategy: Asset not registered");
        
        address aToken = aTokens[asset];
        uint256 aTokenBalance = IAToken(aToken).balanceOf(address(this));
        
        if (aTokenBalance > 0) {
            uint256 toWithdraw = amount > aTokenBalance ? aTokenBalance : amount;
            withdrawn = aavePool.withdraw(asset, toWithdraw, address(this));
        }
        
        return withdrawn;
    }

    /**
     * @notice Get total underlying assets for a vault
     * @param vault The vault address
     * @return The total underlying assets in the protocol
     */
    function totalUnderlying(address vault) external view override returns (uint256) {
        // Get the asset from the vault
        address asset = IBolarityVault(vault).asset();
        address aToken = aTokens[asset];
        
        if (aToken == address(0)) {
            return 0;
        }
        
        // Return the aToken balance of the vault
        return IAToken(aToken).balanceOf(vault);
    }
    
    /**
     * @notice Transfer ownership of the strategy
     * @param newOwner The new owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "AaveStrategy: Invalid owner");
        owner = newOwner;
    }
}

// Interface to get asset from vault
interface IBolarityVault {
    function asset() external view returns (address);
}