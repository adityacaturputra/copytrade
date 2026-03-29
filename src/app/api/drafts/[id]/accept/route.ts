import { NextRequest, NextResponse } from "next/server";
import {
  connectDB,
  DraftTrade,
  Position,
  TradeLog,
  IPosition,
} from "@/lib/database";
import { TradingSignal } from "@/lib/ai/types";
import { mexcPlaceOrder } from "@/lib/mexc-api";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await connectDB();
    const { id } = await params;

    const draft = await DraftTrade.findById(id);
    if (!draft) {
      return NextResponse.json(
        { success: false, error: "Draft not found" },
        { status: 404 },
      );
    }

    if (draft.status !== "pending") {
      return NextResponse.json(
        { success: false, error: `Draft already ${draft.status}` },
        { status: 400 },
      );
    }

    const signal: TradingSignal = JSON.parse(draft.signalData);
    const side = draft.side;
    let position: IPosition | null = null;

    switch (draft.action) {
      case "BUY":
      case "SELL": {
        // Check for duplicate
        const existingPos = await Position.findOne({
          symbol: draft.symbol,
          side,
          status: "open",
        });

        if (existingPos) {
          return NextResponse.json(
            {
              success: false,
              error: `Already have open ${side} position for ${draft.symbol}`,
            },
            { status: 400 },
          );
        }

        // Place order on MEXC
        const orderResult = await mexcPlaceOrder({
          symbol: draft.symbol,
          side: draft.action === "BUY" ? "BUY" : "SELL",
          type: "market",
          quantity: draft.quantity,
          leverage: draft.leverage,
        });

        // Save position
        position = await Position.create({
          symbol: draft.symbol,
          side,
          entryPrice: draft.entryPrice || orderResult.price || 0,
          quantity: orderResult.quantity || draft.quantity,
          leverage: draft.leverage,
          takeProfitPrice: draft.takeProfitTargets?.[0] || undefined,
          stopLossPrice: draft.stopLoss || undefined,
          orderId: orderResult.orderId,
          status: "open",
          messageId: draft.messageId,
          signalData: draft.signalData,
        });
        break;
      }

      case "CLOSE": {
        const positions = await Position.find({
          symbol: draft.symbol,
          status: "open",
        });

        for (const pos of positions) {
          const closeSide = pos.side === "LONG" ? "SELL" : "BUY";
          await mexcPlaceOrder({
            symbol: pos.symbol,
            side: closeSide,
            type: "market",
            quantity: pos.quantity,
          });

          pos.status = "closed";
          pos.closedAt = new Date();
          pos.closeReason = "Manual Accept Close";
          await pos.save();
        }
        break;
      }

      case "UPDATE_SL":
      case "UPDATE_TP": {
        const pos = await Position.findOne({
          symbol: draft.symbol,
          status: "open",
        });

        if (pos) {
          if (draft.stopLoss && draft.action === "UPDATE_SL") {
            pos.stopLossPrice = draft.stopLoss;
          }
          if (draft.takeProfitTargets?.[0] && draft.action === "UPDATE_TP") {
            pos.takeProfitPrice = draft.takeProfitTargets[0];
          }
          await pos.save();
        }
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unhandled action: ${draft.action}` },
          { status: 400 },
        );
    }

    // Update draft status
    draft.status = "accepted";
    draft.resolvedAt = new Date();
    draft.positionId = position?._id?.toString() || undefined;
    await draft.save();

    await TradeLog.create({
      type: "draft",
      action: `accepted_${draft.action}`,
      symbol: draft.symbol,
      details: draft.signalData,
      result: "executed",
    });

    return NextResponse.json({
      success: true,
      data: { draft, position },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
