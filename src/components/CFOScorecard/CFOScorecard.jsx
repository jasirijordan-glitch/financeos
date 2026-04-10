/**
 * CFOScorecard.jsx
 *
 * Main CFO Readiness Scorecard component.
 *
 * Features:
 *  - Animated SVG ring gauge (Red 0-5 / Amber 5-7.5 / Green 7.5-9 / Gold 9-10)
 *  - Five SubGauge components, one per FP&A dimension
 *  - Board readiness summary auto-generated from live score data
 *  - One-click PDF export via jsPDF + jspdf-autotable
 *  - Risk flag count badge
 *  - MoM / YoY delta headlines
 *  - 13-week cash runway progress bar
 *  - Fully collapsible panel
 *
 * Props (all original props preserved for backward compatibility):
 *   plan          string    — plan identifier (passed through, not gated on)
 *   hasQBO        boolean   — QuickBooks Online connected
 *   hasPlaid      boolean   — Plaid bank feed connected
 *   hasExport     boolean   — Export feature flag
 *   hasCsuite     boolean   — C-Suite report feature flag
 *   metrics       object    — { revenue, netIncome, grossMargin, mrr,
 *                              burnRate, runwayMonths, topCustomerPct,
 *                              nrr, lastUpdatedHours }
 *   budget        object    — { revenue: number | number[] }
 *   actuals       object    — { revenue: number | number[] }
 *   cashFlow      object    — { weekly: number[], balance: number }
 *   scenarios     object[]  — scenario objects
 *   historicalData object[] — [{ month, revenue, netIncome, grossMargin,
 *                               mrr, burnRate }]
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import SubGauge from './SubGauge';
import RiskFlags from './RiskFlags';
import {
  computeFPAScore,
  FPA_DIMENSIONS,
  gaugeColor,
  gradeLabel,
  gradeDescription,
} from './scoringEngine';

// ─── Main Ring Gauge ───────────────────────────────────────────────────────

function MainRingGauge({ score, size = 200, strokeWidth = 16, animate = true }) {
  const clamp = Math.max(0, Math.min(10, score));
  const [displayed, setDisplayed] = useState(animate ? 0 : clamp);
  const rafRef = useRef(null);
  const t0Ref  = useRef(null);
  const DURATION = 1400;

  useEffect(() => {
    if (!animate) { setDisplayed(clamp); return; }
    t0Ref.current = null;
    const from = 0, to = clamp;
    const tick = (ts) => {
      if (!t0Ref.current) t0Ref.current = ts;
      const progress = Math.min((ts - t0Ref.current) / DURATION, 1);
      const eased    = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplayed(from + (to - from) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [clamp, animate]);

  const cx = size / 2;
  const cy = size / 2;
  const r  = (size - strokeWidth * 2) / 2;
  const circ  = 2 * Math.PI * r;
  const frac  = displayed / 10;
  const offset = circ * (1 - frac);
  const color  = gaugeColor(displayed);
  const isGold = displayed >= 9;

  // Glow filter intensity scales with score
  const glowAlpha = Math.min(0.9, 0.3 + displayed * 0.06);

  return (
    <div
      style={{ position: 'relative', width: size, height: size, display: 'inline-block' }}
      role="img"
      aria-label={`CFO Readiness Score ${clamp.toFixed(1)} out of 10`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(-90deg)' }}
        overflow="visible"
      >
        <defs>
          {/* Gold gradient */}
          <linearGradient id="cfo-gold" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#FDE68A" />
            <stop offset="50%"  stopColor="#FACC15" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
          {/* Green gradient */}
          <linearGradient id="cfo-green" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#6EE7B7" />
            <stop offset="100%" stopColor="#10B981" />
          </linearGradient>
          {/* Amber gradient */}
          <linearGradient id="cfo-amber" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#FDE68A" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
          {/* Red gradient */}
          <linearGradient id="cfo-red" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#FCA5A5" />
            <stop offset="100%" stopColor="#EF4444" />
          </linearGradient>
          {/* Glow filter */}
          <filter id="cfo-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Background track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
        />

        {/* Glow layer (slightly wider, blurred) */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={color}
          strokeOpacity={glowAlpha * 0.4}
          strokeWidth={strokeWidth + 6}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          filter="url(#cfo-glow)"
        />

        {/* Main filled arc */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={
            isGold      ? 'url(#cfo-gold)'  :
            displayed >= 7.5 ? 'url(#cfo-green)' :
            displayed >= 5   ? 'url(#cfo-amber)' :
                               'url(#cfo-red)'
          }
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />

        {/* Milestone tick marks at 2.5 / 5.0 / 7.5 / 10.0 */}
        {[0.25, 0.5, 0.75, 1.0].map((frac, i) => {
          const angle = frac * 2 * Math.PI - Math.PI / 2;
          const tx = cx + (r + strokeWidth + 4) * Math.cos(angle);
          const ty = cy + (r + strokeWidth + 4) * Math.sin(angle);
          const reached = frac <= displayed / 10;
          return (
            <circle
              key={i}
              cx={tx} cy={ty} r={2.5}
              fill={reached ? color : 'rgba(255,255,255,0.15)'}
            />
          );
        })}
      </svg>

      {/* Center label — rendered outside the rotated SVG to stay upright */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none', userSelect: 'none',
      }}>
        {/* Score */}
        <div style={{
          fontSize: Math.round(size * 0.23),
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: '-0.03em',
          fontVariantNumeric: 'tabular-nums',
          ...(isGold ? {
            background: 'linear-gradient(135deg, #FDE68A, #FACC15, #F59E0B)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          } : { color }),
        }}>
          {displayed.toFixed(1)}
        </div>

        {/* / 10 */}
        <div style={{
          fontSize: Math.round(size * 0.09),
          color: 'rgba(255,255,255,0.38)',
          fontWeight: 500,
          marginTop: 1,
        }}>
          / 10
        </div>

        {/* Grade */}
        <div style={{
          marginTop: 5,
          fontSize: Math.round(size * 0.10),
          fontWeight: 700,
          letterSpacing: '0.04em',
          color,
        }}>
          {gradeLabel(clamp)}
        </div>
      </div>

      {/* Gold shimmer overlay for perfect/near-perfect scores */}
      {isGold && (
        <>
          <div style={{
            position: 'absolute', inset: 0,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 35%, rgba(250,204,21,0.12), transparent 65%)',
            animation: 'cfo-shimmer 2.8s ease-in-out infinite',
            pointerEvents: 'none',
          }} />
          <style>{`
            @keyframes cfo-shimmer {
              0%, 100% { opacity: 0.4; }
              50%       { opacity: 1.0; }
            }
          `}</style>
        </>
      )}
    </div>
  );
}

