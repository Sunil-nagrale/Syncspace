"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Layers, ArrowRight, Github, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("lead.architect@syncspace.dev");
  const [password, setPassword] = useState("Password123!");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const { error } = await authClient.signIn.email({
        email,
        password,
      });

      if (error) {
        setErrorMessage(error.message || "Invalid email or password.");
        setIsLoading(false);
        return;
      }

      router.push("/app");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to sign in. Please verify connection.";
      setErrorMessage(msg);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-muted/20">
      <header className="p-4 flex items-center justify-between container mx-auto max-w-6xl">
        <Link href="/" className="flex items-center gap-2 font-semibold text-base">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-xs shadow-sm">
            <Layers className="h-4 w-4" />
          </div>
          <span>SyncSpace</span>
        </Link>
        <ThemeToggle />
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <Card className="w-full max-w-sm border bg-card shadow-lg">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl font-bold tracking-tight">Sign in to SyncSpace</CardTitle>
            <CardDescription className="text-xs">
              Access your team workspaces, documents, and whiteboards.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 text-xs">
            {errorMessage && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <p className="leading-relaxed">{errorMessage}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <label className="font-medium text-foreground">Email address</label>
                <Input
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-medium text-foreground">Password</label>
                  <span className="text-[11px] text-muted-foreground hover:underline cursor-pointer">
                    Forgot password?
                  </span>
                </div>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>

              <Button type="submit" className="w-full gap-2 mt-2" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Continue to Workspace</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            </form>

            <div className="relative py-2 text-center text-xs after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-border">
              <span className="relative z-10 bg-card px-2 text-muted-foreground">or continue with</span>
            </div>

            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={isLoading}
              onClick={() => {
                // In local dev without OAuth keys, direct navigation to workspace
                router.push("/app");
              }}
            >
              <Github className="h-4 w-4" />
              <span>GitHub SSO</span>
            </Button>
          </CardContent>

          <CardFooter className="border-t p-4 text-center justify-center text-xs text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="font-medium text-foreground hover:underline ml-1">
              Create an account
            </Link>
          </CardFooter>
        </Card>
      </div>

      <footer className="p-4 text-center text-xs text-muted-foreground">
        SyncSpace • Zero-trust collaborative monolith architecture
      </footer>
    </div>
  );
}
