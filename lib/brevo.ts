export async function sendDigestEmail({
  toEmail,
  toName,
  articles,
  intro,
  weekOf,
}: {
  toEmail: string;
  toName: string;
  articles: {
    title: string;
    url: string;
    summary: string;
    key_points: string[];
    tags: string[];
  }[];
  intro: string;
  weekOf: string;
}) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error("Missing env: BREVO_API_KEY");

  // Build the HTML email body
  const articlesHtml = articles
    .map(
      (a) => `
      <div style="margin-bottom:32px;padding-bottom:32px;border-bottom:1px solid #eee;">
        <h2 style="margin:0 0 8px;">
          <a href="${a.url}" style="color:#4f46e5;text-decoration:none;">${a.title}</a>
        </h2>
        <p style="color:#555;margin:0 0 12px;line-height:1.6;">${a.summary}</p>
        <ul style="margin:0 0 12px;padding-left:20px;color:#444;">
          ${a.key_points.map((p) => `<li style="margin-bottom:4px;">${p}</li>`).join("")}
        </ul>
        <div>
          ${a.tags.map((t) => `<span style="display:inline-block;background:#eef2ff;color:#4f46e5;padding:2px 10px;border-radius:99px;font-size:12px;margin-right:4px;">${t}</span>`).join("")}
        </div>
      </div>`
    )
    .join("");

  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:sans-serif;color:#222;">
      <div style="background:#4f46e5;padding:24px;border-radius:12px 12px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:22px;">Your Reading Digest</h1>
        <p style="color:#c7d2fe;margin:4px 0 0;">${weekOf}</p>
      </div>
      <div style="background:#fff;padding:32px;border:1px solid #eee;border-top:none;">
        <p style="font-size:16px;line-height:1.7;color:#444;margin:0 0 32px;">${intro}</p>
        ${articlesHtml}
        <p style="color:#aaa;font-size:12px;text-align:center;margin-top:32px;">
          Sent by Read Later · your personal reading assistant
        </p>
      </div>
    </div>`;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: { name: "Read Later", email: toEmail },
      to: [{ email: toEmail, name: toName }],
      subject: `Your Reading Digest — ${weekOf}`,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Brevo send failed: ${error}`);
  }

  return await res.json();
}