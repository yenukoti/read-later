export type ScrapeResult = {
  title: string;
  content: string;
};

function decodeHtmlEntities(input: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#34;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };

  let out = input;
  for (const [k, v] of Object.entries(entities)) out = out.split(k).join(v);

  out = out.replace(/&#(\d+);/g, (_, num: string) => String.fromCharCode(Number(num)));
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );

  return out;
}

function stripRemainingTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

function normalizeWhitespace(text: string): string {
  // Collapse all whitespace runs and normalize non-breaking spaces.
  return text.replace(/[\s\u00A0]+/g, " ").trim();
}

export async function scrapeArticle(url: string): Promise<ScrapeResult> {
  const parsedUrl = (() => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  })();

  if (!parsedUrl || !["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Invalid URL. Expected an http(s) URL.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(parsedUrl.toString(), {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
      headers: {
        // Some sites require a UA to avoid returning a minimal/blocked page.
        "User-Agent": "read-later/1.0 (+https://example.com)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch page: ${res.status} ${res.statusText}`.trim());
    }

    const html = await res.text();
    // Avoid runaway memory usage on extremely large responses.
    if (html.length > 5_000_000) {
      throw new Error("Fetched HTML is too large to process safely.");
    }

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = decodeHtmlEntities(titleMatch?.[1] ?? "").trim();

    // Remove elements likely to not be article content.
    const cleaned = html
      .replace(/<(script|style|nav|footer)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/?(head|meta|link|img|svg|iframe|object|embed|button|form)[^>]*>/gi, " ");

    const mainMatch =
      cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ??
      cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ??
      cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

    const mainHtml = mainMatch?.[1] ?? cleaned;

    // Convert to plain text: strip any remaining tags, decode entities, normalize whitespace.
    const text = normalizeWhitespace(decodeHtmlEntities(stripRemainingTags(mainHtml)));

    return {
      title: title || "Untitled",
      content: text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

