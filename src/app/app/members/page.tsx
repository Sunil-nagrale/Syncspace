import { UserPlus, Search, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function MembersPage() {
  const members = [
    {
      id: "mem-1",
      name: "Sunil Kumar",
      email: "lead.architect@syncspace.dev",
      role: "OWNER",
      initials: "SK",
      color: "bg-brand-indigo",
      presenceColor: "#6366F1",
      joinedAt: "Jan 10, 2026",
    },
    {
      id: "mem-2",
      name: "Alex Chen",
      email: "alex.chen@syncspace.dev",
      role: "ADMIN",
      initials: "AC",
      color: "bg-emerald-500",
      presenceColor: "#10B981",
      joinedAt: "Jan 12, 2026",
    },
    {
      id: "mem-3",
      name: "Jane Doe",
      email: "jane.doe@syncspace.dev",
      role: "EDITOR",
      initials: "JD",
      color: "bg-indigo-500",
      presenceColor: "#8B5CF6",
      joinedAt: "Feb 01, 2026",
    },
    {
      id: "mem-4",
      name: "Sarah Jenkins",
      email: "sarah.j@syncspace.dev",
      role: "VIEWER",
      initials: "SJ",
      color: "bg-amber-500",
      presenceColor: "#F59E0B",
      joinedAt: "Feb 14, 2026",
    },
  ];

  return (
    <div className="container mx-auto max-w-5xl p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Members & Roles</h1>
          <p className="text-sm text-muted-foreground">
            Manage team access, role-based permissions, and collaboration invitations.
          </p>
        </div>
        <Button size="sm" className="gap-2">
          <UserPlus className="h-4 w-4" />
          <span>Invite Member</span>
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search members by name or email..." className="pl-9" />
        </div>
      </div>

      {/* Members Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-muted/40 font-medium text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Member</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Presence Color</th>
                  <th className="px-6 py-3">Joined</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y text-foreground">
                {members.map((m) => (
                  <tr key={m.id} className="hover:bg-muted/30 transition">
                    <td className="px-6 py-3.5 flex items-center gap-3">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className={`${m.color} text-[10px] text-white font-semibold`}>
                          {m.initials}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-semibold">{m.name}</p>
                        <p className="text-[11px] text-muted-foreground">{m.email}</p>
                      </div>
                    </td>
                    <td className="px-6 py-3.5">
                      <Badge
                        variant={
                          m.role === "OWNER"
                            ? "default"
                            : m.role === "ADMIN"
                            ? "brand"
                            : m.role === "EDITOR"
                            ? "success"
                            : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {m.role}
                      </Badge>
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full border shadow-xs"
                          style={{ backgroundColor: m.presenceColor }}
                        />
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {m.presenceColor}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-muted-foreground">{m.joinedAt}</td>
                    <td className="px-6 py-3.5 text-right">
                      <Button variant="ghost" size="icon-sm" className="h-7 w-7">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
