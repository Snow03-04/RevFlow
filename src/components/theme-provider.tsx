"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { subscribeAccent } from "@/lib/appearance";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  React.useEffect(() => subscribeAccent(() => {}), []);
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
