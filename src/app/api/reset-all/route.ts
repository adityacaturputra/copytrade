import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/database";
import mongoose from "mongoose";
import { ExchangeFactory } from "@/lib/exchange/ExchangeFactory";

export const dynamic = "force-dynamic";

// Collections to clear (DiscordSource is preserved)
const COLLECTIONS_TO_CLEAR = [
  "processedmessages",
  "positions",
  "tradelogs",
  "drafttrades",
  "tradingmodes",
  "risksettings",
  "signalconfigs",
];

interface ResetStepResult {
  step: string;
  status: "success" | "skipped" | "error";
  message: string;
  details?: string[];
}

export async function POST(request: NextRequest) {
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

    // ─── Step 2: Close Exchange Positions ──────────────────────────────
    if (!skipExchange) {
      const provider = (process.env.EXCHANGE_PROVIDER as string) || "paper";

      if (provider === "paper") {
        results.push({
          step: "Exchange",
          status: "skipped",
          message:
            "Paper exchange — positions are in-memory and reset on server restart",
        });
      } else {
        try {
          const exchange = ExchangeFactory.getClient();

          const positions = await exchange.getOpenPositions();
          const details: string[] = [
            `Provider: ${provider}`,
            `Open positions: ${positions.length}`,
          ];

          if (positions.length === 0) {
            results.push({
              step: "Exchange",
              status: "success",
              message: "No open positions to close",
              details,
            });
          } else {
            const result = await exchange.closeAllPositions();

            if (result.closed.length > 0) {
              details.push(`Closed: ${result.closed.join(", ")}`);
            }
            if (result.errors.length > 0) {
              details.push(`Errors: ${result.errors.join(", ")}`);
            }

            results.push({
              step: "Exchange",
              status: result.errors.length > 0 ? "error" : "success",
              message: `Closed ${result.closed.length}/${positions.length} positions`,
              details,
            });
          }
        } catch (err) {
          results.push({
            step: "Exchange",
            status: "error",
            message: `Exchange error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
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
