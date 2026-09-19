import { FinancePlatformPage, type FinanceParams } from "@/components/trackers/finance-platform-page";
export const metadata = { title: "Google · Finance" };
export const dynamic = "force-dynamic";
export default function Page({ searchParams }: { searchParams: Promise<FinanceParams> }) {
  return <FinancePlatformPage platform="google" searchParams={searchParams} />;
}
