"use client";

import React, { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Building2,
  Shield,
  ArrowRight,
  Loader2,
  LogIn,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface InvitationData {
  id: string;
  email: string;
  role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expiresAt: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  };
  invitedBy: {
    id: string;
    name: string;
    email: string;
  };
}

export default function InvitationAcceptancePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();

  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [acceptSuccess, setAcceptSuccess] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function fetchInvitation() {
      try {
        setLoading(true);
        const res = await fetch(`/api/invitations/${encodeURIComponent(token)}`);
        const json = await res.json();

        if (!isMounted) return;

        if (json.data && json.data.valid) {
          setValid(true);
          setInvitation(json.data.invitation);
        } else {
          setValid(false);
          setErrorCode(json.data?.code || "INVALID");
          setErrorMessage(
            json.data?.message || "This invitation link is invalid or expired."
          );
        }
      } catch {
        if (isMounted) {
          setValid(false);
          setErrorCode("ERROR");
          setErrorMessage("Failed to check invitation status. Please try again.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    if (token) {
      void fetchInvitation();
    }

    return () => {
      isMounted = false;
    };
  }, [token]);

  const handleAccept = async () => {
    setActionError(null);
    setAccepting(true);
    try {
      const res = await fetch(
        `/api/invitations/${encodeURIComponent(token)}/accept`,
        {
          method: "POST",
        }
      );
      const json = await res.json();

      if (!res.ok) {
        setActionError(
          json.error || "Failed to accept the invitation. Please try again."
        );
        return;
      }

      setAcceptSuccess(true);
      setTimeout(() => {
        router.push(
          `/app?workspace=${json.data?.workspaceId || invitation?.workspace.id}`
        );
      }, 1500);
    } catch {
      setActionError("A network error occurred while accepting the invitation.");
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = async () => {
    setActionError(null);
    setDeclining(true);
    try {
      const res = await fetch(
        `/api/invitations/${encodeURIComponent(token)}/decline`,
        {
          method: "POST",
        }
      );
      if (res.ok) {
        router.push("/app");
      } else {
        const json = await res.json();
        setActionError(json.error || "Failed to decline invitation.");
      }
    } catch {
      setActionError("Failed to decline invitation.");
    } finally {
      setDeclining(false);
    }
  };

  const roleDescription = {
    ADMIN: "Full administrative access to manage workspace settings, members, and all projects.",
    EDITOR: "Can create, view, and collaboratively edit documents, whiteboards, and projects.",
    VIEWER: "Read-only access to view documents and whiteboards without mutation capabilities.",
    OWNER: "Owner",
  };

  if (loading || sessionPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Validating workspace invitation...</p>
        </div>
      </div>
    );
  }

  // Error / Invalid Token State
  if (!valid || !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md shadow-lg border-muted">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-2">
              {errorCode === "EXPIRED" ? (
                <Clock className="h-6 w-6" />
              ) : (
                <XCircle className="h-6 w-6" />
              )}
            </div>
            <CardTitle className="text-xl">
              {errorCode === "EXPIRED"
                ? "Invitation Expired"
                : errorCode === "REVOKED"
                ? "Invitation Revoked"
                : errorCode === "ACCEPTED"
                ? "Invitation Already Accepted"
                : "Invalid Invitation"}
            </CardTitle>
            <CardDescription className="text-sm pt-1">
              {errorMessage}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 flex flex-col gap-3">
            <Button asChild className="w-full">
              <Link href="/app">Go to Dashboard</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">Sign In with Another Account</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Logged-in email check
  const currentUserEmail = session?.user?.email?.trim().toLowerCase();
  const invitedEmail = invitation.email.trim().toLowerCase();
  const emailMatches = currentUserEmail === invitedEmail;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg shadow-xl border-muted">
        <CardHeader className="text-center pb-4 border-b">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3 font-bold text-lg">
            <Building2 className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-bold">
            Join {invitation.workspace.name}
          </CardTitle>
          <CardDescription className="text-sm">
            {invitation.invitedBy.name} ({invitation.invitedBy.email}) has invited you
            to collaborate on SyncSpace.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-6 space-y-6">
          {/* Workspace & Role Summary */}
          <div className="p-4 rounded-lg bg-muted/40 border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Assigned Access Level
              </span>
              <Badge
                variant={
                  invitation.role === "ADMIN"
                    ? "brand"
                    : invitation.role === "EDITOR"
                    ? "success"
                    : "secondary"
                }
                className="text-xs font-bold"
              >
                <Shield className="h-3 w-3 mr-1 inline" />
                {invitation.role}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {roleDescription[invitation.role] || roleDescription.VIEWER}
            </p>
            <div className="pt-1 text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span>Invited Email:</span>
              <span className="font-semibold text-foreground">{invitation.email}</span>
            </div>
          </div>

          {/* Action Error Banner */}
          {actionError && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{actionError}</span>
            </div>
          )}

          {/* Success Banner */}
          {acceptSuccess && (
            <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                Invitation accepted! Redirecting to {invitation.workspace.name}...
              </span>
            </div>
          )}

          {/* Unauthenticated State */}
          {!session?.user ? (
            <div className="space-y-4">
              <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs">
                You must sign in with <strong>{invitation.email}</strong> to accept
                this invitation.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button asChild className="gap-2">
                  <Link
                    href={`/login?redirect=${encodeURIComponent(
                      `/app/invitations/${token}`
                    )}`}
                  >
                    <LogIn className="h-4 w-4" />
                    <span>Sign In</span>
                  </Link>
                </Button>
                <Button asChild variant="outline" className="gap-2">
                  <Link
                    href={`/register?redirect=${encodeURIComponent(
                      `/app/invitations/${token}`
                    )}`}
                  >
                    <UserPlus className="h-4 w-4" />
                    <span>Create Account</span>
                  </Link>
                </Button>
              </div>
            </div>
          ) : !emailMatches ? (
            /* Authenticated Email Mismatch */
            <div className="space-y-4">
              <div className="p-4 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs space-y-2">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Account Mismatch</span>
                </div>
                <p>
                  This invitation was sent to <strong>{invitation.email}</strong>, but you
                  are currently signed in as <strong>{session.user.email}</strong>.
                </p>
                <p className="text-[11px] opacity-90">
                  Please sign in with the matching email address to accept access.
                </p>
              </div>
              <Button asChild variant="outline" className="w-full gap-2">
                <Link
                  href={`/login?redirect=${encodeURIComponent(
                    `/app/invitations/${token}`
                  )}`}
                >
                  <LogIn className="h-4 w-4" />
                  <span>Switch Account</span>
                </Link>
              </Button>
            </div>
          ) : (
            /* Authenticated and Matching Email */
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/30 border text-xs">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                    {(session.user.name || "U")[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold">{session.user.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {session.user.email} (Verified Match)
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <Button
                  onClick={handleAccept}
                  disabled={accepting || declining || acceptSuccess}
                  className="gap-2 font-semibold"
                  data-testid="accept-invitation-button"
                >
                  {accepting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                  <span>Accept & Join</span>
                </Button>
                <Button
                  onClick={handleDecline}
                  disabled={accepting || declining || acceptSuccess}
                  variant="outline"
                  className="text-muted-foreground hover:text-destructive"
                  data-testid="decline-invitation-button"
                >
                  {declining ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span>Decline</span>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
