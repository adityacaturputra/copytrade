import { NextRequest, NextResponse } from "next/server";
import {
  connectDB,
  DraftTrade,
  Position,
  TradeLog,
  IPosition,
  buildTPTargets,
  recalculateTPAllocation,
} from "@/lib/database";
import { TradingSignal } from "@/lib/ai/types";
import { ExchangeFactory } from "@/lib/exchange/ExchangeFactory";
import { calculateRiskBasedPosition, getRiskConfig } from "@/lib/risk";

/**
 * Auto-calculate Take Profit targets based on RR (Risk-Reward) ratio.
 * Mirrors the same function in executor.ts.
 */
function autoCalculateTPFromRR(
  entryPrice: number,
  stopLoss: number,
  rr: number,
  side: "LONG" | "SHORT",
): number[] {
  const riskDistance = Math.abs(entryPrice - stopLoss);
  const direction = side === "LONG" ? 1 : -1;
  const tps: number[] = [];
  for (let i = 1; i <= rr; i++) {
    const tp = entryPrice + direction * riskDistance * i;
    tps.push(tp);
  }
  return tps;
}

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

    // Check skipNoSL — reject trades without SL if setting is enabled
    if (
      (draft.action === "BUY" || draft.action === "SELL") &&
      !draft.stopLoss
    ) {
      const riskCfg = await getRiskConfig();
      if (riskCfg.skipNoSL) {
        console.warn(
          `[${requestId}] 🚫 Rejecting draft ${id}: no stop loss and skipNoSL is enabled`,
        );
        draft.status = "rejected";
        draft.resolvedAt = new Date();
        await draft.save();
        await TradeLog.create({
          type: "draft",
          action: "rejected_no_sl",
          symbol: draft.symbol,
          details: `Trade rejected: no stop loss provided and skipNoSL is enabled`,
          result: "rejected",
        });
        return NextResponse.json(
          {
            success: false,
            error:
              "Trade rejected: no stop loss provided. Enable SL or disable 'Skip No SL' in risk settings.",
          },
          { status: 400 },
        );
      }
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

    // ─── Auto-calculate TP from RR if no TP but has entry + SL ──────────
    let bodyData: { rr?: number } = {};
    try {
      bodyData = await request.json();
    } catch {
      // Empty body is fine
    }

    const draftTps = draft.takeProfitTargets || [];
    if (
      draftTps.length === 0 &&
      draft.entryPrice &&
      draft.entryPrice > 0 &&
      draft.stopLoss
    ) {
      const riskCfg = await getRiskConfig();
      const rr = bodyData.rr || riskCfg.defaultRR || 3;
      const autoTps = autoCalculateTPFromRR(
        draft.entryPrice,
        draft.stopLoss,
        rr,
        side,
      );
      draft.takeProfitTargets = autoTps;
      console.log(
        `[${requestId}] 📐 Auto-calculated ${autoTps.length} TP targets from ${rr}RR: [${autoTps.join(", ")}]`,
      );
    }

    switch (draft.action) {
      case "BUY":
      case "SELL": {
        console.log(
          `[${requestId}] 📊 Processing ${draft.action} order for ${draft.symbol}...`,
        );

        // Check for duplicate — compare entry, TP, SL with existing open position (same channel)
        const existingPos = await Position.findOne({
          symbol: draft.symbol,
          side,
          channelId: draft.channelId || null,
          status: "open",
        });

        if (existingPos) {
          const newTP = draft.takeProfitTargets?.[0] ?? null;
          const newSL = draft.stopLoss ?? null;
          const existingTP = existingPos.takeProfitTargets?.[0]?.price ?? null;
          const existingSL = existingPos.stopLossPrice ?? null;
          const existingEntry = existingPos.entryPrice ?? null;
          const newEntry = draft.entryPrice ?? null;

          // Helper: compare two numbers with tolerance for floating point
          const numEqual = (a: number | null, b: number | null) => {
            if (a === null && b === null) return true;
            if (a === null || b === null) return false;
            return Math.abs(a - b) < 0.01;
          };

          // null entry from same channel = referring to existing position
          const entryMatch =
            newEntry === null ? true : numEqual(newEntry, existingEntry);
          const tpMatch = numEqual(newTP, existingTP);
          const slMatch = numEqual(newSL, existingSL);

          if (entryMatch && tpMatch && slMatch) {
            // Exact duplicate: same symbol, side, entry, TP, SL — reject
            console.warn(
              `[${requestId}] ⚠️ Duplicate position: ${side} ${draft.symbol} with same entry=${existingEntry}, TP=${existingTP}, SL=${existingSL} (positionId=${existingPos._id})`,
            );
            draft.status = "rejected";
            draft.resolvedAt = new Date();
            await draft.save();
            await TradeLog.create({
              type: "draft",
              action: "rejected_duplicate",
              symbol: draft.symbol,
              details: `Exact duplicate: open ${side} position exists with same entry=${existingEntry}, TP=${existingTP}, SL=${existingSL}`,
              result: "rejected",
            });
            return NextResponse.json(
              {
                success: false,
                error: `Already have open ${side} position for ${draft.symbol} with same entry, TP, and SL`,
              },
              { status: 400 },
            );
          }

          // Entry matches but TP or SL changed — update only the TP/SL
          if (entryMatch) {
            let updated = false;
            const updates: string[] = [];

            if (!tpMatch && newTP !== null) {
              const newTargets = buildTPTargets([newTP], existingPos.quantity);
              existingPos.takeProfitTargets = newTargets;
              updates.push(`TP: ${existingTP} → ${newTP}`);
              updated = true;
            }
            if (!slMatch && newSL !== null) {
              existingPos.stopLossPrice = newSL;
              updates.push(`SL: ${existingSL} → ${newSL}`);
              updated = true;
            }

            if (updated) {
              await existingPos.save();
              console.log(
                `[${requestId}] 🔄 Updated ${side} ${draft.symbol} TP/SL instead of opening duplicate: ${updates.join(", ")}`,
              );
              draft.status = "accepted";
              draft.resolvedAt = new Date();
              draft.positionId = existingPos._id.toString();
              await draft.save();
              await TradeLog.create({
                type: "draft",
                action: "accepted_updated_tp_sl",
                symbol: draft.symbol,
                details: `Existing position TP/SL updated instead of opening duplicate: ${updates.join(", ")}`,
                result: "updated",
              });
              return NextResponse.json({
                success: true,
                data: {
                  draft,
                  position: existingPos,
                  message: `Updated TP/SL on existing position instead of opening duplicate: ${updates.join(", ")}`,
                },
              });
            }

            // Entry matches but no new TP/SL to update
            console.warn(
              `[${requestId}] ⚠️ Duplicate position: ${side} ${draft.symbol} with same entry but no valid TP/SL update (positionId=${existingPos._id})`,
            );
            draft.status = "rejected";
            draft.resolvedAt = new Date();
            await draft.save();
            await TradeLog.create({
              type: "draft",
              action: "rejected_duplicate",
              symbol: draft.symbol,
              details: `Open ${side} position exists with same entry but no valid TP/SL update provided`,
              result: "rejected",
            });
            return NextResponse.json(
              {
                success: false,
                error: `Already have open ${side} position for ${draft.symbol} with same entry and no new TP/SL to update`,
              },
              { status: 400 },
            );
          }

          // Different entry price — this is a genuinely new signal, proceed
          console.log(
            `[${requestId}] ⚠️ Open ${side} ${draft.symbol} exists (entry=${existingEntry}) but draft has different entry=${newEntry} — proceeding as new order`,
          );
        }

        // ─── Risk-Based Position Sizing ─────────────────────────────────
        const entryPrice = draft.entryPrice || signal.entryPrice || 0;
        let orderQuantity = draft.quantity;
        let orderLeverage = draft.leverage;

        if (entryPrice > 0) {
          const riskCalc = await calculateRiskBasedPosition(
            entryPrice,
            draft.stopLoss || signal.stopLoss,
            side,
            draft.quantity,
            draft.leverage,
          );

          if (riskCalc.applied) {
            orderQuantity = riskCalc.quantity;
            orderLeverage = riskCalc.leverage;
            console.log(
              `[${requestId}] 🛡️ Risk management applied: qty=${orderQuantity.toFixed(6)} → ${orderQuantity}, leverage=${draft.leverage} → ${orderLeverage}`,
            );
            console.log(
              `[${requestId}] 🛡️ Risk details: balance=$${riskCalc.accountBalance.toFixed(2)}, margin=$${riskCalc.marginUsdt.toFixed(2)}, slDist=${(riskCalc.slDistancePercent * 100).toFixed(2)}%, notional=$${riskCalc.notionalSize.toFixed(2)}`,
            );
          } else {
            console.warn(
              `[${requestId}] ⚠️ Risk management skipped: ${riskCalc.skipReason}`,
            );
          }
        } else {
          console.warn(
            `[${requestId}] ⚠️ Risk management skipped: no entry price available`,
          );
        }

        // Determine order type from signal data
        const orderType = signal.orderType === "limit" ? "LIMIT" : "MARKET";
        const limitPrice = orderType === "LIMIT" ? draft.entryPrice : undefined;

        // Place order via exchange
        console.log(
          `[${requestId}] 🔄 Placing ${orderType} ${draft.action} order: symbol=${draft.symbol}, qty=${orderQuantity}, leverage=${orderLeverage}${limitPrice ? `, price=${limitPrice}` : ""}`,
        );
        const exchange = ExchangeFactory.getClient();

        // Set leverage before placing order
        try {
          await exchange.setLeverage(draft.symbol, orderLeverage);
        } catch (levErr) {
          console.warn(
            `[${requestId}] ⚠️ Failed to set leverage (may already be set): ${levErr instanceof Error ? levErr.message : String(levErr)}`,
          );
        }

        const orderSide = draft.action === "BUY" ? "BUY" : "SELL";
        const closeSide = orderSide === "BUY" ? "SELL" : "BUY";

        let orderResult;
        try {
          orderResult = await exchange.placeOrder({
            symbol: draft.symbol,
            side: orderSide,
            type: orderType,
            quantity: orderQuantity,
            price: limitPrice,
            leverage: orderLeverage,
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

        // ─── Place TP/SL via plan orders ────────────────────────────────
        const filledQty = orderResult.quantity || orderQuantity;
        const allTps = draft.takeProfitTargets || [];
        const sl = draft.stopLoss;

        // Place ALL TP targets on the exchange
        for (const tp of allTps) {
          try {
            const tpId = await exchange.placeTakeProfit(
              draft.symbol,
              tp,
              tp,
              closeSide,
              filledQty,
            );
            console.log(
              `[${requestId}] 🎯 Take Profit set at ${tp} (plan order ${tpId})`,
            );
          } catch (tpErr) {
            console.warn(
              `[${requestId}] ⚠️ Failed to place TP at ${tp}: ${tpErr instanceof Error ? tpErr.message : String(tpErr)}`,
            );
          }
        }

        if (sl) {
          try {
            const slId = await exchange.placeStopLoss(
              draft.symbol,
              sl,
              sl,
              closeSide,
              filledQty,
            );
            console.log(
              `[${requestId}] 🛑 Stop Loss set at ${sl} (plan order ${slId})`,
            );
          } catch (slErr) {
            console.warn(
              `[${requestId}] ⚠️ Failed to place SL: ${slErr instanceof Error ? slErr.message : String(slErr)}`,
            );
          }
        }

        // Save position
        // For LIMIT orders, use "pending" status since the order may not be filled yet
        // The monitor will detect when the order fills and update to "open"
        const positionStatus = orderType === "LIMIT" ? "pending" : "open";

        console.log(
          `[${requestId}] 💾 Saving position to database (status: ${positionStatus})...`,
        );
        try {
          position = await Position.create({
            symbol: draft.symbol,
            side,
            entryPrice: draft.entryPrice || orderResult.price || 0,
            quantity: orderResult.quantity || orderQuantity,
            leverage: orderLeverage,
            takeProfitTargets: buildTPTargets(
              draft.takeProfitTargets || [],
              orderResult.quantity || orderQuantity,
            ),
            stopLossPrice: draft.stopLoss || undefined,
            orderId: orderResult.orderId,
            status: positionStatus,
            channelId: draft.channelId || undefined,
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
          channelId: draft.channelId || null,
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
      case "UPDATE_TP":
      case "ADD_TP": {
        console.log(
          `[${requestId}] 🔄 Processing ${draft.action} for ${draft.symbol}...`,
        );
        const pos = await Position.findOne({
          symbol: draft.symbol,
          channelId: draft.channelId || null,
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
            `[${requestId}] 📈 Updating TP: ${pos.takeProfitTargets?.[0]?.price} → ${draft.takeProfitTargets[0]}`,
          );
          const firstPending = pos.takeProfitTargets.findIndex(
            (t: any) => t.status === "pending",
          );
          if (firstPending >= 0) {
            pos.takeProfitTargets[firstPending].price =
              draft.takeProfitTargets[0];
          } else {
            const newTargets = buildTPTargets(
              draft.takeProfitTargets,
              pos.quantity,
            );
            pos.takeProfitTargets.push(...newTargets);
          }
          // Recalculate percentages for all TPs
          pos.takeProfitTargets = recalculateTPAllocation(
            pos.takeProfitTargets,
            pos.quantity,
          );
        }

        // ADD_TP: Add new TP target(s) without replacing existing ones
        if (draft.takeProfitTargets?.length && draft.action === "ADD_TP") {
          for (const newTpPrice of draft.takeProfitTargets) {
            const alreadyExists = pos.takeProfitTargets.some(
              (t: any) => Math.abs(t.price - newTpPrice) < 0.01,
            );
            if (!alreadyExists) {
              pos.takeProfitTargets.push({
                price: newTpPrice,
                quantity: 0, // will be recalculated below
                percentage: 0,
                status: "pending",
              });
              console.log(
                `[${requestId}] ➕ Added TP: ${newTpPrice} for ${draft.symbol}`,
              );
            } else {
              console.log(
                `[${requestId}] ⚠️ TP ${newTpPrice} already exists — skipping`,
              );
            }
          }

          // Recalculate percentages & quantities for ALL TPs
          pos.takeProfitTargets = recalculateTPAllocation(
            pos.takeProfitTargets,
            pos.quantity,
          );

          // Also place TP orders on the exchange for the new targets
          const exchange = ExchangeFactory.getClient();
          const closeSide = pos.side === "LONG" ? "SELL" : "BUY";
          for (const newTpPrice of draft.takeProfitTargets) {
            try {
              const tpId = await exchange.placeTakeProfit(
                draft.symbol,
                newTpPrice,
                newTpPrice,
                closeSide,
                pos.quantity,
              );
              console.log(
                `[${requestId}] 🎯 Exchange TP placed at ${newTpPrice} (orderId: ${tpId})`,
              );
            } catch (tpErr) {
              console.warn(
                `[${requestId}] ⚠️ Failed to place TP on exchange at ${newTpPrice}: ${tpErr instanceof Error ? tpErr.message : String(tpErr)}`,
              );
            }
          }
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
