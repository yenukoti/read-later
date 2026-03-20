import { NextResponse } from "next/server";

import { createServerClient } from "../../../../lib/supabase";
import { scrapeArticle } from "../../../../lib/scraper";
import { summarizeArticle } from "../../../../lib/gemini";

type IncomingBody = { url: string };

function getUserIdFromHeaders(headers: Headers): string | null {
  // Try a few common header names; you can standardize later.
  const candidates = ["x-user-id", "x-userid", "user-id", "userId", "x-user"];
  for (const key of candidates) {
    const value = headers.get(key);
    if (value && value.trim()) return value.trim();
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const userId = getUserIdFromHeaders(req.headers);
    if (!userId) {
      return NextResponse.json({ error: "Missing userId header." }, { status: 400 });
    }

    const body = (await req.json()) as Partial<IncomingBody>;
    if (!body?.url || typeof body.url !== "string") {
      return NextResponse.json({ error: "Body must include { url: string }." }, { status: 400 });
    }

    const supabase = createServerClient();

    // 1) Scrape first.
    const scraped = await scrapeArticle(body.url);

    const insertPayload = {
      user_id: userId,
      url: body.url,
      title: scraped.title,
      content: scraped.content,
      // If your table has a default for saved_at, this is harmless.
      saved_at: new Date().toISOString(),
    };

    // 2) Save immediately so we can return an answer right away.
    const { data: inserted, error: insertError } = await supabase
      .from("articles")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError || !inserted) {
      return NextResponse.json(
        { error: insertError?.message ?? "Failed to insert article." },
        { status: 500 },
      );
    }

    // 3) Summarize and update the row asynchronously.
    // Requirement: return the saved article instantly after insert.
    void (async () => {
      try {
        const summary = await summarizeArticle(scraped.content);
        await supabase
          .from("articles")
          .update({
            summary: summary.summary,
            key_points: summary.key_points,
            tags: summary.tags,
          })
          .eq("id", inserted.id);
      } catch (e) {
        // Return already happened; just log failures.
        console.error("Gemini summary update failed:", e);
      }
    })();

    return NextResponse.json(inserted, { status: 200 });
  } catch (err) {
    console.error("POST /api/articles failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const userId = getUserIdFromHeaders(req.headers);
    if (!userId) {
      return NextResponse.json({ error: "Missing userId header." }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from("articles")
      .select("*")
      .eq("user_id", userId)
      .order("saved_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? [], { status: 200 });
  } catch (err) {
    console.error("GET /api/articles failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

