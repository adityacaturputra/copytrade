import { NextRequest, NextResponse } from "next/server";
import {
  getProxyConfig,
  setProxyConfig,
  getProxyInfo,
  getProviderProxyInfo,
  getWebshareApiKeyPoolConfig,
  setWebshareApiKeyPoolConfig,
} from "@copytrade/shared/lib/proxy/ProxyFactory";
import { verifyActionAuth } from "../_lib/action-auth";

export const dynamic = "force-dynamic";

/** GET /api/proxy — Returns proxy config + provider info */
export async function GET() {
  try {
    const config = await getProxyConfig();

    // Get provider info if enabled
    let providerInfo = null;
    if (config.enabled) {
      providerInfo = await getProxyInfo();
    }

    return NextResponse.json({
      success: true,
      config: {
        enabled: config.enabled,
        provider: config.provider,
        custom: config.custom,
      },
      providerInfo,
      webshareApiKeyPool: await getWebshareApiKeyPoolConfig(),
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

/** POST /api/proxy — Update proxy config */
export async function POST(request: NextRequest) {
  const authError = verifyActionAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();

    // Validate provider
    if (body.provider && !["webshare", "custom"].includes(body.provider)) {
      return NextResponse.json(
        { success: false, error: "Provider must be 'webshare' or 'custom'" },
        { status: 400 },
      );
    }

    const config = await setProxyConfig({
      enabled: body.enabled,
      provider: body.provider,
      custom: body.custom
        ? {
            host: body.custom.host || "",
            port: Number(body.custom.port) || 1080,
            username: body.custom.username || "",
            password: body.custom.password || "",
          }
        : undefined,
    });

    if (body.webshareApiKeyPool) {
      await setWebshareApiKeyPoolConfig({
        keys: Array.isArray(body.webshareApiKeyPool.keys)
          ? body.webshareApiKeyPool.keys.map((k: unknown) => String(k))
          : undefined,
        activeIndex:
          body.webshareApiKeyPool.activeIndex !== undefined
            ? Number(body.webshareApiKeyPool.activeIndex)
            : undefined,
        allowedCountryCodes: Array.isArray(
          body.webshareApiKeyPool.allowedCountryCodes,
        )
          ? body.webshareApiKeyPool.allowedCountryCodes.map((v: unknown) =>
              String(v),
            )
          : undefined,
      });
    }

    // Get updated provider info
    let providerInfo = null;
    if (config.enabled) {
      providerInfo = await getProviderProxyInfo(config.provider, config.custom);
    }

    return NextResponse.json({
      success: true,
      config: {
        enabled: config.enabled,
        provider: config.provider,
        custom: config.custom,
      },
      providerInfo,
      webshareApiKeyPool: await getWebshareApiKeyPoolConfig(),
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
