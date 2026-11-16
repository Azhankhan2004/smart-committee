// Winner banner artwork for next/og (Satori). Satori supports a subset of CSS:
// flexbox layout, absolute positioning, gradients, borders and inline SVG.
import { themeFor, type LetterTheme, type Pattern } from "./letter-themes";

export type BannerData = {
  slot: string;
  committeeName: string;
  monthLabel: string;
  monthNumber: number;
  totalMonths: number;
  payout: string;
  kicker?: string;
  footer?: string;
  logo?: string | null;
};

const SIZE = 1080;

function PatternLayer({ pattern, soft }: { pattern: Pattern; soft: string }) {
  const els: React.ReactNode[] = [];
  const abs = { position: "absolute" as const, display: "flex" };
  switch (pattern) {
    case "rings":
      for (let i = 0; i < 5; i++) {
        const d = 360 + i * 150;
        els.push(<div key={i} style={{ ...abs, width: d, height: d, right: -d / 2.6, top: -d / 2.6, borderRadius: d, border: `2px solid ${soft}` }} />);
      }
      break;
    case "dots":
      for (let r = 0; r < 9; r++)
        for (let c = 0; c < 9; c++)
          els.push(<div key={`${r}-${c}`} style={{ ...abs, width: 10, height: 10, borderRadius: 10, background: soft, left: 60 + c * 120, top: 60 + r * 120 }} />);
      break;
    case "diamonds":
      for (let i = 0; i < 7; i++)
        els.push(<div key={i} style={{ ...abs, width: 110, height: 110, left: 40 + i * 160, top: 930 - (i % 2) * 40, transform: "rotate(45deg)", border: `2px solid ${soft}` }} />);
      for (let i = 0; i < 7; i++)
        els.push(<div key={`t${i}`} style={{ ...abs, width: 70, height: 70, left: 80 + i * 160, top: 40 + (i % 2) * 30, transform: "rotate(45deg)", background: soft, opacity: 0.6 }} />);
      break;
    case "rays":
      for (let i = 0; i < 18; i++)
        els.push(<div key={i} style={{ ...abs, width: 1600, height: 26, left: -260, top: 527, transform: `rotate(${i * 10}deg)`, background: i % 2 ? "transparent" : soft, opacity: 0.45 }} />);
      break;
    case "waves":
      for (let i = 0; i < 4; i++) {
        const d = 900 + i * 160;
        els.push(<div key={i} style={{ ...abs, width: d, height: d, left: -d / 4 + i * 60, top: 700 - i * 40, borderRadius: d, border: `3px solid ${soft}` }} />);
      }
      break;
    case "sparkles": {
      const pts = [[90, 120], [940, 160], [180, 860], [880, 900], [520, 70], [60, 520], [1000, 560], [300, 300], [780, 330], [700, 980]];
      pts.forEach(([x, y], i) => {
        const s = 18 + (i % 3) * 12;
        els.push(<div key={i} style={{ ...abs, width: s, height: s, left: x, top: y, transform: "rotate(45deg)", background: soft }} />);
      });
      break;
    }
    case "arches":
      for (let i = 0; i < 6; i++)
        els.push(<div key={i} style={{ ...abs, width: 220, height: 300, left: -20 + i * 190, top: 860, borderRadius: "110px 110px 0 0", border: `2px solid ${soft}` }} />);
      break;
    case "grid":
      for (let i = 1; i < 9; i++) {
        els.push(<div key={`v${i}`} style={{ ...abs, width: 1, height: SIZE, left: i * 120, top: 0, background: soft }} />);
        els.push(<div key={`h${i}`} style={{ ...abs, width: SIZE, height: 1, left: 0, top: i * 120, background: soft }} />);
      }
      break;
    case "petals":
      for (let i = 0; i < 12; i++)
        els.push(<div key={i} style={{ ...abs, width: 120, height: 520, left: 480, top: 280, borderRadius: 120, border: `2px solid ${soft}`, transform: `rotate(${i * 30}deg)` }} />);
      break;
  }
  return <div style={{ position: "absolute", left: 0, top: 0, width: SIZE, height: SIZE, display: "flex" }}>{els}</div>;
}

function Trophy({ color }: { color: string }) {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

export function WinnerBanner({ data, theme: forced }: { data: BannerData; theme?: LetterTheme }) {
  const t = forced ?? themeFor(data.slot);
  const letterSize = data.slot.length > 1 ? 210 : 290;
  return (
    <div
      style={{
        width: SIZE,
        height: SIZE,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        color: "#ffffff",
        fontFamily: "Poppins",
        background: `linear-gradient(155deg, ${t.from} 0%, ${t.to} 75%)`,
      }}
    >
      <PatternLayer pattern={t.pattern} soft={t.soft} />
      <div style={{ position: "absolute", left: 0, top: 0, width: SIZE, height: 12, display: "flex", background: `linear-gradient(90deg, ${t.soft}, ${t.accent}, ${t.soft})` }} />

      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: data.logo ? 40 : 78 }}>
        {data.logo ? (
          <div style={{ display: "flex", width: 92, height: 92, borderRadius: 26, background: "#ffffff", alignItems: "center", justifyContent: "center", marginBottom: 14, boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img src={data.logo} width={76} height={76} />
          </div>
        ) : null}
        <div style={{ display: "flex", fontSize: 38, fontWeight: 600, letterSpacing: 1 }}>{data.committeeName}</div>
        <div style={{ display: "flex", fontSize: 26, color: "rgba(255,255,255,0.72)", marginTop: 6 }}>
          {`Month ${data.monthNumber} of ${data.totalMonths} · ${data.monthLabel}`}
        </div>
      </div>

      {/* Medallion */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: data.logo ? 30 : 46 }}>
        <div
          style={{
            width: 420,
            height: 420,
            borderRadius: 420,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,0.08)",
            border: `6px solid ${t.accent}`,
            boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
          }}
        >
          <div
            style={{
              width: 360,
              height: 360,
              borderRadius: 360,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `2px solid ${t.soft}`,
            }}
          >
            <div style={{ display: "flex", fontSize: letterSize, fontWeight: 800, color: t.accent, lineHeight: 1, marginTop: 24 }}>{data.slot}</div>
          </div>
        </div>
      </div>

      {/* Winner text */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 40 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "10px 30px",
            borderRadius: 999,
            border: `2px solid ${t.accent}`,
            background: "rgba(0,0,0,0.18)",
            color: t.accent,
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: 6,
          }}
        >
          <Trophy color={t.accent} />
          {(data.kicker ?? "THIS MONTH'S WINNER").toUpperCase()}
        </div>
        <div style={{ display: "flex", fontSize: 76, fontWeight: 800, marginTop: 20 }}>{data.payout}</div>
      </div>

      {/* Footer */}
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: SIZE,
          height: 92,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 70px",
          borderTop: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(0,0,0,0.18)",
          fontSize: 24,
          color: "rgba(255,255,255,0.8)",
        }}
      >
        <div style={{ display: "flex" }}>{data.footer ?? "Congratulations from the whole committee"}</div>
        <div style={{ display: "flex", color: t.accent, fontWeight: 600 }}>{t.name}</div>
      </div>
    </div>
  );
}
