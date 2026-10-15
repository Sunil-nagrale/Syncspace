import { describe, it, expect } from "vitest";
import { cn, formatDate, formatRelativeTime } from "@/lib/utils";

describe("lib/utils", () => {
  describe("cn", () => {
    it("merges class names deterministically", () => {
      expect(cn("px-2 py-1", "bg-primary")).toBe("px-2 py-1 bg-primary");
    });

    it("resolves conflicting tailwind classes with last-write-wins", () => {
      expect(cn("px-2", "px-4")).toBe("px-4");
      expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    });

    it("handles conditional class names and falsy values", () => {
      const isVisible = false;
      const isSelected = true;
      expect(cn("base-class", isVisible && "visible-class", isSelected && "selected-class")).toBe(
        "base-class selected-class"
      );
    });
  });

  describe("formatDate", () => {
    it("formats dates in readable US format", () => {
      const date = new Date("2026-01-15T12:00:00Z");
      const formatted = formatDate(date);
      expect(formatted).toContain("Jan");
      expect(formatted).toContain("2026");
    });
  });

  describe("formatRelativeTime", () => {
    it("returns 'just now' for recent timestamps", () => {
      const now = new Date();
      expect(formatRelativeTime(now)).toBe("just now");
    });

    it("returns minutes ago for timestamps under an hour", () => {
      const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
      expect(formatRelativeTime(tenMinsAgo)).toBe("10m ago");
    });

    it("returns hours ago for timestamps under 24 hours", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoHoursAgo)).toBe("2h ago");
    });
  });
});
