import { FinancePlatformPage, type FinanceParams } from "@/components/trackers/finance-platform-page";
export const metadata = { title: "Meta · Finance" };
export const dynamic = "force-dynamic";
export default function Page({ searchParams }: { searchParams: Promise<FinanceParams> }) {
  return <FinancePlatformPage platform="meta" searchParams={searchParams} />;
}
