// Public values (safe in the browser)
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function supabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** The public address of this app, used in links and WhatsApp banner images. */
export function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (explicit && !(process.env.VERCEL && explicit.includes("localhost"))) return explicit;
  if (vercel) return `https://${vercel}`;
  return explicit || "http://localhost:3000";
}
