import { NextResponse } from "next/server";
import { getAllCronStatus } from "@/lib/cron-status";

export const dynamic = "force-dynamic";

/** GET /api/cron/status — poll cron progress for all jobs */
export async function GET() {
  return NextResponse.json({
    success: true,
    cronStatus: getAllCronStatus(),
  });
}
