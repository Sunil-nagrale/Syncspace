"use client";

import * as React from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { CommandPaletteDialog } from "@/components/shared/command-palette-dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

interface AppShellProps {
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  title?: string;
}

export function AppShell({ children, headerActions, title }: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);

  // Load persisted collapse state on mount
  React.useEffect(() => {
    const saved = localStorage.getItem("syncspace:sidebar-collapsed");
    if (saved !== null) {
      setSidebarCollapsed(saved === "true");
    }
  }, []);

  const handleToggleCollapse = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("syncspace:sidebar-collapsed", String(next));
      return next;
    });
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex shrink-0">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleCollapse}
          onOpenSearch={() => setSearchOpen(true)}
        />
      </div>

      {/* Mobile Drawer Navigation */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-72">
          <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
          <Sidebar
            collapsed={false}
            onOpenSearch={() => {
              setMobileMenuOpen(false);
              setSearchOpen(true);
            }}
            className="w-full h-full border-r-0"
          />
        </SheetContent>
      </Sheet>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <Header
          title={title}
          actions={headerActions}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
        />

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Global Command Palette (⌘K) */}
      <CommandPaletteDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
