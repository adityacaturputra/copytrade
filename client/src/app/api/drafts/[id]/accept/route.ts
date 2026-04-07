import { NextRequest, NextResponse } from "next/server";
import { connectDB, DraftTrade, TradeLog, Account } from "@/lib/database";
import { TradingSignal } from "@/lib/ai/types";
import {
  autoCalculateTPFromRR,
  checkDuplicatePosition,
  executeTrade,
} from "@/lib/executor";
import { getRiskConfig } from "@/lib/risk";
import {
  ExchangeFactory,
  ExchangeCredentials,
} from "@/lib/exchange/ExchangeFactory";
import { ExchangeClient } from "@/lib/exchange/types";

/**
 * Resolve exchange client for a draft based on its accountId.
 * Falls back to paper exchange if no account found.
 */
async function getExchangeForDraft(
  accountId?: string,
): Promise<ExchangeClient> {
  if (accountId) {
    const account = await Account.findById(accountId).lean();
    if (account?.exchangeData) {
      const creds: ExchangeCredentials = {
        provider: (account.tradingPlatform as any) || "paper",
        apiKey: account.exchangeData.apiKey,
        secretKey: account.exchangeData.secretKey,
        passphrase: account.exchangeData.passphrase,
        simulated: account.exchangeData.simulated,
      };
      return ExchangeFactory.getClientForAccount(creds);
    }
  }
  return ExchangeFactory.getPaperClient();
}

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const startTime = Date.now();
  const requestId = `accept-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const lp = `[${requestId}]`;

  console.log(`${lp} 📨 POST /api/drafts/[id]/accept — request received`);

  try {
    console.log(`${lp} 🔗 Connecting to database...`);
    await connectDB();
    console.log(`${lp} ✅ Database connected`);

    const { id } = await params;
    console.log(`${lp} 🔍 Looking up draft: ${id}`);

    const draft = await DraftTrade.findById(id);
    if (!draft) {
      console.warn(`${lp} ❌ Draft not found: ${id}`);
      return NextResponse.json(
        { success: false, error: "Draft not found" },
        { status: 404 },
      );
    }

    console.log(
      `${lp} 📋 Draft found: id=${id}, symbol=${draft.symbol}, action=${draft.action}, status=${draft.status}, side=${draft.side}, quantity=${draft.quantity}, leverage=${draft.leverage}`,
    );

    if (draft.status !== "pending") {
      console.warn(`${lp} ⚠️ Draft already ${draft.status}: ${id}`);
      return NextResponse.json(
        { success: false, error: `Draft already ${draft.status}` },
        { status: 400 },
      );
    }

    // ─── skipNoSL check ─────────────────────────────────────────────
    if (
      (draft.action === "BUY" || draft.action === "SELL") &&
      !draft.stopLoss
    ) {
      const riskCfg = await getRiskConfig();
      if (riskCfg.skipNoSL) {
        console.warn(
          `${lp} 🚫 Rejecting draft ${id}: no stop loss and skipNoSL is enabled`,
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

    // ─── Parse signal data ──────────────────────────────────────────
    let signal: TradingSignal;
    try {
      signal = JSON.parse(draft.signalData);
      console.log(
        `${lp} 📡 Parsed signal data: action=${signal.action}, symbol=${signal.symbol}`,
      );
    } catch (parseError) {
      const errMsg =
        parseError instanceof Error ? parseError.message : String(parseError);
      console.error(
        `${lp} ❌ Failed to parse signalData for draft ${id}: ${errMsg}`,
      );
      return NextResponse.json(
        { success: false, error: `Invalid signal data: ${errMsg}` },
        { status: 500 },
      );
    }

    // ─── Auto-calculate TP from RR if no TP but has entry + SL ──────
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
        draft.side,
      );
      draft.takeProfitTargets = autoTps;
      console.log(
        `${lp} 📐 Auto-calculated ${autoTps.length} TP targets from ${rr}RR: [${autoTps.join(", ")}]`,
      );
    }

    // ─── Dispatch by action ─────────────────────────────────────────
    const side = draft.side;
    let positionId: string | undefined;

    switch (draft.action) {
      case "BUY":
      case "SELL": {
        console.log(
          `${lp} 📊 Processing ${draft.action} order for ${draft.symbol}...`,
        );

        // ─── Duplicate check (shared with executor) ─────────────────
        const dupResult = await checkDuplicatePosition(
          draft.symbol,
          side,
          draft.channelId,
          draft.entryPrice,
          draft.takeProfitTargets || [],
          draft.stopLoss,
        );

        if (dupResult.type === "duplicate_exact") {
          console.warn(
            `${lp} ⚠️ Duplicate position: ${side} ${draft.symbol} with same entry/TP/SL`,
          );
          draft.status = "rejected";
          draft.resolvedAt = new Date();
          await draft.save();
          await TradeLog.create({
            type: "draft",
            action: "rejected_duplicate",
            symbol: draft.symbol,
            details: `Exact duplicate: open ${side} position exists with same entry, TP, and SL`,
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

        if (dupResult.type === "duplicate_updated") {
          console.log(
            `${lp} 🔄 Updated existing position TP/SL: ${dupResult.updates.join(", ")}`,
          );
          draft.status = "accepted";
          draft.resolvedAt = new Date();
          await draft.save();
          await TradeLog.create({
            type: "draft",
            action: "accepted_updated_tp_sl",
            symbol: draft.symbol,
            details: `Existing position TP/SL updated: ${dupResult.updates.join(", ")}`,
            result: "updated",
          });
          return NextResponse.json({
            success: true,
            data: {
              draft,
              message: `Updated TP/SL on existing position: ${dupResult.updates.join(", ")}`,
            },
          });
        }

        if (dupResult.type === "duplicate_no_update") {
          console.warn(
            `${lp} ⚠️ Duplicate position: ${side} ${draft.symbol} with same entry but no valid TP/SL update`,
          );
          draft.status = "rejected";
          draft.resolvedAt = new Date();
          await draft.save();
          await TradeLog.create({
            type: "draft",
            action: "rejected_duplicate",
            symbol: draft.symbol,
            details: `Open ${side} position exists with same entry and no new TP/SL to update`,
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

        // dupResult.type === "new" or entry-mismatch — proceed with trade
        // ─── Execute trade (shared core function) ───────────────────
        const position = await executeTrade({
          symbol: draft.symbol,
          action: draft.action,
          entryPrice: draft.entryPrice || undefined,
          stopLoss: draft.stopLoss,
          takeProfitTargets: draft.takeProfitTargets || [],
          leverage: draft.leverage,
          quantity: draft.quantity,
          orderType: signal.orderType === "limit" ? "LIMIT" : "MARKET",
          channelId: draft.channelId || undefined,
          messageId: draft.messageId,
          signalData: draft.signalData,
          logPrefix: requestId,
          accountId: draft.accountId || undefined,
        });

        positionId = position._id.toString();
        break;
      }

      case "CLOSE": {
        console.log(`${lp} 🔒 Processing CLOSE for ${draft.symbol}...`);

        const { Position } = await import("@/lib/database");

        const positions = await Position.find({
          symbol: draft.symbol,
          channelId: draft.channelId || null,
          status: "open",
        });

        console.log(
          `${lp} 📋 Found ${positions.length} open positions to close for ${draft.symbol}`,
        );

        // Resolve exchange from draft's accountId
        const closeExchange = await getExchangeForDraft(draft.accountId);
        for (const pos of positions) {
          console.log(
            `${lp} 🔄 Closing position: id=${pos._id}, symbol=${pos.symbol}, side=${pos.side}, qty=${pos.quantity}`,
          );
          await closeExchange.closePosition(
            pos.symbol,
            pos.orderId,
            pos.quantity,
          );
          pos.status = "closed";
          pos.closedAt = new Date();
          pos.closeReason = "Manual Accept Close";
          await pos.save();
          console.log(`${lp} ✅ Position marked as closed in DB: ${pos._id}`);
        }
        break;
      }

      case "UPDATE_SL":
      case "UPDATE_TP":
      case "ADD_TP": {
        console.log(
          `${lp} 🔄 Processing ${draft.action} for ${draft.symbol}...`,
        );

        const { Position, buildTPTargets, recalculateTPAllocation } =
          await import("@/lib/database");
        const { ExchangeFactory } =
          await import("@/lib/exchange/ExchangeFactory");

        const pos = await Position.findOne({
          symbol: draft.symbol,
          channelId: draft.channelId || null,
          status: "open",
        });

        if (!pos) {
          console.warn(
            `${lp} ⚠️ No open position found for ${draft.symbol} to update`,
          );
          break;
        }

        if (draft.stopLoss && draft.action === "UPDATE_SL") {
          console.log(
            `${lp} 📉 Updating SL: ${pos.stopLossPrice} → ${draft.stopLoss}`,
          );
          pos.stopLossPrice = draft.stopLoss;
        }
        if (draft.takeProfitTargets?.[0] && draft.action === "UPDATE_TP") {
          console.log(
            `${lp} 📈 Updating TP: ${pos.takeProfitTargets?.[0]?.price} → ${draft.takeProfitTargets[0]}`,
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
          pos.takeProfitTargets = recalculateTPAllocation(
            pos.takeProfitTargets,
            pos.quantity,
          );
        }

        if (draft.takeProfitTargets?.length && draft.action === "ADD_TP") {
          const addTpExchange = await getExchangeForDraft(draft.accountId);
          const closeSide = pos.side === "LONG" ? "SELL" : "BUY";

          for (const newTpPrice of draft.takeProfitTargets) {
            const alreadyExists = pos.takeProfitTargets.some(
              (t: any) => Math.abs(t.price - newTpPrice) < 0.01,
            );
            if (!alreadyExists) {
              pos.takeProfitTargets.push({
                price: newTpPrice,
                quantity: 0,
                percentage: 0,
                status: "pending",
              });
              console.log(
                `${lp} ➕ Added TP: ${newTpPrice} for ${draft.symbol}`,
              );
            } else {
              console.log(
                `${lp} ⚠️ TP ${newTpPrice} already exists — skipping`,
              );
            }
            // Place TP on exchange
            try {
              const tpId = await addTpExchange.placeTakeProfit(
                draft.symbol,
                newTpPrice,
                newTpPrice,
                closeSide,
                pos.quantity,
              );
              console.log(
                `${lp} 🎯 Exchange TP placed at ${newTpPrice} (orderId: ${tpId})`,
              );
            } catch (tpErr) {
              console.warn(
                `${lp} ⚠️ Failed to place TP on exchange at ${newTpPrice}: ${tpErr instanceof Error ? tpErr.message : String(tpErr)}`,
              );
            }
          }

          pos.takeProfitTargets = recalculateTPAllocation(
            pos.takeProfitTargets,
            pos.quantity,
          );
        }

        await pos.save();
        console.log(`${lp} ✅ Position updated: ${pos._id}`);
        break;
      }

      default:
        console.warn(`${lp} ⚠️ Unhandled action: ${draft.action}`);
        return NextResponse.json(
          { success: false, error: `Unhandled action: ${draft.action}` },
          { status: 400 },
        );
    }

    // ─── Update draft status ────────────────────────────────────────
    console.log(`${lp} 📝 Updating draft status to "accepted"...`);
    draft.status = "accepted";
    draft.resolvedAt = new Date();
    draft.positionId = positionId || undefined;
    await draft.save();

    await TradeLog.create({
      accountId: draft.accountId || undefined,
      type: "draft",
      action: `accepted_${draft.action}`,
      symbol: draft.symbol,
      details: draft.signalData,
      result: "executed",
    });

    const duration = Date.now() - startTime;
    console.log(
      `${lp} ✅ Draft accepted successfully: id=${draft._id}, action=${draft.action}, symbol=${draft.symbol}, positionId=${positionId || "N/A"} (${duration}ms)`,
    );

    return NextResponse.json({
      success: true,
      data: { draft, positionId },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorName =
      error instanceof Error ? error.constructor.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error(
      `${errorName} (${duration}ms): [${errorName}] ${errorMessage}`,
    );

    if (
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("ETIMEDOUT")
    ) {
      console.error(
        `🌐 Network error detected — exchange API may be unreachable`,
      );
    }
    if (
      errorMessage.includes("MongoError") ||
      errorMessage.includes("MongooseError") ||
      errorMessage.includes("CastError")
    ) {
      console.error(
        `🗄️ Database error detected — check MongoDB connection and query`,
      );
    }
    if (
      errorMessage.includes("insufficient") ||
      errorMessage.includes("Insufficient")
    ) {
      console.error(
        `💰 Insufficient funds error — check exchange account balance`,
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
