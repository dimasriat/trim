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

contract TrimBalancedVault is ITrimSource, Ownable {
    using SafeERC20 for IERC20;

    error TrimWrongDirection();
    error TrimOvershoot();
    error TrimOrderMakerMismatch(address maker);

    uint256 public constant TOLERANCE = 0.01e18;

    IAaveOracle public immutable oracle;
    IAqua public immutable aqua;
    address public immutable router;
    IERC20 public immutable tokenX;
    IERC20 public immutable tokenY;
    uint256 immutable unitX;
    uint256 immutable unitY;

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

    function deviation() external view returns (uint256) {
        (uint256 valueX, uint256 valueY) = _values(tokenX.balanceOf(address(this)), tokenY.balanceOf(address(this)));
        uint256 current = _deviation(valueX, valueY);
        return current < TOLERANCE ? 0 : current;
    }

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

    function fairAmountOut(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256) {
        (uint256 priceIn, uint256 unitIn, uint256 priceOut, uint256 unitOut) = _pricing(tokenIn, tokenOut);
        return amountIn * priceIn * unitOut / (priceOut * unitIn);
    }

    function fairAmountIn(address tokenIn, address tokenOut, uint256 amountOut) external view returns (uint256) {
        (uint256 priceIn, uint256 unitIn, uint256 priceOut, uint256 unitOut) = _pricing(tokenIn, tokenOut);
        return Math.ceilDiv(amountOut * priceOut * unitIn, priceIn * unitOut);
    }

    function _pricing(address tokenIn, address tokenOut) internal view returns (uint256, uint256, uint256, uint256) {
        bool sellsX = _sellsX(tokenIn, tokenOut);
        uint256 priceX = oracle.getAssetPrice(address(tokenX));
        uint256 priceY = oracle.getAssetPrice(address(tokenY));
        return sellsX ? (priceY, unitY, priceX, unitX) : (priceX, unitX, priceY, unitY);
    }

    function _sellsX(address tokenIn, address tokenOut) internal view returns (bool) {
        if (tokenIn == address(tokenY) && tokenOut == address(tokenX)) return true;
        require(tokenIn == address(tokenX) && tokenOut == address(tokenY), TrimWrongDirection());
        return false;
    }

    function _values(uint256 balanceX, uint256 balanceY) internal view returns (uint256, uint256) {
        return (
            balanceX * oracle.getAssetPrice(address(tokenX)) / unitX,
            balanceY * oracle.getAssetPrice(address(tokenY)) / unitY
        );
    }

    function _deviation(uint256 valueX, uint256 valueY) internal pure returns (uint256) {
        uint256 total = valueX + valueY;
        if (total == 0) return 0;
        uint256 gap = valueX > valueY ? valueX - valueY : valueY - valueX;
        return gap * 1e18 / total;
    }
}
