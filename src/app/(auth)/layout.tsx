import Link from "next/link";
import { Logo } from "@/components/brand";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
      <div className="pointer-events-none absolute inset-0 bg-glow" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Logo />
          </Link>
        </div>
        {children}
        <p className="mt-8 text-center text-xs text-muted-foreground">
          By continuing you agree to RevFlow&apos;s Terms and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
