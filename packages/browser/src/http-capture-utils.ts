export function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function durationMs(started: number): number {
  return nowMs() - started;
}

export function sanitizeHttpUrl(rawUrl: string, sanitizer?: (url: string) => string): string {
  const stripped = stripSensitiveUrlParts(rawUrl);
  return sanitizer ? sanitizer(stripped) : stripped;
}

export function pickAllowedHeaders(
  headers: Headers | undefined,
  allowList: readonly string[] | undefined,
): Record<string, string> | undefined {
  if (!headers || !allowList || allowList.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const name of allowList) {
    const value = headers.get(name);
    if (value !== null) out[name.toLowerCase()] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function headersFromInit(headers: HeadersInit | undefined): Headers | undefined {
  if (!headers) return undefined;
  try {
    return new Headers(headers);
  } catch {
    return undefined;
  }
}

export function shouldSample(sampleRate: number, random: () => number): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  return random() < sampleRate;
}

function stripSensitiveUrlParts(rawUrl: string): string {
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawUrl)) {
    return rawUrl.split(/[?#]/, 1)[0] ?? rawUrl;
  }

  try {
    const url = new URL(rawUrl);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return rawUrl.split(/[?#]/, 1)[0] ?? rawUrl;
  }
}
