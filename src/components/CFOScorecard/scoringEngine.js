/**
 * scoringEngine.js
 * CFO Readiness Scoring Engine — v2
 *
 * Five FP&A-native dimensions replace the 15 product-maturity proxies.
 * Every score is driven by real financial data; no hardcoded constants,
 * no plan-gating.  Risk flags detected by the engine are automatically
 * applied as penalties to the relevant dimension score.
 *
 * Public API
 * ──────────
 *   FPA_DIMENSIONS          — dimension registry (id, label, weight, targets)
 *   RISK_RULES              — full rule set (exported for testing)
 *   detectRiskFlags(data)   → RiskFlag[]
 *   computeFPAScore(data)   → ScorecardResult
 *   gaugeColor(score)       → hex string   (Red/Amber/Green/Gold)
 *   gradeLabel(score)       → string       (F / D / C / B / A / A+ / 10/10)
 */

// ─── Dimension Registry ────────────────────────────────────────────────────

export const FPA_DIMENSIONS = [
  {
    id: 'dataCompleteness',
    label: 'Data Completeness',
    weight: 0.25,
    description: 'Quality, coverage, and freshness of financial data inputs',
    targets: [
      'Live accounting feed connected (QBO or equivalent)',
      'Live bank feed connected (Plaid or equivalent)',
      '≥ 24 months of historical data loaded',
      'All 6 core KPIs present: revenue, net income, gross margin, MRR, burn rate, runway',
      'Data freshness ≤ 24 hours',
    ],
  },
  {
    id: 'forecastAccuracy',
    label: 'Forecast Accuracy',
    weight: 0.20,
    description: 'Precision of forward-looking financial models vs actuals',
    targets: [
      'Budget baseline present for current period',
      'Actuals-vs-budget revenue variance < 5%',
      '≥ 3 scenarios modeled (base, bull, bear)',
      'Rolling forecast updated at least monthly',
    ],
  },
  {
    id: 'cashVisibility',
    label: 'Cash Visibility',
    weight: 0.20,
    description: '13-week runway clarity and real-time liquidity monitoring',
    targets: [
      '13-week weekly cash flow forecast populated',
      'Live bank balance via Plaid',
      'Cash runway ≥ 18 months',
      'No critical liquidity flags active',
    ],
  },
  {
    id: 'boardReadiness',
    label: 'Board Readiness',
    weight: 0.20,
    description: 'Depth, quality, and exportability of board-grade reporting',
    targets: [
      'C-Suite report module enabled',
      'One-click board pack export active',
      '≥ 13 months of data (enables YoY comparisons)',
      'All 6 core KPIs visible with MoM and YoY deltas',
    ],
  },
  {
    id: 'riskIntelligence',
    label: 'Risk Intelligence',
    weight: 0.15,
    description: 'Detection, quantification, and mitigation of financial risks',
    targets: [
      '≥ 3 scenario models active',
      'Revenue concentration data present (top-customer %)',
      '≥ 6 months of trend data for margin analysis',
      'No active critical risk flags',
    ],
  },
];

// ─── Risk Rules ───────────────────────────────────────────────────────────
// check(data) → boolean   (true = flag is ACTIVE = penalty applies)
// impact      → number ≤ 0  (added directly to dimension raw score)
// action      → string      (displayed in RiskFlags panel)

