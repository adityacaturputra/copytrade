import { NextRequest, NextResponse } from "next/server";
import { verifyActionAuth } from "../../_lib/action-auth";

export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.BACKEND_URL || "http://localhost:3001"
).replace(/\/+$/, "");

const ALLOWED_ACTIONS = new Set([
  "signal-check",
  "position-monitor",
  "tp-sl-monitor",
  "orphan-cleanup",
  "status",
]);

type RouteParams = {
  params: Promise<{ action: string }>;
};

async function proxyCronRequest(
  method: "GET" | "POST",
  request: NextRequest,
  action: string,
) {
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json(
      { success: false, error: `Unknown cron action: ${action}` },
      { status: 404 },
    );
  }

  try {
    const incomingAuth = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    const authHeader =
      incomingAuth || (cronSecret ? `Bearer ${cronSecret}` : undefined);

    const search = request.nextUrl.search || "";
    const upstreamUrl = `${BACKEND_URL}/api/cron/${action}${search}`;

    const headers: Record<string, string> = {};
    if (authHeader) headers.authorization = authHeader;
    if (request.headers.get("content-type")) {
      headers["content-type"] = request.headers.get("content-type") as string;
    }

    const body = method === "POST" ? await request.text() : undefined;

    const upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body: method === "POST" ? body : undefined,
      cache: "no-store",
    });

    const text = await upstream.text();
    try {
      return NextResponse.json(JSON.parse(text), { status: upstream.status });
    } catch {
      return new NextResponse(text, {
        status: upstream.status,
        headers: {
          "content-type":
            upstream.headers.get("content-type") || "text/plain; charset=utf-8",
        },
      });
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? `Backend cron proxy failed: ${error.message}`
            : "Backend cron proxy failed",
      },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { action } = await params;
  return proxyCronRequest("GET", request, action);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { action } = await params;
  const authError = verifyActionAuth(request);
  if (authError) return authError;
  return proxyCronRequest("POST", request, action);
}