// ─── Board Readiness Summary ───────────────────────────────────────────────

function BoardReadinessSummary({ scores, riskFlags, metrics, deltas, overall }) {
  // Auto-generate summary from live data
  const sortedDims = [...FPA_DIMENSIONS].sort(
    (a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0)
  );
  const strengths = sortedDims.slice(0, 2).filter(d => (scores[d.id] ?? 0) >= 6.5);
  const gaps      = sortedDims.slice(-2).filter(d => (scores[d.id] ?? 0) < 7.5);
  const criticals = riskFlags.filter(f => f.severity === 'critical');
  const color     = gaugeColor(overall);

  const fmtNum = (n, prefix = '') =>
    n == null ? '—' :
    n >= 1e6  ? `${prefix}${(n / 1e6).toFixed(1)}M` :
    n >= 1e3  ? `${prefix}${(n / 1e3).toFixed(0)}K` :
    `${prefix}${n.toFixed(0)}`;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12,
      padding: '14px 16px',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)',
        marginBottom: 10,
      }}>
        Board Readiness Summary
      </div>

      {/* Key metrics row */}
      {metrics && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          {[
            { label: 'Revenue',    val: fmtNum(metrics.revenue, '$') },
            { label: 'MRR',        val: fmtNum(metrics.mrr, '$') },
            { label: 'Gross Margin', val: metrics.grossMargin != null ? `${metrics.grossMargin.toFixed(1)}%` : '—' },
            { label: 'Runway',     val: metrics.runwayMonths != null ? `${metrics.runwayMonths.toFixed(1)} mo` : '—' },
          ].map(({ label, val }) => (
            <div key={label} style={{
              flex: '1 1 80px',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 8, padding: '7px 10px',
            }}>
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.35)', fontWeight: 600, marginBottom: 2 }}>
                {label}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)', fontVariantNumeric: 'tabular-nums' }}>
                {val}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Strengths */}
      {strengths.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9.5, color: '#34D399', fontWeight: 700, marginBottom: 4 }}>
            ✓ STRENGTHS
          </div>
          {strengths.map(d => (
            <div key={d.id} style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 2, paddingLeft: 10 }}>
              {d.label} — {(scores[d.id] ?? 0).toFixed(1)}/10
            </div>
          ))}
        </div>
      )}

      {/* Gaps */}
      {gaps.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9.5, color: '#FBBF24', fontWeight: 700, marginBottom: 4 }}>
            ⚠ GAPS TO CLOSE
          </div>
          {gaps.map(d => (
            <div key={d.id} style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 2, paddingLeft: 10 }}>
              {d.label} — {(scores[d.id] ?? 0).toFixed(1)}/10
            </div>
          ))}
        </div>
      )}

      {/* Critical flags headline */}
      {criticals.length > 0 && (
        <div style={{
          marginTop: 6, padding: '6px 10px',
          background: 'rgba(248,113,113,0.10)',
          border: '1px solid rgba(248,113,113,0.22)',
          borderRadius: 7,
          fontSize: 10.5, color: '#F87171', fontWeight: 600,
        }}>
          {criticals.length} critical issue{criticals.length > 1 ? 's' : ''} require immediate attention before board presentation.
        </div>
      )}
    </div>
  );
}

