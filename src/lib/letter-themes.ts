// A unique look for every slot letter. All themes share the same layout and
// typography (so the set feels like one family), but each letter has its own
// colour palette and background pattern.

export type Pattern = "rings" | "dots" | "diamonds" | "rays" | "waves" | "sparkles" | "arches" | "grid" | "petals";

export type LetterTheme = {
  name: string;
  from: string; // background gradient start
  to: string; // background gradient end
  accent: string; // letter, kicker, payout
  soft: string; // translucent decoration colour
  pattern: Pattern;
};

const THEMES: Record<string, LetterTheme> = {
  A: { name: "Emerald Royale", from: "#065f46", to: "#022c22", accent: "#f5d68a", soft: "rgba(212,164,55,0.28)", pattern: "rings" },
  B: { name: "Sapphire Night", from: "#1e3a8a", to: "#0b1437", accent: "#fcd34d", soft: "rgba(147,197,253,0.25)", pattern: "dots" },
  C: { name: "Ruby Crown", from: "#991b1b", to: "#2b0a0a", accent: "#fde68a", soft: "rgba(251,191,36,0.25)", pattern: "diamonds" },
  D: { name: "Amethyst Glow", from: "#5b21b6", to: "#1e0b3d", accent: "#f5d0fe", soft: "rgba(233,213,255,0.22)", pattern: "rays" },
  E: { name: "Teal Lagoon", from: "#0f766e", to: "#042f2e", accent: "#99f6e4", soft: "rgba(94,234,212,0.22)", pattern: "waves" },
  F: { name: "Midnight Gold", from: "#1f2937", to: "#030712", accent: "#f5d68a", soft: "rgba(245,214,138,0.22)", pattern: "sparkles" },
  G: { name: "Rose Velvet", from: "#9d174d", to: "#2a0716", accent: "#fbcfe8", soft: "rgba(251,207,232,0.22)", pattern: "arches" },
  H: { name: "Ocean Deep", from: "#075985", to: "#03192b", accent: "#bae6fd", soft: "rgba(125,211,252,0.22)", pattern: "grid" },
  I: { name: "Copper Sunset", from: "#9a3412", to: "#2a0e05", accent: "#fed7aa", soft: "rgba(253,186,116,0.25)", pattern: "petals" },
  J: { name: "Forest Jade", from: "#166534", to: "#05210f", accent: "#bbf7d0", soft: "rgba(134,239,172,0.22)", pattern: "diamonds" },
  K: { name: "Royal Indigo", from: "#3730a3", to: "#100e33", accent: "#fde68a", soft: "rgba(199,210,254,0.22)", pattern: "rings" },
  L: { name: "Plum Wine", from: "#6b21a8", to: "#22072f", accent: "#f0abfc", soft: "rgba(240,171,252,0.22)", pattern: "sparkles" },
  M: { name: "Silver Slate", from: "#475569", to: "#0f172a", accent: "#f1f5f9", soft: "rgba(226,232,240,0.2)", pattern: "grid" },
  N: { name: "Turquoise Bay", from: "#0e7490", to: "#062a33", accent: "#a5f3fc", soft: "rgba(103,232,249,0.22)", pattern: "petals" },
  O: { name: "Saffron Sun", from: "#92400e", to: "#2b1306", accent: "#fef08a", soft: "rgba(253,224,71,0.25)", pattern: "rays" },
  P: { name: "Crimson Night", from: "#9f1239", to: "#2d0612", accent: "#fecdd3", soft: "rgba(253,164,175,0.22)", pattern: "waves" },
  Q: { name: "Olive Gold", from: "#4d7c0f", to: "#141f05", accent: "#ecfccb", soft: "rgba(217,249,157,0.22)", pattern: "arches" },
  R: { name: "Cobalt Star", from: "#1d4ed8", to: "#0a1a4d", accent: "#fef3c7", soft: "rgba(191,219,254,0.22)", pattern: "sparkles" },
  S: { name: "Mint Pearl", from: "#047857", to: "#03261c", accent: "#d1fae5", soft: "rgba(167,243,208,0.22)", pattern: "dots" },
  T: { name: "Mahogany", from: "#7c2d12", to: "#1c0a04", accent: "#fde68a", soft: "rgba(253,230,138,0.22)", pattern: "grid" },
  U: { name: "Orchid", from: "#86198f", to: "#2a0630", accent: "#fae8ff", soft: "rgba(245,208,254,0.22)", pattern: "rings" },
  V: { name: "Steel Blue", from: "#1e40af", to: "#0b1530", accent: "#e0f2fe", soft: "rgba(186,230,253,0.2)", pattern: "arches" },
  W: { name: "Bronze", from: "#854d0e", to: "#231503", accent: "#fef9c3", soft: "rgba(254,240,138,0.22)", pattern: "petals" },
  X: { name: "Graphite", from: "#3f3f46", to: "#09090b", accent: "#fafafa", soft: "rgba(228,228,231,0.18)", pattern: "diamonds" },
  Y: { name: "Lagoon Gold", from: "#115e59", to: "#03201e", accent: "#fde68a", soft: "rgba(253,230,138,0.22)", pattern: "rays" },
  Z: { name: "Berry", from: "#be185d", to: "#33061a", accent: "#fce7f3", soft: "rgba(252,231,243,0.2)", pattern: "dots" },
};

/** Theme for a slot code such as "A", "Q" or "AB" (uses the last letter after Z). */
export function themeFor(slot: string): LetterTheme {
  const letters = (slot || "A").toUpperCase().replace(/[^A-Z]/g, "");
  const key = letters.length > 0 ? letters[letters.length - 1] : "A";
  return THEMES[key] ?? THEMES.A;
}

export const ALL_LETTERS = Object.keys(THEMES);
