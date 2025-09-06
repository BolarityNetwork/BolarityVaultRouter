// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IStrategy.sol";

abstract contract BaseStrategy is IStrategy, Ownable {
    using SafeERC20 for IERC20;

    address public immutable vault;
    address public immutable override underlying;

    modifier onlyVault() {
        require(msg.sender == vault, "BaseStrategy: Only vault");
        _;
    }

    constructor(address _vault, address _underlying) Ownable(msg.sender) {
        require(_vault != address(0), "BaseStrategy: Invalid vault");
        require(_underlying != address(0), "BaseStrategy: Invalid underlying");
        vault = _vault;
        underlying = _underlying;
    }

    function invest(uint256 amount) external virtual override onlyVault {
        require(amount > 0, "BaseStrategy: Zero amount");
        IERC20(underlying).safeTransferFrom(vault, address(this), amount);
        _invest(amount);
    }

    function divest(uint256 amount) external virtual override onlyVault {
        require(amount > 0, "BaseStrategy: Zero amount");
        _divest(amount);
        IERC20(underlying).safeTransfer(vault, amount);
    }

    function emergencyWithdraw(uint256 amount) external virtual override onlyVault {
        _emergencyWithdraw(amount);
        uint256 balance = IERC20(underlying).balanceOf(address(this));
        if (balance > 0) {
            IERC20(underlying).safeTransfer(vault, balance);
        }
    }

    function totalUnderlying() external view virtual override returns (uint256);
    
    // Overloaded version with vault parameter for delegatecall
    function totalUnderlying(address) external view virtual override returns (uint256) {
        // Default implementation just returns totalUnderlying()
        return this.totalUnderlying();
    }
    
    // Default implementations for delegatecall interface
    function investDelegate(
        address,
        uint256 amountIn,
        bytes calldata
    ) external virtual override returns (uint256 accounted, uint256 entryGain) {
        // Default: no entry gain, just return amount invested
        accounted = amountIn;
        entryGain = 0;
    }
    
    function divestDelegate(
        address,
        uint256 amountOut,
        bytes calldata
    ) external virtual override returns (uint256 accountedOut, uint256 exitGain) {
        // Default: no exit gain, just return amount withdrawn
        accountedOut = amountOut;
        exitGain = 0;
    }

    function _invest(uint256 amount) internal virtual;
    
    function _divest(uint256 amount) internal virtual;
    
    function _emergencyWithdraw(uint256 amount) internal virtual;
}