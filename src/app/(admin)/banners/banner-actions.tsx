"use client";
import { useState } from "react";
import { Download, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";

export function BannerActions({ src, fileName }: { src: string; fileName: string }) {
  const [busy, setBusy] = useState(false);

  async function getBlob() {
    const res = await fetch(src);
    if (!res.ok) throw new Error("Could not load the banner.");
    return res.blob();
  }

  async function download() {
    setBusy(true);
    try {
      const url = URL.createObjectURL(await getBlob());
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    setBusy(true);
    try {
      const file = new File([await getBlob()], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "Committee winner" });
      else {
        toast.info("Sharing isn’t supported in this browser, so the banner was downloaded instead.");
        await download();
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast.error("Sharing failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <button className="btn btn-primary" onClick={download} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download PNG
      </button>
      <button className="btn btn-whatsapp" onClick={share} disabled={busy}>
        <Share2 className="size-4" /> Share
      </button>
    </div>
  );
}
