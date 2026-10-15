"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, FileText, PenTool } from "lucide-react";
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

interface CreateArtifactDialogProps {
  workspaceId: string;
  type: "DOCUMENT" | "WHITEBOARD";
  projects?: { id: string; name: string }[];
  trigger?: React.ReactNode;
  onCreated?: () => void;
}

export function CreateArtifactDialog({
  workspaceId,
  type,
  projects = [],
  trigger,
  onCreated,
}: CreateArtifactDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDoc = type === "DOCUMENT";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !workspaceId) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          type,
          title: title.trim(),
          projectId: projectId || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Failed to create ${type.toLowerCase()}`);
      }

      setOpen(false);
      setTitle("");
      setProjectId("");
      if (onCreated) {
        onCreated();
      }

      // Route to document or whiteboard page
      const targetUrl = isDoc
        ? `/app/documents/${data.data.id}`
        : `/app/whiteboards/${data.data.id}`;
      router.push(targetUrl);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error creating artifact");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            size="sm"
            variant={isDoc ? "default" : "outline"}
            className="gap-1.5 shadow-sm"
          >
            {isDoc ? (
              <FileText className="h-4 w-4" />
            ) : (
              <PenTool className="h-4 w-4 text-emerald-500" />
            )}
            <span>{isDoc ? "New Document" : "New Whiteboard"}</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-md ${
                  isDoc
                    ? "bg-primary/10 text-primary"
                    : "bg-emerald-500/10 text-emerald-500"
                }`}
              >
                {isDoc ? (
                  <FileText className="h-4 w-4" />
                ) : (
                  <PenTool className="h-4 w-4" />
                )}
              </div>
              <DialogTitle>
                Create New {isDoc ? "Document" : "Whiteboard"}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs">
              {isDoc
                ? "Start a rich-text document with real-time collaborative editing."
                : "Open an infinite canvas whiteboard for diagrams and sketches."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 text-xs">
            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-destructive text-xs">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="font-medium text-foreground">Title</label>
              <Input
                placeholder={isDoc ? "e.g. Architecture Overview" : "e.g. System Topology Diagram"}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            {projects.length > 0 && (
              <div className="space-y-1.5">
                <label className="font-medium text-foreground">Project (Optional)</label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  disabled={isLoading}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">(No Project / Workspace Root)</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
            <Button type="submit" size="sm" disabled={isLoading || !title.trim()}>
              {isLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  <span>Creating...</span>
                </>
              ) : (
                <span>Create {isDoc ? "Document" : "Whiteboard"}</span>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
