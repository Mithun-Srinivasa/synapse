// lib/document.ts -- Synapse document format & serialization utilities
// Phase 4: Persistence optimization

export interface CanvasBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SynapseDocument {
  v: number;               // Schema version for migrations
  boardId: string;
  meta: {
    created: number;
    modified: number;
    objectCount: number;
  };
  bounds: CanvasBounds;    // Content bounding box for viewport auto-centering
  objects: Record<string, unknown>[]; // Compact object array
}

/** Standard Fabric.js object defaults that we can strip to save space */
export const FABRIC_DEFAULTS = {
  originX: 'left',
  originY: 'top',
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  flipX: false,
  flipY: false,
  opacity: 1,
  visible: true,
  shadow: null,
  backgroundColor: '',
  strokeDashArray: null,
  strokeLineCap: 'butt',
  strokeDashOffset: 0,
  strokeLineJoin: 'miter',
  strokeMiterLimit: 4,
  fillRule: 'nonzero',
  paintFirst: 'fill',
  skewX: 0,
  skewY: 0,
  globalCompositeOperation: 'source-over',
} as const;

/**
 * Strips Fabric.js default properties and internal version strings.
 * Helps reduce serialized size by ~4x.
 */
export function stripDefaults(obj: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    if (key === 'version') continue; // Skip Fabric internal version

    const val = obj[key];

    // Skip properties matching default values
    if (key in FABRIC_DEFAULTS) {
      const defVal = (FABRIC_DEFAULTS as any)[key];
      if (val === defVal) continue;
      if (val === null && defVal === null) continue;
    }

    if (val !== undefined) {
      clean[key] = val;
    }
  }
  return clean;
}

/**
 * Computes the total bounding rect that wraps all objects on the canvas.
 * Used to center the viewport when loading the board.
 */
export function getCanvasBounds(canvas: any): CanvasBounds {
  const objects = canvas.getObjects();
  if (objects.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  objects.forEach((obj: any) => {
    // getBoundingRect() calculates coordinates in the canvas space (un-zoomed, un-panned)
    const rect = obj.getBoundingRect();
    if (rect.left < minX) minX = rect.left;
    if (rect.top < minY) minY = rect.top;
    if (rect.left + rect.width > maxX) maxX = rect.left + rect.width;
    if (rect.top + rect.height > maxY) maxY = rect.top + rect.height;
  });

  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Converts a hex color string (#RRGGBB or #RGB) into an rgba string with specified opacity.
 * Used for soft surface overlays of selected shape colors.
 */
export function hexToRgba(hex: string, alpha: number): string {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map((char) => char + char).join('');
  }
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
