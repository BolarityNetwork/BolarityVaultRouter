// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVault {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function mint(uint256 shares, address receiver) external returns (uint256 assets);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function crystallizeFees() external;
}

contract MaliciousContract {
    address public vault;
    
    constructor(address _vault) {
        vault = _vault;
    }
    
    function attemptDeposit(address token, uint256 amount) external returns (uint256) {
        IERC20(token).approve(vault, amount);
        return IVault(vault).deposit(amount, address(this));
    }
    
    function attemptWithdraw(uint256 amount, address receiver, address owner) external returns (uint256) {
        return IVault(vault).withdraw(amount, receiver, owner);
    }
    
    function attemptMint(address token, uint256 shares) external returns (uint256) {
        IERC20(token).approve(vault, type(uint256).max);
        return IVault(vault).mint(shares, address(this));
    }
    
    function attemptRedeem(uint256 shares, address receiver, address owner) external returns (uint256) {
        return IVault(vault).redeem(shares, receiver, owner);
    }
    
    function attemptCrystallizeFees() external {
        IVault(vault).crystallizeFees();
    }
}