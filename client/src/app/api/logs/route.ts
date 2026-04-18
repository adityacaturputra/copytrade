import { NextRequest, NextResponse } from "next/server";
const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:3001").replace(
  /\/+$/,
  "",
);

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const search = new URL(request.url).search;
    const response = await fetch(`${BACKEND_URL}/api/logs${search}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const text = await response.text();

    return new NextResponse(text, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Failed to fetch logs:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
