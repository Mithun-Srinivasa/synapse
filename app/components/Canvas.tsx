'use client';

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { Tool } from '@/components/Toolbar';
import { colors, fabricDefaults } from '@/lib/design-tokens';
import { buildMutation, applyMutation as applyCanvasMutation, type CanvasMutation } from '@/lib/canvasEvents';
import { stripDefaults, getCanvasBounds, hexToRgba, type SynapseDocument } from '@/lib/document';

// ----------------------------------------------------------------
// Canvas history (undo / redo) -- JSON snapshot approach
// ----------------------------------------------------------------
class CanvasHistory {
  private states: string[] = [];
  private idx    = -1;
  private max    = 60;

  save(json: string) {
    // Discard any redo-able future when a new action is taken
    this.states = this.states.slice(0, this.idx + 1);
    this.states.push(json);
    if (this.states.length > this.max) this.states.shift();
    else this.idx++;
  }
  undo(): string | null {
    if (this.idx <= 0) return null;
    return this.states[--this.idx];
  }
  redo(): string | null {
    if (this.idx >= this.states.length - 1) return null;
    return this.states[++this.idx];
  }
  canUndo() { return this.idx > 0; }
  canRedo() { return this.idx < this.states.length - 1; }
}

// ----------------------------------------------------------------
// Types & constants
// ----------------------------------------------------------------
export interface CanvasHandle {
  /** Load a full Fabric JSON snapshot (e.g. from room:snapshot on join). */
  loadSnapshot: (json: string) => Promise<void>;
  /** Apply a single mutation received from a remote peer. */
  applyRemoteMutation: (mutation: CanvasMutation) => Promise<void>;
  /** Return the current canvas as a JSON string. */
  getSnapshot: () => string;
  /** Update the number of remote peers shown in the status bar. */
  setPeerCount: (count: number) => void;
  /** Update color of the selected shape(s). */
  changeSelectedColor: (color: string) => void;
  /** Update font size of the selected text elements. */
  changeSelectedTextSize: (size: 'small' | 'medium' | 'large') => void;
  /** Update text color of the selected sticky note(s). */
  changeSelectedStickyTextColor: (textColor: string) => void;
  /** Reorder the selected object(s) in the z-index stack. */
  layerSelected: (direction: 'back' | 'backward' | 'forward' | 'front') => void;
}

export interface CanvasProps {
  roomId: string;
  activeTool: Tool;
  stickyColor: string;
  onToolChange: (tool: Tool) => void;
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void;
  onSelectionChange?: (
    hasSelection: boolean,
    metadata: { type: string | null; fontSize?: number | null; fill?: string | null } | null
  ) => void;
  undoRef: React.RefObject<(() => void) | null>;
  redoRef: React.RefObject<(() => void) | null>;
  /** Called whenever a local change should be broadcast to peers. */
  onMutation?: (mutation: CanvasMutation) => void;
  /** Called after the canvas state changes (for full-snapshot broadcast). */
  onSnapshot?: (json: string) => void;
  /** Stable user ID assigned by BoardClient. */
  userId?: string;
  /** Called once the Fabric canvas has fully initialized and is ready to receive snapshots. */
  onReady?: () => void;
  onCursorMove?: (x: number, y: number) => void;
  onCursorLeave?: () => void;
  onCursorClick?: (x: number, y: number) => void;
  onViewportChange?: (zoom: number, panX: number, panY: number) => void;
  theme?: 'light' | 'dark';
  textSize?: 'small' | 'medium' | 'large';
  textColor?: string;
}

let fabricModule: typeof import('fabric') | null = null;
let StickyNoteClass: any = null;

function setupCustomClasses(fabric: any) {
  if (StickyNoteClass) return;

  class StickyNote extends fabric.Textbox {
    static type = 'sticky';

    constructor(text: string, options: any = {}) {
      const { type, ...cleanOptions } = options;
      super(text, {
        ...cleanOptions,
        subtype: 'sticky',
        editable: false,
        hoverCursor: 'move',
      });
    }

    initDimensions() {
      const savedHeight = this.height;
      super.initDimensions();
      if (savedHeight !== undefined) {
        this.height = savedHeight;
      }
    }

    _renderBackground(ctx: CanvasRenderingContext2D) {
      const rx = 8;
      const ry = 8;
      // The background card is 24px wider and taller than the text box,
      // centered at the center of the object (0, 0).
      const w = this.width + 24;
      const h = this.height + 24;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, [rx, ry]);
      ctx.fillStyle = this.backgroundColor || '#E8C547';
      ctx.fill();
    }

    _renderText(ctx: CanvasRenderingContext2D) {
      ctx.save();
      const w = this.width;
      const h = this.height;

      // Clip text to the inner text area (textbox width and height)
      ctx.beginPath();
      ctx.rect(-w / 2, -h / 2, w, h);
      ctx.clip();

      super._renderText(ctx);
      ctx.restore();
    }

    toObject(propertiesToInclude = []) {
      return super.toObject([...propertiesToInclude, 'subtype']);
    }

    static async fromObject(object: any) {
      return new StickyNote(object.text || '', object);
    }
  }

  fabric.classRegistry.setClass(StickyNote, 'sticky');
  StickyNoteClass = StickyNote;

  const isLowOpacity = (fill: any) => {
    if (!fill || fill === 'transparent') return true;
    if (typeof fill === 'string') {
      const match = fill.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/);
      if (match) {
        return parseFloat(match[1]) < 0.2;
      }
      if (fill.startsWith('#') && fill.length === 9) {
        return parseInt(fill.substring(7, 9), 16) / 255 < 0.2;
      }
    }
    return false;
  };

  // Helper: transform a canvas-space point into an object's local space (Fabric v6 compatible).
  // Fabric v6 removed toLocalPoint; we invert the object's calcTransformMatrix() instead.
  const toLocalPoint = (obj: any, point: any): { x: number; y: number } => {
    const matrix = obj.calcTransformMatrix();
    // 2x3 affine matrix: [a, b, c, d, e, f] -- invert it
    const { a, b, c, d, e, f } = { a: matrix[0], b: matrix[1], c: matrix[2], d: matrix[3], e: matrix[4], f: matrix[5] };
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-10) return { x: 0, y: 0 };
    const inv = {
      a:  d / det,
      b: -b / det,
      c: -c / det,
      d:  a / det,
      e: (c * f - d * e) / det,
      f: (b * e - a * f) / det,
    };
    return {
      x: inv.a * point.x + inv.c * point.y + inv.e,
      y: inv.b * point.x + inv.d * point.y + inv.f,
    };
  };

  // Click-through on transparent/low-opacity rect centers: only hit when close to border
  const originalRectContainsPoint = fabric.Rect.prototype.containsPoint;
  fabric.Rect.prototype.containsPoint = function(point: any) {
    if (!isLowOpacity(this.fill)) {
      return originalRectContainsPoint.call(this, point);
    }
    const localPt = toLocalPoint(this, point);
    const wHalf = (this.width  * this.scaleX) / 2;
    const hHalf = (this.height * this.scaleY) / 2;
    const tol   = Math.max((this.strokeWidth || 1) * this.scaleX + 8, 12);
    if (Math.abs(localPt.x) > wHalf + tol || Math.abs(localPt.y) > hHalf + tol) return false;
    const nearLR = Math.abs(Math.abs(localPt.x) - wHalf) <= tol;
    const nearTB = Math.abs(Math.abs(localPt.y) - hHalf) <= tol;
    return nearLR || nearTB;
  };

  // Click-through on transparent/low-opacity circle centers: only hit when close to circumference
  const originalCircleContainsPoint = fabric.Circle.prototype.containsPoint;
  fabric.Circle.prototype.containsPoint = function(point: any) {
    if (!isLowOpacity(this.fill)) {
      return originalCircleContainsPoint.call(this, point);
    }
    const localPt = toLocalPoint(this, point);
    const r    = (this.radius || 0) * ((this.scaleX + this.scaleY) / 2);
    const dist  = Math.sqrt(localPt.x * localPt.x + localPt.y * localPt.y);
    const tol   = Math.max((this.strokeWidth || 1) * this.scaleX + 8, 12);
    return Math.abs(dist - r) <= tol;
  };
}

