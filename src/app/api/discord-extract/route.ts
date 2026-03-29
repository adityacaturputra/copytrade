import { NextRequest, NextResponse } from "next/server";
import { connectDB, DiscordSource } from "@/lib/database";
import { checkTokenHealth } from "@/lib/discord";

export const dynamic = "force-dynamic";

/**
 * POST /api/discord-extract
 * Receives a Discord user token extracted via bookmarklet/console script.
 * Creates a new DiscordSource or updates an existing one.
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json();
    const { token, channelIds, name, sourceId } = body;

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Token is required" },
        { status: 400 },
      );
    }

    // Validate the extracted token
    const health = await checkTokenHealth("user", token);
    if (!health.valid) {
      return NextResponse.json(
        {
          success: false,
          error: `Extracted token is invalid: ${health.error}`,
          health,
        },
        { status: 400 },
      );
    }

    if (sourceId) {
      // Update existing source
      const source = await DiscordSource.findById(sourceId);
      if (!source) {
        return NextResponse.json(
          { success: false, error: "Source not found" },
          { status: 404 },
        );
      }

      source.token = token;
      source.isActive = true;
      source.lastError = undefined;

      if (channelIds && channelIds.length > 0) {
        source.channelIds = channelIds;
      }

      await source.save();

      console.log(`✅ Updated Discord source token: ${source.name}`);

      return NextResponse.json({
        success: true,
        message: `Token updated for "${source.name}"`,
        health,
      });
    }

    // Create new source with a default name
    const sourceName =
      name || `Discord Account ${Date.now().toString(36).toUpperCase()}`;
    const channels = channelIds && channelIds.length > 0 ? channelIds : [];

    const source = await DiscordSource.create({
      name: sourceName,
      method: "user",
      token,
      channelIds: channels,
      isActive: channels.length > 0,
      autoRefresh: true,
    });

    console.log(
      `✅ Created Discord source from extracted token: ${sourceName}`,
    );

    return NextResponse.json({
      success: true,
      message: `Created source "${sourceName}"${
        channels.length === 0
          ? " — add channel IDs in Settings to activate"
          : ""
      }`,
      sourceId: (source._id as any).toString(),
      health,
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
