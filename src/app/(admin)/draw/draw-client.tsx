"use client";
import { useEffect, useRef, useState } from "react";
import { Dices, Hand, Loader2, Play, RotateCcw, Sparkles, Square, Trash2, Trophy, Zap } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { Card, EmptyState, Field, Notice } from "@/components/ui";
import { reportWinnerMessage, WinnerShareModal } from "@/components/winner-message";
import { formatMoney } from "@/lib/format";
import { themeFor } from "@/lib/letter-themes";
import type { WinnerNotifyResult } from "@/lib/winner-notify";
import { deleteDraw, runDraw, type DrawResult } from "./actions";

type Phase = "idle" | "spinning" | "drawing" | "landing" | "done";
type Mode = "auto" | "manual";

const AUTO_SPIN_MS = 4000;
const SPIN_STEP_MS = 70;
/** Delays (ms) between the last letters as the card slows down and stops on the winner. */
const SLOWDOWN = [90, 110, 140, 180, 230, 300, 390, 520];

function Confetti() {
  const pieces = Array.from({ length: 70 }, (_, i) => i);
  const colors = ["#f5d68a", "#10b981", "#fde68a", "#34d399", "#ffffff", "#d4a437"];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {pieces.map((i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${(i * 37) % 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${(i % 14) * 0.08}s`,
            animationDuration: `${2.2 + (i % 5) * 0.35}s`,
            transform: `rotate(${i * 23}deg)`,
          }}
        />
      ))}
    </div>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function DrawClient(props: {
  months: { id: string; month_number: number; label: string }[];
  selectedId: string | null;
  eligible: string[];
  slug: string;
  payout: number;
  currency: string;
}) {
  // Freeze the inputs for this draw: the page refreshes in the background once the
  // winner is saved, and the result must keep showing until the admin presses Done.
  const [frozen] = useState(props);
  return <DrawBoard {...frozen} />;
}

function DrawBoard({
  months,
  selectedId,
  eligible,
  slug,
  payout,
  currency,
}: {
  months: { id: string; month_number: number; label: string }[];
  selectedId: string | null;
  eligible: string[];
  slug: string;
  payout: number;
  currency: string;
}) {
  const [mode, setMode] = useState<Mode>("auto");
  const [phase, setPhase] = useState<Phase>("idle");
  const [face, setFace] = useState<string | null>(null);
  const [bump, setBump] = useState(0);
  const [result, setResult] = useState<DrawResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [share, setShare] = useState<WinnerNotifyResult | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const month = months.find((m) => m.id === selectedId) ?? null;

  useEffect(() => () => stopSpin(), []);

  function randomLetter(not?: string | null) {
    if (eligible.length === 1) return eligible[0];
    let l = eligible[Math.floor(Math.random() * eligible.length)];
    while (l === not) l = eligible[Math.floor(Math.random() * eligible.length)];
    return l;
  }

  function startSpin() {
    stopSpin();
    setPhase("spinning");
    timer.current = setInterval(() => {
      setFace((f) => randomLetter(f));
      setBump((b) => b + 1);
    }, SPIN_STEP_MS);
  }

  function stopSpin() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }

  async function land(r: DrawResult) {
    setPhase("landing");
    let last: string | null = face;
    for (const d of SLOWDOWN) {
      last = randomLetter(last === r.winner_slot ? null : last);
      if (last === r.winner_slot) last = randomLetter(r.winner_slot);
      setFace(last);
      setBump((b) => b + 1);
      await sleep(d);
    }
    setFace(r.winner_slot);
    setBump((b) => b + 1);
    await sleep(450);
    setPhase("done");
    if (reportWinnerMessage(r.notify)) setShare(r.notify);
  }

  async function draw() {
    if (!month) return;
    setConfirmOpen(false);
    setResult(null);
    const started = Date.now();
    if (phase !== "spinning") startSpin();
    setPhase(mode === "auto" ? "spinning" : "drawing");
    const res = await runDraw(month.id, mode);
    if (!res.ok) {
      stopSpin();
      setPhase("idle");
      setFace(null);
      toast.error(res.error);
      return;
    }
    if (mode === "auto") await sleep(Math.max(0, AUTO_SPIN_MS - (Date.now() - started)));
    stopSpin();
    setResult(res.data!);
    await land(res.data!);
  }

  if (!month) {
    return <EmptyState title="Nothing to draw right now">Every started month already has a winner. The next draw opens when the next month begins.</EmptyState>;
  }
  if (eligible.length === 0) {
    return <EmptyState title="Everyone has already won">There are no members left to draw.</EmptyState>;
  }

  const busy = phase === "spinning" || phase === "drawing" || phase === "landing";
  const th = face ? themeFor(face) : null;
  const isWinner = phase === "done" && !!result;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="relative overflow-hidden">
        <div className="relative rounded-2xl bg-gradient-to-br from-brand-800 via-brand-900 to-[#022c22] px-4 py-8 text-white sm:py-10">
          {isWinner && <Confetti />}
          <div className="relative text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-gold-300">Lucky draw · one winner</p>
            <p className="mt-1 text-xl font-bold sm:text-2xl">Month {month.month_number} · {month.label}</p>
            <p className="text-sm text-emerald-100/80">Prize: {formatMoney(payout, currency)}</p>
          </div>

          {/* The single draw card */}
          <div className="relative mx-auto mt-8 grid place-items-center">
            <div
              key={bump}
              className={`grid h-64 w-48 place-items-center rounded-3xl border-4 shadow-2xl sm:h-72 sm:w-56 ${busy ? "draw-tick" : ""} ${isWinner ? "ring-8 ring-gold-300/70" : ""}`}
              style={{
                background: face && th
                  ? `linear-gradient(160deg, ${th.from}, ${th.to})`
                  : "repeating-linear-gradient(45deg, rgba(212,164,55,0.16) 0 10px, transparent 10px 20px), linear-gradient(160deg, #047857, #022c22)",
                borderColor: th?.accent ?? "#f5d68a",
                transform: isWinner ? "scale(1.06)" : undefined,
                transition: "transform 400ms ease-out",
              }}
              aria-live="polite"
            >
              {face ? (
                <div className="text-center">
                  <span className="block text-[11px] uppercase tracking-widest text-white/70">Slot</span>
                  <span className="block text-8xl font-black leading-none sm:text-9xl" style={{ color: th?.accent }}>{face}</span>
                  {isWinner && (
                    <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-gold-400 px-3 py-1 text-xs font-bold text-[#3b2a06]">
                      <Trophy className="size-3.5" /> WINNER
                    </span>
                  )}
                </div>
              ) : (
                <div className="grid size-24 place-items-center rounded-full border-2 border-gold-300/80 bg-black/20 text-5xl font-black text-gold-300">?</div>
              )}
            </div>
          </div>

          {/* Everyone taking part */}
          <div className="relative mx-auto mt-6 flex max-w-lg flex-wrap justify-center gap-1.5">
            {eligible.map((s) => {
              const on = face === s && (busy || isWinner);
              return (
                <span
                  key={s}
                  className={`grid size-8 place-items-center rounded-lg text-sm font-bold transition ${
                    on ? (isWinner ? "bg-gold-400 text-[#3b2a06]" : "bg-white text-brand-900") : "bg-white/10 text-white/70"
                  }`}
                >
                  {s}
                </span>
              );
            })}
          </div>

          <div className="relative mt-8 flex flex-col items-center gap-3">
            {isWinner && result ? (
              <>
                <p className="text-center text-2xl font-black sm:text-3xl">
                  <Sparkles className="mr-1 inline size-6 text-gold-300" /> Slot {result.winner_slot} wins month {result.month_number}!
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <a className="btn btn-secondary" href={`/banners?month=${result.month_number}`}>View winner banner</a>
                  <button className="btn btn-ghost text-white hover:bg-white/10" onClick={() => window.location.assign("/draw")}>
                    <RotateCcw className="size-4" /> Done
                  </button>
                </div>
              </>
            ) : mode === "manual" && phase === "spinning" ? (
              <button className="btn bg-gold-400 px-6 text-base font-bold text-[#3b2a06] hover:bg-gold-300" onClick={() => setConfirmOpen(true)}>
                <Square className="size-4" /> Stop &amp; pick the winner
              </button>
            ) : (
              <button
                className="btn bg-gold-400 px-6 text-base font-bold text-[#3b2a06] hover:bg-gold-300 disabled:opacity-60"
                disabled={busy}
                onClick={() => (mode === "manual" ? startSpin() : setConfirmOpen(true))}
              >
                {busy ? <Loader2 className="size-5 animate-spin" /> : mode === "manual" ? <Hand className="size-5" /> : <Play className="size-5" />}
                {busy ? (phase === "landing" ? "Picking the winner…" : "Spinning…") : mode === "manual" ? "Start spinning" : "Start automatic draw"}
              </button>
            )}
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Draw mode">
          <div className="grid grid-cols-2 gap-2">
            {(["auto", "manual"] as Mode[]).map((m) => (
              <button
                key={m}
                disabled={busy || phase === "done"}
                onClick={() => setMode(m)}
                className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-sm font-semibold transition ${
                  mode === m ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-200" : "border-slate-200 dark:border-slate-700"
                }`}
              >
                {m === "auto" ? <Zap className="size-5" /> : <Hand className="size-5" />}
                {m === "auto" ? "Automatic" : "Manual"}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {mode === "auto"
              ? "One click: the card spins through the letters for a few seconds, then stops on the one winner."
              : "You start the spin and press “Stop” when you’re ready, e.g. live in front of the family."}
          </p>
        </Card>
        <Card title="Who can win">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {eligible.length} member{eligible.length === 1 ? "" : "s"} haven’t won yet. All of them take part, and <b>one</b> winner is picked for this month only.
          </p>
        </Card>
        <Notice tone="green" title="One winner per draw">
          Each draw announces exactly one winner for one month. To draw another month, open it from “Other open months” and run a new draw. A wrong draw can be deleted from the draw history below (owner only).
        </Notice>
        {months.length > 1 && (
          <Card title="Other open months">
            <ul className="space-y-1 text-sm">
              {months.map((m) => (
                <li key={m.id}>
                  <a className={`hover:underline ${m.id === selectedId ? "font-semibold" : ""}`} href={`/draw?month=${m.month_number}`}>
                    <Dices className="mr-1 inline size-4" /> Month {m.month_number} · {m.label}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Draw the month ${month.month_number} winner?`}
        description="One winner is picked and saved immediately. If it was a mistake, an owner can delete the draw afterwards."
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={() => void draw()}>
              <Dices className="size-4" /> Yes, draw now
            </button>
          </>
        }
      >
        <p className="text-sm">The winner will also get their personal WhatsApp message with their winner banner (when WhatsApp is connected).</p>
      </Modal>

      <WinnerShareModal result={share} bannerSrc={result ? `/api/banner/${slug}/${result.month_number}` : null} onClose={() => setShare(null)} />
    </div>
  );
}

/** Delete button for one row of the draw history (owner only). */
export function DeleteDrawButton({ drawId, label }: { drawId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const res = await deleteDraw(drawId, reason);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    setOpen(false);
    window.location.assign("/draw");
  }

  return (
    <>
      <button className="btn btn-ghost btn-sm text-rose-600" onClick={() => { setReason(""); setOpen(true); }} aria-label={`Delete draw: ${label}`} title="Delete this draw">
        <Trash2 className="size-4" />
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete this draw?"
        description={`${label}. The winner announcement is cancelled and this month can be drawn again. The deletion is kept in the activity log.`}
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => void confirm()} disabled={busy || reason.trim().length < 5}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete draw
            </button>
          </>
        }
      >
        <Field label="Reason (saved in the activity log)" htmlFor="del-reason" hint="At least 5 characters, e.g. “Drawn by mistake for the wrong month”.">
          <input id="del-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>
    </>
  );
}

