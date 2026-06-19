// design-tokens.ts -- source of truth for all visual values
// No hex values should appear anywhere else in the project

export const colors = {
  bg:            'var(--color-bg)',
  surface:       'var(--color-surface)',
  surfaceRaised: 'var(--color-surface-raised)',
  surfaceHover:  'var(--color-surface-hover)',
  border:        'var(--color-border)',
  borderFocus:   'var(--color-border-focus)',
  textPrimary:   'var(--color-text-primary)',
  textMuted:     'var(--color-text-muted)',
  textDisabled:  'var(--color-text-disabled)',
  accent:        'var(--color-accent)',
  accentDim:     'var(--color-accent-dim)',
  accentFaint:   'var(--color-accent-faint)',
  cursor:        'var(--color-cursor)',
  white:         'var(--color-white, #ffffff)',
  transparent:   'transparent',
} as const;

export const stickyColors = {
  yellow:  '#E8C547',
  blue:    '#4A9EE8',
  green:   '#4AE87A',
  pink:    '#E84A9E',
  purple:  '#9E4AE8',
} as const;

export const drawingColors = {
  charcoal: '#1e1e1e',
  red:      '#ff4757',
  orange:   '#ffa502',
  yellow:   '#e8c547',
  green:    '#2ed573',
  blue:     '#1e90ff',
  purple:   '#9e4ae8',
  pink:     '#e84a9e',
} as const;

export const typography = {
  display: 'var(--font-display)',   // product name only (Bebas Neue)
  ui:      'var(--font-inter)',     // all UI chrome (Inter)
  mono:    'var(--font-geist-mono)',// code, IDs, room keys
} as const;

export const fontSizes = {
  xs:      '11px',
  sm:      '12px',
  md:      '14px',
  lg:      '16px',
  xl:      '20px',
  xxl:     '24px',
  display: '48px',
} as const;

export const fontWeights = {
  normal:   '400',
  medium:   '500',
  semibold: '600',
  bold:     '700',
} as const;

export const radius = {
  none: '0px',
  xs:   '4px',
  sm:   '6px',
  md:   '10px',
  lg:   '16px',
  xl:   '24px',
  pill: '999px',
} as const;

export const spacing = {
  0:  '0px',
  1:  '4px',
  2:  '8px',
  3:  '12px',
  4:  '16px',
  5:  '20px',
  6:  '24px',
  8:  '32px',
  10: '40px',
  12: '48px',
  16: '64px',
} as const;

export const shadows = {
  sm:    '0 1px 3px rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.1)',
  md:    '0 4px 16px rgba(0,0,0,0.3)',
  lg:    '0 8px 32px rgba(0,0,0,0.4)',
  glass: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)',
  glow:  '0 0 20px rgba(232,197,71,0.3)',
  glow2: '0 0 40px rgba(232,197,71,0.15)',
} as const;

export const motion = {
  fast:   { duration: 0.12, ease: 'easeOut' as const },
  normal: { duration: 0.2,  ease: 'easeOut' as const },
  slow:   { duration: 0.35, ease: 'easeOut' as const },
  snap:   { type: 'spring' as const, stiffness: 400, damping: 30 },
  appear: {
    initial:    { opacity: 0, y: 4 },
    animate:    { opacity: 1, y: 0 },
    transition: { duration: 0.15, ease: 'easeOut' as const },
  },
} as const;

// Toolbar dimensions
export const toolbar = {
  width:       '56px',
  iconSize:    '20px',
  itemPadding: '14px 0',
} as const;

// Canvas fabric object defaults -- used in Canvas.tsx and tools
export const fabricDefaults = {
  strokeWidth:       2,
  stroke:            '#2a2a2a',
  fill:              '#161616',
  stickyFill:        '#E8C547',
  stickyTextColor:   '#0d0d0d',
  fontSize:          16,
  fontFamily:        'Inter, system-ui, sans-serif',
  cornerSize:        8,
  cornerColor:       '#E8C547',
  borderColor:       '#E8C547',
  transparentCorners: false,
} as const;
