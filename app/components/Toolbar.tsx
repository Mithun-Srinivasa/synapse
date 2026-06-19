'use client';

import Link from 'next/link';

export type Tool = 'select' | 'pan' | 'sticky' | 'rectangle' | 'circle' | 'arrow' | 'text';

interface ToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

// All icons hand-built from SVG -- no external library per spec
function IconSelect() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3l12 7-6 1-3 6L4 3z" />
    </svg>
  );
}

function IconPan() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3v2M10 15v2M3 10h2M15 10h2" />
      <path d="M6.5 6.5l1.5 1.5M13.5 13.5l-1.5-1.5M13.5 6.5l-1.5 1.5M6.5 13.5l1.5-1.5" />
      <circle cx="10" cy="10" r="2" />
    </svg>
  );
}

function IconSticky() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h12v8l-4 4H4V4z" />
      <path d="M12 12v4M12 12h4" strokeDasharray="2 1" />
    </svg>
  );
}

function IconRectangle() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="14" height="10" rx="2" />
    </svg>
  );
}

function IconCircle() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <circle cx="10" cy="10" r="7" />
    </svg>
  );
}

function IconArrow() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="16" x2="16" y2="4" />
      <polyline points="9,4 16,4 16,11" />
    </svg>
  );
}

function IconText() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="16" y2="6" />
      <line x1="10" y1="6" x2="10" y2="16" />
    </svg>
  );
}

function IconUndo() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9H13a4 4 0 0 1 0 8H9" />
      <polyline points="8,5 4,9 8,13" />
    </svg>
  );
}

function IconRedo() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 9H7a4 4 0 0 0 0 8h4" />
      <polyline points="12,5 16,9 12,13" />
    </svg>
  );
}

// Drawing tools shown in the main group
const drawingTools: Array<{ id: Tool; label: string; icon: React.ReactNode; shortcut: string }> = [
  { id: 'select',    label: 'Select',      icon: <IconSelect />,    shortcut: 'V' },
  { id: 'pan',       label: 'Hand / Pan',  icon: <IconPan />,       shortcut: 'H' },
  { id: 'sticky',    label: 'Sticky Note', icon: <IconSticky />,    shortcut: 'S' },
  { id: 'rectangle', label: 'Rectangle',   icon: <IconRectangle />, shortcut: 'R' },
  { id: 'circle',    label: 'Circle',      icon: <IconCircle />,    shortcut: 'C' },
  { id: 'arrow',     label: 'Arrow',       icon: <IconArrow />,     shortcut: 'A' },
  { id: 'text',      label: 'Text',        icon: <IconText />,      shortcut: 'T' },
];

export default function Toolbar({ activeTool, onToolChange, canUndo, canRedo, onUndo, onRedo }: ToolbarProps) {
  return (
    <aside className="toolbar" role="toolbar" aria-label="Drawing tools">
      {/* Wordmark -- vertical */}
      <Link href="/" className="toolbar-logo" aria-label="Synapse homepage">
        SYN
      </Link>

      <div className="toolbar-divider" />

      {drawingTools.map((tool) => (
        <button
          key={tool.id}
          id={`toolbar-${tool.id}`}
          className={`toolbar-item${activeTool === tool.id ? ' active' : ''}`}
          onClick={() => onToolChange(tool.id)}
          aria-pressed={activeTool === tool.id}
          aria-label={`${tool.label} (${tool.shortcut})`}
        >
          {tool.icon}
          <span className="toolbar-tooltip">
            {tool.label}
            <span style={{
              marginLeft: '6px',
              opacity: 0.4,
              fontFamily: 'var(--font-geist-mono, monospace)',
              fontSize: '10px',
            }}>
              {tool.shortcut}
            </span>
          </span>
        </button>
      ))}

      <div className="toolbar-divider" style={{ marginTop: 'auto' }} />

      {/* Undo / Redo */}
      <button
        id="toolbar-undo"
        className="toolbar-item"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="Undo (Ctrl+Z)"
      >
        <IconUndo />
        <span className="toolbar-tooltip">
          Undo <span style={{ opacity: 0.4, fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '10px' }}>Ctrl+Z</span>
        </span>
      </button>

      <button
        id="toolbar-redo"
        className="toolbar-item"
        onClick={onRedo}
        disabled={!canRedo}
        aria-label="Redo (Ctrl+Y)"
      >
        <IconRedo />
        <span className="toolbar-tooltip">
          Redo <span style={{ opacity: 0.4, fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '10px' }}>Ctrl+Y</span>
        </span>
      </button>
    </aside>
  );
}
