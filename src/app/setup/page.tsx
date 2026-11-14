export const dynamic = "force-dynamic";

export default function SetupPage() {
  const has = (k: string) => Boolean(process.env[k]);
  const rows = [
    ["NEXT_PUBLIC_SUPABASE_URL", has("NEXT_PUBLIC_SUPABASE_URL"), true],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", has("NEXT_PUBLIC_SUPABASE_ANON_KEY"), true],
    ["SUPABASE_SERVICE_ROLE_KEY", has("SUPABASE_SERVICE_ROLE_KEY"), true],
    ["CRON_SECRET", has("CRON_SECRET"), true],
    ["WHATSAPP_ACCESS_TOKEN", has("WHATSAPP_ACCESS_TOKEN"), false],
    ["WHATSAPP_PHONE_NUMBER_ID", has("WHATSAPP_PHONE_NUMBER_ID"), false],
  ] as const;
  return (
    <div className="grid min-h-dvh place-items-center px-5 py-10">
      <div className="card card-pad w-full max-w-lg">
        <h1 className="text-lg font-bold">Finish setting up</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          The app can’t connect to Supabase yet. Add these environment variables (see <code>.env.example</code> and the README), then restart or redeploy.
        </p>
        <ul className="mt-4 divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {rows.map(([key, ok, required]) => (
            <li key={key} className="flex items-center justify-between py-2">
              <code className="text-xs">{key}</code>
              <span className={ok ? "text-emerald-600" : required ? "text-rose-600" : "text-slate-400"}>
                {ok ? "Set" : required ? "Missing" : "Optional"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
