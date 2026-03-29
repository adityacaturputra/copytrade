import { NextResponse } from "next/server";
import { connectDB, getPendingDrafts, getRecentDrafts } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectDB();
    const [pending, recent] = await Promise.all([
      getPendingDrafts(),
      getRecentDrafts(50),
    ]);
    return NextResponse.json({
      success: true,
      data: { pending, recent },
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