export const RISK_RULES = [
  // ── Data Completeness ──────────────────────────────────────────────────
  {
    id: 'no_live_data',
    label: 'No live data connection',
    detail: 'Neither QuickBooks Online nor Plaid is connected. All scores are estimated.',
    severity: 'critical',
    dimension: 'dataCompleteness',
    impact: -2.5,
    action: 'Connect QBO via Settings → Integrations → QuickBooks, then add Plaid bank feed.',
    check: ({ hasQBO, hasPlaid }) => !hasQBO && !hasPlaid,
  },
  {
    id: 'single_source',
    label: 'Only one live data source',
    detail: 'Connecting both QBO and Plaid provides full accounting + banking coverage.',
    severity: 'high',
    dimension: 'dataCompleteness',
    impact: -0.8,
    action: 'Add the missing integration (QBO or Plaid) in Settings → Integrations.',
    check: ({ hasQBO, hasPlaid }) =>
      (hasQBO ? 1 : 0) + (hasPlaid ? 1 : 0) === 1,
  },
  {
    id: 'shallow_history',
    label: 'Less than 12 months of historical data',
    detail: 'YoY analysis and reliable trend detection require ≥ 12 months.',
    severity: 'medium',
    dimension: 'dataCompleteness',
    impact: -0.6,
    action: 'Import historical CSVs in Settings → Data → Historical Import.',
    check: ({ historicalData }) =>
      !historicalData || historicalData.length < 12,
  },
  {
    id: 'missing_kpis',
    label: 'One or more core KPIs missing',
    detail: 'Revenue, net income, gross margin, MRR, burn rate, and runway are all required.',
    severity: 'high',
    dimension: 'dataCompleteness',
    impact: -0.5,
    action: 'Ensure all KPI fields are mapped in Settings → Data → KPI Mapping.',
    check: ({ metrics }) => {
      const req = ['revenue', 'netIncome', 'grossMargin', 'mrr', 'burnRate', 'runwayMonths'];
      return req.some(k => metrics?.[k] == null);
    },
  },
  {
    id: 'stale_data',
    label: 'Data is more than 48 hours old',
    detail: 'Board-grade reporting requires near-real-time data.',
    severity: 'medium',
    dimension: 'dataCompleteness',
    impact: -0.4,
    action: 'Trigger a manual sync in Settings → Integrations → Sync Now.',
    check: ({ metrics }) =>
      metrics?.lastUpdatedHours != null && metrics.lastUpdatedHours > 48,
  },

  // ── Forecast Accuracy ─────────────────────────────────────────────────
  {
    id: 'no_budget',
    label: 'No budget baseline — variance analysis impossible',
    detail: 'Without a budget, forecast accuracy cannot be measured.',
    severity: 'critical',
    dimension: 'forecastAccuracy',
    impact: -2.0,
    action: 'Upload or build a budget in the Budgeting tab.',
    check: ({ budget }) => !budget || Object.keys(budget).length === 0,
  },
  {
    id: 'variance_high',
    label: 'Revenue variance vs budget > 20%',
    detail: 'Actuals are diverging materially from plan.',
    severity: 'high',
    dimension: 'forecastAccuracy',
    impact: -1.2,
    action: 'Review drivers of variance in the Variance Analysis tab and reforecast.',
    check: ({ actuals, budget }) => {
      const v = _budgetVariance(actuals, budget);
      return v !== null && v > 0.20;
    },
  },
  {
    id: 'variance_moderate',
    label: 'Revenue variance vs budget 10–20%',
    detail: 'Forecast is drifting from plan.',
    severity: 'medium',
    dimension: 'forecastAccuracy',
    impact: -0.5,
    action: 'Update your rolling forecast to reflect latest actuals.',
    check: ({ actuals, budget }) => {
      const v = _budgetVariance(actuals, budget);
      return v !== null && v >= 0.10 && v <= 0.20;
    },
  },
  {
    id: 'no_scenarios',
    label: 'No scenario models configured',
    detail: 'Boards expect base, bull, and bear cases.',
    severity: 'high',
    dimension: 'forecastAccuracy',
    impact: -0.8,
    action: 'Create scenarios in the Scenario Planner tab.',
    check: ({ scenarios }) => !scenarios || scenarios.length === 0,
  },
  {
    id: 'single_scenario',
    label: 'Only one scenario — no downside model',
    detail: 'A single scenario does not demonstrate risk awareness.',
    severity: 'medium',
    dimension: 'forecastAccuracy',
    impact: -0.3,
    action: 'Add a bear-case scenario in the Scenario Planner.',
    check: ({ scenarios }) => scenarios?.length === 1,
  },

  // ── Cash Visibility ───────────────────────────────────────────────────
  {
    id: 'no_13w_forecast',
    label: 'No 13-week cash flow forecast',
    detail: 'Weekly cash forecasting is the primary CFO liquidity tool.',
    severity: 'critical',
    dimension: 'cashVisibility',
    impact: -2.5,
    action: 'Build a 13-week forecast in the Cash Flow tab.',
    check: ({ cashFlow }) =>
      !cashFlow?.weekly || cashFlow.weekly.length < 13,
  },
  {
    id: 'runway_critical',
    label: 'Cash runway < 3 months — critical',
    detail: 'Company is at immediate risk of running out of cash.',
    severity: 'critical',
    dimension: 'cashVisibility',
    impact: -3.0,
    action: 'Immediate action required: reduce burn, accelerate collections, or raise capital.',
    check: ({ metrics }) =>
      metrics?.runwayMonths != null && metrics.runwayMonths < 3,
  },
  {
    id: 'runway_low',
    label: 'Cash runway 3–6 months — at risk',
    detail: 'Runway is dangerously short for most fundraising timelines.',
    severity: 'high',
    dimension: 'cashVisibility',
    impact: -1.5,
    action: 'Begin fundraising or cost-reduction plan immediately.',
    check: ({ metrics }) =>
      metrics?.runwayMonths != null &&
      metrics.runwayMonths >= 3 && metrics.runwayMonths < 6,
  },
  {
    id: 'no_plaid',
    label: 'No real-time bank balance (Plaid not connected)',
    detail: 'Cash balances are manually entered or estimated.',
    severity: 'medium',
    dimension: 'cashVisibility',
    impact: -0.8,
    action: 'Connect your bank accounts via Plaid in Settings → Integrations.',
    check: ({ hasPlaid }) => !hasPlaid,
  },

  // ── Board Readiness ───────────────────────────────────────────────────
  {
    id: 'no_export',
    label: 'Board pack export not available on current plan',
    detail: 'One-click export is required for professional board reporting.',
    severity: 'high',
    dimension: 'boardReadiness',
    impact: -1.5,
    action: 'Upgrade to a plan with the Export feature, or use the Print view.',
    check: ({ hasExport }) => !hasExport,
  },
  {
    id: 'no_csuite',
    label: 'C-Suite report module not enabled',
    detail: 'Executive reporting requires the C-Suite module.',
    severity: 'high',
    dimension: 'boardReadiness',
    impact: -1.2,
    action: 'Enable the C-Suite Report module in Settings → Features.',
    check: ({ hasCsuite }) => !hasCsuite,
  },
  {
    id: 'no_yoy',
    label: 'Less than 13 months of data — YoY unavailable',
    detail: 'YoY comparisons are expected in every board package.',
    severity: 'medium',
    dimension: 'boardReadiness',
    impact: -0.5,
    action: 'Import prior-year data via Settings → Data → Historical Import.',
    check: ({ historicalData }) =>
      !historicalData || historicalData.length < 13,
  },

  // ── Risk Intelligence ─────────────────────────────────────────────────
  {
    id: 'revenue_concentration',
    label: 'Revenue concentration: top customer > 40%',
    detail: 'High customer concentration is a material risk factor.',
    severity: 'high',
    dimension: 'riskIntelligence',
    impact: -1.0,
    action: 'Accelerate customer diversification strategy.',
    check: ({ metrics }) =>
      metrics?.topCustomerPct != null && metrics.topCustomerPct > 40,
  },
  {
    id: 'margin_compression',
    label: 'Gross margin declining ≥ 2pp over last 3 months',
    detail: 'Sustained margin compression erodes unit economics.',
    severity: 'high',
    dimension: 'riskIntelligence',
    impact: -0.8,
    action: 'Investigate COGS drivers and ppricing strategy.',
    check: ({ historicalData }) => {
      if (!historicalData || historicalData.length < 3) return false;
      const last = historicalData.slice(-3);
      return (
        last[0]?.grossMargin != null &&
        last[2]?.grossMargin != null &&
        last[2].grossMargin < last[0].grossMargin - 2
      );
    },
  },
  {
    id: 'burn_acceleration',
    label: 'Monthly burn accelerating > 15% MoM',
    detail: 'Rapidly increasing burn compresses runway faster than modeled.',
    severity: 'medium',
    dimension: 'riskIntelligence',
    impact: -0.6,
    action: 'Audit new headcount and OpEx commitments driving burn increase.',
    check: ({ historicalData }) => {
      if (!historicalData || historicalData.length < 2) return false;
      const prev = historicalData[historicalData.length - 2]?.burnRate;
      const curr = historicalData[historicalData.length - 1]?.burnRate;
      if (!prev || !curr || prev === 0) return false;
      return (curr - prev) / prev > 0.15;
    },
  },
  {
    id: 'mrr_churn',
    label: 'Net Revenue Retention < 90%',
    detail: 'NRR below 90% indicates net churn and shrinking revenue base.',
    severity: 'high',
    dimension: 'riskIntelligence',
    impact: -0.7,
    action: 'Launch customer success and expansion revenue program.',
    check: ({ metrics }) =>
      metrics?.nrr != null && metrics.nrr < 90,
  },
];

