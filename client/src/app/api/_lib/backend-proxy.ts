import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:3001").replace(
  /\/+$/,
  "",
);

export async function proxyToBackend(
  request: NextRequest,
  pathname: string,
  init?: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
  },
) {
  const method = init?.method || request.method;
  const search = request.nextUrl.search || "";
  const upstreamUrl = `${BACKEND_URL}${pathname}${search}`;

  const headers: Record<string, string> = {};
  if (request.headers.get("content-type")) {
    headers["content-type"] = request.headers.get("content-type") as string;
  }
  if (request.headers.get("authorization")) {
    headers.authorization = request.headers.get("authorization") as string;
  }
  if (request.headers.get("x-action-password")) {
    headers["x-action-password"] = request.headers.get(
      "x-action-password",
    ) as string;
  }

  const body =
    method === "GET" || method === "HEAD" ? undefined : await request.text();

  const upstream = await fetch(upstreamUrl, {
    method,
    headers,
    body,
    cache: "no-store",
  });

  const text = await upstream.text();

  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") || "application/json",
    },
  });
}
