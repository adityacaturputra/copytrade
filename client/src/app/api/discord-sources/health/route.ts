import { NextRequest, NextResponse } from "next/server";
import { connectDB, DiscordSource } from "@/lib/database";
import { checkTokenHealth } from "@/lib/discord";

export const dynamic = "force-dynamic";

// POST /api/discord-sources/health - Check health of a specific or all sources
export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json();
    const { id } = body;

    if (id) {
      // Check specific source
      const source = await DiscordSource.findById(id);
      if (!source) {
        return NextResponse.json(
          { success: false, error: "Source not found" },
          { status: 404 },
        );
      }

      const health = await checkTokenHealth(source.method, source.token);

      // Update source health status
      if (!health.valid) {
        source.lastError = health.error;
        if (health.needsRefresh) {
          source.isActive = false;
        }
        await source.save();
      } else {
        source.lastError = undefined;
        await source.save();
      }

      return NextResponse.json({
        success: true,
        sourceId: id,
        sourceName: source.name,
        health,
      });
    }

    // Check all sources
    const sources = await DiscordSource.find().lean();
    const results = [];

    for (const source of sources) {
      const health = await checkTokenHealth(source.method, source.token);

      // Update health status
      if (!health.valid) {
        await DiscordSource.findByIdAndUpdate(source._id, {
          lastError: health.error,
          isActive: health.needsRefresh ? false : source.isActive,
        });
      } else {
        await DiscordSource.findByIdAndUpdate(source._id, {
          lastError: undefined,
        });
      }

      results.push({
        sourceId: (source._id as any).toString(),
        sourceName: source.name,
        method: source.method,
        isActive: source.isActive,
        health,
      });
    }

    return NextResponse.json({ success: true, results });
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
