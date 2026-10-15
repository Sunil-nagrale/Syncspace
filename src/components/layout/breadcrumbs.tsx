"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  // If on / or /app, show default
  if (segments.length <= 1) {
    return (
      <div className={cn("flex items-center text-xs font-medium text-muted-foreground", className)}>
        <span className="flex items-center gap-1.5 text-foreground font-semibold">
          <Home className="h-3.5 w-3.5" />
          <span>Acme Engineering</span>
        </span>
      </div>
    );
  }

  // Format path segments
  const breadcrumbs = segments.map((segment, index) => {
    const url = `/${segments.slice(0, index + 1).join("/")}`;
    let label = segment.charAt(0).toUpperCase() + segment.slice(1);
    if (segment === "app") label = "Acme Engineering";
    if (label.includes("-")) {
      label = label.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
    const isLast = index === segments.length - 1;

    return { url, label, isLast };
  });

  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center text-xs text-muted-foreground", className)}>
      <ol className="flex items-center space-x-1.5">
        {breadcrumbs.map((crumb, idx) => (
          <li key={crumb.url} className="flex items-center">
            {idx > 0 && <ChevronRight className="h-3 w-3 mx-1 text-muted-foreground/50 shrink-0" />}
            {crumb.isLast ? (
              <span className="font-semibold text-foreground truncate max-w-[200px]" aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.url}
                className="hover:text-foreground transition-colors truncate max-w-[150px]"
              >
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
