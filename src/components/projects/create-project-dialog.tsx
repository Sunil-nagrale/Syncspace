"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, FolderTree } from "lucide-react";
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

interface CreateProjectDialogProps {
  workspaceId: string;
  trigger?: React.ReactNode;
  onCreated?: () => void;
}

export function CreateProjectDialog({
  workspaceId,
  trigger,
  onCreated,
}: CreateProjectDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !workspaceId) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name: name.trim(),
          description: description.trim() || undefined,
          color: "#6366F1",
          icon: "Folder",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create project");
      }

      setOpen(false);
      setName("");
      setDescription("");
      if (onCreated) {
        onCreated();
      }
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error creating project");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" variant="outline" className="gap-1.5 shadow-sm">
            <Plus className="h-4 w-4" />
            <span>New Project</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <FolderTree className="h-4 w-4" />
              </div>
              <DialogTitle>Create New Project</DialogTitle>
            </div>
            <DialogDescription className="text-xs">
              Organize related documents, whiteboards, and discussions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 text-xs">
            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-destructive text-xs">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="font-medium text-foreground">Project Name</label>
              <Input
                placeholder="e.g. Infrastructure Modernization"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-medium text-foreground">Description (Optional)</label>
              <Input
                placeholder="Brief summary of the project goals..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isLoading}
              />
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
                <span>Create Project</span>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
