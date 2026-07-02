import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
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

const MONTHS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];
const MONTHS_FULL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export default async function RoasPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; year?: string; month?: string; day?: string }>;
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
  const now = new Date();
  const year = parseInt(sp.year ?? "") || now.getFullYear();
  const month = Math.min(12, Math.max(1, parseInt(sp.month ?? "") || now.getMonth() + 1));
  const daysInMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const defaultDay = isCurrentMonth ? now.getDate() : 1;
  const day = Math.min(
    daysInMonth,
    Math.max(1, parseInt(sp.day ?? "") || defaultDay),
  );

  // Preserve the current view + day when navigating between months.
  const monthHref = (y: number, m: number) => {
    const maxDay = new Date(y, m, 0).getDate();
    const d = Math.min(day, maxDay);
    return `/roas?view=${view === "settings" ? "day" : view}&year=${y}&month=${m}&day=${d}`;
  };

  const tabs = [
    { key: "weekly", label: "Weekly", href: `/roas?view=weekly&year=${year}&month=${month}` },
    ...Array.from({ length: daysInMonth }, (_, i) => ({
      key: `d${i + 1}`,
      label: `Day ${String(i + 1).padStart(2, "0")}`,
      href: `/roas?view=day&year=${year}&month=${month}&day=${i + 1}`,
    })),
    { key: "settings", label: "Settings", href: `/roas?view=settings&year=${year}&month=${month}` },
  ];
  const activeKey =
    view === "weekly" ? "weekly" : view === "settings" ? "settings" : `d${day}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily ROAS Tracker"
        description={`Scaling 48h ao nível do produto · moeda ${currency}`}
      />

      {/* Month selector */}
      <div className="flex items-center gap-2">
        <Link
          href={monthHref(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1)}
          className="rounded-md border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div className="flex flex-1 gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 scrollbar-thin">
          {MONTHS.map((label, i) => {
            const m = i + 1;
            return (
              <Link
                key={label}
                href={monthHref(year, m)}
                title={`${MONTHS_FULL[i]} ${year}`}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  m === month
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {label}
              </Link>
            );
          })}
        </div>
        <Link
          href={monthHref(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1)}
          className="rounded-md border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Mês seguinte"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
        <span className="ml-1 whitespace-nowrap text-sm font-medium text-muted-foreground">
          {year}
        </span>
      </div>

      {/* Day / weekly / settings selector */}
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
          allEntries={await getAllRoasEntries(supabase, user.id, year, month)}
          currency={currency}
          daysInMonth={daysInMonth}
        />
      ) : view === "settings" ? (
        <RoasSettingsForm settings={settings} />
      ) : (
        await renderDay()
      )}
    </div>
  );

  async function renderDay() {
    const { entries, prevContext } = await getRoasDay(
      supabase,
      user!.id,
      year,
      month,
      day,
    );
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
          <h2 className="text-lg font-medium">
            {MONTHS_FULL[month - 1]} · Day {String(day).padStart(2, "0")}
          </h2>
          <RoasLive year={year} month={month} day={day} />
        </div>
        <RoasGrid
          key={`${year}-${month}-${day}:${hash}`}
          year={year}
          month={month}
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
