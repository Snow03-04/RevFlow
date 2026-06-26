import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Gauge,
  PiggyBank,
  ShoppingBag,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: PiggyBank,
    title: "True profit, not vanity revenue",
    desc: "COGS, shipping, payment fees, refunds and ad spend subtracted automatically — see what you actually keep.",
  },
  {
    icon: Gauge,
    title: "Live MER & ROAS",
    desc: "Blended marketing efficiency and platform ROAS, updated every 15 minutes across your whole account.",
  },
  {
    icon: ShoppingBag,
    title: "Shopify, fully synced",
    desc: "Orders, products, costs and refunds flow in via OAuth and webhooks. No CSV exports, ever.",
  },
  {
    icon: Megaphone,
    title: "Meta Ads attribution",
    desc: "Daily campaign spend, purchases and ROAS pulled straight from the Marketing API.",
  },
  {
    icon: BarChart3,
    title: "Product-level margins",
    desc: "Rank every product by units, revenue and profit to find your real winners.",
  },
  {
    icon: ShieldCheck,
    title: "Secure by design",
    desc: "Encrypted tokens, Row Level Security and per-account isolation. Your data stays yours.",
  },
];

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[40rem] bg-glow" />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6">
        <section className="flex flex-col items-center pb-20 pt-20 text-center">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Profit analytics for Shopify + Meta Ads
          </span>
          <h1 className="max-w-3xl text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
            Know your{" "}
            <span className="bg-gradient-to-r from-primary to-indigo-400 bg-clip-text text-transparent">
              real profit
            </span>{" "}
            in real time
          </h1>
          <p className="mt-6 max-w-xl text-balance text-lg text-muted-foreground">
            RevFlow connects your Shopify store and Meta Ads account, then does
            the maths competitors hide — so you always know what you actually
            made today.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">
                Start free <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 pb-24 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-medium">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="relative z-10 border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <Logo />
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} RevFlow. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
