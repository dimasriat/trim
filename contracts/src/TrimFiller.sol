// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";
import { ITakerCallbacks } from "@1inch/swap-vm/contracts/interfaces/ITakerCallbacks.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/contracts/libs/TakerTraits.sol";

contract TrimFiller is ITakerCallbacks {
    using SafeERC20 for IERC20;

    error TrimFillerNotOperator();
    error TrimFillerNotRouter();

    IAqua public immutable aqua;
    ISwapVM public immutable router;
    address public immutable operator;

    constructor(IAqua aqua_, ISwapVM router_, address operator_) {
        aqua = aqua_;
        router = router_;
        operator = operator_;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, TrimFillerNotOperator());
        _;
    }

    modifier onlyRouter() {
        require(msg.sender == address(router), TrimFillerNotRouter());
        _;
    }

    function quote(ISwapVM.Order calldata order, address tokenIn, address tokenOut, uint256 amountIn)
        external
        returns (uint256, uint256)
    {
        (uint256 quotedIn, uint256 quotedOut,) = router.quote(order, amountIn, _takerData(tokenIn, tokenOut, 0));
        return (quotedIn, quotedOut);
    }

    function fill(ISwapVM.Order calldata order, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external
        onlyOperator
        returns (uint256, uint256)
    {
        (uint256 filledIn, uint256 filledOut,) = router.swap(order, amountIn, _takerData(tokenIn, tokenOut, minAmountOut));
        return (filledIn, filledOut);
    }

    function withdraw(address token, address to) external onlyOperator {
        IERC20(token).safeTransfer(to, IERC20(token).balanceOf(address(this)));
    }

    function preTransferInCallback(
        address maker,
        address,
        address tokenIn,
        address,
        uint256 amountIn,
        uint256,
        bytes32 orderHash,
        bytes calldata
    ) external onlyRouter {
        IERC20(tokenIn).forceApprove(address(aqua), amountIn);
        aqua.push(maker, address(router), orderHash, tokenIn, amountIn);
    }

    function preTransferOutCallback(address, address, address, address, uint256, uint256, bytes32, bytes calldata)
        external
        view
        onlyRouter
    { }

    function _takerData(address tokenIn, address tokenOut, uint256 minAmountOut) internal view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(this),
            isExactIn: true,
            shouldUnwrapWeth: false,
            hasPreTransferInCallback: true,
            hasPreTransferOutCallback: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: true,
            useTransferFromAndAquaPush: false,
            isAToB: tokenIn < tokenOut,
            allowPartialFill: false,
            usePermit2: false,
            threshold: minAmountOut == 0 ? bytes("") : abi.encodePacked(minAmountOut),
            to: address(0),
            deadline: 0,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: "",
            signature: ""
        }));
    }
}
