"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Building } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface CreateWorkspaceDialogProps {
  trigger?: React.ReactNode;
  onCreated?: () => void;
}

export function CreateWorkspaceDialog({
  trigger,
  onCreated,
}: CreateWorkspaceDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || undefined,
          createDefaultProject: true,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create workspace");
      }

      setOpen(false);
      setName("");
      setSlug("");
      if (onCreated) {
        onCreated();
      }
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error creating workspace");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" className="gap-1.5 shadow-sm">
            <Plus className="h-4 w-4" />
            <span>Create Workspace</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Building className="h-4 w-4" />
              </div>
              <DialogTitle>Create New Workspace</DialogTitle>
            </div>
            <DialogDescription className="text-xs">
              Workspaces isolate your team&apos;s projects, documents, whiteboards, and membership roles.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 text-xs">
            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-destructive text-xs">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="font-medium text-foreground">Workspace Name</label>
              <Input
                placeholder="e.g. Acme Engineering"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slug || slug === name.toLowerCase().replace(/\s+/g, "-")) {
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-"));
                  }
                }}
                required
                disabled={isLoading}
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-medium text-foreground">URL Slug</label>
              <div className="flex items-center rounded-md border border-input bg-muted/30 px-3 text-muted-foreground text-xs">
                <span>syncspace.app/</span>
                <input
                  type="text"
                  className="w-full bg-transparent p-1.5 text-foreground focus:outline-none"
                  placeholder="acme-engineering"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isLoading || !name.trim()}>
              {isLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  <span>Creating...</span>
                </>
              ) : (
                <span>Create Workspace</span>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
