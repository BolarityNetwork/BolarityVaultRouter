// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./BaseStrategy.sol";
import "../interfaces/ICompound.sol";

contract CompoundStrategy is BaseStrategy {
    ICToken public immutable cToken;
    uint256 public constant MANTISSA = 1e18;

    constructor(
        address _vault,
        address _underlying,
        address _cToken
    ) BaseStrategy(_vault, _underlying) {
        require(_cToken != address(0), "CompoundStrategy: Invalid cToken");
        cToken = ICToken(_cToken);
        
        require(cToken.underlying() == _underlying, "CompoundStrategy: Mismatched underlying");
    }

    function totalUnderlying() external view override returns (uint256) {
        uint256 cTokenBalance = cToken.balanceOf(address(this));
        uint256 exchangeRate = cToken.exchangeRateStored();
        return (cTokenBalance * exchangeRate) / MANTISSA;
    }

    function _invest(uint256 amount) internal override {
        IERC20(underlying).approve(address(cToken), amount);
        uint256 mintResult = cToken.mint(amount);
        require(mintResult == 0, "CompoundStrategy: Mint failed");
    }

    function _divest(uint256 amount) internal override {
        uint256 redeemResult = cToken.redeemUnderlying(amount);
        require(redeemResult == 0, "CompoundStrategy: Redeem failed");
    }

    function _emergencyWithdraw(uint256 amount) internal override {
        uint256 cTokenBalance = cToken.balanceOf(address(this));
        if (cTokenBalance > 0) {
            uint256 exchangeRate = cToken.exchangeRateStored();
            uint256 underlyingBalance = (cTokenBalance * exchangeRate) / MANTISSA;
            
            if (underlyingBalance > 0) {
                uint256 toRedeem = amount > underlyingBalance ? underlyingBalance : amount;
                cToken.redeemUnderlying(toRedeem);
            }
        }
    }
}