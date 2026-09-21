import { FinancePlatformPage, type FinanceParams } from "@/components/trackers/finance-platform-page";
export const metadata = { title: "General sheet · Finance" };
export const dynamic = "force-dynamic";
export default function Page({ searchParams }: { searchParams: Promise<FinanceParams> }) {
  return <FinancePlatformPage platform="general" searchParams={searchParams} />;
}
