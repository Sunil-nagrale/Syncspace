import { Trash2, Save, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function WorkspaceSettingsPage() {
  return (
    <div className="container mx-auto max-w-4xl p-6 sm:p-8 space-y-6">
      <div className="pb-4 border-b">
        <h1 className="text-2xl font-bold tracking-tight">Workspace Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage workspace profile, security parameters, domain configuration, and data exports.
        </p>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="security">Security & Access</TabsTrigger>
          <TabsTrigger value="export">Data Export</TabsTrigger>
          <TabsTrigger value="danger">Danger Zone</TabsTrigger>
        </TabsList>

        {/* General Settings */}
        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Workspace Information</CardTitle>
              <CardDescription className="text-xs">
                Visible to all collaborators and team members.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-medium text-foreground">Workspace Name</label>
                <Input defaultValue="Acme Engineering" className="max-w-md" />
              </div>
              <div className="space-y-1.5">
                <label className="font-medium text-foreground">Workspace Slug</label>
                <div className="flex items-center gap-2 max-w-md">
                  <span className="text-muted-foreground font-mono">syncspace.dev/</span>
                  <Input defaultValue="acme-eng" />
                </div>
              </div>
            </CardContent>
            <CardFooter className="border-t px-6 py-3 flex justify-end">
              <Button size="sm" className="gap-1.5">
                <Save className="h-3.5 w-3.5" />
                <span>Save Changes</span>
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* Security Settings */}
        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Access & Room Security</CardTitle>
              <CardDescription className="text-xs">
                Server-side authorization enforced via Liveblocks tokens and PostgreSQL roles.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs text-muted-foreground">
              <p>• Zero-trust authorization enabled: All rooms require authenticated server tokens.</p>
              <p>• Membership revocation immediately terminates active WebSocket connections.</p>
              <p>• Document attachments restricted to 25MB with presigned URLs.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Data Export */}
        <TabsContent value="export" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Export Workspace</CardTitle>
              <CardDescription className="text-xs">
                Download an archive of all rich-text documents (Markdown/HTML) and whiteboards (SVG/JSON).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="h-3.5 w-3.5" />
                <span>Request Full Archive</span>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Danger Zone */}
        <TabsContent value="danger" className="space-y-6">
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-base text-destructive">Delete Workspace</CardTitle>
              <CardDescription className="text-xs">
                Permanently purge this workspace, projects, documents, and canvas data. This action is irreversible.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="destructive" size="sm" className="gap-2">
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete Acme Engineering</span>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
