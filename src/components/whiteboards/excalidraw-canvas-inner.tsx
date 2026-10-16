"use client";

import React, { useEffect, useCallback } from "react";
import "@excalidraw/excalidraw/index.css";
import {
  Excalidraw,
  THEME,
  exportToBlob,
  exportToSvg,
} from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFiles,
  Collaborator,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useTheme } from "next-themes";

export interface ExcalidrawCanvasInnerProps {
  excalidrawAPIRef: React.MutableRefObject<ExcalidrawImperativeAPI | null>;
  viewModeEnabled: boolean;
  collaborators: Map<string, Collaborator>;
  onChange: (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles
  ) => void;
  onPointerUpdate: (payload: {
    pointer: { x: number; y: number; tool: "pointer" | "laser" };
    button: "down" | "up";
  }) => void;
  onExportPng?: () => void;
  onExportSvg?: () => void;
}

export default function ExcalidrawCanvasInner({
  excalidrawAPIRef,
  viewModeEnabled,
  collaborators,
  onChange,
  onPointerUpdate,
}: ExcalidrawCanvasInnerProps) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? THEME.DARK : THEME.LIGHT;
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleExcalidrawApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      excalidrawAPIRef.current = api;
      if (typeof window !== "undefined") {
        (window as unknown as { __EXCALIDRAW_API__?: ExcalidrawImperativeAPI }).__EXCALIDRAW_API__ = api;
        (window as unknown as { __LATEST_ELEMENTS__?: readonly ExcalidrawElement[] }).__LATEST_ELEMENTS__ =
          api.getSceneElementsIncludingDeleted();
      }
    },
    [excalidrawAPIRef]
  );

  const handleCanvasChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles
    ) => {
      if (typeof window !== "undefined") {
        (window as unknown as { __LATEST_ELEMENTS__?: readonly ExcalidrawElement[] }).__LATEST_ELEMENTS__ = elements;
        if (excalidrawAPIRef.current) {
          (window as unknown as { __EXCALIDRAW_API__?: ExcalidrawImperativeAPI }).__EXCALIDRAW_API__ =
            excalidrawAPIRef.current;
        }
      }
      const activeCount = elements.filter((el) => !el.isDeleted).length;
      if (containerRef.current) {
        containerRef.current.setAttribute("data-active-count", String(activeCount));
      }
      onChange(elements, appState, files);
    },
    [onChange, excalidrawAPIRef]
  );

  useEffect(() => {
    if (excalidrawAPIRef.current && collaborators) {
      excalidrawAPIRef.current.updateScene({
        collaborators:
          collaborators as unknown as NonNullable<
            Parameters<ExcalidrawImperativeAPI["updateScene"]>[0]["collaborators"]
          >,
      });
    }
  }, [collaborators, excalidrawAPIRef]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      data-testid="excalidraw-canvas-container"
      data-active-count="0"
    >
      <Excalidraw
        excalidrawAPI={handleExcalidrawApi}
        theme={theme}
        viewModeEnabled={viewModeEnabled}
        zenModeEnabled={false}
        gridModeEnabled={false}
        onChange={handleCanvasChange}
        onPointerUpdate={onPointerUpdate}
        UIOptions={{
          canvasActions: {
            saveAsImage: true,
            export: {
              saveFileToDisk: true,
            },
            toggleTheme: true,
          },
        }}
      />
    </div>
  );
}

export async function exportWhiteboardToPng(
  api: ExcalidrawImperativeAPI,
  title: string
) {
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();

  const blob = await exportToBlob({
    elements,
    appState: {
      ...appState,
      exportBackground: true,
      exportWithDarkMode: appState.theme === "dark",
    },
    files,
    mimeType: "image/png",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportWhiteboardToSvg(
  api: ExcalidrawImperativeAPI,
  title: string
) {
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();

  const svg = await exportToSvg({
    elements,
    appState: {
      ...appState,
      exportBackground: true,
      exportWithDarkMode: appState.theme === "dark",
    },
    files,
  });

  const svgString = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportWhiteboardToJson(
  api: ExcalidrawImperativeAPI,
  title: string
) {
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();

  const data = JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "https://syncspace.dev",
      elements,
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor,
        gridSize: appState.gridSize,
      },
      files,
    },
    null,
    2
  );

  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}.excalidraw.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
