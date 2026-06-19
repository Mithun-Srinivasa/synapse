'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useMemo } from 'react';

interface CursorInfo {
  x: number;
  y: number;
  color: string;
  isPointerDown?: boolean;
}

interface ClickInfo {
  id: string;
  x: number;
  y: number;
  color: string;
}

interface LiveCursorsProps {
  cursors: Record<string, CursorInfo>;
  clicks: ClickInfo[];
  viewport: { zoom: number; panX: number; panY: number };
}

export default function LiveCursors({ cursors, clicks, viewport }: LiveCursorsProps) {
  const { zoom, panX, panY } = viewport;

  // Convert scene coordinates to viewport coordinates
  const convertedCursors = useMemo(() => {
    return Object.entries(cursors).map(([userId, cursor]) => {
      const vx = cursor.x * zoom + panX;
      const vy = cursor.y * zoom + panY;
      return {
        userId,
        vx,
        vy,
        ...cursor,
      };
    });
  }, [cursors, zoom, panX, panY]);

  const convertedClicks = useMemo(() => {
    return clicks.map((click) => {
      const vx = click.x * zoom + panX;
      const vy = click.y * zoom + panY;
      return {
        ...click,
        vx,
        vy,
      };
    });
  }, [clicks, zoom, panX, panY]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      {/* Click Ripples */}
      <AnimatePresence>
        {convertedClicks.map((click) => (
          <motion.div
            key={click.id}
            initial={{ scale: 0.4, opacity: 1 }}
            animate={{ scale: 2.5, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            style={{
              position: 'absolute',
              left: click.vx - 20,
              top: click.vy - 20,
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: `3px solid ${click.color}`,
              pointerEvents: 'none',
            }}
          />
        ))}
      </AnimatePresence>

      {/* Cursors */}
      {convertedCursors.map(({ userId, vx, vy, color, isPointerDown }) => (
        <div
          key={userId}
          style={{
            position: 'absolute',
            left: vx,
            top: vy,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: 'translate(-50%, -50%)',
            // Simple smooth transition for cursor coordinates
            transition: 'left 0.1s ease-out, top 0.1s ease-out',
          }}
        >
          {/* Surround circle (animated on click) */}
          <motion.div
            animate={{
              scale: isPointerDown ? 0.6 : 1.0,
              borderColor: color,
            }}
            transition={{ type: 'spring', stiffness: 450, damping: 15 }}
            style={{
              position: 'absolute',
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: `2px solid ${color}`,
              backgroundColor: 'transparent',
              boxShadow: '0 0 4px rgba(0,0,0,0.15)',
            }}
          />

          {/* Central dot */}
          <div
            style={{
              position: 'absolute',
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: color,
              boxShadow: '0 0 2px rgba(0,0,0,0.3)',
            }}
          />

          {/* Tag for User ID */}
          <div
            style={{
              position: 'absolute',
              top: 18,
              left: 12,
              backgroundColor: color,
              color: '#fff',
              fontSize: '10px',
              fontWeight: 600,
              fontFamily: 'var(--font-geist-sans), sans-serif',
              padding: '2px 6px',
              borderRadius: '4px',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
            }}
          >
            User {userId}
          </div>
        </div>
      ))}
    </div>
  );
}
