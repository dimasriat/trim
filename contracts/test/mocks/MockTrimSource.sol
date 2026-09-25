// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { ITrimSource } from "../../src/interfaces/ITrimSource.sol";

contract MockTrimSource is ITrimSource {
    uint256 public currentDeviation;
    uint256 public priceNum;
    uint256 public priceDen;
    uint256 public amountInToTarget;

    function set(uint256 deviation_, uint256 priceNum_, uint256 priceDen_, uint256 amountInToTarget_) external {
        currentDeviation = deviation_;
        priceNum = priceNum_;
        priceDen = priceDen_;
        amountInToTarget = amountInToTarget_;
    }

    function deviation() external view returns (uint256) {
        return currentDeviation;
    }

    function deviationAfter(address, address, uint256 amountIn, uint256) external view returns (uint256) {
        if (amountInToTarget == 0) return currentDeviation;
        if (amountIn >= amountInToTarget) return 0;
        return currentDeviation * (amountInToTarget - amountIn) / amountInToTarget;
    }

    function fairAmountOut(address, address, uint256 amountIn) external view returns (uint256) {
        return amountIn * priceNum / priceDen;
    }

    function fairAmountIn(address, address, uint256 amountOut) external view returns (uint256) {
        return amountOut * priceDen / priceNum;
    }
}
