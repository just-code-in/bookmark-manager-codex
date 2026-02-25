export type ParsedBookmark = {
  url: string;
  title: string;
  folderPath: string | null;
  dateAdded: string | null;
};

const A_TAG_RE = /<A\b([^>]*)>([\s\S]*?)<\/A>/gi;
const H3_TAG_RE = /<H3\b[^>]*>([\s\S]*?)<\/H3>/i;
const ATTR_RE = /([A-Z_]+)\s*=\s*"([^"]*)"/gi;

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let match = ATTR_RE.exec(raw);

  while (match) {
    attributes[match[1]] = decodeHtml(match[2]);
    match = ATTR_RE.exec(raw);
  }

  ATTR_RE.lastIndex = 0;
  return attributes;
}

function normalizeUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseAddDate(addDate: string | undefined): string | null {
  if (!addDate) return null;
  const seconds = Number(addDate);
  if (Number.isNaN(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

export function parseBookmarksFromHtml(html: string): ParsedBookmark[] {
  const bookmarks: ParsedBookmark[] = [];
  const folderStack: string[] = [];
  let pendingFolder: string | null = null;

  const lines = html.split(/\r?\n/);
  for (const line of lines) {
    const folderMatch = line.match(H3_TAG_RE);
    if (folderMatch) {
      pendingFolder = decodeHtml(folderMatch[1].trim());
    }

    if (line.includes("<DL")) {
      if (pendingFolder) {
        folderStack.push(pendingFolder);
        pendingFolder = null;
      }
    }

    if (line.includes("</DL>")) {
      if (folderStack.length > 0) {
        folderStack.pop();
      }
    }

    let anchorMatch = A_TAG_RE.exec(line);
    while (anchorMatch) {
      const attributes = parseAttributes(anchorMatch[1]);
      const normalizedUrl = normalizeUrl(attributes.HREF ?? "");
      const title = decodeHtml(anchorMatch[2].trim());

      if (normalizedUrl && title.length > 0) {
        bookmarks.push({
          url: normalizedUrl,
          title,
          folderPath: folderStack.length > 0 ? folderStack.join(" / ") : null,
          dateAdded: parseAddDate(attributes.ADD_DATE)
        });
      }

      anchorMatch = A_TAG_RE.exec(line);
    }
    A_TAG_RE.lastIndex = 0;
  }

  return bookmarks;
}
