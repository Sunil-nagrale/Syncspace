"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Layers,
  Home,
  FolderTree,
  FileText,
  PenTool,
  Bell,
  Settings,
  Users,
  Search,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Plus,
  Check,
  Building,
  User,
  LogOut,
  Folder,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onOpenSearch?: () => void;
  className?: string;
}

export function Sidebar({
  collapsed = false,
  onToggleCollapse,
  onOpenSearch,
  className,
}: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const [activeWorkspace, setActiveWorkspace] = React.useState("Acme Engineering");

  const workspaces = [
    { name: "Acme Engineering", slug: "acme-eng", plan: "Enterprise" },
    { name: "Cloud Architecture Labs", slug: "cloud-labs", plan: "Pro" },
    { name: "Personal Sandbox", slug: "personal", plan: "Free" },
  ];

  const navItems = [
    { label: "Dashboard", href: "/app", icon: Home },
    { label: "Projects", href: "/app/projects", icon: FolderTree, count: 3 },
    { label: "Documents", href: "/app/documents", icon: FileText, count: 6 },
    { label: "Whiteboards", href: "/app/whiteboards", icon: PenTool, count: 4 },
    { label: "Notifications", href: "/app/notifications", icon: Bell, count: 2, badgeVariant: "brand" as const },
  ];

  const recentProjects = [
    { name: "Core Platform", href: "/app/projects/core-platform" },
    { name: "API Gateway & Auth", href: "/app/projects/api-gateway" },
    { name: "Mobile Redesign", href: "/app/projects/mobile-redesign" },
  ];

  return (
    <aside
      className={cn(
        "relative flex flex-col border-r bg-muted/40 transition-all duration-300 select-none",
        collapsed ? "w-16" : "w-64",
        className
      )}
    >
      {/* Workspace Switcher Header */}
      <div className="h-14 border-b px-3 flex items-center justify-between gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-2.5 rounded-lg p-1.5 text-left transition hover:bg-accent text-foreground w-full",
                collapsed && "justify-center"
              )}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-xs shadow-sm">
                <Layers className="h-4 w-4" />
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate leading-tight">{activeWorkspace}</p>
                  <p className="text-[10px] text-muted-foreground truncate">Enterprise Plan</p>
                </div>
              )}
              {!collapsed && <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-auto" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
            {workspaces.map((ws) => (
              <DropdownMenuItem
                key={ws.slug}
                onClick={() => setActiveWorkspace(ws.name)}
                className="flex items-center justify-between text-xs py-2"
              >
                <div className="flex items-center gap-2">
                  <Building className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className={activeWorkspace === ws.name ? "font-semibold text-foreground" : ""}>
                    {ws.name}
                  </span>
                </div>
                {activeWorkspace === ws.name && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="text-xs text-muted-foreground">
              <Link href="/app/settings" className="flex items-center gap-2">
                <Plus className="h-3.5 w-3.5" />
                <span>Create Workspace</span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Quick Search Shortcut */}
      <div className="p-2 border-b">
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onOpenSearch}
                className="w-full text-muted-foreground hover:text-foreground"
              >
                <Search className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Search (⌘K)</TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={onOpenSearch}
            className="flex items-center justify-between w-full rounded-md border border-input/60 bg-background/50 px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5" />
              <span>Search or jump to...</span>
            </div>
            <kbd className="pointer-events-none inline-flex h-4 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[9px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          </button>
        )}
      </div>

      {/* Main Nav Items */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          if (collapsed) {
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex h-9 w-full items-center justify-center rounded-md transition-colors",
                      isActive
                        ? "bg-accent text-foreground font-semibold"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {item.label} {item.count ? `(${item.count})` : ""}
                </TooltipContent>
              </Tooltip>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "bg-accent text-foreground font-semibold"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              )}
            >
              <div className="flex items-center gap-2.5">
                <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
                <span>{item.label}</span>
              </div>
              {item.count !== undefined && (
                <Badge
                  variant={item.badgeVariant || "secondary"}
                  className="h-4 px-1 text-[10px] min-w-4 flex items-center justify-center"
                >
                  {item.count}
                </Badge>
              )}
            </Link>
          );
        })}

        {/* Project Section (When Expanded) */}
        {!collapsed && (
          <div className="pt-4 pb-1">
            <div className="flex items-center justify-between px-2 pb-1.5 text-[10px] font-semibold text-muted-foreground tracking-wider uppercase">
              <span>Projects</span>
              <Link href="/app/projects">
                <Plus className="h-3 w-3 hover:text-foreground transition cursor-pointer" />
              </Link>
            </div>
            <div className="space-y-0.5">
              {recentProjects.map((p) => {
                const isActive = pathname === p.href;
                return (
                  <Link
                    key={p.href}
                    href={p.href}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2.5 py-1 text-xs transition-colors",
                      isActive
                        ? "bg-accent text-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    )}
                  >
                    <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate">{p.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Workspace Management & User Profile */}
      <div className="mt-auto border-t p-2 space-y-1">
        {/* Members & Settings Links */}
        {!collapsed ? (
          <>
            <Link
              href="/app/members"
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground transition",
                pathname === "/app/members" && "bg-accent text-foreground font-medium"
              )}
            >
              <Users className="h-4 w-4" />
              <span>Members & Roles</span>
            </Link>
            <Link
              href="/app/settings"
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground transition",
                pathname === "/app/settings" && "bg-accent text-foreground font-medium"
              )}
            >
              <Settings className="h-4 w-4" />
              <span>Workspace Settings</span>
            </Link>
          </>
        ) : (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/app/members"
                  className="flex h-9 w-full items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground transition"
                >
                  <Users className="h-4 w-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Members & Roles</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/app/settings"
                  className="flex h-9 w-full items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground transition"
                >
                  <Settings className="h-4 w-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Workspace Settings</TooltipContent>
            </Tooltip>
          </>
        )}

        <div className="pt-1 border-t">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex items-center gap-2.5 rounded-lg p-1.5 text-left transition hover:bg-accent text-foreground w-full",
                  collapsed && "justify-center"
                )}
              >
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-brand-indigo/15 text-brand-indigo font-semibold text-xs">
                    {session?.user?.name
                      ? session.user.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 2)
                      : "SK"}
                  </AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate leading-tight">
                      {session?.user?.name || "Sunil Kumar"}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {session?.user?.email || "Lead Architect"}
                    </p>
                  </div>
                )}
                {!collapsed && <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal text-xs">
                <div className="flex flex-col space-y-1">
                  <p className="font-semibold text-foreground">
                    {session?.user?.name || "Sunil Kumar"}
                  </p>
                  <p className="text-muted-foreground text-[10px]">
                    {session?.user?.email || "lead.architect@syncspace.dev"}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/app/profile" className="flex items-center gap-2 text-xs">
                  <User className="h-3.5 w-3.5" />
                  <span>Profile & Preferences</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/app/settings" className="flex items-center gap-2 text-xs">
                  <Settings className="h-3.5 w-3.5" />
                  <span>Account Settings</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs text-destructive focus:text-destructive cursor-pointer flex items-center gap-2"
                onClick={async () => {
                  try {
                    await authClient.signOut();
                  } finally {
                    window.location.href = "/login";
                  }
                }}
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Collapse toggle button */}
        {onToggleCollapse && (
          <div className="pt-1 flex items-center justify-center">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleCollapse}
              className="h-6 w-full text-muted-foreground hover:text-foreground"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <ChevronsRight className="h-3.5 w-3.5" />
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <ChevronsLeft className="h-3.5 w-3.5" />
                  <span>Collapse sidebar</span>
                </div>
              )}
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
