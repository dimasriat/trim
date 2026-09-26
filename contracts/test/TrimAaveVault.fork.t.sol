// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/contracts/libs/TakerTraits.sol";
import { MockTaker } from "@1inch/swap-vm/test/solidity/mocks/MockTaker.sol";

import { TrimSkew } from "../src/instructions/TrimSkew.sol";
import { TrimSwapVMRouter } from "../src/TrimSwapVMRouter.sol";
import { TrimOrders } from "../src/TrimOrders.sol";
import { TrimAaveVault } from "../src/TrimAaveVault.sol";
import { IAavePool } from "../src/interfaces/aave/IAavePool.sol";
import { IAaveOracle } from "../src/interfaces/aave/IAaveOracle.sol";

contract TrimAaveVaultForkTest is Test {
    uint256 constant FORK_BLOCK = 26_050_000;
    IAavePool constant POOL = IAavePool(0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2);
    IAaveOracle constant ORACLE = IAaveOracle(0x54586bE62E3c3580375aE3723C145253060Ca0C2);
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    uint256 constant TARGET_HF = 1.5e18;
    uint256 constant OPEN_HF = 1.6e18;
    uint16 constant MAX_DISCOUNT_BPS = 500;
    uint64 constant FULL_DEVIATION = 0.3e18;

    Aqua aqua;
    TrimSwapVMRouter router;
    TrimAaveVault vault;
    MockTaker taker;
    ISwapVM.Order order;
    address owner = makeAddr("owner");
    uint256 wethPrice;
    uint256 debtOpened;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("mainnet"), FORK_BLOCK);
        aqua = Aqua(0x499943E74FB0cE105688beeE8Ef2ABec5D936d31);
        router = new TrimSwapVMRouter(address(aqua), WETH, address(this), "Trim", "1");
        vault = new TrimAaveVault(POOL, ORACLE, aqua, address(router), WETH, USDC, TARGET_HF, owner);
        taker = new MockTaker(aqua, router, address(this));
        wethPrice = ORACLE.getAssetPrice(WETH);

        deal(WETH, owner, 10e18);
        vm.startPrank(owner);
        IERC20(WETH).approve(address(vault), 10e18);
        debtOpened = _debtForHealthFactor(10e18, OPEN_HF);
        vault.open(10e18, debtOpened);
        order = TrimOrders.build(address(vault), WETH, USDC, true, MAX_DISCOUNT_BPS, FULL_DEVIATION);
        vault.ship(order, 10e18);
        vm.stopPrank();
    }

    function test_HealthyPositionHasNoOffer() public {
        assertGt(vault.healthFactor(), TARGET_HF);

        vm.expectRevert(TrimSkew.TrimSkewOnTarget.selector);
        router.quote(order, 1_000e6, _takerData(true));
    }

    function test_FillRaisesHealthFactorTowardTarget() public {
        _dropWethPrice(80);
        uint256 hfBefore = vault.healthFactor();
        assertLt(hfBefore, TARGET_HF);

        _fill(2_000e6, true);

        uint256 hfAfter = vault.healthFactor();
        assertGt(hfAfter, hfBefore);
        assertLe(hfAfter, TARGET_HF);
    }

    function test_FillPaysDiscountAgainstOracle() public {
        _dropWethPrice(80);
        uint256 fair = vault.fairAmountOut(USDC, WETH, 2_000e6);

        (, uint256 amountOut) = _fill(2_000e6, true);

        assertGt(amountOut, fair);
        assertEq(IERC20(WETH).balanceOf(address(taker)), amountOut);
    }

    function test_OvershootingFillIsRejected() public {
        _dropWethPrice(80);

        vm.expectRevert();
        router.quote(order, debtOpened, _takerData(true));
    }

    function test_ReverseDirectionIsRejected() public {
        _dropWethPrice(80);

        vm.expectRevert(TrimAaveVault.TrimWrongDirection.selector);
        vault.deviationAfter(WETH, USDC, 1e18, 1_000e6);
    }

    function test_HooksRejectCallersOtherThanRouter() public {
        bytes32 orderHash = router.hash(order);

        vm.expectRevert(TrimAaveVault.TrimNotOwnOrder.selector);
        vault.preTransferOut(address(vault), address(taker), USDC, WETH, 1_000e6, 1e18, orderHash, "", "");
    }

    function test_HooksRejectOtherOrders() public {
        vm.prank(address(router));
        vm.expectRevert(TrimAaveVault.TrimNotOwnOrder.selector);
        vault.preTransferOut(address(vault), address(taker), USDC, WETH, 1_000e6, 1e18, keccak256("other"), "", "");
    }

    function test_FillNearLiquidationRepaysBeforeWithdrawing() public {
        _dropWethPrice(66);
        assertLt(vault.healthFactor(), 1.1e18);
        uint256 amountIn = debtOpened / 4;
        uint256 snapshot = vm.snapshotState();

        _fill(amountIn, true);
        assertGt(vault.healthFactor(), 1.1e18);

        vm.revertToState(snapshot);
        deal(USDC, address(taker), amountIn);
        vm.expectRevert();
        taker.swap(order, amountIn, _takerData(false));
    }

    function test_GasOfOneFill() public {
        _dropWethPrice(80);
        deal(USDC, address(taker), 2_000e6);
        bytes memory takerData = _takerData(true);

        uint256 gasBefore = gasleft();
        taker.swap(order, 2_000e6, takerData);
        uint256 used = gasBefore - gasleft();

        emit log_named_uint("gas of one fill", used);
        assertLt(used, 700_000);
    }

    function _fill(uint256 amountIn, bool firstTransferFromTaker) internal returns (uint256, uint256) {
        deal(USDC, address(taker), amountIn);
        return taker.swap(order, amountIn, _takerData(firstTransferFromTaker));
    }

    function _dropWethPrice(uint256 percentOfOpen) internal {
        vm.mockCall(
            address(ORACLE),
            abi.encodeCall(IAaveOracle.getAssetPrice, (WETH)),
            abi.encode(wethPrice * percentOfOpen / 100)
        );
    }

    function _debtForHealthFactor(uint256 collateral, uint256 healthFactor) internal view returns (uint256) {
        uint256 collateralBase = collateral * wethPrice / 1e18;
        uint256 debtBase = collateralBase * 8_300 * 1e18 / (10_000 * healthFactor);
        return debtBase * 1e6 / ORACLE.getAssetPrice(USDC);
    }

    function _takerData(bool firstTransferFromTaker) internal view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(taker),
            isExactIn: true,
            shouldUnwrapWeth: false,
            hasPreTransferInCallback: true,
            hasPreTransferOutCallback: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: firstTransferFromTaker,
            useTransferFromAndAquaPush: false,
            isAToB: USDC < WETH,
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
}
