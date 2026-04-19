const FALLBACK_BACKEND_URL = "http://localhost:3001";

export function getPublicBackendBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_BACKEND_URL || FALLBACK_BACKEND_URL
  ).replace(/\/+$/, "");
}

export function buildBackendApiUrl(pathname: string) {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${getPublicBackendBaseUrl()}${normalizedPath}`;
}
