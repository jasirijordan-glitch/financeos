/**
 * RiskFlags.jsx
 *
 * Renders all active risk flags produced by the scoring engine.
 *
 * Features:
 *  - Summary bar: total flags, total score impact, critical count
 *  - Flags grouped by severity: Critical / High / Medium / Low
 *  - Each flag shows: pulsing severity dot, label, detail, dimension,
 *    score impact chip, and recommended action
 *  - Groups are individually collapsible
 *  - Empty state when no flags are active
 *  - Penalty feedback: total score impact per dimension summarized at bottom
 *
 * Props:
 *   riskFlags   RiskFlag[]   — output of detectRiskFlags() / computeFPAScore()
 *   overall     number       — current overall score (for contextual coloring)
 */

import React, { useState } from 'react';
import { FPA_DIMENSIONS } from './scoringEngine';

// ─── Severity config ───────────────────────────────────────────────────────

const SEV = {
  critical: {
    label: 'Critical',
    order: 0,
    textColor:   '#F87171',
    bg:          'rgba(248,113,113,0.09)',
    border:      'rgba(248,113,113,0.22)',
    dotColor:    '#EF4444',
    badgeBg:     'rgba(248,113,113,0.18)',
    headerColor: '#F87171',
  },
  high: {
    label: 'High',
    order: 1,
    textColor:   '#FBBF24',
    bg:          'rgba(251,191,36,0.09)',
    border:      'rgba(251,191,36,0.22)',
    dotColor:    '#F59E0B',
    badgeBg:     'rgba(251,191,36,0.18)',
    headerColor: '#FBBF24',
  },
  medium: {
    label: 'Medium',
    order: 2,
    textColor:   '#FDE68A',
    bg:          'rgba(253,230,138,0.07)',
    border:      'rgba(253,230,138,0.18)',
    dotColor:    '#FCD34D',
    badgeBg:     'rgba(253,230,138,0.14)',
    headerColor: '#FDE68A',
  },
  low: {
    label: 'Low',
    order: 3,
    textColor:   '#93C5FD',
    bg:          'rgba(147,197,253,0.07)',
    border:      'rgba(147,197,253,0.18)',
    dotColor:    '#60A5FA',
    badgeBg:     'rgba(147,197,253,0.14)',
    headerColor: '#93C5FD',
  },
};

// ─── Pulsing dot ───────────────────────────────────────────────────────────

function PulseDot({ color }) {
  return (
    <>
      <div style={{
        position: 'relative', width: 8, height: 8, flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          borderRadius: '50%',
          background: color,
          opacity: 0.35,
          animation: 'rfPulse 1.8s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', inset: 1.5,
          borderRadius: '50%',
          background: color,
        }} />
      </div>
      <style>{`
        @keyframes rfPulse {
          0%, 100% { transform: scale(1); opacity: 0.35; }
          50%       { transform: scale(2.4); opacity: 0; }
        }
      `}</style>
    </>
  );
}

// ─── Single flag row ───────────────────────────────────────────────────────

function FlagRow({ flag }) {
  const [showAction, setShowAction] = useState(false);
  const cfg = SEV[flag.severity] || SEV.low;
  const dimLabel = FPA_DIMENSIONS.find(d => d.id === flag.dimension)?.label ?? flag.dimension;

  return (
    <div style={{
      background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: 9,
      padding: '10px 12px',
      marginBottom: 7,
    }}>
      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {/* Dot */}
        <div style={{ marginTop: 4, flexShrink: 0 }}>
          <PulseDot color={cfg.dotColor} />
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Flag label */}
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,0.82)', lineHeight: 1.4, marginBottom: 3 }}>
            {flag.label}
          </div>

          {/* Detail text */}
          {flag.detail && (
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45, marginBottom: 6 }}>
              {flag.detail}
            </div>
          )}

          {/* Meta row: severity badge + dimension chip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 9.5, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
              color: cfg.textColor, background: cfg.badgeBg,
              border: `1px solid ${cfg.border}`, borderRadius: 5, padding: '1px 7px',
            }}>
              {cfg.label}
            </span>
            <span style={{
              fontSize: 9.5, color: 'rgba(255,255,255,0.38)',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 5, padding: '1px 7px',
            }}>
              {dimLabel}
            </span>

            {/* Action toggle */}
            <button
              onClick={() => setShowAction(a => !a)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                fontSize: 9.5, color: 'rgba(255,255,255,0.28)',
                textDecoration: 'underline', textDecorationStyle: 'dotted',
              }}
            >
              {showAction ? 'Hide action' : 'Recommended action'}
            </button>
          </div>

          {/* Recommended action */}
          {showAction && flag.action && (
            <div style={{
              marginTop: 8, padding: '7px 10px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 7,
              fontSize: 10.5, color: 'rgba(255,255,255,0.60)', lineHeight: 1.5,
              fontStyle: 'italic',
            }}>
              💡 {flag.action}
            </div>
          )}
        </div>

        {/* Impact chip */}
        <div style={{
          flexShrink: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2,
        }}>
          <div style={{
            fontSize: 12, fontWeight: 800, color: cfg.textColor,
            background: cfg.badgeBg, border: `1px solid ${cfg.border}`,
            borderRadius: 6, padding: '2px 8px',
            fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
          }}
            title="Score impact on this dimension"
          >
            {flag.impact.toFixed(1)} pts
          </div>
          <div style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.22)', textAlign: 'right' }}>
            impact
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Severity group ────────────────────────────────────────────────────────