// ─── PDF Export ────────────────────────────────────────────────────────────

async function exportBoardPackPDF({ overall, grade, scores, riskFlags, deltas, metrics, historicalData }) {
  // Dynamic import for SSR safety (Next.js)
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const now   = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // ── Cover / header ──
  doc.setFillColor(15, 17, 25);
  doc.rect(0, 0, pageW, 50, 'F');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.text('CFO Readiness Board Pack', 14, 22);
  doc.setFontSize(10);
  doc.setTextColor(160, 160, 180);
  doc.setFont('helvetica', 'normal');
  doc.text(dateStr, 14, 30);

  // Overall score badge
  const scoreColor =
    overall >= 9   ? [250, 204, 21]  :
    overall >= 7.5 ? [52,  211, 153] :
    overall >= 5   ? [251, 191, 36]  : [248, 113, 113];
  doc.setFillColor(...scoreColor);
  doc.roundedRect(pageW - 60, 10, 46, 28, 4, 4, 'F');
  doc.setFontSize(22);
  doc.setTextColor(15, 17, 25);
  doc.setFont('helvetica', 'bold');
  doc.text(`${overall.toFixed(1)}`, pageW - 42, 26, { align: 'center' });
  doc.setFontSize(9);
  doc.text(`/ 10  Grade: ${grade}`, pageW - 42, 33, { align: 'center' });

  let y = 60;

  // ── Dimension Scores ──
  doc.setFontSize(12);
  doc.setTextColor(40, 40, 60);
  doc.setFont('helvetica', 'bold');
  doc.text('Dimension Scores', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['Dimension', 'Weight', 'Score', 'Contribution', 'Status']],
    body: FPA_DIMENSIONS.map(d => {
      const s = scores[d.id] ?? 0;
      const status = s >= 8.5 ? 'Excellent' : s >= 7.5 ? 'Good' : s >= 6 ? 'Fair' : 'Needs Work';
      return [d.label, `${(d.weight * 100).toFixed(0)}%`, s.toFixed(1), (s * d.weight).toFixed(2), status];
    }),
    headStyles:   { fillColor: [30, 30, 50], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles:   { fontSize: 9 },
    alternateRowStyles: { fillColor: [248, 248, 252] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      2: { halign: 'center' },
      3: { halign: 'center' },
      4: { halign: 'center' },
    },
  });

  y = doc.lastAutoTable.finalY + 10;

  // ── Risk Flags ──
  if (riskFlags.length > 0) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 40, 60);
    doc.text('Active Risk Flags', 14, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [['Severity', 'Dimension', 'Issue', 'Score Impact', 'Recommended Action']],
      body: riskFlags.map(f => [
        f.severity.toUpperCase(),
        FPA_DIMENSIONS.find(d => d.id === f.dimension)?.label ?? f.dimension,
        f.label,
        `${f.impact.toFixed(1)} pts`,
        f.action,
      ]),
      headStyles: { fillColor: [180, 30, 30], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 7.5 },
      columnStyles: { 4: { cellWidth: 60 } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 0) {
          const sev = data.cell.raw;
          if (sev === 'CRITICAL') data.cell.styles.textColor = [220, 30, 30];
          else if (sev === 'HIGH') data.cell.styles.textColor = [200, 100, 0];
        }
      },
    });

    y = doc.lastAutoTable.finalY + 10;
  }

  // ── Key Metrics ──
  if (metrics && Object.keys(metrics).length > 0) {
    if (y > 230) { doc.addPage(); y = 20; }
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 40, 60);
    doc.text('Key Metrics Snapshot', 14, y);
    y += 4;

    const fmtVal = (k, v) => {
      if (k === 'grossMargin') return `${v.toFixed(1)}%`;
      if (k === 'topCustomerPct') return `${v.toFixed(1)}%`;
      if (k === 'nrr') return `${v.toFixed(1)}%`;
      if (k === 'runwayMonths') return `${v.toFixed(1)} months`;
      if (k === 'lastUpdatedHours') return `${v.toFixed(0)} hours ago`;
      if (typeof v === 'number' && v >= 1000) return `$${(v).toLocaleString()}`;
      return String(v);
    };

    autoTable(doc, {
      startY: y,
      head: [['Metric', 'Current Value']],
      body: Object.entries(metrics)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => [
          k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()),
          fmtVal(k, v),
        ]),
      headStyles: { fillColor: [30, 30, 50], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      alternateRowStyles: { fillColor: [248, 248, 252] },
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  // ── Historical Data ──
  if (historicalData && historicalData.length > 0) {
    if (y > 200) { doc.addPage(); y = 20; }
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(40, 40, 60);
    doc.text('Historical Data', 14, y);
    y += 4;

    const cols = Object.keys(historicalData[0]);
    autoTable(doc, {
      startY: y,
      head: [cols.map(c => c.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()))],
      body: historicalData.map(row => cols.map(c => {
        const v = row[c];
        return typeof v === 'number' ? v.toLocaleString() : String(v ?? '');
      })),
      headStyles: { fillColor: [30, 30, 50], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 7.5 },
    });
  }

  // ── Footer on every page ──
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(160, 160, 180);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `CFO Readiness Board Pack  |  Generated ${dateStr}  |  Page ${i} of ${pageCount}`,
      pageW / 2, 290,
      { align: 'center' }
    );
  }

  doc.save(`CFO_Board_Pack_${now.toISOString().slice(0, 10)}.pdf`);
}

