// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockAToken is ERC20 {
    address public immutable UNDERLYING_ASSET_ADDRESS;
    
    constructor(
        address underlying,
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) {
        UNDERLYING_ASSET_ADDRESS = underlying;
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}