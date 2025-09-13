// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IStrategy.sol";
import "../interfaces/IComet.sol";
import "../interfaces/IBolarityVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CompoundStrategy
 * @notice Strategy for Compound V3 (Comet) protocol integration
 * @dev This contract can be used via delegatecall from a vault for investment operations
 * The storage variables (cometMarkets mapping) are only used for configuration management
 * When called via delegatecall, it uses staticcall to read its own storage
 */
contract CompoundStrategy is IStrategy, Ownable {
    using SafeERC20 for IERC20;
    
    // Mapping from asset (base token) to Comet contract address
    mapping(address => address) public cometMarkets;
    
    // Array to track all supported assets
    address[] public supportedAssets;
    mapping(address => bool) public isAssetSupported;
    
    // Events
    event CometMarketSet(address indexed asset, address indexed comet);
    event CometMarketRemoved(address indexed asset);
    
    /**
     * @notice Constructor
     * @dev Sets msg.sender as the owner who can manage Comet markets
     */
    constructor() Ownable(msg.sender) {}
    
    /**
     * @notice Set or update a Comet market for an asset
     * @param asset The base token address
     * @param comet The Comet contract address for this asset
     */
    function setCometMarket(address asset, address comet) external onlyOwner {
        require(asset != address(0), "CompoundStrategy: Invalid asset");
        require(comet != address(0), "CompoundStrategy: Invalid comet");
        
        // Verify the Comet's base token matches
        require(IComet(comet).baseToken() == asset, "CompoundStrategy: Asset mismatch");
        
        // If this is a new asset, add to supported assets array
        if (!isAssetSupported[asset]) {
            supportedAssets.push(asset);
            isAssetSupported[asset] = true;
        }
        
        cometMarkets[asset] = comet;
        emit CometMarketSet(asset, comet);
    }
    
    /**
     * @notice Remove a Comet market for an asset
     * @param asset The base token address to remove
     */
    function removeCometMarket(address asset) external onlyOwner {
        require(isAssetSupported[asset], "CompoundStrategy: Asset not supported");
        
        // Remove from mapping
        delete cometMarkets[asset];
        isAssetSupported[asset] = false;
        
        // Remove from array
        for (uint256 i = 0; i < supportedAssets.length; i++) {
            if (supportedAssets[i] == asset) {
                // Move last element to this position and pop
                supportedAssets[i] = supportedAssets[supportedAssets.length - 1];
                supportedAssets.pop();
                break;
            }
        }
        
        emit CometMarketRemoved(asset);
    }
    
    /**
     * @notice Batch set multiple Comet markets
     * @param assets Array of asset addresses
     * @param comets Array of corresponding Comet addresses
     */
    function batchSetCometMarkets(
        address[] calldata assets,
        address[] calldata comets
    ) external onlyOwner {
        require(assets.length == comets.length, "CompoundStrategy: Length mismatch");
        
        for (uint256 i = 0; i < assets.length; i++) {
            require(assets[i] != address(0), "CompoundStrategy: Invalid asset");
            require(comets[i] != address(0), "CompoundStrategy: Invalid comet");
            
            // Verify the Comet's base token matches
            require(IComet(comets[i]).baseToken() == assets[i], "CompoundStrategy: Asset mismatch");
            
            // If this is a new asset, add to supported assets array
            if (!isAssetSupported[assets[i]]) {
                supportedAssets.push(assets[i]);
                isAssetSupported[assets[i]] = true;
            }
            
            cometMarkets[assets[i]] = comets[i];
            emit CometMarketSet(assets[i], comets[i]);
        }
    }
    
    /**
     * @notice Get the Comet address for a given asset
     * @param asset The base token address
     * @return The Comet contract address
     */
    function getCometForAsset(address asset) public view returns (address) {
        address comet = cometMarkets[asset];
        require(comet != address(0), "CompoundStrategy: Unsupported asset");
        return comet;
    }
    
    /**
     * @notice Internal function to get Comet address in delegatecall context
     * @param asset The asset address
     * @return comet The Comet address
     */
    function _getCometInDelegateCall(address asset) internal view returns (address comet) {
        // In delegatecall context, we need to read the strategy address from vault's storage
        // and make a static call to get the correct Comet address
        address strategyAddress;
        assembly {
            // Strategy is at storage slot 8 in BolarityVault  
            strategyAddress := sload(8)
        }
        
        // Static call to strategy's getCometForAsset function
        (bool success, bytes memory data) = strategyAddress.staticcall(
            abi.encodeWithSelector(this.getCometForAsset.selector, asset)
        );
        require(success && data.length >= 32, "CompoundStrategy: Failed to get Comet");
        comet = abi.decode(data, (address));
        return comet;
    }
    
    /**
     * @notice Get all supported assets
     * @return Array of supported asset addresses
     */
    function getSupportedAssets() external view returns (address[] memory) {
        return supportedAssets;
    }
    
    /**
     * @notice Get count of supported assets
     * @return Number of supported assets
     */
    function getSupportedAssetsCount() external view returns (uint256) {
        return supportedAssets.length;
    }

    /**
     * @notice Invest assets into Compound V3 (delegatecall from vault)
     * @param asset The asset to invest  
     * @param amountIn The amount to invest
     * @return accounted The amount accounted for (same as input for Compound V3)
     * @return entryGain No entry gain for Compound V3
     */
    function investDelegate(
        address asset,
        uint256 amountIn,
        bytes calldata /* data */
    ) external override returns (uint256 accounted, uint256 entryGain) {
        if (amountIn == 0) {
            return (0, 0);
        }
        
        // Get the Comet for this asset in delegatecall context
        address comet = _getCometInDelegateCall(asset);
        
        // Approve and supply to Comet
        // In delegatecall context, this = vault
        IERC20(asset).safeIncreaseAllowance(comet, amountIn);
        IComet(comet).supply(asset, amountIn);
        
        // For Compound V3, there's no immediate entry gain
        return (amountIn, 0);
    }

    /**
     * @notice Withdraw assets from Compound V3 (delegatecall from vault)
     * @param asset The asset to withdraw
     * @param amountOut The amount to withdraw
     * @return accountedOut The amount withdrawn
     * @return exitGain No exit gain for Compound V3
     */
    function divestDelegate(
        address asset,
        uint256 amountOut,
        bytes calldata /* data */
    ) external override returns (uint256 accountedOut, uint256 exitGain) {
        if (amountOut == 0) {
            return (0, 0);
        }
        
        // Get the Comet for this asset in delegatecall context
        address comet = _getCometInDelegateCall(asset);
        
        // Withdraw from Compound V3
        // In delegatecall context, this = vault
        IComet(comet).withdraw(asset, amountOut);
        
        // For Compound V3, there's no exit gain fee
        return (amountOut, 0);
    }

    /**
     * @notice Emergency withdraw from Compound V3 (delegatecall from vault)
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
        
        // Get the Comet for this asset in delegatecall context
        address comet = _getCometInDelegateCall(asset);
        
        // Get current balance in Comet
        uint256 balance = IComet(comet).balanceOf(address(this));
        
        if (balance > 0) {
            uint256 toWithdraw = amount > balance ? balance : amount;
            
            // Attempt to withdraw
            try IComet(comet).withdraw(asset, toWithdraw) {
                withdrawn = toWithdraw;
            } catch {
                // If withdraw fails, return 0
                withdrawn = 0;
            }
        }
        
        return withdrawn;
    }

    /**
     * @notice Get total underlying assets for a vault in Compound V3
     * @param vault The vault address
     * @return The total underlying assets (Comet balance)
     */
    function totalUnderlying(address vault) external view override returns (uint256) {
        // Get the vault's asset directly
        address asset = IBolarityVault(vault).asset();
        
        // Get Comet for this asset
        address comet = cometMarkets[asset];
        if (comet == address(0)) {
            return 0;
        }
        
        // Return the vault's balance in Comet
        return IComet(comet).balanceOf(vault);
    }
    
    /**
     * @notice Preview investment without executing (view function)
     * @param amountIn The amount to invest
     * @return accounted The amount that would be accounted for
     * @return entryGain The entry gain (0 for Compound V3)
     */
    function previewInvest(
        address /* asset */,
        uint256 amountIn
    ) external pure override returns (uint256 accounted, uint256 entryGain) {
        // For Compound V3, supplying base tokens is a 1:1 operation
        // The protocol tracks your deposited balance and yields accumulate over time
        // There's no immediate entry gain at deposit time
        // Therefore: accounted = amountIn, entryGain = 0
        return (amountIn, 0);
    }
}