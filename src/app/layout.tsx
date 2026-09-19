import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { appearanceScript, DEFAULT_ACCENT } from "@/lib/appearance";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "RevFlow — Profit analytics for Shopify + Meta Ads",
    template: "%s · RevFlow",
  },
  description:
    "Real-time revenue, ad spend and true profit tracking for Shopify stores running Meta Ads.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt" className="dark" data-accent={DEFAULT_ACCENT} suppressHydrationWarning>
      <head>
        {/* Apply the saved accent theme before paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: appearanceScript,
          }}
        />
      </head>
      <body className={`${inter.variable} font-sans`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          themes={["light", "dark"]}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
