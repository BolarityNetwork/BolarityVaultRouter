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
import "./interfaces/IBolarityRouter.sol";

contract BolarityRouter is IBolarityRouter, ReentrancyGuard, Pausable, Ownable {
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

    // -------- Write (with data) --------
    function deposit(
        address asset,
        bytes32 market,
        uint256 assets,
        address receiver,
        bytes calldata data
    ) external override nonReentrant whenNotPaused returns (uint256 shares) {
        address vault = _getVault(asset, market);
        
        // Transfer tokens to router first, then approve vault
        IERC20(asset).safeTransferFrom(msg.sender, address(this), assets);
        IERC20(asset).safeIncreaseAllowance(vault, assets);
        
        // Call depositWithData on vault
        shares = IBolarityVault(vault).depositWithData(assets, receiver, data);
        
        emit Deposited(asset, market, receiver, assets, shares);
    }

    function withdraw(
        address asset,
        bytes32 market,
        uint256 assets,
        address receiver,
        address owner,
        bytes calldata data
    ) external override nonReentrant whenNotPaused returns (uint256 shares) {
        address vault = _getVault(asset, market);
        
        // Security check: Only allow msg.sender to withdraw their own funds or with proper approval
        require(owner == msg.sender || IBolarityVault(vault).allowance(owner, msg.sender) > 0, "BolarityRouter: Owner must be msg.sender");
        
        // Call withdrawWithData with the owner parameter
        // If owner == msg.sender, user withdraws their own shares
        // If owner != msg.sender, requires owner's approval to the router
        shares = IBolarityVault(vault).withdrawWithData(assets, receiver, owner, data);
        
        emit Withdrawn(asset, market, receiver, assets, shares);
    }

    function mint(
        address asset,
        bytes32 market,
        uint256 shares,
        address receiver,
        bytes calldata data
    ) external override nonReentrant whenNotPaused returns (uint256 assets) {
        address vault = _getVault(asset, market);
        
        // Get required assets for shares
        assets = IBolarityVault(vault).previewMint(shares);
        
        // Transfer tokens to router first, then approve vault
        IERC20(asset).safeTransferFrom(msg.sender, address(this), assets);
        IERC20(asset).safeIncreaseAllowance(vault, assets);
        
        // Call mintWithData on vault
        uint256 actualAssets = IBolarityVault(vault).mintWithData(shares, receiver, data);
        require(actualAssets <= assets, "BolarityRouter: Slippage");
        
        emit Deposited(asset, market, receiver, actualAssets, shares);
        return actualAssets;
    }

    function redeem(
        address asset,
        bytes32 market,
        uint256 shares,
        address receiver,
        address owner,
        bytes calldata data
    ) external override nonReentrant whenNotPaused returns (uint256 assets) {
        address vault = _getVault(asset, market);
        
        // Security check: Only allow msg.sender to redeem their own shares or with proper approval
        require(owner == msg.sender || IBolarityVault(vault).allowance(owner, msg.sender) > 0, "BolarityRouter: Owner must be msg.sender");
        
        // Call redeemWithData with the owner parameter
        // If owner == msg.sender, user redeems their own shares
        // If owner != msg.sender, requires owner's approval to the router
        assets = IBolarityVault(vault).redeemWithData(shares, receiver, owner, data);
        
        emit Redeemed(asset, market, receiver, shares, assets);
    }

    // -------- Read (unchanged) --------
    function vaultFor(address asset, bytes32 market) external view override returns (address) {
        return registry.getVault(asset, market);
    }

    function previewDeposit(
        address asset,
        bytes32 market,
        uint256 assets
    ) external view override returns (uint256 shares) {
        address vault = registry.getVault(asset, market);
        if (vault == address(0)) return 0;
        return IBolarityVault(vault).previewDeposit(assets);
    }

    function previewWithdraw(
        address asset,
        bytes32 market,
        uint256 assets
    ) external view override returns (uint256 shares) {
        address vault = registry.getVault(asset, market);
        if (vault == address(0)) return 0;
        
        // Handle max withdraw preview
        if (assets == type(uint256).max) {
            // For max withdraw, return all shares of the caller
            return IBolarityVault(vault).balanceOf(msg.sender);
        }
        
        return IBolarityVault(vault).previewWithdraw(assets);
    }

    function previewMint(
        address asset,
        bytes32 market,
        uint256 shares
    ) external view override returns (uint256 assets) {
        address vault = registry.getVault(asset, market);
        if (vault == address(0)) return 0;
        return IBolarityVault(vault).previewMint(shares);
    }

    function previewRedeem(
        address asset,
        bytes32 market,
        uint256 shares
    ) external view override returns (uint256 assets) {
        address vault = registry.getVault(asset, market);
        if (vault == address(0)) return 0;
        
        // Handle max redeem preview
        if (shares == type(uint256).max) {
            // For max redeem, calculate assets for all shares of the caller
            uint256 allShares = IBolarityVault(vault).balanceOf(msg.sender);
            if (allShares == 0) return 0;
            return IBolarityVault(vault).previewRedeem(allShares);
        }
        
        return IBolarityVault(vault).previewRedeem(shares);
    }

    // Admin functions for emergency and testing
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

    function withdrawMultiple(
        address[] calldata assets,
        bytes32[] calldata markets,
        uint256[] calldata amounts,
        address receiver,
        address owner
    ) external nonReentrant whenNotPaused {
        uint256 length = assets.length;
        require(
            length == markets.length && length == amounts.length,
            "BolarityRouter: Array length mismatch"
        );
        
        // Security check: Only allow msg.sender to withdraw their own funds
        require(owner == msg.sender, "BolarityRouter: Owner must be msg.sender");
        
        // Cache msg.sender to avoid multiple CALLER opcodes
        address sender = msg.sender;
        bool isOwner = owner == sender;
        
        // Use unchecked for loop index increment to save gas
        for (uint256 i; i < length; ) {
            address vault = _getVault(assets[i], markets[i]);
            
            // Avoid conditional branching by directly passing the correct owner
            uint256 shares = IBolarityVault(vault).withdraw(
                amounts[i], 
                receiver, 
                isOwner ? sender : owner
            );
            
            emit Withdrawn(assets[i], markets[i], receiver, amounts[i], shares);
            
            unchecked {
                ++i;
            }
        }
    }

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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // Internal functions
    function _getVault(address asset, bytes32 market) internal view returns (address) {
        address vault = registry.getVault(asset, market);
        require(vault != address(0), "BolarityRouter: Vault not found");
        return vault;
    }
}