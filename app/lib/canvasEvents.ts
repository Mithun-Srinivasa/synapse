// canvasEvents.ts -- serialize/deserialize canvas mutations
// Phase 2: used for Socket.io mutation broadcasting between peers.

export type MutationType = 'object:added' | 'object:modified' | 'object:removed' | 'object:layer';

export interface CanvasMutation {
  type: MutationType;
  objectId: string;
  /** Serialized Fabric object (for added/modified). Absent for removed. */
  data: Record<string, unknown>;
  userId: string;
}

// Extra Fabric properties to preserve across serialization
const EXTRA_PROPS = [
  'id', 'subtype', 'interactive', 'subTargetCheck',
  'paddingX', 'paddingY', 'hoverCursor', 'selectionColor', 'cursorColor',
  'perPixelTargetFind',
  'locked', 'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY',
  'lockRotation', 'selectable', 'evented', 'hasControls'
];

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/** Extract a stable ID from a Fabric object. */
export function getObjectId(obj: { id?: string }): string {
  return obj.id ?? '';
}

/**
 * Serialize a Fabric object to a plain JSON-safe payload.
 * Wraps Fabric's own toObject() with our custom fields.
 */
export function serializeObject(
  obj: { toObject: (props: string[]) => Record<string, unknown>; id?: string }
): Record<string, unknown> {
  return obj.toObject(EXTRA_PROPS);
}

/**
 * Build a CanvasMutation payload ready for socket emit.
 */
export function buildMutation(
  type: MutationType,
  obj: { toObject: (props: string[]) => Record<string, unknown>; id?: string },
  userId: string
): CanvasMutation {
  return {
    type,
    objectId: getObjectId(obj),
    data: (type === 'object:removed' || type === 'object:layer') ? {} : serializeObject(obj),
    userId,
  };
}

/**
 * Apply an incoming CanvasMutation from a remote peer to the local canvas.
 * Returns true if the canvas needs a re-render.
 */
export async function applyMutation(
  canvas: any,
  mutation: CanvasMutation
): Promise<boolean> {
  const { type, objectId, data } = mutation;

  if (type === 'object:layer') {
    const obj = canvas.getObjects().find((o: any) => o.id === objectId);
    if (obj) {
      const direction = data.direction as string;
      if (direction === 'back') {
        canvas.sendObjectToBack(obj);
      } else if (direction === 'backward') {
        canvas.sendObjectBackwards(obj);
      } else if (direction === 'forward') {
        canvas.bringObjectForward(obj);
      } else if (direction === 'front') {
        canvas.bringObjectToFront(obj);
      }
      canvas.renderAll();
      return true;
    }
    return false;
  }

  if (type === 'object:removed') {
    const obj = canvas.getObjects().find((o: any) => o.id === objectId);
    if (obj) {
      canvas.remove(obj);
      return true;
    }
    return false;
  }

  if (type === 'object:modified') {
    const obj = canvas.getObjects().find((o: any) => o.id === objectId);
    if (obj) {
      const cleanData = { ...data };
      delete (cleanData as any).type;
      obj.set(cleanData as any);
      obj.setCoords();
      canvas.renderAll();
      return true;
    }
    // Object not found locally on a modified event -- this can happen due to a
    // race condition (modified arrives before added). We fall through to add it
    // ONLY if the object truly doesn't exist. If it does exist under a different
    // reference, we skip to avoid creating duplicates.
    const alreadyExists = canvas.getObjects().some((o: any) => o.id === objectId);
    if (alreadyExists) return false; // avoid duplicate
  }

  // object:added (or modified when not found locally -- treat as add)
  try {
    const enlivedObjects: any[] = await new Promise((resolve, reject) => {
      (canvas.constructor as any).enlivenObjects(
        [data],
        (objs: any[]) => resolve(objs),
        undefined,
        (err: any) => reject(err)
      );
    });
    if (enlivedObjects.length > 0) {
      canvas.add(enlivedObjects[0]);
      canvas.renderAll();
      return true;
    }
  } catch {
    // enlivenObjects API differs across Fabric versions -- try util path
    try {
      const fabric = await import('fabric');
      const enlivedObjects = await (fabric as any).util.enlivenObjects([data]);
      if (enlivedObjects.length > 0) {
        canvas.add(enlivedObjects[0]);
        canvas.renderAll();
        return true;
      }
    } catch {
      console.warn('[canvasEvents] Failed to enliven object', data);
    }
  }

  return false;
}
