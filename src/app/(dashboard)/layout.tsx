import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { Sidebar, MobileNav } from "@/components/dashboard/sidebar";
import { UserMenu } from "@/components/dashboard/user-menu";
import { SyncButton } from "@/components/dashboard/sync-button";
import { Assistant } from "@/components/assistant/assistant";
import { Logo } from "@/components/brand";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url, email")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <div className="lg:hidden">
            <Logo showText={false} />
          </div>
          <div className="hidden text-sm text-muted-foreground lg:block">
            Welcome back{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""} 👋
          </div>
          <div className="flex items-center gap-3">
            <Assistant />
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
          <div className="mx-auto w-full max-w-7xl animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
