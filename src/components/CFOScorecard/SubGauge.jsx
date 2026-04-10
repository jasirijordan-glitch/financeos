/**
 * SubGauge.jsx
 *
 * Individual FP&A dimension gauge component.
 *
 * Renders:
 *  - Animated semi-circular arc gauge showing current score vs target (10.0)
 *  - Dimension label, weight, and description
 *  - Current score with color coding (Red/Amber/Green/Gold)
 *  - Penalty badge if risk flags are reducing this dimension's score
 *  - Raw score vs penalized score breakdown
 *  - MoM and YoY delta labels (for revenue/mrr/grossMargin/burnRate)
 *  - Target checklist (what must be true for 10/10)
 *  - Expand/collapse detail section
 *
 * Props:
 *   dimension   object   — from FPA_DIMENSIONS registry
 *   score       number   — final clamped score [0, 10]
 *   rawScore    number   — score before risk penalties
 *   penalty     number   — total penalty applied (negative number or 0)
 *   deltas      object   — { revenue: { mom, yoy }, mrr: { mom, yoy }, ... }
 *   animate     boolean  — animate arc on mount (default true)
 */

import React, { useEffect, useRef, useState } from 'react';
import { gaugeColor } from './scoringEngine';

// ─── Semi-circle arc gauge ─────────────────────────────────────────────────
// Draws a 180-degree arc (bottom half hidden by card bottom).
// SVG viewport: 120 × 70  (wide, short — fits in card header)

const ARC_W = 120;
const ARC_H = 70;
const ARC_CX = 60;
const ARC_CY = 66; // center Y is near bottom so the arc sits like a speedometer
const ARC_R  = 50;
const ARC_SW = 8;  // stroke width

// Path for a semi-circle arc segment from startAngle → endAngle (in degrees, 0=right)
function describeArc(cx, cy, r, startDeg, endDeg) {
  const toRad = d => (d * Math.PI) / 180;
  const sx = cx + r * Math.cos(toRad(startDeg));
  const sy = cy + r * Math.sin(toRad(startDeg));
  const ex = cx + r * Math.cos(toRad(endDeg));
  const ey = cy + r * Math.sin(toRad(endDeg));
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
}

// Score maps to angle: 0 → -180° (left), 10 → 0° (right), full sweep = 180°
function scoreToAngle(score) {
  return -180 + (score / 10) * 180;
}

