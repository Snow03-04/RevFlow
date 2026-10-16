import type { Metadata } from "next";
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
import { RoasNavigation } from "@/components/trackers/roas-navigation";
import { RoasSettingsForm } from "@/components/trackers/roas-settings-form";
import { WeeklySummary } from "@/components/trackers/weekly-summary";
import { ymdInTz } from "@/lib/date";

export const metadata: Metadata = { title: "ROAS Tracker" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const { data: appSettings } = await supabase.from("settings").select("timezone").eq("user_id", user.id).maybeSingle();
  const [currentYear, currentMonth, currentDay] = ymdInTz(new Date(), appSettings?.timezone ?? "Europe/Lisbon").split("-").map(Number);
  const year = parseInt(sp.year ?? "") || currentYear;
  const month = Math.min(12, Math.max(1, parseInt(sp.month ?? "") || currentMonth));
  const daysInMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth = year === currentYear && month === currentMonth;
  const defaultDay = isCurrentMonth ? currentDay : 1;
  const day = Math.min(
    daysInMonth,
    Math.max(1, parseInt(sp.day ?? "") || defaultDay),
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 sm:space-y-6">
      <PageHeader
        title="ROAS Tracker"
        description="Resultados por campanha. Decisões com base nos últimos 2 dias completos."
      />
      <RoasNavigation year={year} month={month} day={day} view={view}
        today={`${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(currentDay).padStart(2, "0")}`} />

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
    const { entries, evaluations, timezone } = await getRoasDay(
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
          `${e.id}:${e.total_spend}:${e.cpc}:${e.atc}:${e.pur}:${e.price}:${e.cog}:${e.units_sold}:${e.attribution_warning}`,
      )
      .join("|");
    let hash = 0;
    for (let i = 0; i < sig.length; i++) hash = (hash * 31 + sig.charCodeAt(i)) | 0;

    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-medium">
            {day} de {MONTHS_FULL[month - 1].toLowerCase()} <span className="text-muted-foreground">{year}</span>
          </h2>
          <RoasLive year={year} month={month} day={day} />
        </div>
        <RoasGrid
          key={`${year}-${month}-${day}:${hash}`}
          year={year}
          month={month}
          day={day}
          initialEntries={entries}
          evaluations={evaluations}
          timezone={timezone}
          thresholds={thresholds}
          minMargin={minMargin}
          currency={currency}
        />
      </>
    );
  }
}
