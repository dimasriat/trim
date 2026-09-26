// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";
import { ITakerCallbacks } from "@1inch/swap-vm/contracts/interfaces/ITakerCallbacks.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/contracts/libs/TakerTraits.sol";

/// @title TrimFiller
/// @notice Reference taker for Trim orders: quotes and fills exact-in swaps through the SwapVM router,
///         paying the maker from its own balance via Aqua push.
/// @dev Fills are exact-in, no partial fills, taker-first transfer. Output tokens stay in this contract
///      until the operator withdraws them.
contract TrimFiller is ITakerCallbacks {
    using SafeERC20 for IERC20;

    /// @notice Caller is not the operator.
    error TrimFillerNotOperator();
    /// @notice Callback caller is not the router.
    error TrimFillerNotRouter();

    /// @notice Aqua instance used to pay makers.
    IAqua public immutable aqua;
    /// @notice SwapVM router that runs the orders.
    ISwapVM public immutable router;
    /// @notice Only account allowed to fill and withdraw.
    address public immutable operator;

    /// @param aqua_ Aqua instance.
    /// @param router_ SwapVM router.
    /// @param operator_ Operator account.
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

    /// @notice Quotes an exact-in fill of `order` without executing it.
    /// @dev Not view because router.quote is not; open to anyone.
    /// @param order SwapVM order to quote.
    /// @param tokenIn Token the filler pays.
    /// @param tokenOut Token the filler receives.
    /// @param amountIn Amount of tokenIn.
    /// @return Quoted amount in.
    /// @return Quoted amount out.
    function quote(ISwapVM.Order calldata order, address tokenIn, address tokenOut, uint256 amountIn)
        external
        returns (uint256, uint256)
    {
        (uint256 quotedIn, uint256 quotedOut,) = router.quote(order, amountIn, _takerData(tokenIn, tokenOut, 0));
        return (quotedIn, quotedOut);
    }

    /// @notice Fills `order` exact-in; reverts in the router if output is below `minAmountOut`.
    /// @dev This contract must hold `amountIn` of tokenIn; output is sent here. minAmountOut = 0 sets no threshold.
    /// @param order SwapVM order to fill.
    /// @param tokenIn Token the filler pays.
    /// @param tokenOut Token the filler receives.
    /// @param amountIn Amount of tokenIn.
    /// @param minAmountOut Minimum acceptable output.
    /// @return Amount paid in.
    /// @return Amount received.
    function fill(ISwapVM.Order calldata order, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut)
        external
        onlyOperator
        returns (uint256, uint256)
    {
        (uint256 filledIn, uint256 filledOut,) = router.swap(order, amountIn, _takerData(tokenIn, tokenOut, minAmountOut));
        return (filledIn, filledOut);
    }

    /// @notice Sends this contract's whole balance of `token` to `to`.
    /// @param token Token to withdraw.
    /// @param to Recipient.
    function withdraw(address token, address to) external onlyOperator {
        IERC20(token).safeTransfer(to, IERC20(token).balanceOf(address(this)));
    }

    /// @notice Router callback: pays `amountIn` of tokenIn to the maker's Aqua balance for this order.
    /// @dev Runs before the router checks that the maker's Aqua balance grew by amountIn.
    /// @param maker Order maker credited by the push.
    /// @param tokenIn Token paid.
    /// @param amountIn Amount paid.
    /// @param orderHash Order hash the push is credited to.
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

    /// @notice Router callback; no-op. Not requested by this filler's taker traits.
    function preTransferOutCallback(address, address, address, address, uint256, uint256, bytes32, bytes calldata)
        external
        view
        onlyRouter
    { }

    /// @dev Taker traits for an exact-in, full, taker-first fill paid by preTransferInCallback.
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
