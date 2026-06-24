'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Toolbar, { type Tool } from '@/components/Toolbar';
import Canvas, { type CanvasHandle } from '@/components/Canvas';
import { drawingColors } from '@/lib/design-tokens';
import { connectToRoom, disconnectFromRoom, socket as getSocket } from '@/lib/socket';
import type { CanvasMutation } from '@/lib/canvasEvents';
import LiveCursors from '@/components/LiveCursors';

interface BoardClientProps {
  roomId: string;
}

const drawingColorOptions = [
  { key: 'charcoal', value: drawingColors.charcoal, label: 'Charcoal' },
  { key: 'red',      value: drawingColors.red,      label: 'Red'      },
  { key: 'orange',   value: drawingColors.orange,   label: 'Orange'   },
  { key: 'yellow',   value: drawingColors.yellow,   label: 'Yellow'   },
  { key: 'green',    value: drawingColors.green,     label: 'Green'    },
  { key: 'blue',     value: drawingColors.blue,      label: 'Blue'     },
  { key: 'purple',   value: drawingColors.purple,    label: 'Purple'   },
  { key: 'pink',     value: drawingColors.pink,      label: 'Pink'     },
] as const;

// Peer avatar colors — deterministic by userId
const AVATAR_COLORS = [
  '#FF5733', '#33C5FF', '#33FF8D', '#FFD433', '#FF33C5',
  '#33FFF0', '#FF8C33', '#9B33FF', '#FF3380', '#33FF57',
];

function getCursorColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Stable pseudo-random user ID for this browser session */
function genUserId() {
  return Math.random().toString(36).slice(2, 9);
}

// ---- Sub-components --------------------------------------------------------

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8l4 4 6-6" />
    </svg>
  );
}

function ThemeIconMoon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function ThemeIconSun() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

// ---- Main component --------------------------------------------------------

