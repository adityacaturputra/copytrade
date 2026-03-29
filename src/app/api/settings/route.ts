import { NextRequest, NextResponse } from "next/server";
import { connectDB, getTradingMode, setTradingMode } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectDB();
    const mode = await getTradingMode();
    return NextResponse.json({ success: true, mode });
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

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json();
    const { mode } = body;

    if (!mode || !["auto", "manual"].includes(mode)) {
      return NextResponse.json(
        { success: false, error: "Mode must be 'auto' or 'manual'" },
        { status: 400 },
      );
    }

    await setTradingMode(mode as "auto" | "manual");
    return NextResponse.json({ success: true, mode });
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
