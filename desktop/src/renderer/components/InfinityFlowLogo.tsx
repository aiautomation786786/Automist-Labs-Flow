/**
 * InfinityFlowLogo.tsx
 *
 * Official Vector Component Suite for Infinity Flow:
 *  - InfinityFlowMark: Dual-ribbon continuous infinity loop with negative-space crossing.
 *  - InfinityFlowLogo: Full brand horizontal lockup with geometric typography & descriptor.
 */

import React from 'react';

export interface InfinityFlowMarkProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  variant?: 'color' | 'white' | 'light';
}

export const InfinityFlowMark: React.FC<InfinityFlowMarkProps> = ({
  size = 28,
  className,
  style,
  variant = 'color',
}) => {
  if (variant === 'white') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      >
        <g stroke="#ffffff" strokeWidth="10" strokeLinecap="round">
          <path d="M 26 31 C 36 31 43 40 45 44" opacity="0.85" />
          <path d="M 55 56 C 57 60 64 69 74 69 C 85 69 92 61 92 50 C 92 39 85 31 74 31" opacity="0.85" />
          <path d="M 26 31 C 15 31 8 39 8 50 C 8 61 15 69 26 69" opacity="0.85" />
          <path d="M 26 69 C 37 69 44 59 50 50 C 56 41 63 31 74 31" opacity="1.0" />
        </g>
        <circle cx="50" cy="50" r="2.2" fill="#ffffff" />
      </svg>
    );
  }

  if (variant === 'light') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      >
        <defs>
          <linearGradient id="if-mark-light-fore" x1="20%" y1="80%" x2="80%" y2="20%">
            <stop offset="0%" stopColor="#0891b2" />
            <stop offset="50%" stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          <linearGradient id="if-mark-light-back" x1="20%" y1="20%" x2="80%" y2="80%">
            <stop offset="0%" stopColor="#0284c7" />
            <stop offset="50%" stopColor="#4338ca" />
            <stop offset="100%" stopColor="#6d28d9" />
          </linearGradient>
        </defs>
        <g strokeWidth="10" strokeLinecap="round">
          <path d="M 26 31 C 36 31 43 40 45 44" stroke="url(#if-mark-light-back)" opacity="0.9" />
          <path d="M 55 56 C 57 60 64 69 74 69 C 85 69 92 61 92 50 C 92 39 85 31 74 31" stroke="url(#if-mark-light-back)" opacity="0.9" />
          <path d="M 26 31 C 15 31 8 39 8 50 C 8 61 15 69 26 69" stroke="url(#if-mark-light-back)" opacity="0.9" />
          <path d="M 26 69 C 37 69 44 59 50 50 C 56 41 63 31 74 31" stroke="url(#if-mark-light-fore)" />
        </g>
      </svg>
    );
  }

  // Standard full-color vibrant variant
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
    >
      <defs>
        <linearGradient id="if-mark-left" x1="0%" y1="50%" x2="50%" y2="50%">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>

        <linearGradient id="if-mark-right" x1="50%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>

        <linearGradient id="if-mark-fore" x1="20%" y1="80%" x2="80%" y2="20%">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="35%" stopColor="#3b82f6" />
          <stop offset="65%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>

        <linearGradient id="if-mark-back" x1="20%" y1="20%" x2="80%" y2="80%">
          <stop offset="0%" stopColor="#0284c7" />
          <stop offset="35%" stopColor="#4f46e5" />
          <stop offset="70%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#9333ea" />
        </linearGradient>

        <filter id="if-mark-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <g filter="url(#if-mark-glow)">
        <path
          d="M 26 31 C 36 31 43 40 45 44"
          stroke="url(#if-mark-back)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M 55 56 C 57 60 64 69 74 69 C 85 69 92 61 92 50 C 92 39 85 31 74 31"
          stroke="url(#if-mark-back)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M 26 31 C 15 31 8 39 8 50 C 8 61 15 69 26 69"
          stroke="url(#if-mark-left)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M 26 69 C 37 69 44 59 50 50 C 56 41 63 31 74 31"
          stroke="url(#if-mark-fore)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <circle cx="50" cy="50" r="2.2" fill="#ffffff" opacity="0.95" />
      </g>
    </svg>
  );
};

export interface InfinityFlowLogoProps {
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  variant?: 'dark' | 'light';
  showSubtitle?: boolean;
}

export const InfinityFlowLogo: React.FC<InfinityFlowLogoProps> = ({
  height = 36,
  className,
  style,
  variant = 'dark',
  showSubtitle = true,
}) => {
  const isDark = variant === 'dark';
  const markSize = Math.round(height * 0.9);

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: String(Math.round(height * 0.28)) + 'px',
        userSelect: 'none',
        ...style,
      }}
    >
      <InfinityFlowMark size={markSize} variant={isDark ? 'color' : 'light'} />
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div
          style={{
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontWeight: 800,
            fontSize: String(Math.round(height * 0.44)) + 'px',
            lineHeight: 1.15,
            letterSpacing: '0.04em',
            color: isDark ? '#ffffff' : '#0f172a',
          }}
        >
          INFINITY{' '}
          <span
            style={{
              background: 'var(--infinity-gradient, linear-gradient(135deg, #06b6d4 0%, #6366f1 50%, #8b5cf6 100%))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            FLOW
          </span>
        </div>
        {showSubtitle && (
          <div
            style={{
              fontSize: String(Math.max(9, Math.round(height * 0.23))) + 'px',
              fontWeight: 600,
              letterSpacing: '0.18em',
              color: isDark ? 'var(--text-muted, #94a3b8)' : '#64748b',
              marginTop: '2px',
              textTransform: 'uppercase',
            }}
          >
            AI Video Automation
          </div>
        )}
      </div>
    </div>
  );
};

export default InfinityFlowLogo;
