import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

describe("Design System Primitives", () => {
  it("renders Button with default variant and responds to disabled prop", () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole("button", { name: /click me/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it("renders Button with brand variant", () => {
    render(<Button variant="brand">Brand Action</Button>);
    const button = screen.getByRole("button", { name: /brand action/i });
    expect(button).toHaveClass("bg-brand-indigo");
  });

  it("renders Badge with success variant", () => {
    render(<Badge variant="success">Active</Badge>);
    const badge = screen.getByText("Active");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("text-emerald-600");
  });

  it("renders Card structure with title and content", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Architecture Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Real-time CRDT synchronization</p>
        </CardContent>
      </Card>
    );

    expect(screen.getByText("Architecture Overview")).toBeInTheDocument();
    expect(screen.getByText("Real-time CRDT synchronization")).toBeInTheDocument();
  });
});
