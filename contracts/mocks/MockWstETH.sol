// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockStETH is ERC20 {
    constructor() ERC20("Mock Staked ETH", "mstETH") {
        // Mint some initial supply for testing
        _mint(msg.sender, 1000000e18);
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    // Simulate rebasing by returning balanceOf with a multiplier
    uint256 public rebaseMultiplier = 100;
    
    function setRebaseMultiplier(uint256 _multiplier) external {
        rebaseMultiplier = _multiplier;
    }
    
    function balanceOf(address account) public view override returns (uint256) {
        return (super.balanceOf(account) * rebaseMultiplier) / 100;
    }
}

contract MockWstETH is ERC20 {
    using SafeERC20 for IERC20;
    
    address public stETH;
    uint256 public stEthPerToken = 1e18; // 1:1 initially
    
    constructor(address _stETH) ERC20("Mock Wrapped stETH", "mwstETH") {
        stETH = _stETH;
    }
    
    function wrap(uint256 _stETHAmount) external returns (uint256) {
        require(_stETHAmount > 0, "MockWstETH: Zero amount");
        
        // Transfer stETH from sender
        IERC20(stETH).safeTransferFrom(msg.sender, address(this), _stETHAmount);
        
        // Calculate wstETH to mint (non-rebasing)
        uint256 wstETHAmount = (_stETHAmount * 1e18) / stEthPerToken;
        
        // Mint wstETH
        _mint(msg.sender, wstETHAmount);
        
        return wstETHAmount;
    }
    
    function unwrap(uint256 _wstETHAmount) external returns (uint256) {
        require(_wstETHAmount > 0, "MockWstETH: Zero amount");
        
        // Burn wstETH
        _burn(msg.sender, _wstETHAmount);
        
        // Calculate stETH to return
        uint256 stETHAmount = (_wstETHAmount * stEthPerToken) / 1e18;
        
        // Mint stETH if needed (for testing)
        uint256 currentBalance = IERC20(stETH).balanceOf(address(this));
        if (currentBalance < stETHAmount) {
            MockStETH(stETH).mint(address(this), stETHAmount - currentBalance);
        }
        
        // Transfer stETH back
        IERC20(stETH).safeTransfer(msg.sender, stETHAmount);
        
        return stETHAmount;
    }
    
    function getWstETHByStETH(uint256 _stETHAmount) external view returns (uint256) {
        return (_stETHAmount * 1e18) / stEthPerToken;
    }
    
    function getStETHByWstETH(uint256 _wstETHAmount) external view returns (uint256) {
        return (_wstETHAmount * stEthPerToken) / 1e18;
    }
    
    // Mock function to simulate stETH appreciation
    function increaseStEthPerToken(uint256 percentage) external {
        stEthPerToken = (stEthPerToken * (100 + percentage)) / 100;
    }
}