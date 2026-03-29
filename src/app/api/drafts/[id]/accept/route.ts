import { NextRequest, NextResponse } from "next/server";
import {
  connectDB,
  DraftTrade,
  Position,
  TradeLog,
  IPosition,
} from "@/lib/database";
import { TradingSignal } from "@/lib/ai/types";
import { ExchangeFactory } from "@/lib/exchange/ExchangeFactory";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const startTime = Date.now();
  const requestId = `accept-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  console.log(
    `[${requestId}] 📨 POST /api/drafts/[id]/accept — request received`,
  );

  try {
    console.log(`[${requestId}] 🔗 Connecting to database...`);
    await connectDB();
    console.log(`[${requestId}] ✅ Database connected`);

    const { id } = await params;
    console.log(`[${requestId}] 🔍 Looking up draft: ${id}`);

    const draft = await DraftTrade.findById(id);
    if (!draft) {
      console.warn(`[${requestId}] ❌ Draft not found: ${id}`);
      return NextResponse.json(
        { success: false, error: "Draft not found" },
        { status: 404 },
      );
    }

    console.log(
      `[${requestId}] 📋 Draft found: id=${id}, symbol=${draft.symbol}, action=${draft.action}, status=${draft.status}, side=${draft.side}, quantity=${draft.quantity}, leverage=${draft.leverage}`,
    );

    if (draft.status !== "pending") {
      console.warn(`[${requestId}] ⚠️ Draft already ${draft.status}: ${id}`);
      return NextResponse.json(
        { success: false, error: `Draft already ${draft.status}` },
        { status: 400 },
      );
    }

    let signal: TradingSignal;
    try {
      signal = JSON.parse(draft.signalData);
      console.log(
        `[${requestId}] 📡 Parsed signal data: action=${signal.action}, symbol=${signal.symbol}`,
      );
    } catch (parseError) {
      const errMsg =
        parseError instanceof Error ? parseError.message : String(parseError);
      console.error(
        `[${requestId}] ❌ Failed to parse signalData for draft ${id}: ${errMsg}`,
      );
      console.error(
        `[${requestId}] Signal data preview: ${draft.signalData?.substring(0, 200)}`,
      );
      return NextResponse.json(
        {
          success: false,
          error: `Invalid signal data: ${errMsg}`,
        },
        { status: 500 },
      );
    }

    const side = draft.side;
    let position: IPosition | null = null;

    switch (draft.action) {
      case "BUY":
      case "SELL": {
        console.log(
          `[${requestId}] 📊 Processing ${draft.action} order for ${draft.symbol}...`,
        );

        // Check for duplicate
        const existingPos = await Position.findOne({
          symbol: draft.symbol,
          side,
          status: "open",
        });

        if (existingPos) {
          console.warn(
            `[${requestId}] ⚠️ Duplicate position found: ${side} ${draft.symbol} (positionId=${existingPos._id})`,
          );
          return NextResponse.json(
            {
              success: false,
              error: `Already have open ${side} position for ${draft.symbol}`,
            },
            { status: 400 },
          );
        }

        // Place order via exchange
        console.log(
          `[${requestId}] 🔄 Placing ${draft.action} order: symbol=${draft.symbol}, qty=${draft.quantity}, leverage=${draft.leverage}`,
        );
        const exchange = ExchangeFactory.getClient();

        let orderResult;
        try {
          orderResult = await exchange.placeOrder({
            symbol: draft.symbol,
            side: draft.action === "BUY" ? "BUY" : "SELL",
            type: "MARKET",
            quantity: draft.quantity,
            leverage: draft.leverage,
          });
          console.log(
            `[${requestId}] ✅ Order placed: orderId=${orderResult.orderId}, price=${orderResult.price}, qty=${orderResult.quantity}`,
          );
        } catch (orderError) {
          const errMsg =
            orderError instanceof Error
              ? orderError.message
              : String(orderError);
          console.error(
            `[${requestId}] ❌ Exchange order failed for ${draft.symbol}: ${errMsg}`,
          );
          throw orderError;
        }

        // Save position
        console.log(`[${requestId}] 💾 Saving position to database...`);
        try {
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
          console.log(
            `[${requestId}] ✅ Position saved: id=${position._id}, symbol=${position.symbol}, side=${position.side}`,
          );
        } catch (dbError) {
          const errMsg =
            dbError instanceof Error ? dbError.message : String(dbError);
          console.error(
            `[${requestId}] ❌ Failed to save position for ${draft.symbol}: ${errMsg}`,
          );
          throw dbError;
        }
        break;
      }

      case "CLOSE": {
        console.log(
          `[${requestId}] 🔒 Processing CLOSE for ${draft.symbol}...`,
        );
        const positions = await Position.find({
          symbol: draft.symbol,
          status: "open",
        });

        console.log(
          `[${requestId}] 📋 Found ${positions.length} open positions to close for ${draft.symbol}`,
        );

        if (positions.length === 0) {
          console.warn(
            `[${requestId}] ⚠️ No open positions found for ${draft.symbol} to close`,
          );
        }

        const exchange = ExchangeFactory.getClient();
        for (const pos of positions) {
          console.log(
            `[${requestId}] 🔄 Closing position: id=${pos._id}, symbol=${pos.symbol}, side=${pos.side}, qty=${pos.quantity}`,
          );
          try {
            await exchange.closePosition(pos.symbol, pos.orderId, pos.quantity);
            console.log(
              `[${requestId}] ✅ Exchange position closed: ${pos.symbol}`,
            );
          } catch (closeError) {
            const errMsg =
              closeError instanceof Error
                ? closeError.message
                : String(closeError);
            console.error(
              `[${requestId}] ❌ Failed to close position ${pos._id} (${pos.symbol}) on exchange: ${errMsg}`,
            );
            throw closeError;
          }

          pos.status = "closed";
          pos.closedAt = new Date();
          pos.closeReason = "Manual Accept Close";
          await pos.save();
          console.log(
            `[${requestId}] ✅ Position marked as closed in DB: ${pos._id}`,
          );
        }
        break;
      }

      case "UPDATE_SL":
      case "UPDATE_TP": {
        console.log(
          `[${requestId}] 🔄 Processing ${draft.action} for ${draft.symbol}...`,
        );
        const pos = await Position.findOne({
          symbol: draft.symbol,
          status: "open",
        });

        if (!pos) {
          console.warn(
            `[${requestId}] ⚠️ No open position found for ${draft.symbol} to update`,
          );
          break;
        }

        if (draft.stopLoss && draft.action === "UPDATE_SL") {
          console.log(
            `[${requestId}] 📉 Updating SL: ${pos.stopLossPrice} → ${draft.stopLoss}`,
          );
          pos.stopLossPrice = draft.stopLoss;
        }
        if (draft.takeProfitTargets?.[0] && draft.action === "UPDATE_TP") {
          console.log(
            `[${requestId}] 📈 Updating TP: ${pos.takeProfitPrice} → ${draft.takeProfitTargets[0]}`,
          );
          pos.takeProfitPrice = draft.takeProfitTargets[0];
        }
        await pos.save();
        console.log(`[${requestId}] ✅ Position updated: ${pos._id}`);
        break;
      }

      default:
        console.warn(`[${requestId}] ⚠️ Unhandled action: ${draft.action}`);
        return NextResponse.json(
          { success: false, error: `Unhandled action: ${draft.action}` },
          { status: 400 },
        );
    }

    // Update draft status
    console.log(`[${requestId}] 📝 Updating draft status to "accepted"...`);
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

    const duration = Date.now() - startTime;
    console.log(
      `[${requestId}] ✅ Draft accepted successfully: id=${draft._id}, action=${draft.action}, symbol=${draft.symbol}, positionId=${position?._id || "N/A"} (${duration}ms)`,
    );

    return NextResponse.json({
      success: true,
      data: { draft, position },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorName =
      error instanceof Error ? error.constructor.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error(
      `[${requestId}] ❌ UNHANDLED ERROR (${duration}ms): [${errorName}] ${errorMessage}`,
    );

    // Check for specific error types for better debugging
    if (
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("ETIMEDOUT")
    ) {
      console.error(
        `[${requestId}] 🌐 Network error detected — exchange API may be unreachable`,
      );
    }
    if (
      errorMessage.includes("MongoError") ||
      errorMessage.includes("MongooseError") ||
      errorMessage.includes("CastError")
    ) {
      console.error(
        `[${requestId}] 🗄️ Database error detected — check MongoDB connection and query`,
      );
    }
    if (
      errorMessage.includes("insufficient") ||
      errorMessage.includes("Insufficient")
    ) {
      console.error(
        `[${requestId}] 💰 Insufficient funds error — check exchange account balance`,
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        errorType: errorName,
        ...(process.env.NODE_ENV === "development" && { stack: errorStack }),
      },
      { status: 500 },
    );
  }
}
