"use client";
import { useEffect, useRef, useState } from "react";
import { Dices, Hand, Loader2, Play, RotateCcw, Sparkles, Square, Trophy, Zap } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { Badge, Card, EmptyState, Notice } from "@/components/ui";
import { reportWinnerMessage, WinnerShareModal } from "@/components/winner-message";
import { formatMoney } from "@/lib/format";
import { themeFor } from "@/lib/letter-themes";
import type { WinnerNotifyResult } from "@/lib/winner-notify";
import { runDraw, type DrawResult } from "./actions";

type Phase = "idle" | "shuffling" | "drawing" | "revealing" | "done";
type Mode = "auto" | "manual";

const AUTO_SHUFFLE_MS = 4500;
const STEP_MS = 340;

function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function useWide() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

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

export function DrawClient(props: {
  months: { id: string; month_number: number; label: string }[];
  selectedId: string | null;
  eligible: string[];
  slug: string;
  payout: number;
  currency: string;
}) {
  // Freeze the inputs for this draw: the page refreshes in the background once the
  // winner is saved, and the animation must keep showing until the admin presses Done.
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
  const wide = useWide();
  const cardCount = Math.max(1, Math.min(4, eligible.length));
  const [mode, setMode] = useState<Mode>("auto");
  const [phase, setPhase] = useState<Phase>("idle");
  const [order, setOrder] = useState<number[]>(() => Array.from({ length: cardCount }, (_, i) => i));
  const [tilt, setTilt] = useState<number[]>(() => Array(cardCount).fill(0));
  const [result, setResult] = useState<DrawResult | null>(null);
  const [flipped, setFlipped] = useState<boolean[]>(() => Array(cardCount).fill(false));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [share, setShare] = useState<WinnerNotifyResult | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const month = months.find((m) => m.id === selectedId) ?? null;

  useEffect(() => () => stopShuffle(), []);

  function startShuffle() {
    stopShuffle();
    setPhase("shuffling");
    timer.current = setInterval(() => {
      setOrder(shuffled(cardCount));
      setTilt(Array.from({ length: cardCount }, () => Math.round((Math.random() - 0.5) * 24)));
    }, STEP_MS);
  }

  function stopShuffle() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setTilt(Array(cardCount).fill(0));
  }

  async function reveal(r: DrawResult) {
    setPhase("revealing");
    // Cards are dealt in slot order; flip them one at a time, winner last.
    const winnerIdx = r.candidates.findIndex((c) => c.slot === r.winner_slot);
    const sequence = [...r.candidates.keys()].filter((i) => i !== winnerIdx).concat(winnerIdx);
    for (const i of sequence) {
      await new Promise((res) => setTimeout(res, 650));
      setFlipped((f) => f.map((v, j) => (j === i ? true : v)));
    }
    await new Promise((res) => setTimeout(res, 500));
    setPhase("done");
    if (reportWinnerMessage(r.notify)) setShare(r.notify);
  }

  async function draw() {
    if (!month) return;
    setConfirmOpen(false);
    setResult(null);
    setFlipped(Array(cardCount).fill(false));
    const started = Date.now();
    if (mode === "auto") startShuffle();
    setPhase(mode === "auto" ? "shuffling" : "drawing");
    const res = await runDraw(month.id, mode);
    if (!res.ok) {
      stopShuffle();
      setPhase("idle");
      toast.error(res.error);
      return;
    }
    if (mode === "auto") {
      const wait = Math.max(0, AUTO_SHUFFLE_MS - (Date.now() - started));
      await new Promise((r) => setTimeout(r, wait));
    }
    stopShuffle();
    setOrder(Array.from({ length: cardCount }, (_, i) => i));
    setResult(res.data!);
    await reveal(res.data!);
  }

  if (!month) {
    return <EmptyState title="Nothing to draw right now">Every started month already has a winner. The next draw opens when the next month begins.</EmptyState>;
  }
  if (eligible.length === 0) {
    return <EmptyState title="Everyone has already won">There are no members left to draw.</EmptyState>;
  }

  const busy = phase === "shuffling" || phase === "drawing" || phase === "revealing";
  const cols = wide ? Math.min(cardCount, 4) : Math.min(cardCount, 2);
  const rows = Math.ceil(cardCount / cols);
  const cardW = wide ? 168 : 132;
  const cardH = Math.round(cardW * 1.4);
  const gap = wide ? 22 : 14;
  const boardW = cols * cardW + (cols - 1) * gap;
  const boardH = rows * cardH + (rows - 1) * gap;
  const shownCount = result ? result.candidates.length : cardCount;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="relative overflow-hidden">
        <div className="relative rounded-2xl bg-gradient-to-br from-brand-800 via-brand-900 to-[#022c22] px-4 py-8 text-white sm:py-10">
          {phase === "done" && <Confetti />}
          <div className="relative text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-gold-300">Lucky draw</p>
            <p className="mt-1 text-xl font-bold sm:text-2xl">Month {month.month_number} · {month.label}</p>
            <p className="text-sm text-emerald-100/80">Prize: {formatMoney(payout, currency)}</p>
          </div>

          <div className="relative mx-auto mt-8" style={{ width: boardW, height: boardH, perspective: 1200 }}>
            {Array.from({ length: shownCount }, (_, i) => {
              const slotIndex = order.indexOf(i) === -1 ? i : order.indexOf(i);
              const x = (slotIndex % cols) * (cardW + gap);
              const y = Math.floor(slotIndex / cols) * (cardH + gap);
              const cand = result?.candidates[i];
              const isWinner = phase === "done" && cand?.slot === result?.winner_slot;
              const isLoser = phase === "done" && !isWinner;
              const th = cand ? themeFor(cand.slot) : null;
              return (
                <div
                  key={i}
                  className="absolute transition-all ease-out"
                  style={{
                    width: cardW,
                    height: cardH,
                    left: x,
                    top: y,
                    transitionDuration: phase === "shuffling" ? `${STEP_MS - 40}ms` : "500ms",
                    transform: `rotate(${tilt[i] ?? 0}deg) scale(${isWinner ? 1.1 : isLoser ? 0.92 : 1})`,
                    opacity: isLoser ? 0.55 : 1,
                    zIndex: isWinner ? 10 : 1,
                  }}
                >
                  <div
                    className="relative size-full transition-transform duration-700"
                    style={{ transformStyle: "preserve-3d", transform: flipped[i] ? "rotateY(180deg)" : "rotateY(0deg)" }}
                  >
                    {/* Back of the card */}
                    <div
                      className="absolute inset-0 grid place-items-center rounded-2xl border-2 border-gold-400/70 shadow-xl"
                      style={{
                        backfaceVisibility: "hidden",
                        background:
                          "repeating-linear-gradient(45deg, rgba(212,164,55,0.16) 0 10px, transparent 10px 20px), linear-gradient(160deg, #047857, #022c22)",
                      }}
                    >
                      <div className="grid size-16 place-items-center rounded-full border-2 border-gold-300/80 bg-black/20 text-3xl font-black text-gold-300 sm:size-20 sm:text-4xl">
                        ?
                      </div>
                    </div>
                    {/* Front of the card */}
                    <div
                      className={`absolute inset-0 flex flex-col items-center justify-center rounded-2xl border-2 shadow-2xl ${isWinner ? "ring-4 ring-gold-300" : ""}`}
                      style={{
                        backfaceVisibility: "hidden",
                        transform: "rotateY(180deg)",
                        background: th ? `linear-gradient(160deg, ${th.from}, ${th.to})` : "#064e3b",
                        borderColor: th?.accent ?? "#f5d68a",
                      }}
                    >
                      <span className="text-[11px] uppercase tracking-widest text-white/70">Slot</span>
                      <span className="text-6xl font-black sm:text-7xl" style={{ color: th?.accent }}>{cand?.slot}</span>
                      {isWinner && (
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-gold-400 px-2.5 py-0.5 text-xs font-bold text-[#3b2a06]">
                          <Trophy className="size-3.5" /> WINNER
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="relative mt-8 flex flex-col items-center gap-3">
            {phase === "done" && result ? (
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
            ) : mode === "manual" && phase === "shuffling" ? (
              <button className="btn bg-gold-400 px-6 text-base font-bold text-[#3b2a06] hover:bg-gold-300" onClick={() => setConfirmOpen(true)}>
                <Square className="size-4" /> Stop &amp; pick the winner
              </button>
            ) : (
              <button
                className="btn bg-gold-400 px-6 text-base font-bold text-[#3b2a06] hover:bg-gold-300 disabled:opacity-60"
                disabled={busy}
                onClick={() => (mode === "manual" ? startShuffle() : setConfirmOpen(true))}
              >
                {busy ? <Loader2 className="size-5 animate-spin" /> : mode === "manual" ? <Hand className="size-5" /> : <Play className="size-5" />}
                {busy ? (phase === "revealing" ? "Revealing…" : "Shuffling…") : mode === "manual" ? "Start shuffling" : "Start automatic draw"}
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
              ? "One click: the cards shuffle for a few seconds, then the winner is revealed and announced."
              : "You start the shuffle and press “Stop” when you’re ready, e.g. live in front of the family."}
          </p>
        </Card>
        <Card title="Who can win">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {eligible.length} member{eligible.length === 1 ? "" : "s"} haven’t won yet. {Math.min(4, eligible.length)} of them are dealt as cards at random, then one card wins.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {eligible.map((s) => <Badge key={s}>{s}</Badge>)}
          </div>
        </Card>
        <Notice tone="green" title="Fair and recorded">
          The winner is chosen on the server using secure randomness. The result, the 4 cards and the time are saved in the draw history and the activity log, and the draw can’t be repeated for the same month.
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
        description="The winner is final and saved immediately. Only an owner can correct it afterwards, with a reason."
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={() => void draw()}>
              <Dices className="size-4" /> Yes, draw now
            </button>
          </>
        }
      >
        <p className="text-sm">The winner will also get their personal WhatsApp message with their winner banner automatically.</p>
      </Modal>

      <WinnerShareModal result={share} bannerSrc={result ? `/api/banner/${slug}/${result.month_number}` : null} onClose={() => setShare(null)} />
    </div>
  );
}
