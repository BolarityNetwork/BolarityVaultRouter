// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./BaseStrategy.sol";
import "../interfaces/IAave.sol";

contract AaveStrategy is BaseStrategy {
    IPool public immutable aavePool;
    IAToken public immutable aToken;
    uint16 public constant REFERRAL_CODE = 0;

    constructor(
        address _vault,
        address _underlying,
        address _aavePool,
        address _aToken
    ) BaseStrategy(_vault, _underlying) {
        require(_aavePool != address(0), "AaveStrategy: Invalid pool");
        require(_aToken != address(0), "AaveStrategy: Invalid aToken");
        aavePool = IPool(_aavePool);
        aToken = IAToken(_aToken);
        
        require(aToken.UNDERLYING_ASSET_ADDRESS() == _underlying, "AaveStrategy: Mismatched underlying");
    }

    function totalUnderlying() external view override returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    function _invest(uint256 amount) internal override {
        IERC20(underlying).approve(address(aavePool), amount);
        aavePool.supply(underlying, amount, address(this), REFERRAL_CODE);
    }

    function _divest(uint256 amount) internal override {
        aavePool.withdraw(underlying, amount, address(this));
    }

    function _emergencyWithdraw(uint256 amount) internal override {
        uint256 aTokenBalance = aToken.balanceOf(address(this));
        if (aTokenBalance > 0) {
            uint256 toWithdraw = amount > aTokenBalance ? aTokenBalance : amount;
            aavePool.withdraw(underlying, toWithdraw, address(this));
        }
    }
}