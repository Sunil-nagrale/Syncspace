import Link from "next/link";
import { Layers, ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background text-foreground text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground mb-4">
        <Layers className="h-6 w-6" />
      </div>

      <h1 className="text-4xl font-extrabold tracking-tight">404</h1>
      <p className="mt-2 text-lg font-semibold text-foreground">Artifact or Page Not Found</p>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm">
        The document, whiteboard, or project you are trying to access does not exist or you do not have permission to view it.
      </p>

      <div className="mt-6 flex items-center gap-3">
        <Link href="/app">
          <Button size="sm" className="gap-2">
            <Home className="h-4 w-4" />
            <span>Return to Dashboard</span>
          </Button>
        </Link>
        <Link href="/">
          <Button variant="outline" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Home</span>
          </Button>
        </Link>
      </div>
    </div>
  );
}