// ─── Private Helpers ───────────────────────────────────────────────────────

function _sumOrScalar(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.reduce((s, x) => s + (Number(x) || 0), 0);
  return typeof v === 'number' ? v : null;
}

function _budgetVariance(actuals, budget) {
  const a = _sumOrScalar(actuals?.revenue);
  const b = _sumOrScalar(budget?.revenue);
  if (a === null || b === null || b === 0) return null;
  return Math.abs((a - b) / b);
}

// ─── Raw Dimension Scorers ─────────────────────────────────────────────────
// Return a score in [0, 10] BEFORE risk penalties.

function _rawDataCompleteness({ hasQBO, hasPlaid, metrics, historicalData }) {
  let s = 10.0;
  // Integration coverage
  if (!hasQBO && !hasPlaid) s -= 2.5;
  else if (!hasQBO || !hasPlaid) s -= 0.8;
  // Historical depth
  const hLen = historicalData?.length ?? 0;
  if (hLen === 0)       s -= 1.8;
  else if (hLen < 6)   s -= 1.2;
  else if (hLen < 12)  s -= 0.6;
  else if (hLen < 24)  s -= 0.2;
  // KPI coverage
  const req = ['revenue', 'netIncome', 'grossMargin', 'mrr', 'burnRate', 'runwayMonths'];
  const missing = req.filter(k => metrics?.[k] == null).length;
  s -= missing * 0.4;
  // Freshness bonus/penalty
  if (metrics?.lastUpdatedHours != null) {
    if (metrics.lastUpdatedHours <= 1)  s = Math.min(10, s + 0.3);
    else if (metrics.lastUpdatedHours > 48) s -= 0.4;
  }
  return Math.max(0, Math.min(10, s));
}

