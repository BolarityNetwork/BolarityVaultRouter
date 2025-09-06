// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IStrategy.sol";
import "../interfaces/IAave.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract AaveStrategy is IStrategy {
    IPool public immutable aavePool;
    uint16 public constant REFERRAL_CODE = 0;
    
    // Mapping from underlying asset to its aToken
    mapping(address => address) public aTokens;
    
    // Owner for admin functions (set by factory)
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
    
    // Admin function to register aToken for an asset
    function registerAToken(address asset, address aToken) external onlyOwner {
        require(asset != address(0), "AaveStrategy: Invalid asset");
        require(aToken != address(0), "AaveStrategy: Invalid aToken");
        require(IAToken(aToken).UNDERLYING_ASSET_ADDRESS() == asset, "AaveStrategy: Mismatched underlying");
        aTokens[asset] = aToken;
    }

    // Legacy methods for backward compatibility (will be called via delegatecall from vault)
    function underlying() external view override returns (address) {
        // In delegatecall context, this will be the vault's underlying
        // Implementation depends on vault's asset() method
        return address(0); // This won't be used in delegatecall context
    }

    function totalUnderlying() external view override returns (uint256) {
        // Legacy method - delegates to the new method
        return this.totalUnderlying(address(this));
    }

    function invest(uint256 amount) external override {
        // This will be called in delegatecall context
        // We need to get the asset from the calling vault context
        revert("AaveStrategy: Use investDelegate instead");
    }

    function divest(uint256 amount) external override {
        revert("AaveStrategy: Use divestDelegate instead");
    }

    function emergencyWithdraw(uint256 amount) external override {
        revert("AaveStrategy: Use emergency withdraw through vault");
    }

    // New delegatecall interface methods
    function investDelegate(
        address asset,
        uint256 amountIn,
        bytes calldata /* data */
    ) external override returns (uint256 accounted, uint256 entryGain) {
        require(aTokens[asset] != address(0), "AaveStrategy: Asset not registered");
        
        // Approve and supply to Aave
        IERC20(asset).approve(address(aavePool), amountIn);
        aavePool.supply(asset, amountIn, address(this), REFERRAL_CODE);
        
        // For Aave, there's no immediate entry gain
        return (amountIn, 0);
    }

    function divestDelegate(
        address asset,
        uint256 amountOut,
        bytes calldata /* data */
    ) external override returns (uint256 accountedOut, uint256 exitGain) {
        require(aTokens[asset] != address(0), "AaveStrategy: Asset not registered");
        
        // Withdraw from Aave
        aavePool.withdraw(asset, amountOut, address(this));
        
        // For Aave, there's no exit gain fee
        return (amountOut, 0);
    }

    // View method to get total underlying for a vault
    function totalUnderlying(address vault) external view override returns (uint256) {
        // Try to get the asset from the vault
        // This assumes the vault has an asset() method
        address asset = IBolarityVault(vault).asset();
        address aToken = aTokens[asset];
        
        if (aToken == address(0)) {
            return 0;
        }
        
        return IAToken(aToken).balanceOf(vault);
    }
    
    // Emergency withdraw for a specific asset
    function emergencyWithdrawAsset(address asset, uint256 amount) external {
        require(aTokens[asset] != address(0), "AaveStrategy: Asset not registered");
        
        address aToken = aTokens[asset];
        uint256 aTokenBalance = IAToken(aToken).balanceOf(address(this));
        
        if (aTokenBalance > 0) {
            uint256 toWithdraw = amount > aTokenBalance ? aTokenBalance : amount;
            aavePool.withdraw(asset, toWithdraw, address(this));
        }
    }
}

// Interface to get asset from vault
interface IBolarityVault {
    function asset() external view returns (address);
}