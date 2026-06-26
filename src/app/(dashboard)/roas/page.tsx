import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getRoasSettings,
  getRoasDay,
  getAllRoasEntries,
} from "@/lib/trackers/queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { RoasGrid } from "@/components/trackers/roas-grid";
import { RoasLive } from "@/components/trackers/roas-live";
import { RoasSettingsForm } from "@/components/trackers/roas-settings-form";
import { WeeklySummary } from "@/components/trackers/weekly-summary";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "ROAS Tracker" };
export const dynamic = "force-dynamic";

export default async function RoasPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; day?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const sp = await searchParams;

  const settings = await getRoasSettings(supabase, user.id);
  const currency = settings.currency;
  const thresholds = {
    scale: Number(settings.roas_scale),
    maintain: Number(settings.roas_maintain),
    watch: Number(settings.roas_watch),
  };
  const minMargin = Number(settings.min_margin);

  const view = sp.view ?? "day";
  const today = new Date().getDate();
  const day = Math.min(31, Math.max(1, parseInt(sp.day ?? "") || today));

  const tabs = [
    { key: "weekly", label: "Weekly", href: "/roas?view=weekly" },
    ...Array.from({ length: 31 }, (_, i) => ({
      key: `d${i + 1}`,
      label: `Day ${String(i + 1).padStart(2, "0")}`,
      href: `/roas?view=day&day=${i + 1}`,
    })),
    { key: "settings", label: "Settings", href: "/roas?view=settings" },
  ];
  const activeKey =
    view === "weekly" ? "weekly" : view === "settings" ? "settings" : `d${day}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily ROAS Tracker"
        description={`Scaling 48h ao nível do produto · moeda ${currency}`}
      />

      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 scrollbar-thin">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              activeKey === t.key
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {view === "weekly" ? (
        <WeeklySummary
          allEntries={await getAllRoasEntries(supabase, user.id)}
          currency={currency}
        />
      ) : view === "settings" ? (
        <RoasSettingsForm settings={settings} />
      ) : (
        await renderDay()
      )}
    </div>
  );

  async function renderDay() {
    const { entries, prevContext } = await getRoasDay(supabase, user!.id, day);
    // Signature of the server data so the grid remounts (re-seeds its rows)
    // whenever a live refresh changes spend / COG, but not while the user types.
    const sig = entries
      .map(
        (e) =>
          `${e.id}:${e.total_spend}:${e.cpc}:${e.atc}:${e.pur}:${e.price}:${e.cog}:${e.units_sold}`,
      )
      .join("|");
    let hash = 0;
    for (let i = 0; i < sig.length; i++) hash = (hash * 31 + sig.charCodeAt(i)) | 0;

    return (
      <>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Day {String(day).padStart(2, "0")}</h2>
          <RoasLive day={day} />
        </div>
        <RoasGrid
          key={`${day}:${hash}`}
          day={day}
          initialEntries={entries}
          prevContext={prevContext}
          thresholds={thresholds}
          minMargin={minMargin}
          currency={currency}
        />
      </>
    );
  }
}