function _rawForecastAccuracy({ budget, actuals, scenarios }) {
  if (!budget || Object.keys(budget).length === 0) return 1.0;
  let s = 5.0;
  // Variance scoring
  const v = _budgetVariance(actuals, budget);
  if (v !== null) {
    if (v < 0.03)      s += 4.0;
    else if (v < 0.05) s += 3.2;
    else if (v < 0.08) s += 2.2;
    else if (v < 0.10) s += 1.4;
    else if (v < 0.15) s += 0.6;
    // 15-20%: no bonus; >20%: penalty rule handles it
  }
  // Scenario coverage
  const sc = scenarios?.length ?? 0;
  if (sc >= 3)      s += 1.0;
  else if (sc === 2) s += 0.5;
  else if (sc === 1) s += 0.2;
  return Math.max(0, Math.min(10, s));
}

function _rawCashVisibility({ cashFlow, metrics, hasPlaid }) {
  let s = 2.5;
  if (hasPlaid) s += 1.5;
  const weeks = cashFlow?.weekly?.length ?? 0;
  if (weeks >= 13)     s += 3.2;
  else if (weeks >= 8) s += 2.0;
  else if (weeks >= 4) s += 1.0;
  else if (weeks >= 1) s += 0.3;
  if (metrics?.runwayMonths != null) {
    s += 0.8; // having runway data at all
    const rm = metrics.runwayMonths;
    if (rm >= 24)      s += 2.0;
    else if (rm >= 18) s += 1.4;
    else if (rm >= 12) s += 0.8;
    else if (rm >= 6)  s += 0.2;
    // < 6: penalty rules apply
  }
  return Math.max(0, Math.min(10, s));
}

