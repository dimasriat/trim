// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";

import { ITrimSource } from "./interfaces/ITrimSource.sol";
import { IAaveOracle } from "./interfaces/aave/IAaveOracle.sol";

/// @title TrimBalancedVault
/// @notice Two-token vault that targets equal value in each token and sells its overweight token through Aqua.
/// @dev deviation = |Vx - Vy| / (Vx + Vy) at oracle prices. Deviation below TOLERANCE reads as 0, so
///      TrimSkew stops quoting. Tokens stay in the vault; Aqua balances are virtual. Uses no hooks.
contract TrimBalancedVault is ITrimSource, Ownable {
    using SafeERC20 for IERC20;

    /// @notice Tokens are not the vault's pair, or the fill buys the overweight token.
    error TrimWrongDirection();
    /// @notice The fill would make the sold token the underweight one.
    error TrimOvershoot();
    /// @notice The order's maker is not this vault.
    /// @param maker The order's maker.
    error TrimOrderMakerMismatch(address maker);

    /// @notice Deviation under this (1%, scaled by 1e18) counts as balanced.
    uint256 public constant TOLERANCE = 0.01e18;

    /// @notice Price oracle with the Aave `getAssetPrice` interface.
    IAaveOracle public immutable oracle;
    /// @notice Aqua instance the order is shipped to.
    IAqua public immutable aqua;
    /// @notice SwapVM router the order is shipped for.
    address public immutable router;
    /// @notice First token of the pair.
    IERC20 public immutable tokenX;
    /// @notice Second token of the pair.
    IERC20 public immutable tokenY;
    /// @dev 10 ** tokenX decimals.
    uint256 immutable unitX;
    /// @dev 10 ** tokenY decimals.
    uint256 immutable unitY;

    /// @param oracle_ Price oracle.
    /// @param aqua_ Aqua instance.
    /// @param router_ SwapVM router.
    /// @param tokenX_ First token.
    /// @param tokenY_ Second token.
    /// @param owner_ Owner allowed to ship orders.
    constructor(IAaveOracle oracle_, IAqua aqua_, address router_, address tokenX_, address tokenY_, address owner_)
        Ownable(owner_)
    {
        oracle = oracle_;
        aqua = aqua_;
        router = router_;
        tokenX = IERC20(tokenX_);
        tokenY = IERC20(tokenY_);
        unitX = 10 ** IERC20Metadata(tokenX_).decimals();
        unitY = 10 ** IERC20Metadata(tokenY_).decimals();
    }

    /// @notice Ships `order` to Aqua with the vault's current balances of both tokens.
    /// @param order SwapVM order whose maker must be this vault.
    /// @return Strategy hash returned by Aqua.
    function ship(ISwapVM.Order calldata order) external onlyOwner returns (bytes32) {
        require(order.maker == address(this), TrimOrderMakerMismatch(order.maker));
        tokenX.forceApprove(address(aqua), type(uint256).max);
        tokenY.forceApprove(address(aqua), type(uint256).max);
        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenX);
        tokens[1] = address(tokenY);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = tokenX.balanceOf(address(this));
        amounts[1] = tokenY.balanceOf(address(this));
        return aqua.ship(router, abi.encode(order), tokens, amounts);
    }

    /// @notice |Vx - Vy| / (Vx + Vy), scaled by 1e18; 0 when below TOLERANCE or the vault is empty.
    /// @return Current deviation.
    function deviation() external view returns (uint256) {
        (uint256 valueX, uint256 valueY) = _values(tokenX.balanceOf(address(this)), tokenY.balanceOf(address(this)));
        uint256 current = _deviation(valueX, valueY);
        return current < TOLERANCE ? 0 : current;
    }

    /// @notice Deviation after receiving `amountIn` and giving `amountOut`.
    /// @dev Reverts TrimWrongDirection unless the fill sells the overweight token, and TrimOvershoot if the
    ///      sold token would end up lighter than the other. TOLERANCE is not applied here.
    /// @param tokenIn Token received; must be the underweight one.
    /// @param tokenOut Token given; must be the overweight one.
    /// @param amountIn Amount received.
    /// @param amountOut Amount given.
    /// @return Deviation after the fill, scaled by 1e18.
    function deviationAfter(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) external view returns (uint256) {
        (uint256 valueX, uint256 valueY) = _values(tokenX.balanceOf(address(this)), tokenY.balanceOf(address(this)));
        bool sellsX = _sellsX(tokenIn, tokenOut);
        require(sellsX == (valueX > valueY), TrimWrongDirection());
        uint256 balanceX = tokenX.balanceOf(address(this));
        uint256 balanceY = tokenY.balanceOf(address(this));
        (uint256 afterX, uint256 afterY) = sellsX
            ? _values(balanceX - amountOut, balanceY + amountIn)
            : _values(balanceX + amountIn, balanceY - amountOut);
        require(sellsX ? afterX >= afterY : afterY >= afterX, TrimOvershoot());
        return _deviation(afterX, afterY);
    }

    /// @notice tokenOut worth `amountIn` of tokenIn at oracle prices, rounded down.
    /// @dev Checks only that the tokens form the pair, not which side is overweight.
    /// @param tokenIn Token received.
    /// @param tokenOut Token given.
    /// @param amountIn Amount of tokenIn.
    /// @return Amount of tokenOut.
    function fairAmountOut(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256) {
        (uint256 priceIn, uint256 unitIn, uint256 priceOut, uint256 unitOut) = _pricing(tokenIn, tokenOut);
        return amountIn * priceIn * unitOut / (priceOut * unitIn);
    }

    /// @notice tokenIn worth `amountOut` of tokenOut at oracle prices, rounded up.
    /// @dev Checks only that the tokens form the pair, not which side is overweight.
    /// @param tokenIn Token received.
    /// @param tokenOut Token given.
    /// @param amountOut Amount of tokenOut.
    /// @return Amount of tokenIn.
    function fairAmountIn(address tokenIn, address tokenOut, uint256 amountOut) external view returns (uint256) {
        (uint256 priceIn, uint256 unitIn, uint256 priceOut, uint256 unitOut) = _pricing(tokenIn, tokenOut);
        return Math.ceilDiv(amountOut * priceOut * unitIn, priceIn * unitOut);
    }

    /// @dev (priceIn, unitIn, priceOut, unitOut) for the direction.
    function _pricing(address tokenIn, address tokenOut) internal view returns (uint256, uint256, uint256, uint256) {
        bool sellsX = _sellsX(tokenIn, tokenOut);
        uint256 priceX = oracle.getAssetPrice(address(tokenX));
        uint256 priceY = oracle.getAssetPrice(address(tokenY));
        return sellsX ? (priceY, unitY, priceX, unitX) : (priceX, unitX, priceY, unitY);
    }

    /// @dev True for Y in, X out; false for X in, Y out; reverts for any other pair.
    function _sellsX(address tokenIn, address tokenOut) internal view returns (bool) {
        if (tokenIn == address(tokenY) && tokenOut == address(tokenX)) return true;
        require(tokenIn == address(tokenX) && tokenOut == address(tokenY), TrimWrongDirection());
        return false;
    }

    /// @dev Oracle value of each balance, in oracle base units.
    function _values(uint256 balanceX, uint256 balanceY) internal view returns (uint256, uint256) {
        return (
            balanceX * oracle.getAssetPrice(address(tokenX)) / unitX,
            balanceY * oracle.getAssetPrice(address(tokenY)) / unitY
        );
    }

    /// @dev |Vx - Vy| / (Vx + Vy) scaled by 1e18; 0 for an empty vault.
    function _deviation(uint256 valueX, uint256 valueY) internal pure returns (uint256) {
        uint256 total = valueX + valueY;
        if (total == 0) return 0;
        uint256 gap = valueX > valueY ? valueX - valueY : valueY - valueX;
        return gap * 1e18 / total;
    }
}
