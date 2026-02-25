export type UrlHealthStatus = "live" | "redirected" | "dead";

export type UrlValidationResult = {
  status: UrlHealthStatus;
  finalUrl: string | null;
  statusCode: number | null;
  checkedAt: string;
};

function normalizeUrl(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).toString();
  } catch {
    return null;
  }
}

function classifyStatus(
  originalUrl: string,
  finalUrl: string | null,
  statusCode: number | null
): UrlHealthStatus {
  if (!statusCode || statusCode >= 400) {
    return "dead";
  }

  if (!finalUrl) {
    return "live";
  }

  const normalizedOriginal = normalizeUrl(originalUrl);
  const normalizedFinal = normalizeUrl(finalUrl);

  if (!normalizedOriginal || !normalizedFinal) {
    return "live";
  }

  return normalizedOriginal === normalizedFinal ? "live" : "redirected";
}

export async function validateUrl(url: string): Promise<UrlValidationResult> {
  const checkedAt = new Date().toISOString();
  const timeout = 7_000;
  const signal = AbortSignal.timeout(timeout);

  try {
    const headResponse = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal
    });

    return {
      status: classifyStatus(url, headResponse.url, headResponse.status),
      finalUrl: headResponse.url,
      statusCode: headResponse.status,
      checkedAt
    };
  } catch {
    try {
      const getResponse = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal
      });

      return {
        status: classifyStatus(url, getResponse.url, getResponse.status),
        finalUrl: getResponse.url,
        statusCode: getResponse.status,
        checkedAt
      };
    } catch {
      return {
        status: "dead",
        finalUrl: null,
        statusCode: null,
        checkedAt
      };
    }
  }
}
