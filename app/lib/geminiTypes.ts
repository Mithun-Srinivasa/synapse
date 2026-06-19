// geminiTypes.ts -- TypeScript types for AI JSON output
// Used in Phase 5 (AI chat) and Phase 6 (Generate mode)

export type NodeType = 'box' | 'circle' | 'sticky';

export interface AiNode {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AiEdge {
  from: string;
  to: string;
  label?: string;
}

export interface AiCanvasOutput {
  nodes: AiNode[];
  edges: AiEdge[];
}

export type AiMode = 'chat' | 'generate';

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  userId: string;
  userName: string;
  timestamp: number;
  mode: AiMode;
}
