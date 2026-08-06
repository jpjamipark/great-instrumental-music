/** Legacy listing path: .../7942946959.html */
const LEGACY_ID_RE = /\/(\d+)\.html(?:[?#].*)?$/i;

/** New listing path: .../view/d/slug/opaqueId */
const MODERN_ID_RE = /\/view\/d\/[^/]+\/([A-Za-z0-9]+)(?:[?#].*)?$/i;

export function extractPostId(url: string): string | null {
  return url.match(LEGACY_ID_RE)?.[1] ?? url.match(MODERN_ID_RE)?.[1] ?? null;
}

export function isListingUrl(url: string): boolean {
  return extractPostId(url) !== null;
}

/**
 * Whether a listing URL belongs to the Washington DC craigslist area.
 * Legacy subdomain URLs are filtered by host; new /view/ URLs are already
 * scoped by the area search, so they are accepted.
 */
export function isWashingtonDcListing(url: string): boolean {
  if (MODERN_ID_RE.test(url)) return true;

  try {
    return new URL(url).hostname.toLowerCase() === "washingtondc.craigslist.org";
  } catch {
    return false;
  }
}

export function normalizeListingUrl(href: string, baseUrl?: string): string | null {
  try {
    const absolute = new URL(href, baseUrl ?? "https://www.craigslist.org").href;
    if (!isListingUrl(absolute) || !isWashingtonDcListing(absolute)) return null;
    return absolute.split("#")[0];
  } catch {
    return null;
  }
}

/**
 * Extract listing URLs from Craigslist search HTML.
 * Supports legacy numeric .html posting URLs and new /view/ opaque IDs.
 */
export function extractListingUrlsFromHtml(
  html: string,
  baseUrl?: string
): string[] {
  const hrefs = new Set<string>();

  for (const match of html.matchAll(/href="([^"]+)"/gi)) {
    const normalized = normalizeListingUrl(match[1], baseUrl);
    if (normalized) hrefs.add(normalized);
  }

  return [...hrefs];
}
