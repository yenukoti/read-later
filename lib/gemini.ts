import Groq from "groq-sdk";

export type GeminiSummary = {
  summary: string;
  key_points: string[];
  tags: string[];
};

const DEFAULT_RESULT: GeminiSummary = {
  summary: "",
  key_points: [],
  tags: [],
};

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function coerceResult(value: unknown): GeminiSummary {
  if (!value || typeof value !== "object") return DEFAULT_RESULT;
  const obj = value as Partial<Record<keyof GeminiSummary, unknown>>;
  const summary = typeof obj.summary === "string" ? obj.summary : "";
  const key_points = Array.isArray(obj.key_points)
    ? obj.key_points.filter((x): x is string => typeof x === "string")
    : [];
  const tags = Array.isArray(obj.tags)
    ? obj.tags.filter((x): x is string => typeof x === "string")
    : [];
  return { summary, key_points, tags };
}

export async function summarizeArticle(content: string): Promise<GeminiSummary> {
  try {
    if (typeof window !== "undefined") {
      throw new Error("summarizeArticle must run on the server.");
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("Missing env: GROQ_API_KEY");

    const groq = new Groq({ apiKey });

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile", // free, fast, high limits
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a summarization assistant. Always respond with valid JSON only. No markdown, no code fences, no extra text.",
        },
        {
          role: "user",
          content: `Summarize this article. Return JSON only in this exact shape:
{ "summary": string, "key_points": string[], "tags": string[] }

Guidelines: summary = 2-3 sentences; key_points = 3-5 short bullet strings; tags = lowercase single words.

Article:
${content.slice(0, 6000)}`,
        },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const parsed = extractJsonObject(text);
    return coerceResult(parsed);
  } catch (err) {
    console.error("Groq summarizeArticle failed:", err);
    return DEFAULT_RESULT;
  }
}