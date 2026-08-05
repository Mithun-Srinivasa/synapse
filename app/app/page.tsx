'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

function generateRoomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

const features = [
  { text: 'Sticky notes, shapes & arrows', active: true, icon: '✦' },
  { text: 'Real-time multiplayer cursors',  active: true, icon: '⬡' },
  { text: 'AI-powered diagram generation', active: true, icon: '◈' },
  { text: 'Shared AI chat with Gemini',    active: true, icon: '◉' },
];

const stackItems = ['Next.js 16', 'Fabric.js 6', 'Socket.io 4', 'Gemini 3.5'];

// Floating canvas shapes that drift in the background
const SHAPES = [
  { type: 'sticky', color: '#E8C547', size: 72, x: 8,  y: 15, delay: 0,    dur: 3.5 },
  { type: 'circle', color: '#4A9EE8', size: 56, x: 80, y: 20, delay: 0.5,  dur: 4.5 },
  { type: 'rect',   color: '#4AE87A', size: 64, x: 72, y: 65, delay: 0.8,  dur: 5.5 },
  { type: 'sticky', color: '#9E4AE8', size: 60, x: 15, y: 70, delay: 1.0,  dur: 4.0 },
  { type: 'circle', color: '#E84A9E', size: 44, x: 50, y: 10, delay: 0.2,  dur: 6.0 },
  { type: 'rect',   color: '#E8C547', size: 48, x: 88, y: 42, delay: 0.5,  dur: 5.0 },
  { type: 'sticky', color: '#4A9EE8', size: 52, x: 5,  y: 45, delay: 1.2,  dur: 4.0 },
  { type: 'circle', color: '#4AE87A', size: 36, x: 60, y: 80, delay: 0.4,  dur: 6.5 },
];

