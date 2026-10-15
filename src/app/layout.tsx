import type { Metadata } from "next";
import "@/styles/globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: {
    default: "SyncSpace — Real-Time Collaborative Workspace",
    template: "%s | SyncSpace",
  },
  description:
    "Unified real-time collaborative workspace combining Tiptap rich-text documents, Excalidraw multiplayer whiteboards, and high-velocity team projects.",
  keywords: [
    "real-time collaboration",
    "tiptap",
    "yjs",
    "excalidraw",
    "liveblocks",
    "whiteboard",
    "knowledge base",
    "product documentation",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={200}>
            {children}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
