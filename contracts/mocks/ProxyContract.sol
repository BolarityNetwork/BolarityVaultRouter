// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVault {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
}

contract ProxyContract {
    address public vault;
    
    constructor(address _vault) {
        vault = _vault;
    }
    
    function callDeposit(address token, uint256 amount) external returns (uint256) {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        IERC20(token).approve(vault, amount);
        return IVault(vault).deposit(amount, msg.sender);
    }
}