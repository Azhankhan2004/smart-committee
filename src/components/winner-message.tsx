"use client";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { logManualShare } from "@/app/(admin)/notifications/actions";
import type { WinnerNotifyResult } from "@/lib/winner-notify";
import { Modal } from "./modal";
import { Notice } from "./ui";

/** Shows a toast for the automatic winner message, and returns true when a manual share is needed. */
export function reportWinnerMessage(r: WinnerNotifyResult | undefined): boolean {
  if (!r) return false;
  if (r.status === "sent") toast.success("Winner’s personal WhatsApp message sent.");
  else if (r.status === "duplicate") toast.info("The winner had already been sent their message.");
  else if (r.status === "failed" || r.status === "skipped") toast.warning(`Winner message not sent: ${r.error}`);
  else if (r.status === "template_off") toast.info("The personal winner message template is switched off.");
  return r.status === "manual";
}

export function WinnerShareModal({
  result,
  bannerSrc,
  onClose,
}: {
  result: WinnerNotifyResult | null;
  bannerSrc: string | null;
  onClose: () => void;
}) {
  const share = result && result.status === "manual" ? result.share : null;
  return (
    <Modal open={!!share} onClose={onClose} title="Send the winner their message" description="WhatsApp isn’t connected for this committee yet, so open WhatsApp with the message ready and press send.">
      {share && (
        <div className="space-y-4">
          {bannerSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bannerSrc} alt="Winner banner" className="w-full rounded-2xl shadow" />
          )}
          {!share.phone && <Notice tone="amber">This member has no WhatsApp number saved, so you’ll need to pick the chat yourself.</Notice>}
          <pre className="whitespace-pre-wrap rounded-xl bg-[#e7ffdb] p-3 font-sans text-sm text-slate-900">{share.body}</pre>
          <p className="text-xs text-slate-500">Tip: download the banner above and attach it in the same chat.</p>
          <a
            href={share.url}
            target="_blank"
            rel="noreferrer"
            className="btn btn-whatsapp w-full"
            onClick={() => {
              void logManualShare({ templateKey: "winner_personal", memberId: share.memberId, scheduleId: share.scheduleId, body: share.body, phone: share.phone });
              onClose();
            }}
          >
            <MessageCircle className="size-4" /> Open WhatsApp
          </a>
        </div>
      )}
    </Modal>
  );
}
