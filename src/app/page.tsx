import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Gauge,
  PiggyBank,
  ShoppingBag,
  Megaphone,
  LineChart,
  ShieldCheck,
  Lock,
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
    title: "Meta Ads spend",
    desc: "Daily campaign spend, purchases and ROAS pulled straight from the Meta Marketing API.",
  },
  {
    icon: LineChart,
    title: "Google Ads spend",
    desc: "Daily campaign cost and conversions imported read-only from the Google Ads API, folded into your true profit and ROAS.",
  },
  {
    icon: BarChart3,
    title: "Product-level margins",
    desc: "Rank every product by units, revenue and profit to find your real winners.",
  },
];

const integrations = [
  {
    icon: ShoppingBag,
    name: "Shopify",
    desc: "Orders, products, costs and refunds — the revenue side of your P&L.",
  },
  {
    icon: Megaphone,
    name: "Meta Ads",
    desc: "Campaign spend, purchases and conversion value from the Meta Marketing API.",
  },
  {
    icon: LineChart,
    name: "Google Ads",
    desc: "Campaign cost, clicks, conversions and conversion value from the Google Ads API.",
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
            Profit analytics for Shopify · Meta Ads · Google Ads
          </span>
          <h1 className="max-w-3xl text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
            Know your{" "}
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              real profit
            </span>{" "}
            in real time
          </h1>
          <p className="mt-6 max-w-xl text-balance text-lg text-muted-foreground">
            RevFlow connects your Shopify store with your Meta Ads and Google Ads
            accounts, then does the maths competitors hide — so you always know
            what you actually made today.
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

        <section className="grid grid-cols-1 gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-3">
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

        {/* Integrations + data-access transparency (also documents our Google
            Ads API usage for reviewers: read-only reporting, no management). */}
        <section className="pb-24">
          <div className="rounded-2xl border border-border bg-card p-8 sm:p-10">
            <div className="mx-auto max-w-2xl text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" /> Read-only by design
              </span>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
                Your accounts stay yours
              </h2>
              <p className="mt-3 text-balance text-muted-foreground">
                RevFlow connects to the platforms below with your permission and
                only <span className="font-medium text-foreground">reads</span>{" "}
                the data needed to compute profit. We never create, edit, pause
                or manage campaigns, bids or budgets — there are no write
                operations.
              </p>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {integrations.map((i) => (
                <div
                  key={i.name}
                  className="rounded-xl border border-border bg-background/50 p-5"
                >
                  <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <i.icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold">{i.name}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {i.desc}
                  </p>
                </div>
              ))}
            </div>

            <div className="mx-auto mt-8 max-w-3xl rounded-xl border border-border bg-background/50 p-5 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                How RevFlow uses the Google Ads API
              </p>
              <p className="mt-2">
                After you authorise access via Google OAuth, RevFlow uses the
                Google Ads API strictly in read-only mode to import your own ad
                data: <span className="text-foreground">ListAccessibleCustomers</span>{" "}
                to find the accounts you can access, and{" "}
                <span className="text-foreground">GoogleAdsService.SearchStream</span>{" "}
                (GAQL) to read daily campaign metrics — cost, impressions,
                clicks, conversions and conversion value. Those numbers are
                combined with your Shopify revenue and product costs to show your
                true net profit and real ROAS. No campaign, budget or bid is ever
                modified.
              </p>
            </div>
          </div>
        </section>

        <section className="flex flex-col items-center gap-3 pb-24 text-center">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-semibold">Secure by design</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Encrypted tokens, Row Level Security and per-account isolation. Your
            data stays yours.
          </p>
          <Button asChild size="lg" className="mt-4">
            <Link href="/signup">
              Start free <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
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
