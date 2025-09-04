// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IRegistry.sol";
import "./interfaces/IBolarityVault.sol";
import "./interfaces/IVaultFactory.sol";

contract BolarityRouter is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    IRegistry public immutable registry;
    IVaultFactory public immutable factory;

    event Deposited(
        address indexed asset,
        bytes32 indexed market,
        address indexed receiver,
        uint256 assets,
        uint256 shares
    );
    
    event Withdrawn(
        address indexed asset,
        bytes32 indexed market,
        address indexed receiver,
        uint256 assets,
        uint256 shares
    );
    
    event Redeemed(
        address indexed asset,
        bytes32 indexed market,
        address indexed receiver,
        uint256 shares,
        uint256 assets
    );
    
    event EmergencyWithdraw(
        address indexed asset,
        bytes32 indexed market,
        uint256 amount
    );

    constructor(address _registry, address _factory) Ownable(msg.sender) {
        require(_registry != address(0), "BolarityRouter: Invalid registry");
        require(_factory != address(0), "BolarityRouter: Invalid factory");
        registry = IRegistry(_registry);
        factory = IVaultFactory(_factory);
    }

    // Deposit to a specific vault
    function depositToVault(
        address asset,
        bytes32 market,
        uint256 assets,
        address receiver
    ) external nonReentrant whenNotPaused returns (uint256 shares) {
        address vault = _getVault(asset, market);
        
        IERC20(asset).safeTransferFrom(msg.sender, address(this), assets);
        IERC20(asset).safeIncreaseAllowance(vault, assets);
        
        shares = IBolarityVault(vault).deposit(assets, receiver);
        
        emit Deposited(asset, market, receiver, assets, shares);
    }

    // Deposit to preferred vault
    function depositToPreferredVault(
        address asset,
        uint256 assets,
        address receiver
    ) external nonReentrant whenNotPaused returns (uint256 shares) {
        bytes32 market = registry.getPreferredMarket(asset);
        require(market != bytes32(0), "BolarityRouter: No preferred market");
        
        address vault = _getVault(asset, market);
        
        IERC20(asset).safeTransferFrom(msg.sender, address(this), assets);
        IERC20(asset).safeIncreaseAllowance(vault, assets);
        
        shares = IBolarityVault(vault).deposit(assets, receiver);
        
        emit Deposited(asset, market, receiver, assets, shares);
    }

    // Withdraw from a specific vault
    function withdrawFromVault(
        address asset,
        bytes32 market,
        uint256 assets,
        address receiver,
        address owner
    ) external nonReentrant whenNotPaused returns (uint256 shares) {
        address vault = _getVault(asset, market);
        
        // If owner != msg.sender, router needs approval from owner
        // Otherwise, owner can withdraw their own shares directly
        if (owner == msg.sender) {
            shares = IBolarityVault(vault).withdraw(assets, receiver, msg.sender);
        } else {
            // This path requires the owner to have approved the router
            shares = IBolarityVault(vault).withdraw(assets, receiver, owner);
        }
        
        emit Withdrawn(asset, market, receiver, assets, shares);
    }

    // Redeem shares from a specific vault
    function redeemFromVault(
        address asset,
        bytes32 market,
        uint256 shares,
        address receiver,
        address owner
    ) external nonReentrant whenNotPaused returns (uint256 assets) {
        address vault = _getVault(asset, market);
        
        // If owner != msg.sender, router needs approval from owner
        // Otherwise, owner can redeem their own shares directly
        if (owner == msg.sender) {
            assets = IBolarityVault(vault).redeem(shares, receiver, msg.sender);
        } else {
            // This path requires the owner to have approved the router
            assets = IBolarityVault(vault).redeem(shares, receiver, owner);
        }
        
        emit Redeemed(asset, market, receiver, shares, assets);
    }

    // Batch deposit to multiple vaults
    function depositMultiple(
        address[] calldata assets,
        bytes32[] calldata markets,
        uint256[] calldata amounts,
        address receiver
    ) external nonReentrant whenNotPaused {
        require(
            assets.length == markets.length && assets.length == amounts.length,
            "BolarityRouter: Array length mismatch"
        );
        
        for (uint256 i = 0; i < assets.length; i++) {
            address vault = _getVault(assets[i], markets[i]);
            
            IERC20(assets[i]).safeTransferFrom(msg.sender, address(this), amounts[i]);
            IERC20(assets[i]).safeIncreaseAllowance(vault, amounts[i]);
            
            uint256 shares = IBolarityVault(vault).deposit(amounts[i], receiver);
            
            emit Deposited(assets[i], markets[i], receiver, amounts[i], shares);
        }
    }

    // Batch withdraw from multiple vaults
    function withdrawMultiple(
        address[] calldata assets,
        bytes32[] calldata markets,
        uint256[] calldata amounts,
        address receiver,
        address owner
    ) external nonReentrant whenNotPaused {
        require(
            assets.length == markets.length && assets.length == amounts.length,
            "BolarityRouter: Array length mismatch"
        );
        
        for (uint256 i = 0; i < assets.length; i++) {
            address vault = _getVault(assets[i], markets[i]);
            
            uint256 shares;
            // If owner == msg.sender, withdraw directly
            // Otherwise requires approval
            if (owner == msg.sender) {
                shares = IBolarityVault(vault).withdraw(amounts[i], receiver, msg.sender);
            } else {
                shares = IBolarityVault(vault).withdraw(amounts[i], receiver, owner);
            }
            
            emit Withdrawn(assets[i], markets[i], receiver, amounts[i], shares);
        }
    }

    // Emergency withdraw for owner
    function emergencyWithdrawAll(
        address asset,
        bytes32 market,
        address receiver
    ) external onlyOwner {
        address vault = _getVault(asset, market);
        
        uint256 balance = IBolarityVault(vault).balanceOf(address(this));
        if (balance > 0) {
            uint256 assets = IBolarityVault(vault).redeem(balance, receiver, address(this));
            emit EmergencyWithdraw(asset, market, assets);
        }
    }

    // Pause/unpause functions
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // View functions
    function getVault(address asset, bytes32 market) external view returns (address) {
        return registry.getVault(asset, market);
    }

    function getUserBalance(address asset, bytes32 market, address user) external view returns (uint256) {
        address vault = registry.getVault(asset, market);
        if (vault == address(0)) return 0;
        return IBolarityVault(vault).balanceOf(user);
    }

    function getTotalAssets(address asset, bytes32 market) external view returns (uint256) {
        address vault = registry.getVault(asset, market);
        if (vault == address(0)) return 0;
        return IBolarityVault(vault).totalAssets();
    }

    function previewDeposit(
        address asset,
        bytes32 market,
        uint256 assets
    ) external view returns (uint256 shares) {
        address vault = registry.getVault(asset, market);
        if (vault == address(0)) return 0;
        return IBolarityVault(vault).previewDeposit(assets);
    }

    function previewWithdraw(
        address asset,
        bytes32 market,
        uint256 assets
    ) external view returns (uint256 shares) {
        address vault = registry.getVault(asset, market);
        if (vault == address(0)) return 0;
        return IBolarityVault(vault).previewWithdraw(assets);
    }

    function previewMint(
        address asset,
        bytes32 market,
        uint256 shares
    ) external view returns (uint256 assets) {
        address vault = registry.getVault(asset, market);
        if (vault == address(0)) return 0;
        return IBolarityVault(vault).previewMint(shares);
    }

    function previewRedeem(
        address asset,
        bytes32 market,
        uint256 shares
    ) external view returns (uint256 assets) {
        address vault = registry.getVault(asset, market);
        if (vault == address(0)) return 0;
        return IBolarityVault(vault).previewRedeem(shares);
    }

    // Internal functions
    function _getVault(address asset, bytes32 market) internal view returns (address) {
        address vault = registry.getVault(asset, market);
        require(vault != address(0), "BolarityRouter: Vault not found");
        return vault;
    }
}