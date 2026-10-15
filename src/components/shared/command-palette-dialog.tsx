"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  PenTool,
  FolderTree,
  Settings,
  Users,
  Bell,
  Home,
  Plus,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

interface CommandPaletteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPaletteDialog({
  open,
  onOpenChange,
}: CommandPaletteDialogProps) {
  const router = useRouter();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  const runCommand = (command: () => void) => {
    onOpenChange(false);
    command();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search documents, whiteboards, projects..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem
            onSelect={() => runCommand(() => router.push("/app"))}
          >
            <Home className="mr-2 h-4 w-4" />
            <span>Workspace Dashboard</span>
            <CommandShortcut>GH</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/app/projects"))}
          >
            <FolderTree className="mr-2 h-4 w-4" />
            <span>All Projects</span>
            <CommandShortcut>GP</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/app/documents"))}
          >
            <FileText className="mr-2 h-4 w-4" />
            <span>Documents Directory</span>
            <CommandShortcut>GD</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/app/whiteboards"))}
          >
            <PenTool className="mr-2 h-4 w-4" />
            <span>Whiteboards Gallery</span>
            <CommandShortcut>GW</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/app/notifications"))}
          >
            <Bell className="mr-2 h-4 w-4" />
            <span>Notifications Inbox</span>
            <CommandShortcut>GN</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick Create (UI Preview)">
          <CommandItem
            onSelect={() =>
              runCommand(() => router.push("/app/documents/new-demo-doc"))
            }
          >
            <Plus className="mr-2 h-4 w-4 text-brand-indigo" />
            <span>New Collaborative Document</span>
            <CommandShortcut>ND</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              runCommand(() => router.push("/app/whiteboards/new-demo-board"))
            }
          >
            <Plus className="mr-2 h-4 w-4 text-emerald-500" />
            <span>New Multiplayer Whiteboard</span>
            <CommandShortcut>NW</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Administration & Settings">
          <CommandItem
            onSelect={() => runCommand(() => router.push("/app/members"))}
          >
            <Users className="mr-2 h-4 w-4" />
            <span>Manage Workspace Members</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/app/settings"))}
          >
            <Settings className="mr-2 h-4 w-4" />
            <span>Workspace Settings</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
