// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity ^0.8.27;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { Context } from "@1inch/swap-vm/contracts/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/contracts/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/contracts/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/contracts/libs/InstructionBuilder.sol";
import { InstructionArgs } from "@1inch/swap-vm/contracts/libs/InstructionArgs.sol";

import { ITrimSource } from "../interfaces/ITrimSource.sol";

/// @title TrimSkew
/// @notice SwapVM instruction (opcode 0xb6) that prices a swap by how far the maker's position has drifted
///         from its target. The further off target, the larger the price concession the maker gives.
/// @dev Program args: source (20 bytes), maxDiscountBps (uint16), fullDeviation (uint64). Deviation is
///      read from `source` scaled by 1e18, 0 meaning on target.
///      discount = maxDiscountBps * min(deviation, fullDeviation) / fullDeviation.
library TrimSkew {
    using InstructionArgs for bytes;
    using InstructionBuilder for MemoryPtr;

    /// @notice The source reports zero deviation, so there is nothing to trim.
    error TrimSkewOnTarget();
    /// @notice The discount cap must be below 10000 bps.
    /// @param maxDiscountBps The rejected cap.
    error TrimSkewDiscountTooLarge(uint16 maxDiscountBps);
    /// @notice fullDeviation must be non-zero; it is the divisor of the discount curve.
    error TrimSkewZeroFullDeviation();

    /// @dev Opcode slot this instruction occupies in TrimSwapVMRouter's dispatch.
    Opcode constant opcode = Opcode._b6;
    uint256 constant BPS = 10_000;

    /// @dev Encoded size: instruction header plus 30 bytes of args.
    function sizeOf(address, uint16, uint64) internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 20 + 2 + 8;
    }

    /// @dev Encodes the instruction into a new bytes array.
    function build(address source, uint16 maxDiscountBps, uint64 fullDeviation) internal pure returns (bytes memory) {
        return build(MemoryPtrLib.alloc(sizeOf(source, maxDiscountBps, fullDeviation)), source, maxDiscountBps, fullDeviation).resolve();
    }

    /// @dev Writes the instruction at `ptrStart`; validates maxDiscountBps < 10000 and fullDeviation > 0.
    function build(MemoryPtr ptrStart, address source, uint16 maxDiscountBps, uint64 fullDeviation) internal pure returns (MemoryPtr ptr) {
        require(maxDiscountBps < BPS, TrimSkewDiscountTooLarge(maxDiscountBps));
        require(fullDeviation > 0, TrimSkewZeroFullDeviation());
        ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(source).push(uint256(maxDiscountBps), 2).push(uint256(fullDeviation), 8);
        ptrStart.patchLength(ptr);
    }

    /// @dev Decodes args. Does not re-check the bounds enforced by `build`.
    function parse(bytes calldata args) internal pure returns (ITrimSource source, uint16 maxDiscountBps, uint64 fullDeviation) {
        source = ITrimSource(args.at(0).asAddress());
        maxDiscountBps = args.at(20).asU16();
        fullDeviation = args.at(22).asU64();
    }

    /// @dev Linear in deviation, capped at maxDiscountBps once deviation reaches fullDeviation. Rounds down.
    function discountBps(uint256 deviation, uint16 maxDiscountBps, uint64 fullDeviation) internal pure returns (uint256) {
        return uint256(maxDiscountBps) * Math.min(deviation, fullDeviation) / fullDeviation;
    }

    /// @dev Sets the missing side of the swap in `ctx`.
    ///      A fill is priced at the average of the discount before it (d0, from `deviation()`) and after it
    ///      (d1, from `deviationAfter` at a first-pass amount priced at d0). With a linear discount this
    ///      approximates the discount integrated over the fill, so one large fill earns about what the same
    ///      size split into small fills would, instead of taking d0 on the whole amount.
    ///      Exact-in: amountOut = fair * 10000 / (10000 - (d0 + d1) / 2), fair = fairAmountOut(amountIn).
    ///      Exact-out: amountIn = ceil(fair * (10000 - (d0 + d1) / 2) / 10000), fair = fairAmountIn(amountOut).
    ///      Every division rounds in the maker's favour, including the floored average.
    ///      Reverts TrimSkewOnTarget when deviation is 0.
    function exec(Context memory ctx, bytes calldata args) internal view {
        (ITrimSource source, uint16 maxDiscountBps, uint64 fullDeviation) = parse(args);
        uint256 deviation = source.deviation();
        require(deviation > 0, TrimSkewOnTarget());
        uint256 startBps = discountBps(deviation, maxDiscountBps, fullDeviation);
        address tokenIn = ctx.query.tokenIn;
        address tokenOut = ctx.query.tokenOut;

        if (ctx.query.isExactIn) {
            uint256 fair = source.fairAmountOut(tokenIn, tokenOut, ctx.swap.amountIn);
            uint256 firstOut = fair * BPS / (BPS - startBps);
            uint256 endBps = discountBps(source.deviationAfter(tokenIn, tokenOut, ctx.swap.amountIn, firstOut), maxDiscountBps, fullDeviation);
            ctx.swap.amountOut = fair * BPS / (BPS - (startBps + endBps) / 2);
        } else {
            uint256 fair = source.fairAmountIn(tokenIn, tokenOut, ctx.swap.amountOut);
            uint256 firstIn = Math.ceilDiv(fair * (BPS - startBps), BPS);
            uint256 endBps = discountBps(source.deviationAfter(tokenIn, tokenOut, firstIn, ctx.swap.amountOut), maxDiscountBps, fullDeviation);
            ctx.swap.amountIn = Math.ceilDiv(fair * (BPS - (startBps + endBps) / 2), BPS);
        }
    }
}