async function getFabric() {
  if (!fabricModule) {
    fabricModule = await import('fabric');
    setupCustomClasses(fabricModule);
  }
  return fabricModule;
}

function uid(): string { return Math.random().toString(36).slice(2, 9); }

const MIN_DRAG = 8;
const STATUS_BAR_H = 24; // height of the status bar overlay (px)
const CLICK_DEFAULTS = {
  sticky:    { w: 220, h: 220 },
  rectangle: { w: 180, h: 130 },
  circle:    { w: 140, h: 140 },
  text:      { w: 200 },
};

// ----------------------------------------------------------------
// Extra serialization keys we want preserved in history snapshots
// ----------------------------------------------------------------
const EXTRA_PROPS = ['id', 'subtype', 'interactive', 'subTargetCheck', 'paddingX', 'paddingY', 'hoverCursor', 'selectionColor', 'cursorColor', 'perPixelTargetFind'];

// ----------------------------------------------------------------
// Component
// ----------------------------------------------------------------
const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas({
  roomId,
  activeTool,
  stickyColor,
  onToolChange,
  onHistoryChange,
  onSelectionChange,
  undoRef,
  redoRef,
  onMutation,
  onSnapshot,
  onReady,
  userId = 'local',
  onCursorMove,
  onCursorLeave,
  onCursorClick,
  onViewportChange,
  theme = 'dark',
  textSize = 'small',
  textColor,
}, ref) {
  const canvasElRef  = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricRef    = useRef<any>(null);

  // Stable refs that callbacks close over
  const activeToolRef  = useRef<Tool>(activeTool);
  const stickyColorRef = useRef<string>(stickyColor);

  // Drag / shape preview
  const dragStartRef  = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ghostRef      = useRef<any>(null);

  // Pan state
  const isPanningRef   = useRef(false);
  const panLastRef     = useRef<{ x: number; y: number } | null>(null);
  const spaceHeldRef   = useRef(false);    // Space bar temp-pan (like Figma)
  const midMouseRef    = useRef(false);    // Middle mouse pan

  // History
  const historyRef       = useRef(new CanvasHistory());
  const isRestoringRef   = useRef(false);  // prevent snapshot during restore
  const textDebounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCursorEmitRef = useRef(0);

  // Collaboration
  const onMutationRef  = useRef(onMutation);
  const onSnapshotRef  = useRef(onSnapshot);
  const onReadyRef     = useRef(onReady);
  const userIdRef      = useRef(userId);
  const onCursorMoveRef = useRef(onCursorMove);
  const onCursorLeaveRef = useRef(onCursorLeave);
  const onCursorClickRef = useRef(onCursorClick);
  const onViewportChangeRef = useRef(onViewportChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const textSizeRef = useRef(textSize);
  const textColorRef = useRef(textColor);
  const themeRef = useRef(theme);

  useEffect(() => { textSizeRef.current = textSize; }, [textSize]);
  useEffect(() => { textColorRef.current = textColor; }, [textColor]);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  // True after onReady fires -- suppresses initial empty-canvas snapshot broadcast
  const canvasJoinedRef = useRef(false);
  useEffect(() => { onMutationRef.current  = onMutation;  }, [onMutation]);
  useEffect(() => { onSnapshotRef.current  = onSnapshot;  }, [onSnapshot]);
  useEffect(() => { onReadyRef.current     = onReady;     }, [onReady]);
  useEffect(() => { userIdRef.current      = userId;      }, [userId]);
  useEffect(() => { onCursorMoveRef.current = onCursorMove; }, [onCursorMove]);
  useEffect(() => { onCursorLeaveRef.current = onCursorLeave; }, [onCursorLeave]);
  useEffect(() => { onCursorClickRef.current = onCursorClick; }, [onCursorClick]);
  useEffect(() => { onViewportChangeRef.current = onViewportChange; }, [onViewportChange]);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);

  // UI state
  const [hasSelection, setHasSelection] = useState(false);
  const [objectCount,  setObjectCount]  = useState(0);
  const [zoom,         setZoom]         = useState(100);
  const [isPanActive,  setIsPanActive]  = useState(false); // cursor indicator
  const [peerCount,    setPeerCount]    = useState(0);    // remote peers in room

  // Keep refs in sync with props
  useEffect(() => { activeToolRef.current  = activeTool;  }, [activeTool]);
  useEffect(() => { stickyColorRef.current = stickyColor; }, [stickyColor]);


  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------
  const updateCount = useCallback((canvas: any) => {
    setObjectCount(canvas.getObjects().length);
  }, []);

  const notifyHistory = useCallback(() => {
    const h = historyRef.current;
    onHistoryChange(h.canUndo(), h.canRedo());
  }, [onHistoryChange]);  const centerOnBounds = useCallback((bounds: { minX: number; minY: number; maxX: number; maxY: number }) => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const contentWidth = bounds.maxX - bounds.minX;
    const contentHeight = bounds.maxY - bounds.minY;

    if (contentWidth <= 0 || contentHeight <= 0) return;

    const padding = 60;
    const fitZoomX = (canvas.width - padding) / contentWidth;
    const fitZoomY = (canvas.height - padding) / contentHeight;
    let zoom = Math.min(1.0, fitZoomX, fitZoomY);
    zoom = Math.min(Math.max(zoom, 0.1), 8); // clamp zoom between 10% and 800%

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    canvas.setZoom(zoom);
    const vpt = canvas.viewportTransform;
    if (vpt) {
      vpt[4] = canvas.width / 2 - centerX * zoom;
      vpt[5] = canvas.height / 2 - centerY * zoom;
      canvas.setViewportTransform(vpt);
    }
    canvas.renderAll();

    // Notify parent BoardClient of viewport pan/zoom update (so live cursor overlay updates positions)
    onViewportChangeRef.current?.(zoom, canvas.viewportTransform?.[4] ?? 0, canvas.viewportTransform?.[5] ?? 0);
    setZoom(Math.round(zoom * 100)); // Sync zoom UI percentage
  }, []);

  const saveHistory = useCallback(() => {
    if (isRestoringRef.current) return;
    const canvas = fabricRef.current;
    if (!canvas) return;

    // 1. Serialize all objects
    const rawObjects = canvas.toJSON(EXTRA_PROPS).objects;

    // 2. Strip defaults
    const strippedObjects = rawObjects.map((obj: any) => stripDefaults(obj));

    // 3. Compute bounds
    const bounds = getCanvasBounds(canvas);

    // 4. Wrap in SynapseDocument
    const document: SynapseDocument = {
      v: 1,
      boardId: roomId,
      meta: {
        created: Date.now(),
        modified: Date.now(),
        objectCount: strippedObjects.length,
      },
      bounds,
      objects: strippedObjects,
    };

    const docJson = JSON.stringify(document);
    historyRef.current.save(docJson);
    notifyHistory();

    // Only broadcast snapshots after the canvas has joined (onReady fired).
    // This prevents the initial empty-canvas save from overwriting room state.
    if (canvasJoinedRef.current) {
      onSnapshotRef.current?.(docJson);
    }
  }, [notifyHistory, roomId]);

  const restoreFromSnapshot = useCallback(async (json: string, centerViewport = false) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    isRestoringRef.current = true;

    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      console.error('[Canvas] Failed to parse snapshot JSON:', err);
      isRestoringRef.current = false;
      return;
    }

    let fabricJson: any;
    let bounds: any = null;

    if (parsed && parsed.v === 1 && Array.isArray(parsed.objects)) {
      // It's a SynapseDocument!
      fabricJson = { objects: parsed.objects };
      bounds = parsed.bounds;
    } else {
      // It's raw Fabric JSON (e.g. from local undo/redo stack)
      fabricJson = parsed;
    }

    await canvas.loadFromJSON(fabricJson);

    // Re-apply interactive flags that Fabric may not fully restore from JSON
    canvas.getObjects().forEach((obj: any) => {
      if (obj.subtype === 'sticky') {
        obj.setControlsVisibility({
          mt: true,
          mb: true,
        });
      }
      // Restore tool mode selectability
      const tool = activeToolRef.current;
      obj.selectable = tool === 'select';
      obj.evented    = tool === 'select';
    });

    canvas.renderAll();
    isRestoringRef.current = false;
    updateElevationShadows(canvas);
    updateCount(canvas);
    notifyHistory();

    if (centerViewport && bounds) {
      centerOnBounds(bounds);
    }
  }, [updateCount, notifyHistory, centerOnBounds]);

  const updateElevationShadows = useCallback((canvas: any) => {
    if (!canvas || !fabricModule) return;
    const fabric = fabricModule;
    const objects = canvas.getObjects().filter((obj: any) => {
      // Only apply to selectable shape elements (avoid cursors, ghosts, etc.)
      return obj.selectable && obj.id && obj.subtype !== 'cursor';
    });

    const n = objects.length;
    const isDark = theme === 'dark';

    objects.forEach((obj: any, rank: number) => {
      const relativeElevation = n > 1 ? rank / (n - 1) : 1.0;

      // Sharp shadow for top, progressively lighter (lower opacity, larger blur) for bottom
      const opacity = isDark
        ? 0.12 + 0.38 * relativeElevation  // 0.12 at bottom, 0.50 at top
        : 0.06 + 0.24 * relativeElevation; // 0.06 at bottom, 0.30 at top

      const blur = 18 - 10 * relativeElevation;        // 18px at bottom (soft), 8px at top (sharp)
      const offsetY = 9 - 5 * relativeElevation;      // 9px at bottom, 4px at top
      const offsetX = 0;

      obj.set({
        shadow: new fabric.Shadow({
          color: `rgba(0, 0, 0, ${opacity})`,
          blur,
          offsetX,
          offsetY,
        }),
      });
    });

    canvas.renderAll();
  }, [theme]);

  const getActiveMetadata = useCallback((canvas: any) => {
    if (!canvas) return null;
    const active = canvas.getActiveObject();
    if (!active) return null;
    if (active.type === 'activeSelection') {
      return { type: 'selection', fontSize: null, fill: null };
    }
    const obj = active as any;
    const fill = typeof obj.fill === 'string' ? obj.fill : null;

    const objects = canvas.getObjects().filter((o: any) => o.selectable && o.id && o.subtype !== 'cursor');
    const layerTotal = objects.length;
    const layerRank = objects.indexOf(active) + 1;

    return {
      type: obj.subtype || active.type || null,
      fontSize: (obj.fontSize as number) || null,
      fill,
      layerRank: layerRank > 0 ? layerRank : undefined,
      layerTotal: layerTotal > 0 ? layerTotal : undefined,
    };
  }, []);

  const drawLayerBadge = useCallback((canvas: any, ctx: CanvasRenderingContext2D) => {
    if (!canvas || !fabricModule) return;
    const fabric = fabricModule;
    const activeObj = canvas.getActiveObject();
    if (!activeObj || activeObj.type === 'activeSelection' || !activeObj.selectable) return;

    const objects = canvas.getObjects().filter((o: any) => o.selectable && o.id && o.subtype !== 'cursor');
    const total = objects.length;
    const rank = objects.indexOf(activeObj) + 1;
    if (rank <= 0) return;

    // Find top center of object in canvas space
    const coords = activeObj.getCoords();
    if (!coords || coords.length < 2) return;
    const tl = coords[0];
    const tr = coords[1];
    const topCenterX = (tl.x + tr.x) / 2;
    const topCenterY = (tl.y + tr.y) / 2;

    // Transform to viewport space (screen pixels)
    const screenPt = fabric.util.transformPoint(
      new fabric.Point(topCenterX, topCenterY),
      canvas.viewportTransform
    );

    // Float 18px above the top border
    const badgeY = screenPt.y - 18;
    const badgeX = screenPt.x;

    ctx.save();
    // Reset context transform to draw badge in crisp screen space
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Badge content
    const text = `LAYER ${rank} OF ${total}`;
    ctx.font = 'bold 9px Inter, sans-serif';
    const textWidth = ctx.measureText(text).width;

    const paddingX = 8;
    const paddingY = 4;
    const w = textWidth + paddingX * 2;
    const h = 18;
    const rx = 9; // fully rounded pill

    const x = badgeX - w / 2;
    const y = badgeY - h / 2;

    // Draw shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    // Draw background pill
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rx);
    ctx.fillStyle = themeRef.current === 'dark' ? '#181824' : '#ffffff';
    ctx.fill();

    // Draw border
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1;
    ctx.strokeStyle = themeRef.current === 'dark' ? 'rgba(232, 197, 71, 0.6)' : 'rgba(201, 168, 0, 0.6)';
    ctx.stroke();

    // Draw text
    ctx.fillStyle = themeRef.current === 'dark' ? '#E8C547' : '#9a7e00';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, badgeX, badgeY + 0.5);

    ctx.restore();
  }, []);

  // ----------------------------------------------------------------
  // Undo / Redo -- called from BoardClient via stable callbacks
  // ----------------------------------------------------------------
  const undo = useCallback(async () => {
    const snap = historyRef.current.undo();
    if (snap) await restoreFromSnapshot(snap);
    notifyHistory();
  }, [restoreFromSnapshot, notifyHistory]);

  const redo = useCallback(async () => {
    const snap = historyRef.current.redo();
    if (snap) await restoreFromSnapshot(snap);
    notifyHistory();
  }, [restoreFromSnapshot, notifyHistory]);

  // Expose stable undo/redo via refs so BoardClient can wire them
  useEffect(() => {
    if (undoRef) undoRef.current = undo;
    if (redoRef) redoRef.current = redo;
  }, [undo, redo, undoRef, redoRef]);

  // Sync elevation shadows on theme changes
  useEffect(() => {
    if (fabricRef.current) {
      updateElevationShadows(fabricRef.current);
    }
  }, [theme, updateElevationShadows]);

  // ----------------------------------------------------------------
  // Imperative handle -- collaboration surface exposed to BoardClient
  // ----------------------------------------------------------------
  useImperativeHandle(ref, () => ({
    async loadSnapshot(json: string) {
      await restoreFromSnapshot(json, true); // Center viewport on load!
    },
    async applyRemoteMutation(mutation: CanvasMutation) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      isRestoringRef.current = true;
      await applyCanvasMutation(canvas, mutation);
      updateCount(canvas);
      isRestoringRef.current = false;
      updateElevationShadows(canvas);
    },
    getSnapshot() {
      const canvas = fabricRef.current;
      if (!canvas) return '{}';
      const rawObjects = canvas.toJSON(EXTRA_PROPS).objects;
      const strippedObjects = rawObjects.map((obj: any) => stripDefaults(obj));
      const bounds = getCanvasBounds(canvas);
      const document: SynapseDocument = {
        v: 1,
        boardId: roomId,
        meta: {
          created: Date.now(),
          modified: Date.now(),
          objectCount: strippedObjects.length,
        },
        bounds,
        objects: strippedObjects,
      };
      return JSON.stringify(document);
    },
    setPeerCount(count: number) {
      setPeerCount(count);
    },
    changeSelectedColor(color: string) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;

      const updateObjColor = (obj: any) => {
        if (obj.subtype === 'sticky') {
          obj.set({ backgroundColor: color });
        } else if (obj.type === 'rect' || obj.type === 'circle') {
          obj.set({
            stroke: color,
            fill: hexToRgba(color, 0.06),
          });
        } else if (obj.type === 'textbox') {
          obj.set({ fill: color });
        } else if (obj.subtype === 'arrow') {
          obj.set({ stroke: color });
        }
      };

      if (activeObj.type === 'activeSelection') {
        activeObj.forEachObject((obj: any) => updateObjColor(obj));
      } else {
        updateObjColor(activeObj);
      }

      canvas.renderAll();
      saveHistory();
    },
    layerSelected(direction: 'back' | 'backward' | 'forward' | 'front') {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const active = canvas.getActiveObject();
      if (!active) return;

      if (direction === 'back') {
        canvas.sendObjectToBack(active);
      } else if (direction === 'backward') {
        canvas.sendObjectBackwards(active);
      } else if (direction === 'forward') {
        canvas.bringObjectForward(active);
      } else if (direction === 'front') {
        canvas.bringObjectToFront(active);
      }

      updateElevationShadows(canvas);
      canvas.renderAll();
      saveHistory();

      // Notify selection change to update HUD layer indicator!
      onSelectionChangeRef.current?.(true, getActiveMetadata(canvas));

      // Broadcast layering mutation!
      if (active.id && !isRestoringRef.current) {
        onMutationRef.current?.({
          type: 'object:layer',
          objectId: active.id,
          data: { direction },
          userId: userIdRef.current,
        });
      }
    },
    changeSelectedTextSize(size: 'small' | 'medium' | 'large') {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;

      const FONT_SIZES = {
        small: 16,
        medium: 24,
        large: 36,
      } as const;
      const fontSizeVal = FONT_SIZES[size] || 16;

      const updateObjTextSize = (obj: any) => {
        if (obj.type === 'textbox' || obj.subtype === 'sticky') {
          obj.set({ fontSize: fontSizeVal });
          obj.setCoords();
        }
      };

      if (activeObj.type === 'activeSelection') {
        activeObj.forEachObject((obj: any) => updateObjTextSize(obj));
      } else {
        updateObjTextSize(activeObj);
      }

      canvas.renderAll();
      saveHistory();

      // Emit object:modified mutation
      if (activeObj.type === 'activeSelection') {
        activeObj.forEachObject((obj: any) => {
          if (obj.id && !isRestoringRef.current) {
            onMutationRef.current?.(buildMutation('object:modified', obj, userIdRef.current));
          }
        });
      } else {
        if (activeObj.id && !isRestoringRef.current) {
          onMutationRef.current?.(buildMutation('object:modified', activeObj, userIdRef.current));
        }
      }
    },
    changeSelectedStickyTextColor(textColorVal: string) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;

      const updateStickyTextColor = (obj: any) => {
        if (obj.subtype === 'sticky') {
          obj.set({ fill: textColorVal });
        }
      };

      if (activeObj.type === 'activeSelection') {
        activeObj.forEachObject((obj: any) => updateStickyTextColor(obj));
      } else {
        updateStickyTextColor(activeObj);
      }

      canvas.renderAll();
      saveHistory();

      // Emit object:modified mutation
      if (activeObj.type === 'activeSelection') {
        activeObj.forEachObject((obj: any) => {
          if (obj.id && !isRestoringRef.current) {
            onMutationRef.current?.(buildMutation('object:modified', obj, userIdRef.current));
          }
        });
      } else {
        if (activeObj.id && !isRestoringRef.current) {
          onMutationRef.current?.(buildMutation('object:modified', activeObj, userIdRef.current));
        }
      }
    },
  }), [restoreFromSnapshot, updateCount, roomId]);

  // ----------------------------------------------------------------
  // Tool mode -- what the canvas interaction state should be
  // ----------------------------------------------------------------
  const isPanMode = useCallback((tool: Tool) =>
    tool === 'pan' || spaceHeldRef.current || midMouseRef.current
  , []);

  const applyToolMode = useCallback((canvas: any, tool: Tool) => {
    const panning = isPanMode(tool);
    canvas.isDrawingMode = false;
    canvas.selection     = !panning && tool === 'select';
    canvas.defaultCursor = panning ? 'grab' : (tool === 'select' ? 'default' : 'crosshair');
    canvas.hoverCursor   = panning ? 'grab' : (tool === 'select' ? 'move'    : 'crosshair');
    canvas.forEachObject((obj: any) => {
      if (obj.isEditing) return; // Skip currently editing text objects to preserve Fabric's state
      obj.selectable = !panning && tool === 'select';
      obj.evented    = !panning && tool === 'select';
    });
    canvas.renderAll();
    setIsPanActive(panning);
  }, [isPanMode]);

  // ----------------------------------------------------------------
  // Per-object styling from design tokens
  // ----------------------------------------------------------------
  const applyObjectDefaults = useCallback((obj: any) => {
    obj.set({
      cornerSize:         fabricDefaults.cornerSize,
      cornerColor:        fabricDefaults.cornerColor,
      cornerStyle:        'circle',
      borderColor:        fabricDefaults.borderColor,
      borderScaleFactor:  1.5,
      transparentCorners: fabricDefaults.transparentCorners,
      padding:            4,
    });
  }, []);

  // ----------------------------------------------------------------
  // Shape finalizers
  // ----------------------------------------------------------------

  /** Auto-revert to select after placing any shape */
  const revertToSelect = useCallback(() => {
    onToolChange('select');
  }, [onToolChange]);

  const finalizeStickyNote = useCallback((x: number, y: number, w: number, h: number) => {
    const canvas = fabricRef.current;
    if (!canvas || !fabricModule || !StickyNoteClass) return;
    const fabric = fabricModule;
    const color  = stickyColorRef.current;

    // Calculate a font size proportional to the shape's min dimensions (default: size 220px gets fontSize 24px)
    const size = Math.min(w, h);
    const baseFontSize = 24;
    const computedFontSize = Math.round(baseFontSize * (size / 220));
    const fontSize = Math.max(computedFontSize, 12); // min font size 12px

    const sticky = new StickyNoteClass('', {
      left: x + 12, // adjust position by padding to align selection box to card edge
      top: y + 12,
      width: w - 24,
      height: h - 24,
      padding: 12, // native Fabric padding pushes selection handles/border to card edge
      backgroundColor: color,
      fill: '#1a1500',   // dark text for readability on yellow/coloured backgrounds
      fontSize: fontSize,
      fontFamily: 'Geist, Inter, sans-serif',
      editable: true,
      textAlign: 'left',
      breakWords: true,
      splitByGrapheme: true,
      cursorColor: '#333',
      cursorWidth: 2,
      // Use 'move' cursor so users know they can drag; text cursor only shows during editing
      hoverCursor: 'move',
      selectionColor: 'rgba(0, 0, 0, 0.15)',
      id: uid(),
      shadow: new fabric.Shadow({
        color:   'rgba(0,0,0,0.22)',
        blur:    14,
        offsetX: 0,
        offsetY: 6,
      }),
    });

    applyObjectDefaults(sticky);

    // Enable middle top (mt) and middle bottom (mb) resize handles for height
    sticky.setControlsVisibility({
      mt: true,
      mb: true,
    });

    canvas.add(sticky);
    canvas.setActiveObject(sticky);
    canvas.renderAll();
    updateCount(canvas);
    saveHistory();
    revertToSelect();

    // Do NOT auto-enter editing — user should be able to reposition first.
    // They can double-click to edit, or press Enter while selected.
  }, [applyObjectDefaults, updateCount, saveHistory, revertToSelect]);

  const finalizeRectangle = useCallback((x: number, y: number, w: number, h: number) => {
    const canvas = fabricRef.current;
    if (!canvas || !fabricModule) return;
    const fabric = fabricModule;
    const color = stickyColorRef.current;
    const rect = new fabric.Rect({
      left: x, top: y, width: w, height: h,
      fill:        hexToRgba(color, 0.06), // Faint transparent overlay fill
      stroke:      color,                  // Stroke matching active color
      strokeWidth: fabricDefaults.strokeWidth,
      rx: 4, ry: 4,
      strokeUniform: true,
      id: uid(),
    } as any);

    applyObjectDefaults(rect);
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
    updateCount(canvas);
    saveHistory();
    revertToSelect();
  }, [applyObjectDefaults, updateCount, saveHistory, revertToSelect]);

  const finalizeCircle = useCallback((x: number, y: number, w: number, h: number) => {
    const canvas = fabricRef.current;
    if (!canvas || !fabricModule) return;
    const fabric = fabricModule;
    const radius = Math.min(w, h) / 2;
    const color = stickyColorRef.current;
    const circle = new fabric.Circle({
      left:        x + (w - radius * 2) / 2,
      top:         y + (h - radius * 2) / 2,
      radius,
      fill:        hexToRgba(color, 0.06), // Faint transparent overlay fill
      stroke:      color,                  // Stroke matching active color
      strokeWidth: fabricDefaults.strokeWidth,
      strokeUniform: true,
      id:          uid(),
    } as any);

    applyObjectDefaults(circle);
    canvas.add(circle);
    canvas.setActiveObject(circle);
    canvas.renderAll();
    updateCount(canvas);
    saveHistory();
    revertToSelect();
  }, [applyObjectDefaults, updateCount, saveHistory, revertToSelect]);

  const finalizeArrow = useCallback((
    start: { x: number; y: number },
    end:   { x: number; y: number }
  ) => {
    const canvas = fabricRef.current;
    if (!canvas || !fabricModule) return;
    const fabric = fabricModule;
    const dx = end.x - start.x, dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < MIN_DRAG) return;
    const angle     = Math.atan2(dy, dx);
    const headLen   = Math.min(18, len * 0.28);
    const headAngle = Math.PI / 7;
    const lx1 = end.x - headLen * Math.cos(angle - headAngle);
    const ly1 = end.y - headLen * Math.sin(angle - headAngle);
    const lx2 = end.x - headLen * Math.cos(angle + headAngle);
    const ly2 = end.y - headLen * Math.sin(angle + headAngle);
    const color = stickyColorRef.current;
    const arrow = new fabric.Polyline(
      [{ x: start.x, y: start.y }, { x: end.x, y: end.y },
       { x: lx1, y: ly1 }, { x: end.x, y: end.y }, { x: lx2, y: ly2 }],
      {
        fill: colors.transparent, stroke: color, // Stroke matching active color
        strokeWidth: 2, strokeLineCap: 'round', strokeLineJoin: 'round',
        objectCaching: false, id: uid(), subtype: 'arrow',
        perPixelTargetFind: true,
      } as any
    );
    applyObjectDefaults(arrow);
    canvas.add(arrow);
    canvas.setActiveObject(arrow);
    canvas.renderAll();
    updateCount(canvas);
    saveHistory();
    revertToSelect();
  }, [applyObjectDefaults, updateCount, saveHistory, revertToSelect]);

  const finalizeText = useCallback((x: number, y: number, w: number) => {
    const canvas = fabricRef.current;
    if (!canvas || !fabricModule) return;
    const fabric = fabricModule;
    const color = textColorRef.current || stickyColorRef.current;
    const FONT_SIZES = {
      small: 16,
      medium: 24,
      large: 36,
    } as const;
    const sizeVal = FONT_SIZES[textSizeRef.current] || 16;
    const tb = new fabric.Textbox('Text', {
      left: x, top: y,
      width:      Math.max(w, 80),
      fontSize:   sizeVal,
      fontFamily: 'Geist, Inter, sans-serif',
      fill:       color, // Text color matching active color
      editable:   false,
      splitByGrapheme: true,
      hoverCursor: 'move',
      cursorColor: '#E8C547',
      selectionColor: 'rgba(232, 197, 71, 0.3)',
      id:         uid(),
    } as any);

    applyObjectDefaults(tb);
    canvas.add(tb);
    canvas.setActiveObject(tb);
    revertToSelect();
    
    // Enable editable temporarily to enter editing on creation
    tb.set({ editable: true, hoverCursor: 'text' });
    tb.enterEditing?.();
    tb.selectAll?.();
    
    canvas.renderAll();
    updateCount(canvas);
  }, [applyObjectDefaults, updateCount, revertToSelect]);

  // Stable callback refs to prevent stale closure bugs inside useEffect listeners
  const saveHistoryRef = useRef(saveHistory);
  const revertToSelectRef = useRef(revertToSelect);
  const finalizeStickyNoteRef = useRef(finalizeStickyNote);
  const finalizeRectangleRef = useRef(finalizeRectangle);
  const finalizeCircleRef = useRef(finalizeCircle);
  const finalizeArrowRef = useRef(finalizeArrow);
  const finalizeTextRef = useRef(finalizeText);
  const applyToolModeRef = useRef(applyToolMode);
  const updateCountRef = useRef(updateCount);

  useEffect(() => { saveHistoryRef.current = saveHistory; }, [saveHistory]);
  useEffect(() => { revertToSelectRef.current = revertToSelect; }, [revertToSelect]);
  useEffect(() => { finalizeStickyNoteRef.current = finalizeStickyNote; }, [finalizeStickyNote]);
  useEffect(() => { finalizeRectangleRef.current = finalizeRectangle; }, [finalizeRectangle]);
  useEffect(() => { finalizeCircleRef.current = finalizeCircle; }, [finalizeCircle]);
  useEffect(() => { finalizeArrowRef.current = finalizeArrow; }, [finalizeArrow]);
  useEffect(() => { finalizeTextRef.current = finalizeText; }, [finalizeText]);
  useEffect(() => { applyToolModeRef.current = applyToolMode; }, [applyToolMode]);
  useEffect(() => { updateCountRef.current = updateCount; }, [updateCount]);

  // ----------------------------------------------------------------
  // Ghost (drag preview) helpers
  // ----------------------------------------------------------------
  const removeGhost = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas || !ghostRef.current) return;
    canvas.remove(ghostRef.current);
    ghostRef.current = null;
    canvas.renderAll();
  }, []);

  const updateGhost = useCallback((
    start: { x: number; y: number },
    cur:   { x: number; y: number },
    tool:  Tool
  ) => {
    const canvas = fabricRef.current;
    if (!canvas || !fabricModule) return;
    const fabric = fabricModule;

    const x = Math.min(start.x, cur.x);
    const y = Math.min(start.y, cur.y);
    const w = Math.abs(cur.x - start.x);
    const h = Math.abs(cur.y - start.y);

    const base = { selectable: false, evented: false, opacity: 0.5, objectCaching: false };

    if (ghostRef.current) {
      if (tool === 'arrow') {
        // Line ghost: update endpoint
        ghostRef.current.set({ x2: cur.x, y2: cur.y });
      } else if (tool === 'circle') {
        const r = Math.min(w, h) / 2;
        ghostRef.current.set({ left: x + (w - r * 2) / 2, top: y + (h - r * 2) / 2, radius: r });
      } else {
        ghostRef.current.set({ left: x, top: y, width: Math.max(w, 1), height: Math.max(h, 1) });
      }
      canvas.renderAll();
      return;
    }

    // Build ghost on first move of a drag
    const dash = { strokeDashArray: [6, 3] as number[] };
    let ghost: any;

    if (tool === 'sticky') {
      ghost = new fabric.Rect({ left: x, top: y, width: w, height: h,
        fill: stickyColorRef.current, stroke: colors.accent, strokeWidth: 1.5, rx: 3, ry: 3, ...base, ...dash });
    } else if (tool === 'rectangle') {
      ghost = new fabric.Rect({ left: x, top: y, width: w, height: h,
        fill: colors.surface, stroke: colors.accent, strokeWidth: 1.5, rx: 4, ry: 4, ...base, ...dash });
    } else if (tool === 'circle') {
      const r = Math.min(w, h) / 2;
      ghost = new fabric.Circle({ left: x + (w - r * 2) / 2, top: y + (h - r * 2) / 2, radius: r,
        fill: colors.surface, stroke: colors.accent, strokeWidth: 1.5, ...base, ...dash });
    } else if (tool === 'text') {
      ghost = new fabric.Rect({ left: x, top: y, width: Math.max(w, 40), height: Math.max(h, 24),
        fill: 'transparent', stroke: colors.accent, strokeWidth: 1.5, ...base,
        strokeDashArray: [4, 4] });
    } else if (tool === 'arrow') {
      ghost = new fabric.Line([start.x, start.y, cur.x, cur.y], {
        stroke: colors.accent, strokeWidth: 1.5, ...base, ...dash });
    }

    if (ghost) { ghostRef.current = ghost; canvas.add(ghost); canvas.renderAll(); }
  }, []);

  // ----------------------------------------------------------------
  // Canvas init
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!canvasElRef.current || !containerRef.current) return;
    let mounted = true;

    const init = async () => {
      const fabric = await getFabric();
      if (!mounted || !canvasElRef.current || !containerRef.current) return;
      const container = containerRef.current;

      const canvas = new fabric.Canvas(canvasElRef.current, {
        width:  container.clientWidth,
        height: container.clientHeight - STATUS_BAR_H,
        backgroundColor:      'transparent',
        selection:            true,
        preserveObjectStacking: true,
        renderOnAddRemove:    true,
        selectionColor:       'rgba(232, 197, 71, 0.15)',
        selectionBorderColor: '#E8C547',
        selectionLineWidth:   1,
        selectionDashArray:   [4, 4],
      });

      fabricRef.current = canvas;

      // ---- mouse:down ----
      canvas.on('mouse:down', (opt: any) => {
        const tool = activeToolRef.current;
        const e    = opt.e as MouseEvent;

        // Report cursor click (if not a pan drag interaction)
        const isMiddleClick = e.button === 1;
        const isSpacePan = spaceHeldRef.current;
        const isPanTool = tool === 'pan';
        if (!isMiddleClick && !isSpacePan && !isPanTool) {
          const clickP = canvas.getScenePoint(e);
          onCursorClickRef.current?.(clickP.x, clickP.y);
        }

        // Middle-mouse pan start
        if (e.button === 1) {
          e.preventDefault();
          midMouseRef.current = true;
          isPanningRef.current = true;
          panLastRef.current   = { x: e.clientX, y: e.clientY };
          canvas.defaultCursor = 'grabbing';
          canvas.hoverCursor   = 'grabbing';
          return;
        }

        // Space-held pan start
        if (spaceHeldRef.current) {
          isPanningRef.current = true;
          panLastRef.current   = { x: e.clientX, y: e.clientY };
          canvas.defaultCursor = 'grabbing';
          canvas.hoverCursor   = 'grabbing';
          return;
        }

        // Pan tool
        if (tool === 'pan') {
          isPanningRef.current = true;
          panLastRef.current   = { x: e.clientX, y: e.clientY };
          canvas.defaultCursor = 'grabbing';
          canvas.hoverCursor   = 'grabbing';
          return;
        }

        if (tool === 'select') return;

        // Begin draw drag
        const p = canvas.getScenePoint(e);
        dragStartRef.current  = { x: p.x, y: p.y };
        isDraggingRef.current = false;
      });

      // ---- mouse:move ----
      canvas.on('mouse:move', (opt: any) => {
        const e = opt.e as MouseEvent;
        const p = canvas.getScenePoint(e);

        // Throttle cursor moves to avoid overloading the socket server (~25fps)
        const now = Date.now();
        if (now - lastCursorEmitRef.current > 40) {
          onCursorMoveRef.current?.(p.x, p.y);
          lastCursorEmitRef.current = now;
        }

        // Pan movement
        if (isPanningRef.current && panLastRef.current) {
          const dx = e.clientX - panLastRef.current.x;
          const dy = e.clientY - panLastRef.current.y;
          panLastRef.current = { x: e.clientX, y: e.clientY };
          canvas.relativePan(new fabric.Point(dx, dy));
          return;
        }

        // Draw drag
        const tool  = activeToolRef.current;
        const start = dragStartRef.current;
        if (tool === 'select' || tool === 'pan' || !start) return;

        const dx = p.x - start.x;
        const dy = p.y - start.y;

        if (!isDraggingRef.current) {
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) isDraggingRef.current = true;
          else return;
        }
        updateGhost(start, { x: p.x, y: p.y }, tool);
      });

      // ---- mouse:up ----
      canvas.on('mouse:up', (opt: any) => {
        const e = opt.e as MouseEvent;

        // End middle-mouse pan
        if (midMouseRef.current) {
          midMouseRef.current  = false;
          isPanningRef.current = false;
          panLastRef.current   = null;
          applyToolModeRef.current(canvas, activeToolRef.current);
          return;
        }

        // End space or pan-tool pan
        if (isPanningRef.current) {
          isPanningRef.current = false;
          panLastRef.current   = null;
          applyToolModeRef.current(canvas, activeToolRef.current);
          return;
        }

        const tool  = activeToolRef.current;
        const start = dragStartRef.current;

        // For non-select tools, always kill any lingering rubber-band selection box
        // that Fabric may have started (e.g. from a missed mousedown dispatch).
        if (tool !== 'select' && tool !== 'pan') {
          // Fabric v6 internal: clear _groupSelector and redraw to erase the dashed box
          (canvas as any)._groupSelector = null;
          canvas.renderAll();
        }

        if (tool === 'select' || tool === 'pan' || !start) return;

        const p       = canvas.getScenePoint(e);
        const wasDrag = isDraggingRef.current;

        removeGhost();
        dragStartRef.current  = null;
        isDraggingRef.current = false;

        const rawX = Math.min(start.x, p.x);
        const rawY = Math.min(start.y, p.y);
        const rawW = Math.abs(p.x - start.x);
        const rawH = Math.abs(p.y - start.y);

        if (tool === 'sticky') {
          const useDrag = wasDrag && rawW > MIN_DRAG && rawH > MIN_DRAG;
          finalizeStickyNoteRef.current(
            useDrag ? rawX : start.x - CLICK_DEFAULTS.sticky.w / 2,
            useDrag ? rawY : start.y - CLICK_DEFAULTS.sticky.h / 2,
            useDrag ? rawW : CLICK_DEFAULTS.sticky.w,
            useDrag ? rawH : CLICK_DEFAULTS.sticky.h,
          );
          return;
        }
        if (tool === 'rectangle') {
          const useDrag = wasDrag && rawW > MIN_DRAG && rawH > MIN_DRAG;
          finalizeRectangleRef.current(
            useDrag ? rawX : start.x - CLICK_DEFAULTS.rectangle.w / 2,
            useDrag ? rawY : start.y - CLICK_DEFAULTS.rectangle.h / 2,
            useDrag ? rawW : CLICK_DEFAULTS.rectangle.w,
            useDrag ? rawH : CLICK_DEFAULTS.rectangle.h,
          );
          return;
        }
        if (tool === 'circle') {
          const useDrag = wasDrag && rawW > MIN_DRAG && rawH > MIN_DRAG;
          finalizeCircleRef.current(
            useDrag ? rawX : start.x - CLICK_DEFAULTS.circle.w / 2,
            useDrag ? rawY : start.y - CLICK_DEFAULTS.circle.h / 2,
            useDrag ? rawW : CLICK_DEFAULTS.circle.w,
            useDrag ? rawH : CLICK_DEFAULTS.circle.h,
          );
          return;
        }
        if (tool === 'text') {
          const useDrag = wasDrag && rawW > MIN_DRAG;
          finalizeTextRef.current(
            useDrag ? rawX : start.x - CLICK_DEFAULTS.text.w / 2,
            useDrag ? rawY : start.y - 12,
            useDrag ? rawW : CLICK_DEFAULTS.text.w,
          );
          return;
        }
        if (tool === 'arrow') {
          const dx = p.x - start.x, dy = p.y - start.y;
          if (Math.sqrt(dx * dx + dy * dy) >= MIN_DRAG) {
            finalizeArrowRef.current(start, { x: p.x, y: p.y });
          }
          return;
        }
      });

      // Block browser context menu on middle-click pan
      canvas.on('contextmenu', (opt: any) => {
        if (midMouseRef.current) opt.e.preventDefault();
      });

      canvas.on('selection:created', () => {
        setHasSelection(true);
        onSelectionChangeRef.current?.(true, getActiveMetadata(canvas));
      });
      canvas.on('selection:updated', () => {
        setHasSelection(true);
        onSelectionChangeRef.current?.(true, getActiveMetadata(canvas));
      });
      canvas.on('selection:cleared', () => {
        setHasSelection(false);
        onSelectionChangeRef.current?.(false, null);
      });
      canvas.on('object:removed', (opt: any) => {
        setHasSelection(false);
        updateCountRef.current(canvas);
        const obj = opt.target;
        if (obj?.id) {
          // Clear from broadcast-ID set so a future undo+redo can re-broadcast
          broadcastedIds.delete(obj.id);
          // Broadcast removal to peers (skip restores)
          if (!isRestoringRef.current) {
            onMutationRef.current?.(buildMutation('object:removed', obj, userIdRef.current));
          }
        }
        if (!isRestoringRef.current) {
          updateElevationShadows(canvas);
        }
      });

      // Save history after move / resize (fires on mouse:up)
      canvas.on('object:modified', (opt: any) => {
        const obj = opt.target;
        if (obj && obj.subtype === 'sticky') {
          // Only bake scale if the object was actually resized (scaleX/Y meaningfully != 1).
          // A plain move also fires object:modified with scaleX=1 — we must NOT bake in that case
          // because floating-point drift causes a visible shrink every time the note is selected+moved.
          const SCALE_EPSILON = 0.005; // ignore sub-0.5% deviations caused by FP drift
          const scaleX = obj.scaleX ?? 1;
          const scaleY = obj.scaleY ?? 1;
          if (Math.abs(scaleX - 1) > SCALE_EPSILON || Math.abs(scaleY - 1) > SCALE_EPSILON) {
            const w = obj.getScaledWidth();
            const h = obj.getScaledHeight();
            const newFontSize = Math.round(obj.fontSize * scaleX);
            obj.set({
              // getScaledWidth/Height includes padding * 2, so inner size is w - 24
              width:    Math.max(w - 24, 20),
              height:   Math.max(h - 24, 20),
              fontSize: Math.max(newFontSize, 12),
              scaleX: 1,
              scaleY: 1,
            });
            obj.setCoords();
          }
        }
        if (!isRestoringRef.current) {
          saveHistoryRef.current();
          // Broadcast modification to peers
          if (obj?.id) {
            onMutationRef.current?.(buildMutation('object:modified', obj, userIdRef.current));
          }
        }
      });

      // Track which object IDs we have already broadcast as 'added' so that
      // Fabric's internal remove+re-add (z-order, active-object promotion during drag)
      // doesn't cause peers to receive a second 'object:added' for the same object.
      const broadcastedIds = new Set<string>();

      // Broadcast when a new object is added (only local adds, not restores)
      canvas.on('object:added', (opt: any) => {
        const obj = opt.target;
        // Skip ghost shapes (drag preview) and remote/restore objects
        if (isRestoringRef.current || !obj?.id || obj.selectable === false) return;
        // Skip if we already announced this object -- Fabric can re-add the same
        // object internally (z-ordering, active-selection promotion) during a drag.
        if (broadcastedIds.has(obj.id)) return;
        broadcastedIds.add(obj.id);
        onMutationRef.current?.(buildMutation('object:added', obj, userIdRef.current));
        updateElevationShadows(canvas);
      });



      // Zoom via wheel
      canvas.on('mouse:wheel', (opt: any) => {
        const delta = opt.e.deltaY;
        let z = canvas.getZoom() * (delta > 0 ? 0.95 : 1.05);
        z = Math.min(Math.max(z, 0.1), 8);
        canvas.zoomToPoint(new fabric.Point(opt.e.offsetX, opt.e.offsetY), z);
        setZoom(Math.round(z * 100));
        opt.e.preventDefault();
        opt.e.stopPropagation();
      });

      // Double-click on a sticky note or textbox unlocks editing (Excalidraw pattern)
      // Single click selects/moves; double-click enters text editing.
      canvas.on('mouse:dblclick', (opt: any) => {
        const obj = opt.target;
        if (!obj) return;
        if (obj.subtype === 'sticky' || obj.type === 'textbox') {
          obj.set({ editable: true, hoverCursor: 'text' });
          canvas.setActiveObject(obj);
          obj.enterEditing();
          canvas.renderAll();
        }
      });

      canvas.on('text:changed', (opt: any) => {
        const obj = opt.target;
        if (obj && obj.id && !isRestoringRef.current) {
          if (textDebounceRef.current) clearTimeout(textDebounceRef.current);
          textDebounceRef.current = setTimeout(() => {
            onMutationRef.current?.(buildMutation('object:modified', obj, userIdRef.current));
            // Update the server's snapshot so new joiners get the latest text
            const json = JSON.stringify((canvas as any).toJSON(EXTRA_PROPS));
            onSnapshotRef.current?.(json);
          }, 200);
        }
      });

      canvas.on('text:editing:exited', (opt: any) => {
        const obj = opt.target;
        if (textDebounceRef.current) {
          clearTimeout(textDebounceRef.current);
          textDebounceRef.current = null;
        }
        // Re-lock textbox and sticky notes so next single-click selects rather than edits
        if (obj && (obj.subtype === 'sticky' || obj.type === 'textbox')) {
          obj.set({ editable: false, hoverCursor: 'move' });
        }
        saveHistoryRef.current();
        if (obj && obj.id && !isRestoringRef.current) {
          onMutationRef.current?.(buildMutation('object:modified', obj, userIdRef.current));
        }
        revertToSelectRef.current();
      });

      applyToolModeRef.current(canvas, activeToolRef.current);
      // Live presence events
      canvas.on('mouse:out', () => {
        onCursorLeaveRef.current?.();
      });

      canvas.on('after:render', (opt: any) => {
        const vpt = canvas.viewportTransform;
        if (vpt) {
          onViewportChangeRef.current?.(canvas.getZoom(), vpt[4], vpt[5]);
        }

        // Draw dynamic z-index / layer indicator badge (Option B)
        const ctx = opt.ctx;
        if (ctx) {
          drawLayerBadge(canvas, ctx);
        }
      });

      // Expose to window for testing/debugging
      (window as any).canvas = canvas;
      // Save the empty-canvas initial state as slot 0 in history
      saveHistoryRef.current();
      // Signal to BoardClient that the canvas is ready to receive snapshots.
      // Also marks the canvas as joined so future saveHistory calls broadcast.
      canvasJoinedRef.current = true;
      onReadyRef.current?.();
    };

    init();

    return () => {
      mounted = false;
      if (textDebounceRef.current) {
        clearTimeout(textDebounceRef.current);
      }
      if (fabricRef.current) { fabricRef.current.dispose(); fabricRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync tool mode when prop changes
  useEffect(() => {
    if (fabricRef.current) applyToolMode(fabricRef.current, activeTool);
  }, [activeTool, applyToolMode]);

  // ----------------------------------------------------------------
  // Keyboard handlers
  // ----------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const isEditing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;

      // Space bar -- temp pan (Figma/Excalidraw style)
      if (e.code === 'Space' && !isEditing && !spaceHeldRef.current) {
        e.preventDefault();
        spaceHeldRef.current = true;
        if (fabricRef.current) applyToolMode(fabricRef.current, activeToolRef.current);
        return;
      }

      if (isEditing) return;

      // Enter / F2 -- enter text editing on the selected sticky or textbox (Excalidraw pattern)
      // Enter / F2 -- enter text editing on the selected sticky or textbox (Excalidraw pattern)
      if (e.key === 'Enter' || e.key === 'F2') {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const active = canvas.getActiveObject() as any;
        if (active && (active.subtype === 'sticky' || active.type === 'textbox')) {
          e.preventDefault();
          active.set({ editable: true, hoverCursor: 'text' });
          active.enterEditing?.();
          canvas.renderAll();
        }
        return;
      }

      // Delete / Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const active = canvas.getActiveObjects();
        if (active.length > 0) {
          active.forEach((obj: any) => canvas.remove(obj));
          canvas.discardActiveObject();
          canvas.renderAll();
          updateCount(canvas);
          saveHistory();
        }
        return;
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRef.current?.();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redoRef.current?.();
        return;
      }

      // Layering [ (send backward) and ] (bring forward)
      if (e.key === '[' || e.key === ']') {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const active = canvas.getActiveObject();
        if (active) {
          e.preventDefault();
          let direction: 'back' | 'backward' | 'forward' | 'front';
          if (e.key === '[') {
            direction = e.shiftKey ? 'back' : 'backward';
          } else {
            direction = e.shiftKey ? 'front' : 'forward';
          }

          if (direction === 'back') {
            canvas.sendObjectToBack(active);
          } else if (direction === 'backward') {
            canvas.sendObjectBackward(active);
          } else if (direction === 'forward') {
            canvas.bringObjectForward(active);
          } else if (direction === 'front') {
            canvas.bringObjectToFront(active);
          }

          canvas.renderAll();
          saveHistory();

          // Broadcast layering mutation!
          if (active.id && !isRestoringRef.current) {
            onMutationRef.current?.({
              type: 'object:layer',
              objectId: active.id,
              data: { direction },
              userId: userIdRef.current,
            });
          }
        }
        return;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false;
        isPanningRef.current = false;
        panLastRef.current   = null;
        if (fabricRef.current) applyToolMode(fabricRef.current, activeToolRef.current);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
    };
  }, [applyToolMode, updateCount, saveHistory]);

  // Resize
  useEffect(() => {
    const onResize = () => {
      const canvas = fabricRef.current, container = containerRef.current;
      if (!canvas || !container) return;
      canvas.setWidth(container.clientWidth);
      canvas.setHeight(container.clientHeight - STATUS_BAR_H);
      canvas.renderAll();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------
  return (
    <div
      ref={containerRef}
      className="canvas-wrapper"
      id="canvas-container"
      style={{ cursor: isPanActive ? 'grab' : undefined }}
    >
      <canvas ref={canvasElRef} id="synapse-canvas" />

      <div className="status-bar">
        <span>
          <span className="dot" style={{ backgroundColor: peerCount > 0 ? '#4AE87A' : 'var(--color-accent)' }} />
          {peerCount > 0 ? `${peerCount + 1} online` : 'Solo'}
        </span>
        <span>{objectCount} object{objectCount !== 1 ? 's' : ''}</span>
        <span>{zoom}%</span>
        {hasSelection && (
          <span style={{ color: colors.textMuted }}><kbd>Del</kbd> to delete</span>
        )}
        <span style={{ marginLeft: 'auto', color: colors.textMuted, fontFamily: 'var(--font-geist-mono, monospace)', fontSize: '10px' }}>
          Drag to size&nbsp;&nbsp;|&nbsp;&nbsp;Space+drag to pan&nbsp;&nbsp;|&nbsp;&nbsp;Scroll to zoom&nbsp;&nbsp;|&nbsp;&nbsp;[ / ] to layer
        </span>
      </div>
    </div>
  );
});

export default Canvas;