function FloatingShape({ shape, theme }: { shape: typeof SHAPES[0]; theme: 'light' | 'dark' }) {
  const isLight = theme === 'light';
  const baseOpacity = isLight ? 0.38 : 0.18; // higher opacity for light mode
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${shape.x}%`,
    top: `${shape.y}%`,
    width: shape.size,
    height: shape.size,
    animationDelay: `${shape.delay}s`,
    animationDuration: `${shape.dur}s`,
    opacity: baseOpacity,
    pointerEvents: 'none',
  };

  if (shape.type === 'circle') {
    return (
      <div
        style={{
          ...style,
          borderRadius: '50%',
          border: `2px solid ${shape.color}`,
          boxShadow: isLight
            ? `0 4px 16px ${shape.color}20`
            : `0 0 20px ${shape.color}40`,
          animation: `shape-float ${shape.dur}s ease-in-out infinite`,
          animationDelay: `${shape.delay}s`,
        }}
      />
    );
  }

  if (shape.type === 'sticky') {
    return (
      <div
        style={{
          ...style,
          borderRadius: 8,
          backgroundColor: isLight ? `${shape.color}35` : `${shape.color}20`,
          border: isLight ? `1.5px solid ${shape.color}70` : `1.5px solid ${shape.color}50`,
          boxShadow: isLight
            ? `0 6px 18px ${shape.color}25`
            : `0 4px 20px ${shape.color}30`,
          animation: `shape-float ${shape.dur}s ease-in-out infinite`,
          animationDelay: `${shape.delay}s`,
        }}
      />
    );
  }

  // rect
  return (
    <div
      style={{
        ...style,
        borderRadius: 6,
        border: isLight ? `1.5px solid ${shape.color}70` : `1.5px solid ${shape.color}50`,
        boxShadow: isLight
          ? `0 6px 18px ${shape.color}20`
          : `0 4px 20px ${shape.color}25`,
        animation: `shape-float ${shape.dur}s ease-in-out infinite`,
        animationDelay: `${shape.delay}s`,
      }}
    />
  );
}

export default function HomePage() {
  const [roomId, setRoomId] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [mounted, setMounted] = useState(false);

  // Load saved theme on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('synapse-theme') as 'light' | 'dark';
    if (savedTheme === 'light' || savedTheme === 'dark') {
      setTheme(savedTheme);
    }
    setMounted(true);
  }, []);

  // Sync theme with DOM and localStorage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('synapse-theme', theme);
  }, [theme]);

  // Generate room ID client-side to avoid hydration mismatch
  useEffect(() => {
    setRoomId(generateRoomId());
  }, []);

  return (
    <main className="landing-root">
      {/* Animated dot grid */}
      <div className="landing-grid" aria-hidden="true" />

      {/* Floating ambient blobs */}
      <div aria-hidden="true" className="blob" style={{
        width: 500, height: 500,
        background: 'radial-gradient(circle, #E8C547, #9E4AE8)',
        top: '-120px', left: '-80px',
        animationDuration: '4.5s',
      }} />
      <div aria-hidden="true" className="blob" style={{
        width: 400, height: 400,
        background: 'radial-gradient(circle, #4A9EE8, #4AE87A)',
        bottom: '-100px', right: '-60px',
        animationDuration: '5.5s',
        animationDelay: '1.5s',
      }} />
      <div aria-hidden="true" className="blob" style={{
        width: 300, height: 300,
        background: 'radial-gradient(circle, #E84A9E, #E8C547)',
        top: '40%', right: '10%',
        animationDuration: '5.0s',
        animationDelay: '0.8s',
      }} />

      {/* Floating canvas shapes */}
      {SHAPES.map((shape, i) => (
        <FloatingShape key={i} shape={shape} theme={theme} />
      ))}

      {/* Theme toggle — top right */}
      <button
        onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
        className="hud-btn"
        style={{ position: 'fixed', top: 16, right: 16 }}
        title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
        aria-label="Toggle theme"
      >
        {theme === 'light' ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
        )}
      </button>

      {/* Hero content */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          textAlign: 'center',
          maxWidth: '520px',
          padding: '0 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
        }}
      >
        {/* Wordmark */}
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(80px, 16vw, 120px)',
            letterSpacing: '0.14em',
            lineHeight: 1,
            marginBottom: 8,
            userSelect: 'none',
            animation: 'wordmark-entrance 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            // Gradient text styling in light mode
            background: theme === 'light'
              ? 'linear-gradient(135deg, #C9A800 0%, #E87A4A 100%)'
              : 'transparent',
            WebkitBackgroundClip: theme === 'light' ? 'text' : 'initial',
            WebkitTextFillColor: theme === 'light' ? 'transparent' : 'initial',
            color: theme === 'light' ? 'transparent' : 'var(--color-accent)',
            textShadow: theme === 'light'
              ? '0 10px 40px rgba(201, 168, 0, 0.15)'
              : '0 0 60px var(--color-accent-glow)',
          }}
        >
          SYNAPSE
        </h1>

        {/* Tagline */}
        <p
          style={{
            fontSize: 15,
            color: 'var(--color-text-muted)',
            marginBottom: 40,
            letterSpacing: '0.04em',
            fontWeight: 500,
          }}
        >
          Real-time collaborative AI whiteboard
        </p>

        {/* CTA */}
        {mounted && roomId ? (
          <Link
            id="create-board-btn"
            href={`/board/${roomId}`}
            className="cta-btn"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="1" y="1" width="14" height="14" rx="2" />
              <line x1="8" y1="4" x2="8" y2="12" />
              <line x1="4" y1="8" x2="12" y2="8" />
            </svg>
            Create Board
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }} aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </Link>
        ) : (
          <div className="cta-btn-loading">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, animation: 'spin 1s linear infinite' }} aria-hidden="true">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            Generating board...
          </div>
        )}

        {/* Feature chips */}
        <div
          style={{
            marginTop: 44,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'center',
          }}
        >
          {features.map((feature, i) => (
            <div key={i} className="feature-chip" style={{ opacity: feature.active ? 1 : 0.5 }}>
              <span
                className={feature.active ? 'dot-active' : 'dot-inactive'}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: feature.active ? 'var(--color-accent)' : 'var(--color-text-disabled)',
                  boxShadow: feature.active ? '0 0 6px var(--color-accent-glow)' : 'none',
                  display: 'inline-block',
                }}
              />
              {feature.text}
              {!feature.active && (
                <span style={{ fontSize: 10, color: 'var(--color-text-disabled)', fontWeight: 600 }}>
                  SOON
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Stack badges */}
        <div className="stack-badges" style={{ marginTop: 32 }}>
          {stackItems.map((item) => (
            <span key={item} className="stack-badge">{item}</span>
          ))}
        </div>
      </div>


    </main>
  );
}
