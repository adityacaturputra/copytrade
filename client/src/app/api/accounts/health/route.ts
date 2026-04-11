import { NextRequest, NextResponse } from "next/server";
import { connectDB, Account } from "@copytrade/shared/lib/database";
import { SourceFactory } from "@copytrade/shared/lib/source/SourceFactory";
import type { BaseSourceConfig } from "@copytrade/shared/lib/source/types";
import { SourceType } from "@copytrade/shared/lib/enums";

// ─── POST /api/accounts/health ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    await connectDB();
    const body = await req.json();
    const { id } = body;

    let accounts = await Account.find().lean();

    if (id) {
      accounts = accounts.filter((a) => a._id.toString() === id);
    }

    const results = await Promise.all(
      accounts.map(async (account) => {
        try {
          const provider = SourceFactory.getProvider(
            account.sourceType as SourceType,
          );

          // Build config from account data
          const config: BaseSourceConfig = {
            _id: account._id.toString(),
            name: account.name,
            type: account.sourceType as SourceType,
            channelIds: account.channelIds,
            // Spread sourceData so provider can access credentials
            ...(account.sourceData as Record<string, unknown>),
          };

          const health = await provider.checkHealth(config);

          // Update account health status
          await Account.findByIdAndUpdate(account._id, {
            lastError: health.valid ? null : health.error,
            ...(health.valid ? {} : { isActive: false }),
          });

          return {
            accountId: account._id.toString(),
            accountName: account.name,
            sourceType: account.sourceType,
            health,
          };
        } catch (error) {
          const errMsg =
            error instanceof Error ? error.message : "Unknown error";
          return {
            accountId: account._id.toString(),
            accountName: account.name,
            sourceType: account.sourceType,
            health: { valid: false, error: errMsg, needsRefresh: false },
          };
        }
      }),
    );

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Health check error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Health check failed",
      },
      { status: 500 },
    );
  }
}
