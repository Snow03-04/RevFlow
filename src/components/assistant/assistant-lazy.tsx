"use client";

import dynamic from "next/dynamic";

// The assistant (chat + voice mode) pulls in audio/streaming code. It sits in
// the header on every page, so defer it until after the first paint.
const Assistant = dynamic(
  () => import("@/components/assistant/assistant").then((m) => m.Assistant),
  { ssr: false },
);

export function AssistantLazy() {
  return <Assistant />;
}
