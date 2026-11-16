import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { WinnerBanner, type BannerData } from "./banner-art";

let fontsPromise: Promise<{ name: string; data: Buffer; weight: 400 | 600 | 800; style: "normal" }[]> | null = null;

function loadFonts() {
  if (!fontsPromise) {
    const dir = join(process.cwd(), "src", "assets", "fonts");
    fontsPromise = Promise.all(
      ([400, 600, 800] as const).map(async (weight) => ({
        name: "Poppins",
        data: await readFile(join(dir, `poppins-latin-${weight}-normal.woff`)),
        weight,
        style: "normal" as const,
      })),
    );
  }
  return fontsPromise;
}

export async function renderBanner(data: BannerData, opts: { cacheSeconds?: number } = {}) {
  const fonts = await loadFonts();
  return new ImageResponse(<WinnerBanner data={data} />, {
    width: 1080,
    height: 1080,
    fonts,
    headers: { "Cache-Control": `public, max-age=${opts.cacheSeconds ?? 300}, s-maxage=${opts.cacheSeconds ?? 300}` },
  });
}
