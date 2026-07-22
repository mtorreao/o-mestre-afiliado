/**
 * Loading — Spinner e skeletons
 */
import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingProps { text?: string; size?: 'sm' | 'md' | 'lg'; }
const iconSizes = { sm: 16, md: 24, lg: 32 };

export function Loading({ text, size = 'md' }: LoadingProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '2.5rem 1rem', color: 'var(--color-text-muted)' }}>
      <Loader2 size={iconSizes[size]} style={{ animation: 'spin 0.8s linear infinite', color: 'var(--color-primary)' }} />
      {text && <span style={{ fontSize: 'var(--text-sm)' }}>{text}</span>}
    </div>
  );
}

const skeletonBorder = '1px solid var(--color-border-light)';
const sBase: React.CSSProperties = { background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', animation: 'pulse 2s ease-in-out infinite' };

export function SkeletonLine({ width = '100%', height = '12px', delay = 0, style }: { width?: string; height?: string; delay?: number; style?: React.CSSProperties }) {
  return <div style={{ ...sBase, width, height, animationDelay: `${delay}s`, ...style }} />;
}

export function LoadingSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem' }}>
      {Array.from({ length: lines }).map((_, i) => <SkeletonLine key={i} width={i === lines - 1 ? '60%' : '100%'} delay={i * 0.15} />)}
    </div>
  );
}

export function CardSkeleton({ header = true, lines = 3, bodyHeight }: { header?: boolean; lines?: number; bodyHeight?: string }) {
  return (
    <div style={{ background: 'var(--color-surface)', border: skeletonBorder, borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
      {header && <div style={{ padding: '1rem 1.25rem', borderBottom: skeletonBorder, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SkeletonLine width="140px" /><SkeletonLine width="60px" height="10px" delay={0.1} />
      </div>}
      <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {Array.from({ length: lines }).map((_, i) => <SkeletonLine key={i} width={i === lines - 1 ? '55%' : '100%'} delay={0.15 + i * 0.1} />)}
        {bodyHeight && <div style={{ ...sBase, width: '100%', height: bodyHeight, animationDelay: `${0.15 + lines * 0.1}s`, marginTop: '0.25rem' }} />}
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '2rem 0' }}>
    <CardSkeleton header lines={2} />
    <CardSkeleton header lines={3} bodyHeight="60px" />
    <CardSkeleton header lines={1} bodyHeight="40px" />
    <CardSkeleton header lines={2} bodyHeight="80px" />
    <CardSkeleton header lines={1} bodyHeight="100px" />
  </div>;
}