// ─── 13-Week Cash Runway Bar ───────────────────────────────────────────────

function RunwayBar({ runwayMonths }) {
  if (runwayMonths == null) return null;
  const MAX   = 24;
  const pct   = Math.min((runwayMonths / MAX) * 100, 100);
  const color =
    runwayMonths < 3  ? '#F87171' :
    runwayMonths < 6  ? '#FBBF24' :
    runwayMonths < 12 ? '#FDE68A' : '#34D399';

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>
          Cash Runway
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
          {runwayMonths.toFixed(1)} mo
          {runwayMonths < 6 && (
            <span style={{ marginLeft: 6, fontSize: 9.5, color: '#F87171' }}>⚠ AT RISK</span>
          )}
        </span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: color, borderRadius: 3,
          boxShadow: `0 0 8px ${color}55`,
          transition: 'width 1s cubic-bezier(0.34,1.56,0.64,1)',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 8.5, color: 'rgba(255,255,255,0.2)' }}>
        {['0', '6 mo', '12 mo', '18 mo', '24 mo+'].map(t => <span key={t}>{t}</span>)}
      </div>
    </div>
  );
}

// ─── Delta Badge ───────────────────────────────────────────────────────────

function DeltaBadge({ value, label }) {
  if (value == null) return null;
  const pos = value >= 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      fontSize: 9.5, fontWeight: 700,
      color:      pos ? '#34D399' : '#F87171',
      background: pos ? 'rgba(52,211,153,0.10)' : 'rgba(248,113,113,0.10)',
      border:    `1px solid ${pos ? 'rgba(52,211,153,0.22)' : 'rgba(248,113,113,0.22)'}`,
      borderRadius: 5, padding: '1px 5px',
      fontVariantNumeric: 'tabular-nums',
    }} title={label}>
      {pos ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function CFOScorecard({
  // Original props
  plan,
  hasQBO    = false,
  hasPlaid  = false,
  // New optional props
  hasExport  = false,
  hasCsuite  = false,
  metrics    = {},
  budget     = {},
  actuals    = {},
  cashFlow   = {},
  scenarios  = [],
  historicalData = [],
}) {
  const [open,      setOpen]      = useState(false);
  const [activeTab, setActiveTab] = useState('dimensions'); // 'dimensions' | 'risks' | 'trends'
  const [exporting, setExporting] = useState(false);

  const result = computeFPAScore({
    hasQBO, hasPlaid, hasExport, hasCsuite,
    metrics, budget, actuals, cashFlow, scenarios, historicalData,
  });

  const { scores, rawScores, penaltiesByDim, overall, grade, riskFlags, deltas } = result;

  const critCount   = riskFlags.filter(f => f.severity === 'critical').length;
  const accentColor = gaugeColor(overall);
  const desc        = gradeDescription(overall);

  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportBoardPackPDF({ overall, grade, scores, riskFlags, deltas, metrics, historicalData });
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('PDF export failed. Please check the console for details.');
    } finally {
      setExporting(false);
    }
  }, [exporting, overall, grade, scores, riskFlags, deltas, metrics, historicalData]);

  const TABS = [
    { id: 'dimensions', label: 'Dimensions' },
    { id: 'risks',      label: 'Risks',  badge: critCount > 0 ? critCount : null },
    { id: 'trends',     label: 'Trends' },
  ];

  return (
    <div style={{
      background: 'rgba(12,14,22,0.90)',
      border: '1px solid rgba(255,255,255,0.09)',
      borderRadius: 14,
      overflow: 'hidden',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      {/* ── Collapsed Header ── */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '14px 18px',
          background: 'none', border: 'none', cursor: 'pointer',
          borderBottom: open ? '1px solid rgba(255,255,255,0.07)' : 'none',
        }}
      >
        {/* Left: mini ring + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <MainRingGauge score={overall} size={56} strokeWidth={5} animate={false} />
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.90)' }}>
              CFO Readiness Score
            </div>
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.38)', marginTop: 2, maxWidth: 280 }}>
              {desc}
            </div>
          </div>
        </div>

        {/* Right: score + critical badge + chevron */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {critCount > 0 && (
            <div style={{
              fontSize: 10, fontWeight: 700, color: '#F87171',
              background: 'rgba(248,113,113,0.12)',
              border: '1px solid rgba(248,113,113,0.25)',
              borderRadius: 6, padding: '2px 8px',
            }}>
              ⚠ {critCount} critical
            </div>
          )}
          <div style={{
            fontSize: 24, fontWeight: 800, color: accentColor,
            fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
          }}>
            {overall.toFixed(1)}
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontWeight: 500, marginLeft: 2 }}>/10</span>
          </div>
          <div style={{
            fontSize: 11, color: 'rgba(255,255,255,0.25)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.25s ease',
          }}>▼</div>
        </div>
      </button>

      {/* ── Expanded Panel ── */}
      {open && (
        <div style={{ padding: '20px 18px 24px' }}>

          {/* Top section: large ring + summary */}
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 20 }}>
            {/* Large ring gauge */}
            <div style={{ flexShrink: 0 }}>
              <MainRingGauge score={overall} size={190} strokeWidth={15} animate />
            </div>

            {/* Right column */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Grade chip */}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: `${accentColor}18`,
                border: `1px solid ${accentColor}35`,
                borderRadius: 8, padding: '4px 10px', marginBottom: 8,
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: accentColor }}>
                  Grade
                </span>
                <span style={{ fontSize: 14, fontWeight: 800, color: accentColor }}>
                  {grade}
                </span>
              </div>

              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.55, marginBottom: 12 }}>
                {desc}
              </div>

              {/* Revenue deltas */}
              {deltas?.revenue && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.28)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>
                    Revenue Trend
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {deltas.revenue.mom != null && (
                      <>
                        <DeltaBadge value={deltas.revenue.mom} label="Month-over-Month" />
                        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.22)' }}>MoM</span>
                      </>
                    )}
                    {deltas.revenue.yoy != null && (
                      <>
                        <DeltaBadge value={deltas.revenue.yoy} label="Year-over-Year" />
                        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.22)' }}>YoY</span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Cash runway bar */}
              <RunwayBar runwayMonths={metrics?.runwayMonths} />

              {/* Export button */}
              <button
                onClick={handleExport}
                disabled={exporting}
                style={{
                  marginTop: 16,
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '8px 16px',
                  background: exporting ? 'rgba(52,211,153,0.06)' : 'rgba(52,211,153,0.12)',
                  border: '1px solid rgba(52,211,153,0.30)',
                  borderRadius: 8, cursor: exporting ? 'default' : 'pointer',
                  fontSize: 11, fontWeight: 600, color: '#34D399',
                  transition: 'all 0.15s',
                  letterSpacing: '0.02em',
                }}
              >
                {exporting ? '⏳ Generating PDF…' : '📊 Export Board Pack PDF'}
              </button>
            </div>
          </div>

          {/* Board Readiness Summary */}
          <div style={{ marginBottom: 18 }}>
            <BoardReadinessSummary
              scores={scores}
              riskFlags={riskFlags}
              metrics={metrics}
              deltas={deltas}
              overall={overall}
            />
          </div>

          {/* Tab bar */}
          <div style={{
            display: 'flex', gap: 2,
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 9, padding: 3,
            marginBottom: 14,
          }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1, padding: '6px 0',
                  background: activeTab === tab.id ? 'rgba(255,255,255,0.09)' : 'transparent',
                  border: 'none', borderRadius: 7, cursor: 'pointer',
                  fontSize: 11, fontWeight: 600,
                  color: activeTab === tab.id ? 'rgba(255,255,255,0.90)' : 'rgba(255,255,255,0.38)',
                  transition: 'all 0.15s',
                  position: 'relative',
                }}
              >
                {tab.label}
                {tab.badge && (
                  <span style={{
                    marginLeft: 5, fontSize: 8.5, fontWeight: 800,
                    background: '#EF4444', color: '#fff',
                    borderRadius: 8, padding: '0 4px',
                  }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Tab: Dimensions ── */}
          {activeTab === 'dimensions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {FPA_DIMENSIONS.map(dim => (
                <SubGauge
                  key={dim.id}
                  dimension={dim}
                  score={scores[dim.id] ?? 0}
                  rawScore={rawScores[dim.id] ?? 0}
                  penalty={penaltiesByDim[dim.id] ?? 0}
                  deltas={deltas}
                  animate
                />
              ))}
              <div style={{
                marginTop: 4, fontSize: 9.5, color: 'rgba(255,255,255,0.20)',
                textAlign: 'right', fontVariantNumeric: 'tabular-nums',
              }}>
                Weighted overall: {FPA_DIMENSIONS.map(d =>
                  `${(scores[d.id] ?? 0).toFixed(1)}×${d.weight}`
                ).join(' + ')} = {overall.toFixed(1)}
              </div>
            </div>
          )}

          {/* ── Tab: Risks ── */}
          {activeTab === 'risks' && (
            <RiskFlags riskFlags={riskFlags} overall={overall} />
          )}

          {/* ── Tab: Trends ── */}
          {activeTab === 'trends' && (
            <div>
              {Object.keys(deltas).length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center' }}>
                  <div style={{ fontSize: 26, marginBottom: 8 }}>📅</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', fontWeight: 600 }}>
                    No trend data available
                  </div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.25)', marginTop: 6, maxWidth: 280, margin: '6px auto 0' }}>
                    Connect live data sources and provide at least 2 months of history to see MoM trends; 13+ months for YoY.
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.entries(deltas).map(([field, d]) => (
                    <div key={field} style={{
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 13px',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      borderRadius: 9,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.65)', textTransform: 'capitalize' }}>
                        {field.replace(/([A-Z])/g, ' $1')}
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        {d.mom != null && (
                          <div style={{ textAlign: 'center' }}>
                            <DeltaBadge value={d.mom} label="Month-over-Month" />
                            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.22)', marginTop: 2 }}>MoM</div>
                          </div>
                        )}
                        {d.yoy != null ? (
                          <div style={{ textAlign: 'center' }}>
                            <DeltaBadge value={d.yoy} label="Year-over-Year" />
                            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.22)', marginTop: 2 }}>YoY</div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.18)' }}>
                            YoY: need 13+ mo
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.22)', textAlign: 'center', marginTop: 4 }}>
                    {historicalData.length} month{historicalData.length !== 1 ? 's' : ''} of history loaded
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
