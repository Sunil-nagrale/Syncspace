"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, Search, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

interface HeaderProps {
  onOpenMobileMenu?: () => void;
  onOpenSearch?: () => void;
  title?: string;
  actions?: React.ReactNode;
}

export function Header({
  onOpenMobileMenu,
  onOpenSearch,
  title,
  actions,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b bg-background/80 px-4 backdrop-blur-md">
      {/* Left side: Mobile Menu Trigger + Breadcrumbs */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenMobileMenu}
          className="md:hidden text-muted-foreground hover:text-foreground"
          aria-label="Open mobile navigation"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div className="hidden sm:block">
          <Breadcrumbs />
        </div>

        {title && (
          <span className="sm:hidden text-xs font-semibold truncate max-w-[150px]">
            {title}
          </span>
        )}
      </div>

      {/* Right side: Global Actions, Collaborators, Notifications & Theme */}
      <div className="flex items-center gap-2">
        {/* Contextual actions passed by page (e.g. Share or Live cursors) */}
        {actions}

        {/* Global Search Shortcut Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenSearch}
          className="hidden md:flex h-8 gap-2 px-2.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search</span>
          <kbd className="pointer-events-none rounded border bg-muted px-1.5 font-mono text-[9px] text-muted-foreground">
            ⌘K
          </kbd>
        </Button>

        {/* Notifications Icon with Unread Indicator */}
        <Link href="/app/notifications">
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-indigo opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-indigo"></span>
            </span>
          </Button>
        </Link>

        {/* Theme Toggle */}
        <ThemeToggle />
      </div>
    </header>
  );
}
