import { NextRequest, NextResponse } from "next/server";
import {
  connectDB,
  DiscordSource,
  getAllDiscordSources,
} from "@copytrade/shared/lib/database/index";
import { checkTokenHealth } from "@/lib/discord";
import { verifyActionAuth } from "../_lib/action-auth";

export const dynamic = "force-dynamic";

// GET /api/discord-sources - List all sources
export async function GET() {
  try {
    await connectDB();
    const sources = await getAllDiscordSources();

    // Mask tokens for security
    const masked = sources.map((s) => ({
      ...s,
      token: maskToken(s.token),
      refreshToken: s.refreshToken ? maskToken(s.refreshToken) : null,
    }));

    return NextResponse.json({ success: true, sources: masked });
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

// POST /api/discord-sources - Create a new source
export async function POST(request: NextRequest) {
  const authError = verifyActionAuth(request);
  if (authError) return authError;

  try {
    await connectDB();
    const body = await request.json();

    const {
      name,
      method,
      token,
      refreshToken,
      channelIds,
      channelNames,
      autoRefresh,
    } = body;

    if (!name || !method || !token || !channelIds || channelIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: name, method, token, channelIds",
        },
        { status: 400 },
      );
    }

    if (!["bot", "user"].includes(method)) {
      return NextResponse.json(
        { success: false, error: "Method must be 'bot' or 'user'" },
        { status: 400 },
      );
    }

    // Validate token by health check
    const health = await checkTokenHealth(method, token);
    if (!health.valid) {
      return NextResponse.json(
        {
          success: false,
          error: `Token validation failed: ${health.error}`,
          health,
        },
        { status: 400 },
      );
    }

    const source = await DiscordSource.create({
      name,
      method,
      token,
      refreshToken: refreshToken || null,
      channelIds: Array.isArray(channelIds) ? channelIds : [channelIds],
      channelNames: channelNames || {},
      isActive: true,
      autoRefresh: autoRefresh !== false,
    });

    console.log(`✅ Created Discord source: ${name} (${method})`);

    return NextResponse.json({
      success: true,
      source: {
        ...source.toObject(),
        token: maskToken(source.token),
      },
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

// PUT /api/discord-sources - Update a source
export async function PUT(request: NextRequest) {
  const authError = verifyActionAuth(request);
  if (authError) return authError;

  try {
    await connectDB();
    const body = await request.json();
    const {
      id,
      name,
      method,
      token,
      refreshToken,
      channelIds,
      channelNames,
      isActive,
      autoRefresh,
    } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Source ID is required" },
        { status: 400 },
      );
    }

    const source = await DiscordSource.findById(id);
    if (!source) {
      return NextResponse.json(
        { success: false, error: "Source not found" },
        { status: 404 },
      );
    }

    // If token changed, validate it
    let healthResult = null;
    if (token && token !== source.token) {
      healthResult = await checkTokenHealth(method || source.method, token);
      if (!healthResult.valid) {
        return NextResponse.json(
          {
            success: false,
            error: `Token validation failed: ${healthResult.error}`,
            health: healthResult,
          },
          { status: 400 },
        );
      }
      source.token = token;
      source.lastError = undefined;
    }

    if (name) source.name = name;
    if (method && ["bot", "user"].includes(method)) source.method = method;
    if (refreshToken !== undefined) source.refreshToken = refreshToken;
    if (channelIds && channelIds.length > 0) source.channelIds = channelIds;
    if (channelNames !== undefined) source.channelNames = channelNames;
    if (isActive !== undefined) source.isActive = isActive;
    if (autoRefresh !== undefined) source.autoRefresh = autoRefresh;
    if (body.disabledChannelIds !== undefined) {
      // Validate that all disabled channel IDs belong to this source
      const validIds = body.disabledChannelIds.filter((id: string) =>
        source.channelIds.includes(id),
      );
      source.disabledChannelIds = validIds;
    }

    await source.save();

    console.log(`✅ Updated Discord source: ${source.name}`);

    return NextResponse.json({
      success: true,
      source: {
        ...source.toObject(),
        token: maskToken(source.token),
      },
      health: healthResult,
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

// DELETE /api/discord-sources - Delete a source
export async function DELETE(request: NextRequest) {
  const authError = verifyActionAuth(request);
  if (authError) return authError;

  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Source ID is required" },
        { status: 400 },
      );
    }

    const source = await DiscordSource.findByIdAndDelete(id);
    if (!source) {
      return NextResponse.json(
        { success: false, error: "Source not found" },
        { status: 404 },
      );
    }

    console.log(`🗑️ Deleted Discord source: ${source.name}`);

    return NextResponse.json({ success: true });
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

// Helper: mask token for display
function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "****";
  return token.substring(0, 4) + "****" + token.substring(token.length - 4);
}