function _rawBoardReadiness({ hasExport, hasCsuite, historicalData, metrics }) {
  let s = 2.3; // base raised to allow 10.0 ceiling when all conditions met
  if (hasCsuite && hasExport) s += 3.5;
  else if (hasCsuite)         s += 2.2;
  else if (hasExport)         s += 1.0;
  const hLen = historicalData?.length ?? 0;
  if (hLen >= 24)      s += 2.0;
  else if (hLen >= 13) s += 1.5;
  else if (hLen >= 6)  s += 0.8;
  else if (hLen >= 2)  s += 0.3;
  // KPI breadth
  const kpis = ['revenue', 'netIncome', 'grossMargin', 'mrr', 'burnRate', 'runwayMonths'];
  const present = kpis.filter(k => metrics?.[k] != null).length;
  s += (present / kpis.length) * 1.5;
  // Delta visibility bonuses
  if (hLen >= 2)  s += 0.3;
  if (hLen >= 13) s += 0.4;
  return Math.max(0, Math.min(10, s));
}

function _rawRiskIntelligence({ scenarios, metrics, historicalData }) {
  let s = 3.0;
  const sc = scenarios?.length ?? 0;
  if (sc >= 3)      s += 2.5;
  else if (sc === 2) s += 1.5;
  else if (sc === 1) s += 0.5;
  const hLen = historicalData?.length ?? 0;
  if (hLen >= 12)     s += 2.0;
  else if (hLen >= 6) s += 1.2;
  else if (hLen >= 3) s += 0.5;
  if (metrics?.topCustomerPct != null) s += 0.8;
  if (metrics?.nrr != null)           s += 0.7;
  if (metrics?.burnRate != null && hLen >= 2) s += 0.5;
  if (metrics?.runwayMonths >= 18)    s += 0.5;
  return Math.max(0, Math.min(10, s));
}

// ─── Delta Computation ─────────────────────────────────────────────────────

