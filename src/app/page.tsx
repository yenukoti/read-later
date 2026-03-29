"use client";

import { useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";

import { createBrowserClient } from "../../lib/supabase";

type Article = {
  id: string | number;
  user_id?: string;
  url: string;
  title: string;
  summary?: string | null;
  tags?: string[] | string | null;
  key_points?: string[] | null;
  saved_at?: string | null;
  read_at?: string | null;
  archived_at?: string | null;
};

function formatSavedAt(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function normalizeTags(value: Article["tags"]): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((t): t is string => typeof t === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === "string");
    } catch {
      // ignore
    }
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeKeyPoints(value: Article["key_points"]): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((t): t is string => typeof t === "string");
  return [];
}

function pickPillColors(i: number) {
  const colors = [
    "bg-blue-50 text-blue-700 ring-blue-100",
    "bg-emerald-50 text-emerald-700 ring-emerald-100",
    "bg-amber-50 text-amber-700 ring-amber-100",
    "bg-violet-50 text-violet-700 ring-violet-100",
    "bg-rose-50 text-rose-700 ring-rose-100",
    "bg-sky-50 text-sky-700 ring-sky-100",
  ];
  return colors[i % colors.length];
}

export default function Home() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const userId = session?.user.id ?? null;

  const [urlToSave, setUrlToSave] = useState<string>("");
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = createBrowserClient();
    setSupabase(client);

    let cancelled = false;

    void client.auth.getSession().then(({ data: { session: initial } }) => {
      if (cancelled) return;
      setSession(initial);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/articles", {
      method: "GET",
      headers: {
        "x-user-id": userId,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Failed to load (${res.status})`);
        }
        return res.json() as Promise<Article[]>;
      })
      .then((data) => {
        if (cancelled) return;
        setArticles(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load articles.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function saveUrl() {
    if (!userId) return;
    setIsSaving(true);
    setIsSummarizing(false);
    setError(null);
    try {
      const res = await fetch("/api/articles", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": userId,
        },
        body: JSON.stringify({ url: urlToSave }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed to save (${res.status})`);
      }

      const saved = (await res.json()) as Article;
      setArticles((prev) => [saved, ...prev]);
      setUrlToSave("");

      // Gemini summary runs asynchronously; refresh after a short delay.
      window.setTimeout(() => {
        fetch("/api/articles", {
          method: "GET",
          headers: {
            "x-user-id": userId,
          },
        })
          .then(async (res) => {
            if (!res.ok) return;
            const data = (await res.json()) as Article[];
            setArticles(data);
          })
          .catch(() => {
            // ignore refresh errors
          })
          .finally(() => setIsSummarizing(false));
      }, 3500);

      setIsSaving(false);
      setIsSummarizing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save article.");
      setIsSaving(false);
      setIsSummarizing(false);
    }
  }

  async function markRead(article: Article) {
    const iso = new Date().toISOString();
    setArticles((prev) => prev.map((a) => (a.id === article.id ? { ...a, read_at: iso } : a)));
    if (!supabase) return;
    try {
      await supabase.from("articles").update({ read_at: iso }).eq("id", article.id);
    } catch {
      // Optimistic UI only (RLS/schema issues will be reflected on next reload).
    }
  }

  async function archive(article: Article) {
    const iso = new Date().toISOString();
    setArticles((prev) => prev.map((a) => (a.id === article.id ? { ...a, archived_at: iso } : a)));
    if (!supabase) return;
    try {
      await supabase.from("articles").update({ archived_at: iso }).eq("id", article.id);
    } catch {
      // Optimistic UI only.
    }
  }

  async function signInWithGoogle() {
    if (!supabase) return;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined,
      },
    });
    if (oauthError) setError(oauthError.message);
  }

  async function signOut() {
    if (!supabase) return;
    setError(null);
    await supabase.auth.signOut();
    setArticles([]);
  }

  if (authLoading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-background px-4 py-16">
        <div className="flex flex-col items-center gap-3 text-foreground/70">
          <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/60" />
          <p className="text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center bg-background px-4 py-16">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Read Later</h1>
          <p className="mt-2 text-sm text-foreground/70">
            Save articles. Get AI summaries. Weekly digest.
          </p>
          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            disabled={!supabase}
            className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-foreground/15 bg-white px-4 py-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-foreground/5 disabled:opacity-60 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </button>
          {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background">
      <nav className="sticky top-0 z-10 border-b border-foreground/10 bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-4">
          <div className="text-base font-semibold tracking-tight">Read Later</div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-lg border border-foreground/15 bg-white px-3 py-2 text-sm text-foreground shadow-sm hover:bg-foreground/5 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            Sign out
          </button>
        </div>
      </nav>

      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="flex flex-col gap-5">
          <header className="flex flex-col gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Saved Articles</h1>
            <p className="text-sm text-foreground/70">
              Paste a URL, we’ll scrape it, summarize it, and save it.
            </p>
          </header>

          <section className="rounded-2xl border border-foreground/10 bg-white/60 p-3">
            <div className="flex w-full items-stretch gap-2">
              <input
                disabled={isSaving || isSummarizing}
                className="flex-1 rounded-xl border border-foreground/10 bg-white px-3 py-2.5 text-foreground outline-none focus:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-zinc-900"
                placeholder="Paste a URL to save…"
                value={urlToSave}
                onChange={(e) => setUrlToSave(e.target.value)}
              />
              <button
                className="inline-flex min-w-[132px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:opacity-60"
                disabled={isSaving || isSummarizing || !urlToSave.trim()}
                onClick={saveUrl}
                type="button"
              >
                {isSaving ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Saving…
                  </>
                ) : isSummarizing ? (
                  <>Saving and summarizing…</>
                ) : (
                  <>Save</>
                )}
              </button>
            </div>

            {isSummarizing && (
              <div className="mt-2 text-sm text-foreground/70">Saving and summarizing…</div>
            )}
            {error && <div className="mt-3 text-sm text-rose-700">{error}</div>}
          </section>

          <section>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="animate-pulse rounded-xl border border-foreground/10 bg-white/60 p-4"
                  >
                    <div className="h-4 w-2/3 rounded bg-foreground/10" />
                    <div className="mt-3 h-3 w-full rounded bg-foreground/10" />
                    <div className="mt-2 h-3 w-5/6 rounded bg-foreground/10" />
                  </div>
                ))}
              </div>
            ) : articles.length === 0 ? (
              <div className="rounded-2xl border border-foreground/10 bg-white/60 p-8 text-center dark:bg-zinc-900">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/5 ring-1 ring-foreground/10">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-6 w-6 text-foreground/70"
                  >
                    <path d="M6 4h12a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2z" />
                  </svg>
                </div>
                <div className="mt-4 text-base font-medium">Nothing saved yet</div>
                <div className="mt-1 text-sm text-foreground/70">
                  Paste a URL above and we’ll scrape and summarize it.
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {articles.map((a) => {
                  const tags = normalizeTags(a.tags);
                  const keyPoints = normalizeKeyPoints(a.key_points);
                  const savedAtLabel = formatSavedAt(a.saved_at);
                  return (
                    <article
                      key={String(a.id)}
                      className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10"
                    >
                      <div className="flex flex-col gap-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h2 className="truncate text-base font-semibold leading-6">
                              <a
                                href={a.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-foreground hover:text-foreground/80 underline decoration-foreground/20 hover:decoration-foreground/40"
                              >
                                {a.title || "Untitled"}
                              </a>
                            </h2>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm shadow-sm hover:bg-white/80 disabled:opacity-60 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                              disabled={!!a.read_at}
                              onClick={() => markRead(a)}
                            >
                              Mark as Read
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm shadow-sm hover:bg-white/80 disabled:opacity-60 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                              disabled={!!a.archived_at}
                              onClick={() => archive(a)}
                            >
                              Archive
                            </button>
                          </div>
                        </div>

                        <div className="text-xs text-foreground/60">
                          {savedAtLabel ? `Saved ${savedAtLabel}` : ""}
                        </div>

                        <p className="text-sm leading-6 text-foreground/80">
                          {a.summary ? a.summary : "Summarizing…"}
                        </p>

                        <ul className="list-inside list-disc space-y-1 text-sm text-foreground/80">
                          {keyPoints.length ? (
                            keyPoints.map((kp, i) => <li key={`${kp}-${i}`}>{kp}</li>)
                          ) : (
                            <li className="text-foreground/60">(No key points yet)</li>
                          )}
                        </ul>

                        {tags.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {tags.slice(0, 10).map((t, i) => (
                              <span
                                key={`${t}-${i}`}
                                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs ring-1 ${pickPillColors(i)}`}
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