function SeverityGroup({ severity, flags }) {
  const [open, setOpen] = useState(true);
  const cfg = SEV[severity] || SEV.low;
  if (!flags || flags.length === 0) return null;

  const totalImpact = flags.reduce((s, f) => s + f.impact, 0);

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Group header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 0 7px',
          borderBottom: `1px solid rgba(255,255,255,0.06)`,
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.dotColor, flexShrink: 0 }} />
          <span style={{
            fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em',
            textTransform: 'uppercase', color: cfg.headerColor,
          }}>
            {cfg.label}
          </span>
          <span style={{
            fontSize: 9.5, fontWeight: 800,
            background: cfg.badgeBg, color: cfg.textColor,
            border: `1px solid ${cfg.border}`,
            borderRadius: 10, padding: '0 6px',
          }}>
            {flags.length}
          </span>
          <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.28)', fontVariantNumeric: 'tabular-nums' }}>
            ({totalImpact.toFixed(1)} pts)
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.22)' }}>
          {open ? '▲' : '▼'}
        </div>
      </button>

      {open && flags.map(flag => <FlagRow key={flag.id} flag={flag} />)}
    </div>
  );
}

// ─── Dimension penalty summary ─────────────────────────────────────────────

function PenaltySummary({ riskFlags }) {
  const byDim = {};
  riskFlags.forEach(f => {
    byDim[f.dimension] = (byDim[f.dimension] || 0) + f.impact;
  });
  const entries = Object.entries(byDim).sort((a, b) => a[1] - b[1]);
  if (entries.length === 0) return null;

  return (
    <div style={{
      marginTop: 12, padding: '10px 12px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 9,
    }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.30)', marginBottom: 8 }}>
        Score Impact by Dimension
      </div>
      {entries.map(([dimId, total]) => {
        const dim = FPA_DIMENSIONS.find(d => d.id === dimId);
        return (
          <div key={dimId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
            <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.50)' }}>
              {dim?.label ?? dimId}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#F87171', fontVariantNumeric: 'tabular-nums' }}>
              {total.toFixed(1)} pts
            </span>
          </div>
        );
      })}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 6, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(255,255,255,0.45)' }}>Total penalty</span>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: '#F87171', fontVariantNumeric: 'tabular-nums' }}>
          {riskFlags.reduce((s, f) => s + f.impact, 0).toFixed(1)} pts
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function RiskFlags({ riskFlags = [], overall = 0 }) {
  // Empty state
  if (riskFlags.length === 0) {
    return (
      <div style={{
        padding: '24px 16px',
        background: 'rgba(52,211,153,0.06)',
        border: '1px solid rgba(52,211,153,0.18)',
        borderRadius: 11,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#34D399', marginBottom: 4 }}>
          No active risk flags
        </div>
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', maxWidth: 260, margin: '0 auto', lineHeight: 1.5 }}>
          All monitored metrics are within acceptable thresholds. Continue maintaining live data connections and regular forecasting.
        </div>
      </div>
    );
  }

  // Group by severity
  const grouped = { critical: [], high: [], medium: [], low: [] };
  riskFlags.forEach(f => {
    const key = f.severity in grouped ? f.severity : 'low';
    grouped[key].push(f);
  });

  const critCount = grouped.critical.length;
  const highCount = grouped.high.length;
  const totalImpact = riskFlags.reduce((s, f) => s + f.impact, 0);
  const critImpact  = grouped.critical.reduce((s, f) => s + f.impact, 0);

  return (
    <div>
      {/* ── Summary bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 14px',
        background: critCount > 0 ? 'rgba(248,113,113,0.08)' : 'rgba(251,191,36,0.08)',
        border: `1px solid ${critCount > 0 ? 'rgba(248,113,113,0.22)' : 'rgba(251,191,36,0.22)'}`,
        borderRadius: 10,
        marginBottom: 16,
      }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: critCount > 0 ? '#F87171' : '#FBBF24', marginBottom: 3 }}>
            {riskFlags.length} Active Risk Flag{riskFlags.length !== 1 ? 's' : ''}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.4 }}>
            {critCount > 0 && `${critCount} critical`}
            {critCount > 0 && highCount > 0 && '  ·  '}
            {highCount > 0 && `${highCount} high`}
            {critCount === 0 && highCount === 0 && `${riskFlags.length} medium/low severity`}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#F87171', fontVariantNumeric: 'tabular-nums' }}>
            {totalImpact.toFixed(1)}
          </div>
          <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.30)' }}>pts total penalty</div>
        </div>
      </div>

      {/* ── Grouped flag lists ── */}
      {['critical', 'high', 'medium', 'low'].map(sev => (
        <SeverityGroup key={sev} severity={sev} flags={grouped[sev]} />
      ))}

      {/* ── Dimension impact summary ── */}
      <PenaltySummary riskFlags={riskFlags} />

      {/* ── Remediation hint ── */}
      {critCount > 0 && (
        <div style={{
          marginTop: 10, padding: '8px 12px',
          background: 'rgba(248,113,113,0.06)',
          border: '1px solid rgba(248,113,113,0.15)',
          borderRadius: 8,
          fontSize: 10.5, color: 'rgba(255,255,255,0.38)', lineHeight: 1.5,
        }}>
          💡 Resolving all <strong style={{ color: '#F87171' }}>critical</strong> flags would recover{' '}
          <strong style={{ color: '#FBBF24', fontVariantNumeric: 'tabular-nums' }}>
            {Math.abs(critImpact).toFixed(1)} pts
          </strong>{' '}
          of overall score impact.
        </div>
      )}
    </div>
  );
}