function _computeDeltas(historicalData) {
  if (!historicalData || historicalData.length < 2) return {};
  const curr  = historicalData[historicalData.length - 1];
  const prev1 = historicalData[historicalData.length - 2];
  const prev12 = historicalData.length >= 13
    ? historicalData[historicalData.length - 13]
    : null;
  const fields = ['revenue', 'netIncome', 'grossMargin', 'mrr', 'burnRate'];
  const out = {};
  fields.forEach(f => {
    const c = curr?.[f], p = prev1?.[f], py = prev12?.[f];
    if (c != null && p != null && p !== 0) {
      out[f] = { mom: ((c - p) / Math.abs(p)) * 100 };
      if (py != null && py !== 0) out[f].yoy = ((c - py) / Math.abs(py)) * 100;
    }
  });
  return out;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * detectRiskFlags(data) → RiskFlag[]
 *
 * data: { hasQBO, hasPlaid, hasExport, hasCsuite, metrics,
 *         budget, actuals, cashFlow, scenarios, historicalData }
 */
export function detectRiskFlags(data) {
  return RISK_RULES
    .filter(rule => {
      try { return rule.check(data); }
      catch (_) { return false; }
    })
    .map(({ id, label, detail, severity, dimension, impact, action }) => ({
      id, label, detail, severity, dimension, impact, action,
    }));
}

/**
 * computeFPAScore(data) → ScorecardResult
 *
 * data: {
 *   hasQBO         boolean
 *   hasPlaid       boolean
 *   hasExport      boolean
 *   hasCsuite      boolean
 *   metrics        { revenue, netIncome, grossMargin, mrr, burnRate,
 *                    runwayMonths, topCustomerPct, nrr, lastUpdatedHours }
 *   budget         { revenue: number | number[] }
 *   actuals        { revenue: number | number[] }
 *   cashFlow       { weekly: number[], balance: number }
 *   scenarios      object[]
 *   historicalData { month, revenue, netIncome, grossMargin, mrr, burnRate }[]
 * }
 *
 * returns: {
 *   scores              { [id]: number }   — clamped [0,10] after penalties
 *   rawScores           { [id]: number }   — before penalties
 *   penaltiesByDim      { [id]: number }   — total penalty per dimension
 *   overall             number             — weighted, 1 dp
 *   grade               string             — F/D/C/B/A/A+/10/10
 *   riskFlags           RiskFlag[]
 *   deltas              { [field]: { mom, yoy? } }
 *   dimensionContribs   { [id]: number }   — score × weight
 * }
 */
export function computeFPAScore(data) {
  const {
    hasQBO = false, hasPlaid = false, hasExport = false, hasCsuite = false,
    metrics = {}, budget = {}, actuals = {}, cashFlow = {},
    scenarios = [], historicalData = [],
  } = data;

  const payload = {
    hasQBO, hasPlaid, hasExport, hasCsuite,
    metrics, budget, actuals, cashFlow, scenarios, historicalData,
  };

  // 1. Detect risk flags
  const riskFlags = detectRiskFlags(payload);

  // 2. Aggregate penalties by dimension
  const penaltiesByDim = {};
  riskFlags.forEach(f => {
    penaltiesByDim[f.dimension] = (penaltiesByDim[f.dimension] || 0) + f.impact;
  });

  // 3. Raw scores
  const rawScores = {
    dataCompleteness: _rawDataCompleteness({ hasQBO, hasPlaid, metrics, historicalData }),
    forecastAccuracy: _rawForecastAccuracy({ budget, actuals, scenarios }),
    cashVisibility:   _rawCashVisibility({ cashFlow, metrics, hasPlaid }),
    boardReadiness:   _rawBoardReadiness({ hasExport, hasCsuite, historicalData, metrics }),
    riskIntelligence: _rawRiskIntelligence({ scenarios, metrics, historicalData }),
  };

  // 4. Apply penalties and clamp
  const scores = {};
  FPA_DIMENSIONS.forEach(d => {
    scores[d.id] = Math.max(0, Math.min(10, rawScores[d.id] + (penaltiesByDim[d.id] || 0)));
  });

  // 5. Weighted overall
  const weighted = FPA_DIMENSIONS.reduce((sum, d) => sum + scores[d.id] * d.weight, 0);
  const overall  = Math.round(weighted * 10) / 10;

  // 6. Grade
  const grade = gradeLabel(overall);

  // 7. Deltas
  const deltas = _computeDeltas(historicalData);

  // 8. Per-dimension contributions
  const dimensionContribs = {};
  FPA_DIMENSIONS.forEach(d => { dimensionContribs[d.id] = +(scores[d.id] * d.weight).toFixed(3); });

  return { scores, rawScores, penaltiesByDim, overall, grade, riskFlags, deltas, dimensionContribs };
}

// ─── Color + Grade Helpers ─────────────────────────────────────────────────

/** gaugeColor(score) — returns hex color for SVG strokes and UI accents */
export function gaugeColor(score) {
  if (score >= 9.0) return '#FACC15'; // Gold
  if (score >= 7.5) return '#34D399'; // Emerald / Green
  if (score >= 5.0) return '#FBBF24'; // Amber
  return '#F87171';                    // Rose / Red
}

/** gradeLabel(score) — returns letter grade string */
export function gradeLabel(score) {
  if (score >= 10.0) return '10/10';
  if (score >= 9.5)  return 'A+';
  if (score >= 8.5)  return 'A';
  if (score >= 7.5)  return 'B';
  if (score >= 6.5)  return 'C';
  if (score >= 5.5)  return 'D';
  return 'F';
}

/** gradeDescription(score) — one-line board-ready explanation */
export function gradeDescription(overall) {
  if (overall >= 9.5) return 'Exceptional — fully data-driven, board-ready FP&A infrastructure.';
  if (overall >= 8.5) return 'Strong — minor gaps remain; close data sources for full marks.';
  if (overall >= 7.5) return 'Solid — good foundation; integrate live data to unlock top tier.';
  if (overall >= 6.5) return 'Developing — connect data sources and add cash forecasting.';
  if (overall >= 5.0) return 'Early stage — significant FP&A infrastructure investment needed.';
  return 'Critical — urgent action required on data completeness and cash visibility.';
}
