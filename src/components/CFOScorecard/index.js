/**
 * index.js — Barrel export for CFOScorecard component suite
 *
 * Default import:
 *   import CFOScorecard from '@/components/CFOScorecard';
 *
 * Named imports:
 *   import { SubGauge, RiskFlags, computeFPAScore, FPA_DIMENSIONS } from '@/components/CFOScorecard';
 */

// ── Default export: main component ──────────────────────────────────────────
export { default } from './CFOScorecard';

// ── Sub-components ──────────────────────────────────────────────────────────
export { default as CFOScorecard } from './CFOScorecard';
export { default as SubGauge     } from './SubGauge';
export { default as RiskFlags    } from './RiskFlags';

// ── Scoring engine (useful for server-side pre-computation or testing) ──────
export {
  computeFPAScore,
  detectRiskFlags,
  FPA_DIMENSIONS,
  RISK_RULES,
  gaugeColor,
  gradeLabel,
  gradeDescription,
} from './scoringEngine';
