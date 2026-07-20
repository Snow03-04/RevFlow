import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Sidebar, MobileNav } from "@/components/dashboard/sidebar";
import { UserMenu } from "@/components/dashboard/user-menu";
import { SyncButton } from "@/components/dashboard/sync-button";
import { StoreSwitcher } from "@/components/dashboard/store-switcher";
import { AssistantLazy } from "@/components/assistant/assistant-lazy";
import { Logo } from "@/components/brand";
import { storeLabel } from "@/lib/utils";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [{ data: profile }, { data: stores }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, avatar_url, email")
      .eq("id", user.id)
      .single(),
    // select("*") (not an explicit list) so a not-yet-applied shop_name column
    // degrades to the domain label instead of erroring the whole header.
    supabase
      .from("shopify_connections")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
  ]);
  const storeOptions = (stores ?? []).map((s) => ({
    id: s.id,
    label: storeLabel(s.shop_name, s.shop_domain),
  }));

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="lg:hidden">
              <Logo showText={false} />
            </div>
            <StoreSwitcher stores={storeOptions} />
            <span className="hidden truncate text-sm text-muted-foreground xl:inline">
              Welcome back{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""} 👋
            </span>
          </div>
          <div className="flex items-center gap-3">
            <AssistantLazy />
            <SyncButton />
            <UserMenu
              email={profile?.email ?? user.email ?? ""}
              name={profile?.full_name ?? null}
              avatarUrl={profile?.avatar_url ?? null}
            />
          </div>
        </header>
        <MobileNav />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="w-full animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}