export default function BoardClient({ roomId }: BoardClientProps) {
  const [activeTool,     setActiveTool]     = useState<Tool>('select');
  const [drawingColor,   setDrawingColor]   = useState<string>(drawingColors.yellow);
  const [canUndo,        setCanUndo]        = useState(false);
  const [canRedo,        setCanRedo]        = useState(false);
  const [peerCount,      setPeerCount]      = useState(0);
  const [hasSelection,   setHasSelection]   = useState(false);
  const [selectedType,   setSelectedType]   = useState<string | null>(null);
  const [theme,          setTheme]          = useState<'light' | 'dark'>('dark');
  const [textSize,       setTextSize]       = useState<'small' | 'medium' | 'large'>('small');
  const [stickyTextColor, setStickyTextColor] = useState<string>('#1a1500');
  const [copied,         setCopied]         = useState(false);
  const [showToast,      setShowToast]      = useState(false);
  const [layers,             setLayers]             = useState<any[]>([]);
  const [isLayersPanelOpen,  setIsLayersPanelOpen]  = useState(false);

  // Load saved theme on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('synapse-theme') as 'light' | 'dark';
    if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme);
  }, []);

  // Sync theme with DOM and localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('synapse-theme', theme);
  }, [theme]);

  // Live Presence (Cursors) States
  const [cursors, setCursors] = useState<Record<string, { x: number; y: number; color: string; isPointerDown?: boolean }>>({});
  const [clicks,  setClicks]  = useState<Array<{ id: string; x: number; y: number; color: string }>>([]);
  const [viewport, setViewport] = useState({ zoom: 1, panX: 0, panY: 0 });

  // Stable refs wired to Canvas internals via callbacks
  const undoRef   = useRef<(() => void) | null>(null);
  const redoRef   = useRef<(() => void) | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);

  // Room / user identity
  const userIdRef = useRef(genUserId());
  const roomIdRef = useRef(roomId);

  // Snapshot buffering
  const pendingSnapshotRef = useRef<string | null>(null);
  const canvasReadyRef     = useRef(false);

  const handleCanvasReady = useCallback(() => {
    canvasReadyRef.current = true;
    const pending = pendingSnapshotRef.current;
    if (pending) {
      pendingSnapshotRef.current = null;
      canvasRef.current?.loadSnapshot(pending);
    }
  }, []);

  const applyOrBufferSnapshot = useCallback((snapshot: string) => {
    if (canvasReadyRef.current) {
      canvasRef.current?.loadSnapshot(snapshot);
    } else {
      pendingSnapshotRef.current = snapshot;
    }
  }, []);

  // ---- Keyboard shortcuts --------------------------------------------------
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const shortcuts: Record<string, Tool> = {
      v: 'select',    V: 'select',
      h: 'pan',       H: 'pan',
      s: 'sticky',    S: 'sticky',
      r: 'rectangle', R: 'rectangle',
      c: 'circle',    C: 'circle',
      a: 'arrow',     A: 'arrow',
      t: 'text',      T: 'text',
    };

    if (e.key === 'l' || e.key === 'L') {
      setIsLayersPanelOpen(prev => !prev);
      return;
    }

    if (e.key in shortcuts) setActiveTool(shortcuts[e.key]);
    if (e.key === 'Escape')  setActiveTool('select');
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleToolChange = useCallback((tool: Tool) => setActiveTool(tool), []);

  const handleSelectionChange = useCallback((
    hasSel: boolean,
    metadata: {
      type: string | null;
      fontSize?: number | null;
      fill?: string | null;
    } | null
  ) => {
    setHasSelection(hasSel);
    setSelectedType(metadata ? metadata.type : null);

    if (metadata?.fontSize) {
      const fs = metadata.fontSize;
      if (fs <= 18)      setTextSize('small');
      else if (fs <= 28) setTextSize('medium');
      else               setTextSize('large');
    }

    if (metadata?.type === 'sticky' && metadata?.fill) {
      setStickyTextColor(metadata.fill);
    }
  }, []);

  const handleLayersChange = useCallback((layersList: any[]) => {
    setLayers(layersList);
  }, []);

  const handleColorChange = useCallback((color: string) => {
    setDrawingColor(color);
    canvasRef.current?.changeSelectedColor(color);
  }, []);

  const handleHistoryChange = useCallback((u: boolean, r: boolean) => {
    setCanUndo(u);
    setCanRedo(r);
  }, []);

  const handleUndo = useCallback(() => undoRef.current?.(), []);
  const handleRedo = useCallback(() => redoRef.current?.(), []);

  // ---- Copy room link -------------------------------------------------------
  const handleCopyLink = useCallback(() => {
    const url = typeof window !== 'undefined'
      ? `${window.location.origin}/board/${roomId}`
      : `/board/${roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setShowToast(true);
      setTimeout(() => {
        setCopied(false);
        setShowToast(false);
      }, 2000);
    });
  }, [roomId]);

  // ---- Socket — real-time collaboration ------------------------------------
  const handleMutation = useCallback((mutation: CanvasMutation) => {
    const sock = getSocket();
    sock.emit('canvas:mutation', { roomId: roomIdRef.current, mutation });
  }, []);

  const handleSnapshot = useCallback((json: string) => {
    const sock = getSocket();
    sock.emit('canvas:snapshot', { roomId: roomIdRef.current, snapshot: json });
  }, []);

  const handleCursorMove = useCallback((x: number, y: number) => {
    const sock = getSocket();
    sock.emit('cursor:move', { roomId: roomIdRef.current, x, y, userId: userIdRef.current });
  }, []);

  const handleCursorLeave = useCallback(() => {
    const sock = getSocket();
    sock.emit('cursor:leave', { roomId: roomIdRef.current, userId: userIdRef.current });
  }, []);

  const handleCursorClick = useCallback((x: number, y: number) => {
    const sock = getSocket();
    sock.emit('cursor:click', { roomId: roomIdRef.current, x, y, userId: userIdRef.current });
  }, []);

  const handleViewportChange = useCallback((zoom: number, panX: number, panY: number) => {
    setViewport({ zoom, panX, panY });
  }, []);

  useEffect(() => {
    const sock = connectToRoom(roomId, userIdRef.current);

    sock.on('room:snapshot', ({ snapshot, peerCount }: { snapshot: string | null; peerCount?: number }) => {
      if (snapshot) applyOrBufferSnapshot(snapshot);
      if (typeof peerCount === 'number') setPeerCount(peerCount);
    });

    sock.on('canvas:mutation', ({ mutation }: { mutation: CanvasMutation }) => {
      canvasRef.current?.applyRemoteMutation(mutation);
    });

    sock.on('room:peer_joined', () => setPeerCount(p => p + 1));

    sock.on('room:peer_left', ({ userId }: { socketId?: string; userId?: string }) => {
      setPeerCount(p => Math.max(0, p - 1));
      if (userId) {
        setCursors(prev => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
      }
    });

    sock.on('cursor:move', ({ userId, x, y }: { userId: string; x: number; y: number }) => {
      setCursors(prev => ({
        ...prev,
        [userId]: { ...prev[userId], x, y, color: getCursorColor(userId) },
      }));
    });

    sock.on('cursor:leave', ({ userId }: { userId: string }) => {
      setCursors(prev => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    });

    sock.on('cursor:click', ({ userId, x, y }: { userId: string; x: number; y: number }) => {
      const color = getCursorColor(userId);
      const clickId = `${userId}_${Date.now()}_${Math.random()}`;
      setClicks(prev => [...prev, { id: clickId, x, y, color }]);
      setTimeout(() => setClicks(prev => prev.filter(c => c.id !== clickId)), 600);

      setCursors(prev => {
        if (!prev[userId]) return prev;
        return { ...prev, [userId]: { ...prev[userId], isPointerDown: true } };
      });
      setTimeout(() => {
        setCursors(prev => {
          if (!prev[userId]) return prev;
          return { ...prev, [userId]: { ...prev[userId], isPointerDown: false } };
        });
      }, 150);
    });

    sock.on('connect',    () => console.log('[BoardClient] socket connected:', sock.id));
    sock.on('disconnect', (r) => console.log('[BoardClient] socket disconnected:', r));

    return () => {
      disconnectFromRoom();
      sock.off('room:snapshot');
      sock.off('canvas:mutation');
      sock.off('room:peer_joined');
      sock.off('room:peer_left');
      sock.off('cursor:move');
      sock.off('cursor:leave');
      sock.off('cursor:click');
      sock.off('connect');
      sock.off('disconnect');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    canvasRef.current?.setPeerCount(peerCount);
  }, [peerCount]);

  // ---- Tool hint text -------------------------------------------------------
  const toolHint: Partial<Record<Tool, string>> = {
    sticky:    'Click to place  ·  Double-click to edit  ',
    rectangle: 'Drag to size, or click for default  ',
    circle:    'Drag to size, or click for default  ',
    arrow:     'Drag from start to end  ',
    text:      'Drag to set width, or click  ',
    pan:       'Drag to pan the canvas  ',
  };

  // Peer avatar colors (deterministic per peer slot)
  const peerAvatarColors = AVATAR_COLORS.slice(0, Math.min(peerCount, 5));

  return (
    <main className="board-layout" aria-label={`Synapse board ${roomId}`}>
      {/* Floating left vertical toolbar */}
      <Toolbar
        activeTool={activeTool}
        onToolChange={handleToolChange}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      {/* Top-right controls */}
      <div style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        {/* Peer presence avatars */}
        {peerCount > 0 && (
          <div className="hud-bar" style={{ padding: '4px 10px', gap: 4 }}>
            <div className="peer-avatars">
              {peerAvatarColors.map((color, i) => (
                <div
                  key={i}
                  className="peer-dot"
                  style={{ backgroundColor: color }}
                  title={`Peer ${i + 1}`}
                >
                  {String.fromCharCode(65 + i)}
                </div>
              ))}
              {peerCount > 5 && (
                <div className="peer-dot" style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-muted)', fontSize: 8 }}>
                  +{peerCount - 5}
                </div>
              )}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600 }}>
              {peerCount} online
            </span>
          </div>
        )}

        {/* Theme toggle */}
        <button
          className="hud-btn"
          onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
          aria-label="Toggle theme"
        >
          {theme === 'light' ? <ThemeIconMoon /> : <ThemeIconSun />}
        </button>
      </div>

      {/* Top-center: Room bar */}
      <div style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
      }}>
        <div className="room-bar">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
            <path d="M8 1l2 4 5 .5-3.5 3.5 1 5L8 12l-4.5 2 1-5L1 5.5 6 5z" />
          </svg>
          <span className="room-bar-id">{roomId}</span>
          <button
            className="room-bar-copy"
            onClick={handleCopyLink}
            title="Copy board link"
            aria-label="Copy board link"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
      </div>

      {/* Copy toast */}
      {showToast && (
        <div className="copy-toast" role="status" aria-live="polite">
          ✓ Link copied to clipboard
        </div>
      )}

      {/* Canvas area */}
      <div className="canvas-area">
        <Canvas
          ref={canvasRef}
          roomId={roomId}
          activeTool={activeTool}
          stickyColor={drawingColor}
          onToolChange={setActiveTool}
          onHistoryChange={handleHistoryChange}
          onLayersChange={handleLayersChange}
          onSelectionChange={handleSelectionChange}
          undoRef={undoRef}
          redoRef={redoRef}
          onMutation={handleMutation}
          onSnapshot={handleSnapshot}
          onReady={handleCanvasReady}
          userId={userIdRef.current}
          onCursorMove={handleCursorMove}
          onCursorLeave={handleCursorLeave}
          onCursorClick={handleCursorClick}
          onViewportChange={handleViewportChange}
          theme={theme}
          textSize={textSize}
          textColor={drawingColor}
        />

        <LiveCursors
          cursors={cursors}
          clicks={clicks}
          viewport={viewport}
        />

        {/* Right-Side Layers Panel */}
        <div className={`layers-panel${isLayersPanelOpen ? '' : ' closed'}`}>
          <div className="layers-panel-header">
            <span className="layers-panel-title">Layers</span>
            <button
              className="layers-panel-close-btn"
              onClick={() => setIsLayersPanelOpen(false)}
              title="Close Panel"
              aria-label="Close layers panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="layers-list">
            {layers.length === 0 ? (
              <div className="layers-empty-state">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                  <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
                </svg>
                <span>No layers created yet. Add shapes to start organizing.</span>
              </div>
            ) : (
              layers.map((layer) => {
                let label = 'Shape';
                let iconText = '▢';
                if (layer.type === 'rect') {
                  label = 'Rectangle';
                  iconText = '▢';
                } else if (layer.type === 'circle') {
                  label = 'Circle';
                  iconText = '◯';
                } else if (layer.subtype === 'sticky') {
                  label = 'Sticky Note';
                  iconText = '🗂';
                } else if (layer.type === 'textbox') {
                  label = 'Text';
                  iconText = 'T';
                } else if (layer.subtype === 'arrow') {
                  label = 'Arrow';
                  iconText = '↗';
                }

                return (
                  <div
                    key={layer.id}
                    className={`layer-item-row${layer.active ? ' active' : ''}${layer.locked ? ' locked' : ''}`}
                    onClick={() => canvasRef.current?.selectObject(layer.id)}
                  >
                    <span className="layer-icon" style={layer.color ? { color: layer.color } : {}}>
                      {iconText}
                    </span>
                    <div className="layer-label-container">
                      <span className="layer-name">{label}</span>
                      {layer.text && (
                        <span className="layer-text-preview">
                          {layer.text.length > 18 ? layer.text.slice(0, 16) + '...' : layer.text}
                        </span>
                      )}
                    </div>
                    <button
                      className={`layer-lock-btn${layer.locked ? ' locked' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        canvasRef.current?.toggleLock(layer.id);
                      }}
                      title={layer.locked ? 'Unlock Layer' : 'Lock Layer'}
                      aria-label={layer.locked ? 'Unlock layer' : 'Lock layer'}
                    >
                      {layer.locked ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                        </svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
                          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ---- Bottom floating HUD ----------------------------------------- */}
        <div style={{
          position: 'absolute',
          bottom: 36,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          zIndex: 20,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}>

          {/* Layers panel toggle */}
          <button
            className={`hud-bar layers-toggle-hud-btn${isLayersPanelOpen ? ' active' : ''}`}
            onClick={() => setIsLayersPanelOpen(!isLayersPanelOpen)}
            title="Layers List (L)"
            aria-label="Toggle Layers Panel"
            aria-pressed={isLayersPanelOpen}
            style={{
              cursor: 'pointer',
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '36px',
              boxSizing: 'border-box',
            }}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} width="14" height="14" style={{ marginRight: 6 }}>
              <path d="M3 6l7-3 7 3-7 3-7-3zM3 10l7 3 7-3M3 14l7 3 7-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hud-label" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'inherit', padding: 0 }}>Layers</span>
          </button>

          {/* Color picker pill — shown for all tools except pan */}
          {activeTool !== 'pan' && (
            <div className="hud-bar" role="group" aria-label="Drawing color">
              <span className="hud-label">Color</span>
              <div className="hud-divider" />
              {drawingColorOptions.map((opt) => (
                <button
                  key={opt.key}
                  id={`drawing-color-${opt.key}`}
                  className={`color-swatch${drawingColor === opt.value ? ' selected' : ''}`}
                  style={{ backgroundColor: opt.value }}
                  onClick={() => handleColorChange(opt.value)}
                  aria-label={`Drawing color: ${opt.label}`}
                  aria-pressed={drawingColor === opt.value}
                  title={opt.label}
                />
              ))}
            </div>
          )}

          {/* Layer controls — shown only when an object is selected */}
          {hasSelection && (
            <div className="hud-bar" role="group" aria-label="Layering">
              <span className="hud-label">
                Layers
              </span>
              <div className="hud-divider" />
              <button
                className="layer-btn"
                onClick={() => canvasRef.current?.layerSelected('front')}
                title="Bring to Front (Shift+])"
                aria-label="Bring to Front"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75}>
                  <path d="M4 14l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 8l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 1" />
                </svg>
              </button>
              <button
                className="layer-btn"
                onClick={() => canvasRef.current?.layerSelected('forward')}
                title="Bring Forward (])"
                aria-label="Bring Forward"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75}>
                  <path d="M4 12l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                className="layer-btn"
                onClick={() => canvasRef.current?.layerSelected('backward')}
                title="Send Backward ([)"
                aria-label="Send Backward"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75}>
                  <path d="M16 8l-6 6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                className="layer-btn"
                onClick={() => canvasRef.current?.layerSelected('back')}
                title="Send to Back (Shift+[)"
                aria-label="Send to Back"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75}>
                  <path d="M16 6l-6 6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M16 12l-6 6-6-6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 1" />
                </svg>
              </button>
            </div>
          )}

          {/* Text styling controls — shown when text tool active or text/sticky selected */}
          {(activeTool === 'text' || selectedType === 'textbox' || selectedType === 'sticky') && (
            <div className="hud-bar" role="group" aria-label="Text styling">
              <div className="segmented-control" role="group" aria-label="Text size">
                <span className="hud-label" style={{ marginRight: 2 }}>Size</span>
                <div className="hud-divider" style={{ height: 16, margin: '0 4px' }} />
                {(['small', 'medium', 'large'] as const).map((size) => (
                  <button
                    key={size}
                    id={`text-size-${size}`}
                    className={`segmented-item${textSize === size ? ' active' : ''}`}
                    onClick={() => {
                      setTextSize(size);
                      canvasRef.current?.changeSelectedTextSize(size);
                    }}
                    aria-pressed={textSize === size}
                  >
                    {size[0].toUpperCase()}
                  </button>
                ))}
              </div>

              {selectedType === 'sticky' && (
                <>
                  <div className="hud-divider" />
                  <span className="hud-label">Text</span>
                  <button
                    id="sticky-text-color-dark"
                    onClick={() => {
                      setStickyTextColor('#1a1500');
                      canvasRef.current?.changeSelectedStickyTextColor('#1a1500');
                    }}
                    className={`layer-btn${stickyTextColor === '#1a1500' ? ' active' : ''}`}
                    title="Dark text"
                    aria-label="Dark text"
                    style={stickyTextColor === '#1a1500' ? {
                      background: 'var(--color-accent-faint)',
                      borderColor: 'var(--color-accent-dim)',
                      color: 'var(--color-accent)',
                    } : {}}
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
                      <circle cx="10" cy="10" r="6" fill="#1a1500" />
                    </svg>
                  </button>
                  <button
                    id="sticky-text-color-light"
                    onClick={() => {
                      setStickyTextColor('#ffffff');
                      canvasRef.current?.changeSelectedStickyTextColor('#ffffff');
                    }}
                    className={`layer-btn${stickyTextColor === '#ffffff' ? ' active' : ''}`}
                    title="Light text"
                    aria-label="Light text"
                    style={stickyTextColor === '#ffffff' ? {
                      background: 'var(--color-accent-faint)',
                      borderColor: 'var(--color-accent-dim)',
                      color: 'var(--color-accent)',
                    } : {}}
                  >
                    <svg viewBox="0 0 20 20" width="12" height="12">
                      <circle cx="10" cy="10" r="6" fill="#ffffff" stroke="rgba(0,0,0,0.2)" strokeWidth={1.5} />
                    </svg>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Tool hint bar */}
        {activeTool !== 'select' && toolHint[activeTool] && (
          <div className="delete-hint" aria-live="polite">
            {toolHint[activeTool]}
            <kbd>Esc</kbd> to cancel
          </div>
        )}
      </div>
    </main>
  );
}
