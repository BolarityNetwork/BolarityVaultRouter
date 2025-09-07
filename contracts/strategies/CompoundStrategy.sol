// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IStrategy.sol";
import "../interfaces/ICompound.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title CompoundStrategy
 * @notice Stateless strategy for Compound protocol integration via delegatecall
 * @dev This contract is meant to be used via delegatecall from a vault
 */
contract CompoundStrategy is IStrategy {
    using SafeERC20 for IERC20;
    
    uint256 public constant MANTISSA = 1e18;
    
    // Mapping from underlying asset to its cToken
    mapping(address => address) public cTokens;
    
    // Owner for admin functions
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "CompoundStrategy: Not owner");
        _;
    }

    constructor() {
        owner = msg.sender; // Set deployer as owner
    }
    
    /**
     * @notice Register cToken for an asset
     * @param asset The underlying asset address
     * @param cToken The corresponding cToken address
     */
    function registerCToken(address asset, address cToken) external onlyOwner {
        require(asset != address(0), "CompoundStrategy: Invalid asset");
        require(cToken != address(0), "CompoundStrategy: Invalid cToken");
        require(ICToken(cToken).underlying() == asset, "CompoundStrategy: Mismatched underlying");
        cTokens[asset] = cToken;
    }

    /**
     * @notice Invest assets into Compound (delegatecall from vault)
     * @param asset The asset to invest
     * @param amountIn The amount to invest
     * @return accounted The amount accounted for (same as input for Compound)
     * @return entryGain No entry gain for Compound
     */
    function investDelegate(
        address asset,
        uint256 amountIn,
        bytes calldata /* data */
    ) external override returns (uint256 accounted, uint256 entryGain) {
        address cToken = cTokens[asset];
        require(cToken != address(0), "CompoundStrategy: Asset not registered");
        
        // Approve and mint cTokens
        // In delegatecall context, this = vault
        IERC20(asset).safeIncreaseAllowance(cToken, amountIn);
        uint256 mintResult = ICToken(cToken).mint(amountIn);
        require(mintResult == 0, "CompoundStrategy: Mint failed");
        
        // For Compound, there's no immediate entry gain
        return (amountIn, 0);
    }

    /**
     * @notice Withdraw assets from Compound (delegatecall from vault)
     * @param asset The asset to withdraw
     * @param amountOut The amount to withdraw
     * @return accountedOut The amount withdrawn
     * @return exitGain No exit gain for Compound
     */
    function divestDelegate(
        address asset,
        uint256 amountOut,
        bytes calldata /* data */
    ) external override returns (uint256 accountedOut, uint256 exitGain) {
        address cToken = cTokens[asset];
        require(cToken != address(0), "CompoundStrategy: Asset not registered");
        
        // Redeem underlying from Compound
        // In delegatecall context, this = vault
        uint256 redeemResult = ICToken(cToken).redeemUnderlying(amountOut);
        require(redeemResult == 0, "CompoundStrategy: Redeem failed");
        
        // For Compound, there's no exit gain fee
        return (amountOut, 0);
    }

    /**
     * @notice Emergency withdraw from Compound (delegatecall from vault)
     * @param asset The asset to withdraw
     * @param amount The amount to withdraw
     * @return withdrawn The amount actually withdrawn
     */
    function emergencyWithdrawDelegate(
        address asset,
        uint256 amount,
        bytes calldata /* data */
    ) external override returns (uint256 withdrawn) {
        address cToken = cTokens[asset];
        require(cToken != address(0), "CompoundStrategy: Asset not registered");
        
        uint256 cTokenBalance = ICToken(cToken).balanceOf(address(this));
        if (cTokenBalance > 0) {
            uint256 exchangeRate = ICToken(cToken).exchangeRateStored();
            uint256 underlyingBalance = (cTokenBalance * exchangeRate) / MANTISSA;
            
            if (underlyingBalance > 0) {
                uint256 toRedeem = amount > underlyingBalance ? underlyingBalance : amount;
                uint256 redeemResult = ICToken(cToken).redeemUnderlying(toRedeem);
                if (redeemResult == 0) {
                    withdrawn = toRedeem;
                }
            }
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
        address cToken = cTokens[asset];
        
        if (cToken == address(0)) {
            return 0;
        }
        
        // Calculate underlying balance from cToken balance
        uint256 cTokenBalance = ICToken(cToken).balanceOf(vault);
        if (cTokenBalance == 0) {
            return 0;
        }
        
        uint256 exchangeRate = ICToken(cToken).exchangeRateStored();
        return (cTokenBalance * exchangeRate) / MANTISSA;
    }
    
    /**
     * @notice Transfer ownership of the strategy
     * @param newOwner The new owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "CompoundStrategy: Invalid owner");
        owner = newOwner;
    }
}

// Interface to get asset from vault
interface IBolarityVault {
    function asset() external view returns (address);
}