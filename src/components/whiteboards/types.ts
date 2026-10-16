import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export interface WhiteboardSnapshotData {
  elements?: readonly ExcalidrawElement[];
  appState?: Partial<AppState>;
  files?: BinaryFiles;
}

export interface CollaborativeWhiteboardProps {
  whiteboardId: string;
  workspaceId: string;
  workspaceName?: string;
  projectName?: string | null;
  initialTitle: string;
  liveblocksRoomId: string;
  effectiveRole: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
  authorName: string;
  updatedAtIso: string;
  currentUser?: {
    id: string;
    name: string;
    email?: string;
    color?: string;
    image?: string | null;
  } | null;
  initialSnapshot?: WhiteboardSnapshotData | null;
  isDemoMode?: boolean;
  liveblocksConfigured?: boolean;
}

export interface CollaboratorInfo {
  id: string;
  name: string;
  color: string;
  role: string;
  connectionId?: number;
}

export interface WhiteboardMemberItem {
  id: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
    color?: string | null;
  };
}

export interface WhiteboardPermissionItem {
  id: string;
  artifactId: string;
  userId: string;
  role: "EDITOR" | "VIEWER" | "NONE";
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
    color?: string | null;
  };
}
