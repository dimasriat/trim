// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/Test.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";
import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/contracts/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/contracts/libs/TakerTraits.sol";
import { MockTaker } from "@1inch/swap-vm/test/solidity/mocks/MockTaker.sol";

import { TrimSkew } from "../src/instructions/TrimSkew.sol";
import { TrimSwapVMRouter } from "../src/TrimSwapVMRouter.sol";
import { MockTrimSource } from "./mocks/MockTrimSource.sol";

contract TrimSkewTest is Test {
    uint16 constant MAX_DISCOUNT_BPS = 500;
    uint64 constant FULL_DEVIATION = 0.3e18;
    uint256 constant BPS = 10_000;

    Aqua aqua;
    TrimSwapVMRouter router;
    TokenMock usdc;
    TokenMock weth;
    MockTrimSource source;
    MockTaker taker;
    address maker = makeAddr("maker");
    ISwapVM.Order order;

    function setUp() public {
        aqua = new Aqua();
        router = new TrimSwapVMRouter(address(aqua), address(0), address(this), "Trim", "1");
        usdc = new TokenMock("USD Coin", "USDC");
        weth = new TokenMock("Wrapped Ether", "WETH");
        source = new MockTrimSource();
        source.set(0.2e18, 1, 2000, 0);
        taker = new MockTaker(aqua, router, address(this));

        order = MakerTraitsLib.build(_makerArgs(TrimSkew.build(address(source), MAX_DISCOUNT_BPS, FULL_DEVIATION)));

        weth.mint(maker, 100e18);
        vm.startPrank(maker);
        weth.approve(address(aqua), type(uint256).max);
        aqua.ship(address(router), abi.encode(order), _pair(), _amounts(0, 100e18));
        vm.stopPrank();
    }

    function test_QuoteRevertsWhenPositionIsOnTarget() public {
        source.set(0, 1, 2000, 0);

        vm.expectRevert(TrimSkew.TrimSkewOnTarget.selector);
        router.quote(order, 1_000e18, _takerData(true));
    }

    function test_ExactInPaysDiscountOfCurrentDeviation() public view {
        (uint256 amountIn, uint256 amountOut,) = router.quote(order, 1_000e18, _takerData(true));

        uint256 discountBps = uint256(MAX_DISCOUNT_BPS) * 0.2e18 / FULL_DEVIATION;
        assertEq(amountIn, 1_000e18);
        assertEq(amountOut, 0.5e18 * BPS / (BPS - discountBps));
    }

    function test_DiscountIsCappedAtFullDeviation() public {
        source.set(0.9e18, 1, 2000, 0);

        (, uint256 amountOut,) = router.quote(order, 1_000e18, _takerData(true));

        assertEq(amountOut, 0.5e18 * BPS / (BPS - MAX_DISCOUNT_BPS));
    }

    function test_LargerFillGetsWorseAveragePrice() public {
        source.set(0.2e18, 1, 2000, 100_000e18);

        (uint256 smallIn, uint256 smallOut,) = router.quote(order, 1_000e18, _takerData(true));
        (uint256 largeIn, uint256 largeOut,) = router.quote(order, 50_000e18, _takerData(true));

        assertLt(largeOut * 1e18 / largeIn, smallOut * 1e18 / smallIn);
    }

    function test_ExactOutChargesDiscountedAmountIn() public view {
        (uint256 amountIn, uint256 amountOut,) = router.quote(order, 1e18, _takerData(false));

        uint256 discountBps = uint256(MAX_DISCOUNT_BPS) * 0.2e18 / FULL_DEVIATION;
        assertEq(amountOut, 1e18);
        assertEq(amountIn, _ceilDiv(2000e18 * (BPS - discountBps), BPS));
    }

    function test_SwapMovesTokensAtQuotedAmounts() public {
        (, uint256 quotedOut,) = router.quote(order, 1_000e18, _takerData(true));
        usdc.mint(address(taker), 1_000e18);

        (uint256 amountIn, uint256 amountOut) = taker.swap(order, 1_000e18, _takerData(true));

        assertEq(amountIn, 1_000e18);
        assertEq(amountOut, quotedOut);
        assertEq(weth.balanceOf(address(taker)), quotedOut);
        assertEq(usdc.balanceOf(maker), 1_000e18);
    }

    function _makerArgs(bytes memory program) internal view returns (MakerTraitsLib.Args memory) {
        return MakerTraitsLib.Args({
            maker: maker,
            tokenA: address(usdc),
            tokenB: address(weth),
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: true,
            usePermit2: false,
            allowZeroAmountIn: false,
            receiver: address(0),
            hasPreTransferInHook: false,
            hasPostTransferInHook: false,
            hasPreTransferOutHook: false,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: address(0),
            postTransferInData: "",
            preTransferOutTarget: address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: program
        });
    }

    function _takerData(bool isExactIn) internal view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(taker),
            isExactIn: isExactIn,
            shouldUnwrapWeth: false,
            hasPreTransferInCallback: true,
            hasPreTransferOutCallback: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: true,
            useTransferFromAndAquaPush: false,
            isAToB: true,
            allowPartialFill: false,
            usePermit2: false,
            threshold: "",
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

    function _pair() internal view returns (address[] memory tokens) {
        tokens = new address[](2);
        tokens[0] = address(usdc);
        tokens[1] = address(weth);
    }

    function _amounts(uint256 a, uint256 b) internal pure returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = a;
        amounts[1] = b;
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a + b - 1) / b;
    }
}
