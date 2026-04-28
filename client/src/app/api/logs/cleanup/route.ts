import { NextRequest } from "next/server";
import { proxyToBackend } from "../../_lib/backend-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return proxyToBackend(request, "/api/logs/cleanup", { method: "POST" });
}
