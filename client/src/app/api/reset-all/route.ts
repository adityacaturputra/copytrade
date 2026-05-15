import { NextRequest, NextResponse } from "next/server";
import { connectDB, Account } from "@copytrade/shared/lib/database/index";
import mongoose from "mongoose";
import { resetExchangeAccountState } from "@copytrade/shared/lib/exchange/reset-account-state";
import { verifyActionAuth } from "../_lib/action-auth";

export const dynamic = "force-dynamic";

// Collections to clear (DiscordSource is preserved)
const COLLECTIONS_TO_CLEAR = [
  "processedmessages",
  "positions",
  "tradelogs",
  "drafttrades",
];

interface ResetStepResult {
  step: string;
  status: "success" | "skipped" | "error";
  message: string;
  details?: string[];
}

export async function POST(request: NextRequest) {
  const authError = verifyActionAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const skipExchange = body?.skipExchange === true;
    const skipDb = body?.skipDb === true;

    const results: ResetStepResult[] = [];

    // ─── Step 1: Reset Database ────────────────────────────────────────
    if (!skipDb) {
      try {
        await connectDB();
        const db = mongoose.connection.db;
        if (!db) {
          results.push({
            step: "Database",
            status: "error",
            message: "Failed to get database reference",
          });
        } else {
          const collections = await db.listCollections().toArray();
          const collectionNames = collections.map((c) => c.name);
          const details: string[] = [];

          for (const colName of COLLECTIONS_TO_CLEAR) {
            if (collectionNames.includes(colName)) {
              const count = await db.collection(colName).countDocuments();
              await db.collection(colName).drop();
              details.push(`Dropped: ${colName} (${count} docs)`);
            } else {
              details.push(`Skipped: ${colName} (does not exist)`);
            }
          }

          // Report preserved
          if (collectionNames.includes("discordsources")) {
            const count = await db
              .collection("discordsources")
              .countDocuments();
            details.push(`Preserved: discordsources (${count} docs)`);
          }
          if (collectionNames.includes("accounts")) {
            const count = await db.collection("accounts").countDocuments();
            details.push(`Preserved: accounts (${count} docs)`);
          }

          results.push({
            step: "Database",
            status: "success",
            message: "Database collections reset successfully",
            details,
          });
        }
      } catch (err) {
        results.push({
          step: "Database",
          status: "error",
          message: `Database error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } else {
      results.push({
        step: "Database",
        status: "skipped",
        message: "Skipped (--skip-db)",
      });
    }

    // ─── Step 2: Reset Exchange State (cancel orders/algo, close positions) ─────
    if (!skipExchange) {
      try {
        await connectDB();
        const accounts = await Account.find({ isActive: true }).lean();

        if (accounts.length === 0) {
          results.push({
            step: "Exchange",
            status: "skipped",
            message: "No active accounts to reset",
          });
        } else {
          const allDetails: string[] = [];
          let totalCancelledOrders = 0;
          let totalCancelledAlgoOrders = 0;
          let totalClosedPositions = 0;
          let totalErrors = 0;

          for (const account of accounts) {
            try {
              const resetResult = await resetExchangeAccountState({
                name: account.name,
                tradingPlatform: account.tradingPlatform,
                exchangeData:
                  (account.exchangeData as Record<string, unknown> | null) ||
                  null,
              });

              totalCancelledOrders += resetResult.cancelledOrders;
              totalCancelledAlgoOrders += resetResult.cancelledAlgoOrders;
              totalClosedPositions += resetResult.closedPositions;
              if (resetResult.status === "error") {
                totalErrors +=
                  resetResult.orderCancelErrors +
                    resetResult.algoCancelErrors +
                    resetResult.positionCloseErrors || 1;
              }

              allDetails.push(
                `Account "${resetResult.accountName}" (${resetResult.provider}): ${resetResult.message}`,
              );
              allDetails.push(
                ...resetResult.details.map((detail) => `  ${detail}`),
              );
            } catch (err) {
              totalErrors++;
              allDetails.push(
                `Account "${account.name}": ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }

          results.push({
            step: "Exchange",
            status: totalErrors > 0 ? "error" : "success",
            message:
              `Reset ${accounts.length} account(s): ` +
              `${totalCancelledOrders} order(s) cancelled, ` +
              `${totalCancelledAlgoOrders} algo order(s) cancelled, ` +
              `${totalClosedPositions} position(s) closed`,
            details: allDetails,
          });
        }
      } catch (err) {
        results.push({
          step: "Exchange",
          status: "error",
          message: `Exchange error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } else {
      results.push({
        step: "Exchange",
        status: "skipped",
        message: "Skipped (--skip-exchange)",
      });
    }

    const hasErrors = results.some((r) => r.status === "error");

    return NextResponse.json({
      success: !hasErrors,
      message: hasErrors
        ? "Reset completed with some errors"
        : "Reset completed successfully",
      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Reset failed",
        error: error instanceof Error ? error.message : "Unknown error",
        results: [],
      },
      { status: 500 },
    );
  }
}
