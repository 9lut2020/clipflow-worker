/**
 * Public URL of the Next.js frontend, used for links in notifications.
 * FRONTEND_URL wins; otherwise the first configured CORS origin.
 */
export function getFrontendUrl(env: any): string {
  const explicit = String(env?.FRONTEND_URL || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const firstOrigin = String(env?.CORS_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .find(Boolean);
  return (firstOrigin || "https://clipflow-tmyda.vercel.app").replace(/\/$/, "");
}
