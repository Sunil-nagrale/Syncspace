"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { CollaborativeWhiteboardProps } from "./types";

const CollaborativeWhiteboardView = dynamic(
  () =>
    import("./collaborative-whiteboard").then(
      (mod) => mod.CollaborativeWhiteboardView
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex flex-col h-full w-full bg-background items-center justify-center relative select-none"
        data-testid="whiteboard-loading-skeleton"
      >
        <div
          className="absolute inset-0 opacity-20 dark:opacity-10"
          style={{
            backgroundImage:
              "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative z-10 flex flex-col items-center gap-3 p-6 rounded-xl border bg-card/70 backdrop-blur-sm shadow-sm max-w-sm text-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand-indigo" />
          <div className="text-sm font-semibold">Loading whiteboard...</div>
          <p className="text-xs text-muted-foreground">
            Initializing Excalidraw canvas environment...
          </p>
        </div>
      </div>
    ),
  }
);

export function CollaborativeWhiteboardClient(
  props: CollaborativeWhiteboardProps
) {
  return <CollaborativeWhiteboardView {...props} />;
}
