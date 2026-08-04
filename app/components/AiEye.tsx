'use client';

import { useRef, useEffect } from 'react';
import { motion, useSpring } from 'framer-motion';

interface AiEyeProps {
  mouseX: number;
  mouseY: number;
  /** Override target for saccade — when set, eye looks at this point instead of mouse */
  saccadeTarget: { x: number; y: number } | null;
  /** Whether the AI is currently processing */
  isThinking: boolean;
}

const SPRING_CONFIG = { stiffness: 400, damping: 30 };
const EYE_CX = 16;
const EYE_CY = 16;
const MAX_OFFSET = 6;

export default function AiEye({ mouseX, mouseY, saccadeTarget, isThinking }: AiEyeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Spring-animated pupil position
  const pupilSpringX = useSpring(EYE_CX, SPRING_CONFIG);
  const pupilSpringY = useSpring(EYE_CY, SPRING_CONFIG);

  useEffect(() => {
    // Determine tracking target
    const targetX = saccadeTarget ? saccadeTarget.x : mouseX;
    const targetY = saccadeTarget ? saccadeTarget.y : mouseY;

    // Get the eye's screen position to compute direction
    const el = containerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const eyeScreenX = rect.left + rect.width / 2;
      const eyeScreenY = rect.top + rect.height / 2;

      const dx = targetX - eyeScreenX;
      const dy = targetY - eyeScreenY;
      const angle = Math.atan2(dy, dx);

      pupilSpringX.set(EYE_CX + Math.cos(angle) * MAX_OFFSET);
      pupilSpringY.set(EYE_CY + Math.sin(angle) * MAX_OFFSET);
    }
  }, [mouseX, mouseY, saccadeTarget, pupilSpringX, pupilSpringY]);

  return (
    <div ref={containerRef} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        {/* Outer glow */}
        <defs>
          <radialGradient id="eyeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(232,197,71,0.15)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
        <ellipse cx={EYE_CX} cy={EYE_CY} rx={14} ry={14} fill="url(#eyeGlow)" />

        {/* Eye socket (outer ellipse) */}
        <ellipse
          cx={EYE_CX}
          cy={EYE_CY}
          rx={10}
          ry={7}
          fill="var(--color-surface)"
          stroke="var(--color-accent-dim)"
          strokeWidth={1.2}
        />

        {/* Pupil (animated) */}
        <motion.circle
          cx={pupilSpringX}
          cy={pupilSpringY}
          r={3.5}
          fill="var(--color-accent)"
          style={isThinking ? {
            animation: 'ai-eye-think 1s ease-in-out infinite',
          } : undefined}
        />

        {/* Highlight/reflection dot */}
        <circle
          cx={EYE_CX + 2.5}
          cy={EYE_CY - 2}
          r={1.2}
          fill="rgba(255,255,255,0.6)"
        />
      </svg>
    </div>
  );
}
