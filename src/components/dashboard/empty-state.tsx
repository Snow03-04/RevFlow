import Link from "next/link";
import { Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function EmptyState({
  title,
  description,
  ctaHref,
  ctaLabel,
  icon: Icon = Plug,
}: {
  title: string;
  description: string;
  ctaHref?: string;
  ctaLabel?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-6 w-6" />
      </div>
      <div className="max-w-md space-y-1">
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {ctaHref && ctaLabel && (
        <Button asChild>
          <Link href={ctaHref}>{ctaLabel}</Link>
        </Button>
      )}
    </Card>
  );
}
