// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IWstETH
 * @notice Interface for wrapped staked ETH (wstETH) from Lido
 */
interface IWstETH is IERC20 {
    /**
     * @notice Wrap stETH to wstETH
     * @param _stETHAmount Amount of stETH to wrap
     * @return Amount of wstETH received
     */
    function wrap(uint256 _stETHAmount) external returns (uint256);
    
    /**
     * @notice Unwrap wstETH to stETH
     * @param _wstETHAmount Amount of wstETH to unwrap
     * @return Amount of stETH received
     */
    function unwrap(uint256 _wstETHAmount) external returns (uint256);
    
    /**
     * @notice Get amount of stETH for a given amount of wstETH
     * @param _wstETHAmount Amount of wstETH
     * @return Amount of stETH
     */
    function getStETHByWstETH(uint256 _wstETHAmount) external view returns (uint256);
    
    /**
     * @notice Get amount of wstETH for a given amount of stETH
     * @param _stETHAmount Amount of stETH
     * @return Amount of wstETH
     */
    function getWstETHByStETH(uint256 _stETHAmount) external view returns (uint256);
    
    /**
     * @notice Get the address of stETH token
     * @return Address of stETH token
     */
    function stETH() external view returns (address);
    
    /**
     * @notice Get current stETH per wstETH rate
     * @return Current exchange rate
     */
    function stEthPerToken() external view returns (uint256);
    
    /**
     * @notice Get current wstETH per stETH rate
     * @return Current exchange rate
     */
    function tokensPerStEth() external view returns (uint256);
}

/**
 * @title IStETH
 * @notice Interface for staked ETH (stETH) from Lido
 */
interface IStETH is IERC20 {
    /**
     * @notice Submit ETH to the pool
     * @param _referral Referral address
     * @return Amount of StETH shares generated
     */
    function submit(address _referral) external payable returns (uint256);
    
    /**
     * @notice Get the amount of shares for a given amount of stETH
     * @param _ethAmount Amount of stETH
     * @return Amount of shares
     */
    function getSharesByPooledEth(uint256 _ethAmount) external view returns (uint256);
    
    /**
     * @notice Get the amount of stETH for a given amount of shares
     * @param _sharesAmount Amount of shares
     * @return Amount of stETH
     */
    function getPooledEthByShares(uint256 _sharesAmount) external view returns (uint256);
    
    /**
     * @notice Get total pooled ETH
     * @return Total amount of pooled ETH
     */
    function getTotalPooledEther() external view returns (uint256);
    
    /**
     * @notice Get total shares
     * @return Total amount of shares
     */
    function getTotalShares() external view returns (uint256);
}