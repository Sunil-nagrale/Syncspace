"use client";

import * as React from "react";
import { Save, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/shared/theme-toggle";

export default function ProfilePage() {
  const presenceColors = [
    { name: "Indigo", hex: "#4F46E5" },
    { name: "Emerald", hex: "#10B981" },
    { name: "Violet", hex: "#8B5CF6" },
    { name: "Amber", hex: "#F59E0B" },
    { name: "Coral", hex: "#F43F5E" },
    { name: "Teal", hex: "#14B8A6" },
    { name: "Blue", hex: "#3B82F6" },
    { name: "Fuchsia", hex: "#D946EF" },
  ];

  const [selectedColor, setSelectedColor] = React.useState("#4F46E5");

  return (
    <div className="container mx-auto max-w-3xl p-6 sm:p-8 space-y-6">
      <div className="pb-4 border-b">
        <h1 className="text-2xl font-bold tracking-tight">Profile & Preferences</h1>
        <p className="text-sm text-muted-foreground">
          Manage your personal details, presence color tag, and display preferences.
        </p>
      </div>

      {/* User Identity Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personal Information</CardTitle>
          <CardDescription className="text-xs">
            Displayed alongside your live cursor and comments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-xs">
          <div className="flex items-center gap-4 pb-2">
            <Avatar className="h-14 w-14">
              <AvatarFallback
                className="text-white font-bold text-lg"
                style={{ backgroundColor: selectedColor }}
              >
                SK
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold text-sm">Sunil Kumar</p>
              <p className="text-muted-foreground text-xs">Lead Architect & Senior Full-Stack Engineer</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="font-medium text-foreground">Display Name</label>
            <Input defaultValue="Sunil Kumar" className="max-w-md" />
          </div>

          <div className="space-y-1.5">
            <label className="font-medium text-foreground">Work Email</label>
            <Input defaultValue="lead.architect@syncspace.dev" disabled className="max-w-md bg-muted/50" />
          </div>
        </CardContent>
        <CardFooter className="border-t px-6 py-3 flex justify-end">
          <Button size="sm" className="gap-1.5">
            <Save className="h-3.5 w-3.5" />
            <span>Save Profile</span>
          </Button>
        </CardFooter>
      </Card>

      {/* Presence Color Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Collaborator Presence Color</CardTitle>
          <CardDescription className="text-xs">
            This color highlights your live cursor and text selections across team documents and whiteboards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            {presenceColors.map((color) => (
              <button
                key={color.hex}
                type="button"
                onClick={() => setSelectedColor(color.hex)}
                className="h-8 w-8 rounded-full flex items-center justify-center transition ring-offset-background hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring"
                style={{ backgroundColor: color.hex }}
                aria-label={`Select ${color.name} presence color`}
              >
                {selectedColor === color.hex && (
                  <Check className="h-4 w-4 text-white stroke-[3]" />
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Appearance Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance & Theme</CardTitle>
          <CardDescription className="text-xs">
            Customize the application color scheme.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-xs space-y-0.5">
            <p className="font-medium text-foreground">Theme Preference</p>
            <p className="text-muted-foreground">Select Light, Dark, or System Sync.</p>
          </div>
          <ThemeToggle />
        </CardContent>
      </Card>
    </div>
  );
}
