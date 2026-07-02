import { cn } from "@/lib/utils";

/**
 * RevFlow wordmark + glyph. The mark is a rounded gradient tile with an upward
 * "flow" stroke rising to a gold node — echoing the app's gold Profit accent.
 */
export function Logo({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 shadow-lg shadow-primary/25 ring-1 ring-white/10">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-[18px] w-[18px]"
          aria-hidden
        >
          {/* rising flow */}
          <path
            d="M4 15.5c2.2 0 3.4-2 5-4.5s2.9-4.5 5.5-4.5"
            stroke="white"
            strokeOpacity="0.95"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          {/* baseline tick */}
          <path
            d="M4.2 18.6h10"
            stroke="white"
            strokeOpacity="0.35"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* peak node */}
          <circle cx="18.4" cy="6.6" r="2.1" fill="white" />
        </svg>
      </div>
      {showText && (
        <span className="text-lg font-semibold tracking-tight">
          Rev<span className="text-primary">Flow</span>
        </span>
      )}
    </div>
  );
}
