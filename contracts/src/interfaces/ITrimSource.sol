// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title ITrimSource
/// @notice What a maker exposes so the TrimSkew instruction can price fills against it.
/// @dev Deviations are scaled by 1e18; 0 means on target. Fair amounts are at oracle price, no discount.
interface ITrimSource {
    /// @notice Current distance of the maker's position from its target.
    /// @return Deviation scaled by 1e18; 0 when on target.
    function deviation() external view returns (uint256);

    /// @notice Deviation the position would have after a given fill.
    /// @dev Should revert for fills the maker does not accept, e.g. wrong direction or overshooting the target.
    /// @param tokenIn Token the maker receives.
    /// @param tokenOut Token the maker gives.
    /// @param amountIn Amount of tokenIn received.
    /// @param amountOut Amount of tokenOut given.
    /// @return Deviation after the fill, scaled by 1e18.
    function deviationAfter(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) external view returns (uint256);

    /// @notice Oracle-fair amount of tokenOut for a given amountIn.
    /// @param tokenIn Token the maker receives.
    /// @param tokenOut Token the maker gives.
    /// @param amountIn Amount of tokenIn.
    /// @return Fair amount of tokenOut, rounded down.
    function fairAmountOut(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256);

    /// @notice Oracle-fair amount of tokenIn for a given amountOut.
    /// @param tokenIn Token the maker receives.
    /// @param tokenOut Token the maker gives.
    /// @param amountOut Amount of tokenOut.
    /// @return Fair amount of tokenIn, rounded up.
    function fairAmountIn(address tokenIn, address tokenOut, uint256 amountOut) external view returns (uint256);
}