function ArcGauge({ score, size = 1, animate = true }) {
  const clamp = Math.max(0, Math.min(10, score));
  const [displayed, setDisplayed] = useState(animate ? 0 : clamp);
  const rafRef = useRef(null);
  const t0Ref  = useRef(null);
  const DURATION = 900;

  useEffect(() => {
    if (!animate) { setDisplayed(clamp); return; }
    t0Ref.current = null;
    const to = clamp;
    const tick = (ts) => {
      if (!t0Ref.current) t0Ref.current = ts;
      const p = Math.min((ts - t0Ref.current) / DURATION, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setDisplayed(to * e);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [clamp, animate]);

  const color     = gaugeColor(displayed);
  const startDeg  = -180;
  const endDeg    = scoreToAngle(displayed);
  const trackPath = describeArc(ARC_CX, ARC_CY, ARC_R, -180, 0);
  const fillPath  = describeArc(ARC_CX, ARC_CY, ARC_R, startDeg, endDeg);

  // Needle tip position
  const needleAngle = endDeg;
  const needleRad   = (needleAngle * Math.PI) / 180;
  const nx = ARC_CX + ARC_R * Math.cos(needleRad);
  const ny = ARC_CY + ARC_R * Math.sin(needleRad);

  const isGold = displayed >= 9;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg
        width={ARC_W * size}
        height={ARC_H * size}
        viewBox={`0 0 ${ARC_W} ${ARC_H}`}
        style={{ overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={`sg-grad-${score.toFixed(0)}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor={color} stopOpacity="0.6" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
          <filter id={`sg-glow-${score.toFixed(0)}`}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Track arc (background) */}
        <path
          d={trackPath}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={ARC_SW}
          strokeLinecap="round"
        />

        {/* Zone color bands (thin, underneath) */}
        {[
          { from: 0,   to: 5,   color: 'rgba(248,113,113,0.15)' },
          { from: 5,   to: 7.5, color: 'rgba(251,191,36,0.15)'  },
          { from: 7.5, to: 9,   color: 'rgba(52,211,153,0.15)'  },
          { from: 9,   to: 10,  color: 'rgba(250,204,21,0.20)'  },
        ].map(({ from, to, color: zc }) => (
          <path
            key={`${from}-${to}`}
            d={describeArc(ARC_CX, ARC_CY, ARC_R, scoreToAngle(from), scoreToAngle(to))}
            fill="none"
            stroke={zc}
            strokeWidth={ARC_SW}
            strokeLinecap="butt"
          />
        ))}

        {/* Glow layer */}
        {displayed > 0.1 && (
          <path
            d={fillPath}
            fill="none"
            stroke={color}
            strokeOpacity={0.3}
            strokeWidth={ARC_SW + 4}
            strokeLinecap="round"
            filter={`url(#sg-glow-${score.toFixed(0)})`}
          />
        )}

        {/* Fill arc */}
        {displayed > 0.1 && (
          <path
            d={fillPath}
            fill="none"
            stroke={`url(#sg-grad-${score.toFixed(0)})`}
            strokeWidth={ARC_SW}
            strokeLinecap="round"
          />
        )}

        {/* Needle tip dot */}
        {displayed > 0.1 && (
          <circle cx={nx} cy={ny} r={3.5} fill={color} />
        )}

        {/* Center score label */}
        <text
          x={ARC_CX}
          y={ARC_CY - 4}
          textAnchor="middle"
          fontSize={18}
          fontWeight={800}
          fontFamily="'Inter', system-ui, sans-serif"
          letterSpacing="-0.5"
          fill={color}
        >
          {displayed.toFixed(1)}
        </text>
        <text
          x={ARC_CX}
          y={ARC_CY + 10}
          textAnchor="middle"
          fontSize={8}
          fontWeight={500}
          fontFamily="'Inter', system-ui, sans-serif"
          fill="rgba(255,255,255,0.30)"
        >
          / 10
        </text>

        {/* Zone labels */}
        <text x={8}       y={ARC_CY + 14} fontSize={7} fill="rgba(248,113,113,0.50)" textAnchor="middle">0</text>
        <text x={ARC_CX}  y={16}          fontSize={7} fill="rgba(255,255,255,0.20)" textAnchor="middle">5</text>
        <text x={ARC_W-8} y={ARC_CY + 14} fontSize={7} fill="rgba(250,204,21,0.50)"  textAnchor="middle">10</text>
      </svg>
    </div>
  );
}

// ─── Delta badge ───────────────────────────────────────────────────────────

function DeltaBadge({ value, label, tiny = false }) {
  if (value == null) return null;
  const pos = value >= 0;
  return (
    <span
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        fontSize: tiny ? 8.5 : 9.5,
        fontWeight: 700,
        color:      pos ? '#34D399' : '#F87171',
        background: pos ? 'rgba(52,211,153,0.10)' : 'rgba(248,113,113,0.10)',
        border:    `1px solid ${pos ? 'rgba(52,211,153,0.22)' : 'rgba(248,113,113,0.22)'}`,
        borderRadius: 5,
        padding: tiny ? '0 4px' : '1px 5px',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {pos ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

// ─── Animated progress bar ─────────────────────────────────────────────────

function ProgressBar({ score, animate }) {
  const [pct, setPct] = useState(animate ? 0 : score * 10);
  const rafRef  = useRef(null);
  const t0Ref   = useRef(null);
  const DURATION = 800;

  useEffect(() => {
    if (!animate) { setPct(score * 10); return; }
    t0Ref.current = null;
    const target = score * 10;
    const tick = (ts) => {
      if (!t0Ref.current) t0Ref.current = ts;
      const p = Math.min((ts - t0Ref.current) / DURATION, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setPct(e * target);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [score, animate]);

  const color = gaugeColor(score);
  return (
    <div style={{ height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
      <div style={{
        height: '100%', width: `${Math.min(pct, 100)}%`,
        background: color, borderRadius: 2,
        boxShadow: `0 0 6px ${color}50`,
        transition: animate ? 'none' : 'width 0.4s ease',
      }} />
    </div>
  );
}

// ─── Check icon ───────────────────────────────────────────────────────────

function CheckIcon({ checked }) {
  return (
    <div style={{
      width: 14, height: 14, borderRadius: 3, flexShrink: 0, marginTop: 1,
      background: checked ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.06)',
      border: `1px solid ${checked ? 'rgba(52,211,153,0.40)' : 'rgba(255,255,255,0.12)'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#34D399', fontSize: 9, fontWeight: 900,
    }}>
      {checked ? '✓' : null}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

// Map dimension IDs to the delta field they should display
const DIMENSION_DELTA_FIELD = {
  dataCompleteness: 'revenue',
  forecastAccuracy: 'revenue',
  cashVisibility:   'burnRate',
  boardReadiness:   'revenue',
  riskIntelligence: 'grossMargin',
};

export default function SubGauge({
  dimension,
  score    = 0,
  rawScore = 0,
  penalty  = 0,
  deltas   = {},
  animate  = true,
}) {
  const [expanded, setExpanded] = useState(false);

  const color     = gaugeColor(score);
  const hasPenalty = penalty < -0.01;
  const deltaField = DIMENSION_DELTA_FIELD[dimension.id];
  const dimDeltas  = deltaField ? deltas[deltaField] : null;

  // A target is "met" if score >= 8.0 (heuristic for high performance)
  const targetMet = score >= 8.0;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.035)',
      border: `1px solid ${hasPenalty ? 'rgba(248,113,113,0.20)' : 'rgba(255,255,255,0.07)'}`,
      borderRadius: 11,
      padding: '14px 16px',
      transition: 'border-color 0.2s',
    }}>
      {/* ── Header row ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Arc gauge (left) */}
        <div style={{ flexShrink: 0 }}>
          <ArcGauge score={score} animate={animate} />
          {/* Target label under arc */}
          <div style={{ textAlign: 'center', fontSize: 8.5, color: 'rgba(255,255,255,0.22)', marginTop: -6 }}>
            Target: 10.0
          </div>
        </div>

        {/* Right side: labels + deltas + progress */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Top row: dimension name + weight + penalty badge */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'rgba(255,255,255,0.88)', lineHeight: 1.3 }}>
                {dimension.label}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.32)', marginTop: 1 }}>
                Weight: {(dimension.weight * 100).toFixed(0)}%
                &ensp;·&ensp;
                Contributes {(score * dimension.weight).toFixed(2)} pts
              </div>
            </div>
            {hasPenalty && (
              <div style={{
                flexShrink: 0,
                fontSize: 9.5, fontWeight: 700,
                color: '#F87171',
                background: 'rgba(248,113,113,0.12)',
                border: '1px solid rgba(248,113,113,0.25)',
                borderRadius: 5, padding: '2px 7px',
                whiteSpace: 'nowrap',
              }}
                title={`${Math.abs(penalty).toFixed(1)} point penalty from risk flags`}
              >
                −{Math.abs(penalty).toFixed(1)} risk penalty
              </div>
            )}
          </div>

          {/* Description */}
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.38)', lineHeight: 1.45, marginTop: 5, marginBottom: 8 }}>
            {dimension.description}
          </div>

          {/* MoM / YoY delta row */}
          {dimDeltas && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.28)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {deltaField?.replace(/([A-Z])/g, ' $1')}:
              </span>
              {dimDeltas.mom != null && (
                <>
                  <DeltaBadge value={dimDeltas.mom} label="Month-over-Month" />
                  <span style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.22)' }}>MoM</span>
                </>
              )}
              {dimDeltas.yoy != null && (
                <>
                  <DeltaBadge value={dimDeltas.yoy} label="Year-over-Year" />
                  <span style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.22)' }}>YoY</span>
                </>
              )}
              {dimDeltas.yoy == null && (
                <span style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.18)' }}>
                  YoY unavailable (need 13+ months)
                </span>
              )}
            </div>
          )}

          {/* Progress bar */}
          <ProgressBar score={score} animate={animate} />

          {/* Score scale labels */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontSize: 8, color: 'rgba(255,255,255,0.18)' }}>
            <span>0</span>
            <span style={{ color: 'rgba(248,113,113,0.5)' }}>5</span>
            <span style={{ color: 'rgba(251,191,36,0.5)' }}>7.5</span>
            <span style={{ color: 'rgba(52,211,153,0.5)' }}>9</span>
            <span style={{ color: 'rgba(250,204,21,0.6)' }}>10</span>
          </div>
        </div>
      </div>

      {/* ── Expand / collapse toggle ── */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          marginTop: 10, width: '100%',
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          fontSize: 10, color: 'rgba(255,255,255,0.28)', padding: '3px 0',
        }}
      >
        {expanded ? 'Hide detail' : 'Show detail'}
        <span style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
      </button>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
          {/* Score breakdown (only shown when there's a penalty) */}
          {hasPenalty && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 6 }}>
                Score Breakdown
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.50)' }}>
                  <span>Base score (before risk penalties)</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{rawScore.toFixed(1)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#F87171' }}>
                  <span>Risk flag penalties</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{penalty.toFixed(1)}</span>
                </div>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', fontSize: 11.5,
                  color, fontWeight: 700,
                  borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 4, marginTop: 2,
                }}>
                  <span>Final score</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{score.toFixed(1)} / 10</span>
                </div>
              </div>
            </div>
          )}

          {/* Target checklist */}
          {dimension.targets?.length > 0 && (
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>
                Requirements for 10/10
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dimension.targets.map((t, i) => {
                  // Heuristic: first targets are usually the most impactful;
                  // consider "met" based on overall dimension score
                  const met = score >= 8.0 + (i * -0.5); // progressive — lower bar for later targets
                  const reallyMet = score >= 9.0 || (score >= 7.5 && i < 2);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <CheckIcon checked={reallyMet} />
                      <div style={{
                        fontSize: 10.5, lineHeight: 1.4,
                        color: reallyMet ? 'rgba(255,255,255,0.60)' : 'rgba(255,255,255,0.38)',
                        textDecoration: reallyMet ? 'none' : 'none',
                      }}>
                        {t}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
