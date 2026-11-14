import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getTemplates } from "@/lib/data";
import { NotificationTabs } from "../tabs";
import { TemplatesClient } from "./templates-client";

export const metadata = { title: "Message templates" };

export default async function TemplatesPage() {
  const { db } = await requireAdmin();
  const templates = await getTemplates(db);
  return (
    <>
      <PageHeader title="Message templates" description="Edit the wording of each WhatsApp message. Placeholders like {{member_name}} are filled in automatically." />
      <NotificationTabs />
      <TemplatesClient templates={templates} />
    </>
  );
}
