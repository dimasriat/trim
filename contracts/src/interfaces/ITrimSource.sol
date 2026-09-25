// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITrimSource {
    function deviation() external view returns (uint256);

    function deviationAfter(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) external view returns (uint256);

    function fairAmountOut(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256);

    function fairAmountIn(address tokenIn, address tokenOut, uint256 amountOut) external view returns (uint256);
}
