import { NextRequest, NextResponse } from "next/server";
import { connectDB, Account, DiscordSource } from "@/lib/database";
import { SourceType } from "@/lib/enums";

// ─── GET /api/accounts ─────────────────────────────────────────────────────
export async function GET() {
  try {
    await connectDB();

    const accounts = await Account.find().sort({ createdAt: 1 }).lean();

    // Mask sensitive fields for display
    const masked = accounts.map((acc) => ({
      ...acc,
      sourceData: {
        ...acc.sourceData,
        token: acc.sourceData?.token
          ? "••••••••" + String(acc.sourceData.token).slice(-4)
          : undefined,
        refreshToken: acc.sourceData?.refreshToken
          ? "••••••••" + String(acc.sourceData.refreshToken).slice(-4)
          : undefined,
      },
      exchangeData: {
        ...acc.exchangeData,
        apiKey: acc.exchangeData?.apiKey
          ? "••••••••" + String(acc.exchangeData.apiKey).slice(-4)
          : undefined,
        secretKey: acc.exchangeData?.secretKey ? "••••••••" : undefined,
        passphrase: acc.exchangeData?.passphrase ? "••••••••" : undefined,
      },
    }));

    return NextResponse.json({ success: true, accounts: masked });
  } catch (error) {
    console.error("Failed to fetch accounts:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch accounts" },
      { status: 500 },
    );
  }
}

// ─── POST /api/accounts ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    await connectDB();
    const body = await req.json();

    const {
      name,
      sourceType,
      sourceData,
      channelIds,
      channelNames,
      tradingPlatform,
      exchangeData,
    } = body;

    if (!name || !sourceType) {
      return NextResponse.json(
        { success: false, error: "Name and source type are required" },
        { status: 400 },
      );
    }

    if (!Object.values(SourceType).includes(sourceType)) {
      return NextResponse.json(
        { success: false, error: `Invalid source type: ${sourceType}` },
        { status: 400 },
      );
    }

    if (!channelIds || channelIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "At least one channel ID is required" },
        { status: 400 },
      );
    }

    // Validate source credentials based on type
    if (sourceType === "discord") {
      if (!sourceData?.token) {
        return NextResponse.json(
          { success: false, error: "Discord token is required" },
          { status: 400 },
        );
      }
      if (!sourceData?.method) {
        return NextResponse.json(
          { success: false, error: "Discord method (bot/user) is required" },
          { status: 400 },
        );
      }
    }

    // Validate exchange credentials if trading platform specified
    if (tradingPlatform && tradingPlatform !== "paper") {
      if (!exchangeData?.apiKey || !exchangeData?.secretKey) {
        return NextResponse.json(
          {
            success: false,
            error: `Exchange API credentials are required for ${tradingPlatform}`,
          },
          { status: 400 },
        );
      }
    }

    const account = await Account.create({
      name,
      isActive: true,
      sourceType,
      sourceData: sourceData || {},
      channelIds,
      channelNames: channelNames || {},
      disabledChannelIds: [],
      tradingPlatform: tradingPlatform || "paper",
      exchangeData: exchangeData || null,
    });

    console.log(
      `✅ Created account: ${name} (${sourceType} → ${tradingPlatform || "paper"})`,
    );

    return NextResponse.json({ success: true, account });
  } catch (error) {
    console.error("Failed to create account:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to create account",
      },
      { status: 500 },
    );
  }
}

// ─── PUT /api/accounts ─────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    await connectDB();
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Account ID is required" },
        { status: 400 },
      );
    }

    const account = await Account.findById(id);
    if (!account) {
      return NextResponse.json(
        { success: false, error: "Account not found" },
        { status: 404 },
      );
    }

    // Update fields selectively
    if (updates.name !== undefined) account.name = updates.name;
    if (updates.isActive !== undefined) account.isActive = updates.isActive;
    if (updates.channelIds !== undefined)
      account.channelIds = updates.channelIds;
    if (updates.channelNames !== undefined)
      account.channelNames = updates.channelNames;
    if (updates.disabledChannelIds !== undefined)
      account.disabledChannelIds = updates.disabledChannelIds;
    if (updates.tradingPlatform !== undefined)
      account.tradingPlatform = updates.tradingPlatform;

    // Merge sourceData — keep existing values if new ones are masked/empty
    if (updates.sourceData) {
      const merged = { ...(account.sourceData as Record<string, unknown>) };
      for (const [key, value] of Object.entries(updates.sourceData)) {
        // Skip masked values (••••••••)
        if (typeof value === "string" && value.startsWith("••••••••")) continue;
        // Skip empty strings — means "keep existing"
        if (value === "") continue;
        merged[key] = value;
      }
      account.sourceData = merged;
    }

    // Merge exchangeData similarly
    if (updates.exchangeData) {
      const merged = {
        ...((account.exchangeData as Record<string, unknown>) || {}),
      };
      for (const [key, value] of Object.entries(updates.exchangeData)) {
        if (typeof value === "string" && value.startsWith("••••••••")) continue;
        if (value === "") continue;
        merged[key] = value;
      }
      account.exchangeData = merged;
    }

    await account.save();

    console.log(`✅ Updated account: ${account.name}`);

    return NextResponse.json({ success: true, account });
  } catch (error) {
    console.error("Failed to update account:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to update account",
      },
      { status: 500 },
    );
  }
}

// ─── DELETE /api/accounts ──────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Account ID is required" },
        { status: 400 },
      );
    }

    const account = await Account.findByIdAndDelete(id);
    if (!account) {
      return NextResponse.json(
        { success: false, error: "Account not found" },
        { status: 404 },
      );
    }

    console.log(`🗑️ Deleted account: ${account.name}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete account:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to delete account",
      },
      { status: 500 },
    );
  }
}
