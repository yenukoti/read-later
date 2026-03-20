import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { createServerClient } from "../../../../lib/supabase";

// ─── Types ───────────────────────────────────────────────────────────────────

type Article = {
  id: string;
  title: string;
  summary: string | null;
  key_points: string[] | string | null;
  url: string;
  tags: string[] | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getKeyPoints(value: Article["key_points"]): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    } catch { /* ignore */ }
    return value.split("\n").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function getSecret(headers: Headers): string | null {
  const auth = headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return auth.trim() || null;
}

function buildEmailHtml(narrative: string, articles: Article[], weekOf: string): string {
  const articlesHtml = articles.map((a) => {
    const points = getKeyPoints(a.key_points);
    const tags = (a.tags ?? []).map(
      (t) => `<span style="display:inline-block;background:#eef2ff;color:#4f46e5;padding:2px 10px;border-radius:99px;font-size:12px;margin-right:4px;">${t}</span>`
    ).join("");

    return `
      <div style="margin-bottom:28px;padding-bottom:28px;border-bottom:1px solid #eee;">
        <h2 style="margin:0 0 8px;font-size:18px;">
          <a href="${a.url}" style="color:#4f46e5;text-decoration:none;">${a.title ?? a.url}</a>
        </h2>
        <p style="color:#555;margin:0 0 12px;line-height:1.6;">${a.summary ?? "No summary available."}</p>
        ${points.length ? `
          <ul style="margin:0 0 12px;padding-left:20px;color:#444;">
            ${points.map((p) => `<li style="margin-bottom:4px;">${p}</li>`).join("")}
          </ul>` : ""}
        ${tags ? `<div style="margin-top:8px;">${tags}</div>` : ""}
      </div>`;
  }).join("");

  return `
    <div style="max-width:600px;margin:0 auto;font-family:sans-serif;color:#222;">
      <div style="background:#4f46e5;padding:28px 32px;border-radius:12px 12px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:24px;">Your Reading Digest</h1>
        <p style="color:#c7d2fe;margin:6px 0 0;font-size:14px;">${weekOf}</p>
      </div>
      <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;">
        <p style="font-size:16px;line-height:1.8;color:#444;margin:0 0 32px;white-space:pre-line;">${narrative}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:0 0 28px;">
        ${articlesHtml}
        <p style="color:#bbb;font-size:12px;text-align:center;margin-top:32px;">
          Sent by Read Later · your personal reading assistant
        </p>
      </div>
    </div>`;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {

    // 1. Auth check
    const secret = getSecret(req.headers);
    const expected = process.env.CRON_SECRET;
    if (!expected || secret !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Check required env vars upfront
    const groqKey     = process.env.GROQ_API_KEY;
    const brevoKey    = process.env.BREVO_API_KEY;
    const toEmail     = process.env.BREVO_TO_EMAIL;
    const senderEmail = process.env.BREVO_SENDER_EMAIL;

    if (!groqKey)     return NextResponse.json({ error: "Missing: GROQ_API_KEY" },     { status: 500 });
    if (!brevoKey)    return NextResponse.json({ error: "Missing: BREVO_API_KEY" },    { status: 500 });
    if (!toEmail)     return NextResponse.json({ error: "Missing: BREVO_TO_EMAIL" },   { status: 500 });
    if (!senderEmail) return NextResponse.json({ error: "Missing: BREVO_SENDER_EMAIL" }, { status: 500 });

    // 3. Fetch this week's articles from Supabase
    const supabase = createServerClient();
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: articles, error } = await supabase
      .from("articles")
      .select("id, title, summary, key_points, url, tags")
      .gte("saved_at", oneWeekAgo)
      .eq("archived", false)
      .order("saved_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // No articles this week — skip email
    if (!articles || articles.length === 0) {
      return NextResponse.json({ ok: true, emailed: false, message: "No articles this week" });
    }

    // 4. Use Groq to write the connecting narrative
    const groq = new Groq({ apiKey: groqKey });

    const articleList = articles.map((a, i) => {
      const points = getKeyPoints(a.key_points);
      return [
        `Article ${i + 1}: ${a.title ?? a.url}`,
        `Summary: ${a.summary ?? "(none)"}`,
        points.length ? `Key points: ${points.join(" | ")}` : "",
      ].filter(Boolean).join("\n");
    }).join("\n\n");

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content: "You write warm, engaging reading digest intros. Plain text only — no markdown, no bullet points, no headers.",
        },
        {
          role: "user",
          content: `Write exactly 2 paragraphs connecting the themes across these articles. Make it feel like a thoughtful friend summarizing your week of reading.\n\n${articleList}`,
        },
      ],
    });

    const narrative = completion.choices[0]?.message?.content?.trim()
      ?? `You saved ${articles.length} articles this week. Here's your digest.`;

    // 5. Send the email via Brevo
    const weekOf = new Date().toLocaleDateString("en-IN", {
      day: "numeric", month: "long", year: "numeric",
    });

    const htmlContent = buildEmailHtml(narrative, articles as Article[], weekOf);

    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": brevoKey,
      },
      body: JSON.stringify({
        sender: { name: "Read Later", email: senderEmail },
        to: [{ email: toEmail, name: "Reader" }],
        subject: `Your Reading Digest — ${weekOf}`,
        htmlContent,
      }),
    });

    if (!brevoRes.ok) {
      const brevoError = await brevoRes.text();
      throw new Error(`Brevo error: ${brevoError}`);
    }

    // 6. Log the digest run
    try {
      await supabase.from("digest_logs").insert({
        user_id: "local-user",
        article_ids: articles.map((a) => a.id),
      });
    } catch (e) {
      console.error("digest_logs insert failed (non-fatal):", e);
    }

    return NextResponse.json({
      ok: true,
      emailed: true,
      articleCount: articles.length,
      message: `Digest sent to ${toEmail}`,
    });

  } catch (err) {
    console.error("POST /api/digest failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}