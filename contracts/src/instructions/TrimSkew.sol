// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity ^0.8.27;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { Context } from "@1inch/swap-vm/contracts/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/contracts/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/contracts/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/contracts/libs/InstructionBuilder.sol";
import { InstructionArgs } from "@1inch/swap-vm/contracts/libs/InstructionArgs.sol";

import { ITrimSource } from "../interfaces/ITrimSource.sol";

library TrimSkew {
    using InstructionArgs for bytes;
    using InstructionBuilder for MemoryPtr;

    error TrimSkewOnTarget();
    error TrimSkewDiscountTooLarge(uint16 maxDiscountBps);
    error TrimSkewZeroFullDeviation();

    Opcode constant opcode = Opcode._b6;
    uint256 constant BPS = 10_000;

    function sizeOf(address, uint16, uint64) internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 20 + 2 + 8;
    }

    function build(address source, uint16 maxDiscountBps, uint64 fullDeviation) internal pure returns (bytes memory) {
        return build(MemoryPtrLib.alloc(sizeOf(source, maxDiscountBps, fullDeviation)), source, maxDiscountBps, fullDeviation).resolve();
    }

    function build(MemoryPtr ptrStart, address source, uint16 maxDiscountBps, uint64 fullDeviation) internal pure returns (MemoryPtr ptr) {
        require(maxDiscountBps < BPS, TrimSkewDiscountTooLarge(maxDiscountBps));
        require(fullDeviation > 0, TrimSkewZeroFullDeviation());
        ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(source).push(uint256(maxDiscountBps), 2).push(uint256(fullDeviation), 8);
        ptrStart.patchLength(ptr);
    }

    function parse(bytes calldata args) internal pure returns (ITrimSource source, uint16 maxDiscountBps, uint64 fullDeviation) {
        source = ITrimSource(args.at(0).asAddress());
        maxDiscountBps = args.at(20).asU16();
        fullDeviation = args.at(22).asU64();
    }

    function discountBps(uint256 deviation, uint16 maxDiscountBps, uint64 fullDeviation) internal pure returns (uint256) {
        return uint256(maxDiscountBps) * Math.min(deviation, fullDeviation) / fullDeviation;
    }

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
