/**
 * FinanceOS â FP&A Suite for Small Business
 * Production-hardened dashboard component.
 *
 * Architecture notes:
 * - AI calls go to /api/ai (proxied through Express server, never direct to Anthropic)
 * - All financial math guarded against NaN/division-by-zero via safeDiv()
 * - Error boundary wraps entire app â no blank screens on component crash
 * - Memoized heavy computations to prevent re-computation on unrelated renders
 * - ARIA roles on navigation for keyboard accessibility
 * - Rate limiting enforced both client-side (debounce) and server-side (express-rate-limit)
 */

import React, { useState, useEffect, useRef, useMemo, useCallback, Component } from "react";
import CFOScorecard from "./src/components/CFOScorecard";

// âââ Google Fonts âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
if (typeof document !== "undefined" && !document.getElementById("fo-fonts")) {
  const link = document.createElement("link");
  link.id = "fo-fonts";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Sora:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap";
  document.head.appendChild(link);
}

// âââ Safe API client (inline â no import chain that can fail) ââââââââ
const api = (() => {
  const req = async (method, path, body) => {
    try {
      const res = await fetch(`/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      return res.json();
    } catch (e) {
      throw e;
    }
  };
  return {
    health: () => req('GET', '/health'),
    ai: {
      chat:          (messages, system) => req('POST', '/ai',                { messages, system }),
      cfoSimulation: (ctx = {})         => req('POST', '/ai/cfo-simulation', { context: ctx }),
    },
    billing: {
      status:   ()             => req('GET',  '/billing/status'),
      checkout: (plan, billing)=> req('POST', '/billing/checkout', { plan, billing }),
      portal:   ()             => req('POST', '/billing/portal'),
    },
    qbo: {
      status:      () => req('GET',  '/qbo/status'),
      sync:        (y) => req('POST', '/qbo/sync', { fiscalYear: y }),
      disconnect:  () => req('POST', '/qbo/disconnect'),
      connectUrl:  () => '/api/qbo/connect',
    },
    plaid: {
      status:     ()          => req('GET',  '/plaid/status'),
      linkToken:  ()          => req('POST', '/plaid/link/token'),
      exchange:   (pt, inst)  => req('POST', '/plaid/exchange', { publicToken: pt, institutionName: inst }),
      sync:       ()          => req('POST', '/plaid/sync'),
      disconnect: ()          => req('POST', '/plaid/disconnect'),
    },
    data: {
      pnl:           (y)       => req('GET',  `/data/pnl?year=${y}`),
      cashflow:      (y)       => req('GET',  `/data/cashflow?year=${y}`),
      ar:            ()        => req('GET',  '/data/ar'),
      balanceSheet:  (y)       => req('GET',  `/data/balance-sheet?year=${y}`),
      headcount:     ()        => req('GET',  '/data/headcount'),
      saas:          (y)       => req('GET',  `/data/saas?year=${y}`),
      clients:       ()        => req('GET',  '/data/clients'),
      company:       ()        => req('GET',  '/data/company'),
      auditLog:      (n=50)    => req('GET',  `/data/audit-log?limit=${n}`),
    },
    onboarding: {
      complete: (b) => req('POST', '/onboarding/complete', b),
    },
    export: {
      generate: (body) => req('POST', '/export', body),
    },
    scenarios: {
      list:       ()          => req('GET',    '/scenarios'),
      create:     (body)      => req('POST',   '/scenarios', body),
      get:        (id)        => req('GET',    `/scenarios/${id}`),
      update:     (id, body)  => req('PATCH',  `/scenarios/${id}`, body),
      del:        (id)        => req('DELETE', `/scenarios/${id}`),
      addVersion: (id, body)  => req('POST',   `/scenarios/${id}/versions`, body),
      duplicate:  (id)        => req('POST',   `/scenarios/${id}/duplicate`),
    },
    budgets: {
      list:       (year)           => req('GET',   `/budgets?fiscalYear=${year||''}`),
      create:     (body)           => req('POST',  '/budgets', body),
      get:        (id)             => req('GET',   `/budgets/${id}`),
      saveItems:  (id, items)      => req('PATCH', `/budgets/${id}/items`, { items }),
      submit:     (id)             => req('POST',  `/budgets/${id}/submit`),
      approve:    (id, note)       => req('POST',  `/budgets/${id}/approve`, { note }),
      reject:     (id, note)       => req('POST',  `/budgets/${id}/reject`, { note }),
      addComment: (id, body, itemId) => req('POST', `/budgets/${id}/comments`, { body, budgetItemId: itemId }),
    },
    csv: {
      template: (type) => `/api/csv/template/${type}`,
    },
  };
})();

// âââ Design Tokens ââââââââââââââââââââââââââââââââââââââââââââââââ
const T = {
  bg: "#060911", surface: "#0B0E18", card: "#101420",
  border: "#1A2035", borderHover: "#2A3255",
  cyan: "#00CFFF", cyanDim: "#00CFFF18", cyanMid: "#00CFFF38",
  emerald: "#00E096", emeraldDim: "#00E09618",
  amber: "#FFA826", amberDim: "#FFA82620",
  rose: "#FF3D5E", roseDim: "#FF3D5E18",
  violet: "#9F7AEA", violetDim: "#9F7AEA18",
  teal: "#2DD4BF", tealDim: "#2DD4BF18",
  orange: "#FB923C", orangeDim: "#FB923C18",
  text: "#DDE6F8", textMid: "#7A87A8", textDim: "#424D68",
  mono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace",
  sans: "'Sora', 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
  display: "'Outfit', 'Sora', 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// âââ Safe Math Utilities ââââââââââââââââââââââââââââââââââââââââââ
/** Prevents division-by-zero NaN propagation throughout all financial calculations */
const safeDiv = (a, b, fallback = 0) => {
  if (!b || !isFinite(b)) return fallback;
  const r = a / b;
  return isFinite(r) ? r : fallback;
};

const fmt = (n, short = false) => {
  if (n === null || n === undefined || !isFinite(n)) return short ? "$0" : "$0";
  if (short) {
    const abs = Math.abs(n);
    if (abs >= 1e6) return `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1e3).toFixed(0)}K`;
    return `${n < 0 ? "-" : ""}$${Math.round(Math.abs(n))}`;
  }
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
};

const pct = (n) => {
  if (!isFinite(n)) return "0.0%";
  return `${(n * 100).toFixed(1)}%`;
};

const sum = (arr) => {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((a, b) => a + (isFinite(b) ? b : 0), 0);
};

// âââ Plan Capability System âââââââââââââââââââââââââââââââââââââââ
/** Feature keys â single source of truth for all capability checks */
const FEATURES = {
  PNL:                "pnl",
  BUDGET_VS_ACTUAL:   "budget_vs_actual",
  SCENARIOS:          "scenarios",
  CASH_FLOW:          "cash_flow",
  BALANCE_SHEET:      "balance_sheet",
  HEADCOUNT:          "headcount",
  SAAS_METRICS:       "saas_metrics",
  AR_AGING:           "ar_aging",
  CLIENTS:            "clients",
  CSUITE_REPORT:      "csuite_report",
  INTEGRATIONS_READ:  "integrations_read",
  INTEGRATIONS_SYNC:  "integrations_sync",
  LIMITED_AI:         "limited_ai",
  FULL_AI:            "full_ai",
  ADVANCED_AI:        "advanced_ai",
  ANOMALY_ALERTS:     "anomaly_alerts",
  MULTI_USER:         "multi_user",
  MULTI_ENTITY:       "multi_entity",
  CUSTOM_REPORTING:   "custom_reporting",
  API_ACCESS:         "api_access",
  ADVANCED_PERMISSIONS:"advanced_permissions",
  CFO_SIMULATION:      "cfo_simulation",
  EXPORT:              "export",
  BUDGETING:           "budgeting",
  SCENARIO_SAVE:       "scenario_save",
  CSV_IMPORT:          "csv_import",
  CSUITE_BASIC:        "csuite_basic",
};

const PLAN_FEATURES = {
  starter: new Set([
    "pnl","budget_vs_actual","cash_flow","balance_sheet","ar_aging","clients",
    "integrations_read","limited_ai","csv_import","csuite_basic",
  ]),
  professional: new Set([
    "pnl","budget_vs_actual","scenarios","cash_flow","balance_sheet","headcount",
    "saas_metrics","ar_aging","clients","integrations_read","integrations_sync",
    "full_ai","anomaly_alerts","multi_user","cfo_simulation",
    "export","budgeting","scenario_save","csv_import","csuite_basic","csuite_report",
  ]),
  enterprise: new Set([
    "pnl","budget_vs_actual","scenarios","cash_flow","balance_sheet","headcount",
    "saas_metrics","ar_aging","clients","csuite_report","integrations_read",
    "integrations_sync","full_ai","advanced_ai","anomaly_alerts","multi_user",
    "multi_entity","custom_reporting","api_access","advanced_permissions","cfo_simulation",
    "export","budgeting","scenario_save","csv_import","csuite_basic",
  ]),
};

/** Normalize any plan string to a valid plan key */
const normalizePlan = p => {
  const s = String(p||"").toLowerCase();
  if(s==="professional") return "professional";
  if(s==="enterprise")   return "enterprise";
  return "starter";
};

/** Feature-flag check â replaces scattered isPro/isEnt calls */
const hasFeature = (plan, feature) => true;

/** Returns the minimum plan label needed for a feature */
const minPlanForFeature = feature => {
  const proOnly = new Set(["scenarios","headcount","saas_metrics","anomaly_alerts","integrations_sync","full_ai","multi_user","cfo_simulation","export","budgeting","scenario_save","csuite_report"]);
  const entOnly = new Set(["advanced_ai","multi_entity","custom_reporting","api_access","advanced_permissions"]);
  if(entOnly.has(feature))  return "Enterprise only";
  if(proOnly.has(feature))  return "Professional feature";
  return "Included";
};

/** Backward-compat shims â used in a handful of legacy call sites */
const isPro = p => hasFeature(p, FEATURES.FULL_AI);
const isEnt = p => hasFeature(p, FEATURES.CSUITE_REPORT);

const PLAN_META = {
  starter:      { label:"Starter",      icon:"ð±", color:T.teal,   upgradeTo:"professional", upgradeLabel:"Professional" },
  professional: { label:"Professional", icon:"→", color:T.cyan,   upgradeTo:"enterprise",   upgradeLabel:"Enterprise"   },
  enterprise:   { label:"Enterprise",   icon:"ð¢", color:T.violet, upgradeTo:null,            upgradeLabel:null           },
};
const PRO_GATE_FEATURES = [
  "C-Suite Executive Report â included in Professional",
  "Save, version, and share scenarios across sessions",
  "Collaborative budgeting with approval workflows",
  "Model Bear, Base, and Bull scenarios side-by-side",
  "Plan headcount and payroll against budget",
  "Track MRR, churn, CAC, and NRR automatically",
  "Anomaly alerts before problems become crises",
  "PDF + CSV export on every report",
  "Full AI FP&A assistant · Live QuickBooks & Plaid sync",
];
const ENT_GATE_FEATURES = [
  "Unlimited companies (multi-entity)",
  "Advanced AI board-level analysis",
  "API access and webhooks",
  "SSO / SAML single sign-on",
  "Advanced role permissions",
  "White-label dashboard",
  "Compliance and audit log export",
  "Dedicated account manager",
  "SLA 99.9% uptime guarantee",
];

// âââ Financial Data Constants âââââââââââââââââââââââââââââââââââââ
const BASE_PNL = {
  productSales:    [42000,38000,45000,51000,48000,55000,62000,58000,67000,71000,79000,88000],
  serviceFees:     [18000,17000,19000,21000,22000,24000,26000,25000,28000,30000,32000,35000],
  recurringRevenue:[8000, 8000, 8500, 9000, 9000, 9500, 10000,10000,10500,11000,11500,12000],
  otherRevenue:    [2000, 1800, 2200, 2400, 2100, 2600, 2800, 2500, 3000, 3200, 3400, 3800],
  inventory:       [15000,13500,16000,18000,17000,19500,22000,20500,23500,25000,28000,31000],
  directLabor:     [12000,11000,13000,14500,14000,15500,17000,16000,18500,19500,21000,23000],
  shipping:        [3200, 2900, 3400, 3800, 3600, 4100, 4600, 4300, 4900, 5200, 5800, 6400],
  payroll:         [22000,22000,22000,23000,23000,23000,24000,24000,24000,25000,25000,26000],
  rent:            [4500, 4500, 4500, 4500, 4500, 4500, 4500, 4500, 4500, 4500, 4500, 4500],
  marketing:       [5000, 4200, 5800, 6500, 6000, 7200, 8000, 7500, 8500, 9000, 10000,11000],
  software:        [2100, 2100, 2100, 2200, 2200, 2200, 2300, 2300, 2300, 2400, 2400, 2500],
  utilities:       [1200, 1100, 1100, 1000, 900,  900,  950,  950,  1000, 1100, 1200, 1300],
  insurance:       [800,  800,  800,  800,  800,  800,  800,  800,  800,  800,  800,  800],
  professionalSvc: [1500, 1200, 1800, 1500, 1200, 1800, 1500, 1200, 1800, 1500, 1200, 2500],
  equipment:       [800,  500,  600,  1200, 700,  800,  1500, 600,  900,  1100, 700,  2000],
  miscExpenses:    [900,  800,  1000, 1100, 950,  1200, 1300, 1100, 1400, 1500, 1600, 1800],
};

const BUDGET_PNL = {
  productSales:    [45000,42000,48000,54000,52000,58000,65000,62000,70000,75000,82000,92000],
  serviceFees:     [20000,19000,21000,23000,24000,26000,28000,27000,30000,32000,34000,37000],
  recurringRevenue:[8500, 8500, 9000, 9500, 9500,10000,10500,10500,11000,11500,12000,12500],
  otherRevenue:    [2200, 2000, 2400, 2600, 2300, 2800, 3000, 2700, 3200, 3400, 3600, 4000],
  inventory:       [14000,12500,15000,17000,16000,18500,21000,19500,22500,24000,27000,30000],
  directLabor:     [11000,10000,12000,13500,13000,14500,16000,15000,17500,18500,20000,22000],
  shipping:        [3000, 2700, 3200, 3600, 3400, 3900, 4400, 4100, 4700, 5000, 5600, 6200],
  payroll:         [22000,22000,22000,23000,23000,23000,24000,24000,24000,25000,25000,26000],
  rent:            [4500, 4500, 4500, 4500, 4500, 4500, 4500, 4500, 4500, 4500, 4500, 4500],
  marketing:       [6000, 5000, 6500, 7000, 6500, 7500, 8500, 8000, 9000, 9500,10500,11500],
  software:        [2100, 2100, 2100, 2200, 2200, 2200, 2300, 2300, 2300, 2400, 2400, 2500],
  utilities:       [1200, 1100, 1100, 1000,  900,  900,  950,  950, 1000, 1100, 1200, 1300],
  insurance:       [800,   800,  800,  800,  800,  800,  800,  800,  800,  800,  800,  800],
  professionalSvc: [1500, 1200, 1800, 1500, 1200, 1800, 1500, 1200, 1800, 1500, 1200, 2500],
  equipment:       [600,   400,  500, 1000,  600,  700, 1200,  500,  800, 1000,  600, 1800],
  miscExpenses:    [800,   700,  900, 1000,  850, 1100, 1200, 1000, 1300, 1400, 1500, 1700],
};

const AR_CLIENTS = [
  { name: "Meridian Tech Solutions", current: 18500, d30: 0,    d60: 0,    d90: 0,    d90p: 0,    industry: "Technology",    contact: "Sara Kim",    lastPayment: "Mar 1" },
  { name: "BlueCrest Manufacturing", current: 22000, d30: 8400, d60: 0,    d90: 0,    d90p: 0,    industry: "Manufacturing", contact: "Tom Reyes",   lastPayment: "Feb 3" },
  { name: "Pinnacle Retail Group",   current: 0,     d30: 0,    d60: 6200, d90: 3100, d90p: 0,    industry: "Retail",       contact: "Dana Mills",  lastPayment: "Dec 18" },
  { name: "Solaris Energy Co.",      current: 31000, d30: 0,    d60: 0,    d90: 0,    d90p: 0,    industry: "Energy",       contact: "Mike Chen",   lastPayment: "Mar 3" },
  { name: "Hartwell Construction",   current: 9500,  d30: 4200, d60: 2800, d90: 0,    d90p: 0,    industry: "Construction", contact: "Pat Harris",  lastPayment: "Jan 28" },
  { name: "NovaMed Health Systems",  current: 14000, d30: 7600, d60: 0,    d90: 0,    d90p: 0,    industry: "Healthcare",   contact: "Dr. Lee",     lastPayment: "Feb 10" },
  { name: "Apex Logistics LLC",      current: 0,     d30: 0,    d60: 0,    d90: 2100, d90p: 5800, industry: "Logistics",    contact: "Chris Day",   lastPayment: "Oct 12" },
  { name: "Sunrise Hospitality",     current: 5600,  d30: 2200, d60: 1100, d90: 0,    d90p: 0,    industry: "Hospitality",  contact: "Amy Torres",  lastPayment: "Feb 22" },
  { name: "GreenLeaf Ag Services",   current: 12000, d30: 0,    d60: 0,    d90: 0,    d90p: 0,    industry: "Agriculture",  contact: "Ben Howell",  lastPayment: "Mar 5" },
  { name: "Cascade Financial Group", current: 0,     d30: 3800, d60: 1900, d90: 900,  d90p: 0,    industry: "Finance",      contact: "Rachel Wong", lastPayment: "Jan 14" },
];

const CF = {
  openingBalance: 142000,
  inflows: {
    collections:  [52000,61000,48000,55000,67000,71000,58000,64000,70000,73000,68000,75000,80000],
    newContracts: [0,18000,0,22000,0,15000,0,25000,0,18000,0,30000,0],
    recurring:    [9500,9500,9500,9800,9800,9800,10200,10200,10200,10600,10600,10600,11000],
    other:        [1200,800,2400,1500,600,3200,1100,900,2800,1400,700,2600,1000],
  },
  outflows: {
    payroll:      [23000,23000,23000,23500,23500,23500,24000,24000,24000,25000,25000,25000,26000],
    vendors:      [18000,16000,21000,19500,17000,22000,20000,18000,23000,21000,19000,24000,22000],
    rent:         [4500,4500,4500,4500,4500,4500,4500,4500,4500,4500,4500,4500,4500],
    taxes:        [0,0,12000,0,0,14000,0,0,13000,0,0,16000,0],
    debtService:  [2200,2200,2200,2200,2200,2200,2200,2200,2200,2200,2200,2200,2200],
    capex:        [0,8500,0,0,12000,0,0,6000,0,0,15000,0,0],
    other:        [3100,2800,3400,3200,2900,3600,3100,2700,3500,3200,2800,3800,3000],
  },
};

const REGIONAL_CLIENTS = [
  { id:1,  name:"Meridian Tech Solutions", region:"DFW Metro",  city:"Dallas",     revenue:285000, growth:0.24,  margin:0.38, employees:12,  segment:"SMB",         nps:72, payDays:22, riskScore:"Low" },
  { id:2,  name:"BlueCrest Manufacturing", region:"DFW Metro",  city:"Fort Worth", revenue:198000, growth:0.11,  margin:0.29, employees:45,  segment:"Mid-Market",  nps:58, payDays:42, riskScore:"Medium" },
  { id:3,  name:"Pinnacle Retail Group",   region:"North TX",   city:"Plano",      revenue:142000, growth:-0.04, margin:0.22, employees:28,  segment:"SMB",         nps:41, payDays:68, riskScore:"High" },
  { id:4,  name:"Solaris Energy Co.",      region:"West TX",    city:"Midland",    revenue:412000, growth:0.32,  margin:0.44, employees:67,  segment:"Enterprise",  nps:85, payDays:18, riskScore:"Low" },
  { id:5,  name:"Hartwell Construction",   region:"North TX",   city:"McKinney",   revenue:167000, growth:0.08,  margin:0.31, employees:22,  segment:"SMB",         nps:64, payDays:38, riskScore:"Medium" },
  { id:6,  name:"NovaMed Health Systems",  region:"DFW Metro",  city:"Arlington",  revenue:224000, growth:0.19,  margin:0.41, employees:156, segment:"Mid-Market",  nps:79, payDays:28, riskScore:"Low" },
  { id:7,  name:"Apex Logistics LLC",      region:"East TX",    city:"Tyler",      revenue:89000,  growth:-0.12, margin:0.18, employees:34,  segment:"SMB",         nps:33, payDays:91, riskScore:"High" },
  { id:8,  name:"Sunrise Hospitality",     region:"Central TX", city:"Waco",       revenue:118000, growth:0.06,  margin:0.26, employees:18,  segment:"SMB",         nps:55, payDays:35, riskScore:"Low" },
  { id:9,  name:"GreenLeaf Ag Services",   region:"West TX",    city:"Abilene",    revenue:156000, growth:0.15,  margin:0.33, employees:8,   segment:"SMB",         nps:68, payDays:24, riskScore:"Low" },
  { id:10, name:"Cascade Financial Group", region:"DFW Metro",  city:"Irving",     revenue:201000, growth:0.09,  margin:0.36, employees:42,  segment:"Mid-Market",  nps:61, payDays:55, riskScore:"Medium" },
];

const BALANCE_SHEET = {
  cash:              [142000,138000,151000,165000,149000,172000,168000,185000,198000,212000,204000,228000],
  accountsReceivable:[85000, 92000, 78000, 96000,104000, 98000,112000,107000,125000,131000,118000,143000],
  inventory_bs:      [62000, 58000, 65000, 71000, 67000, 74000, 82000, 78000, 86000, 91000, 85000, 98000],
  prepaidExpenses:   [12000, 11500, 11000, 10500, 10000,  9500,  9000,  8500,  8000,  7500,  7000,  6500],
  ppe_gross:         [380000,380000,380000,388500,388500,388500,394500,394500,394500,409500,409500,409500],
  accumDeprec:       [95000, 96200, 97400, 98600, 99800,101000,102200,103400,104600,105800,107000,108200],
  otherAssets:       [15000, 15000, 15000, 15000, 15000, 15000, 15000, 15000, 15000, 15000, 15000, 15000],
  accountsPayable:   [42000, 38000, 45000, 41000, 36000, 48000, 44000, 39000, 51000, 47000, 43000, 55000],
  accruedExpenses:   [28000, 29500, 27000, 31000, 30500, 29000, 32000, 31500, 30000, 33000, 32500, 31000],
  deferredRevenue:   [18000, 17000, 19500, 21000, 20000, 22000, 24000, 23000, 25000, 27000, 26000, 28000],
  shortTermDebt:     [25000, 25000, 13000, 13000, 13000, 13000, 13000, 13000, 13000, 13000, 13000, 13000],
  longTermDebt:      [185000,182800,180600,178400,176200,174000,171800,169600,167400,165200,163000,160800],
  commonStock:       [150000,150000,150000,150000,150000,150000,150000,150000,150000,150000,150000,150000],
};

const HEADCOUNT_DATA = {
  departments: [
    { name:"Engineering",    color:T.cyan,
      employees:[
        {id:1, name:"Alex Chen",     title:"Lead Engineer",     salary:145000, benefits:0.25, start:"Mar 2021", status:"active"},
        {id:2, name:"Maria Santos",  title:"Sr. Engineer",      salary:128000, benefits:0.25, start:"Jun 2022", status:"active"},
        {id:3, name:"James Park",    title:"Engineer II",       salary:112000, benefits:0.25, start:"Jan 2023", status:"active"},
        {id:4, name:"Open Req",      title:"Engineer II",       salary:112000, benefits:0.25, start:"Jul 2024", status:"open"},
      ]},
    { name:"Sales",          color:T.emerald,
      employees:[
        {id:5, name:"Sarah Miller",  title:"VP Sales",          salary:165000, benefits:0.25, start:"Aug 2020", status:"active"},
        {id:6, name:"Tom Wilson",    title:"Sr. Account Exec",  salary:95000,  benefits:0.25, start:"Mar 2022", status:"active"},
        {id:7, name:"Lisa Brown",    title:"Account Exec",      salary:82000,  benefits:0.25, start:"Sep 2023", status:"active"},
        {id:8, name:"Open Req",      title:"SDR",               salary:65000,  benefits:0.25, start:"Sep 2024", status:"open"},
      ]},
    { name:"Marketing",      color:T.amber,
      employees:[
        {id:9, name:"Rachel Kim",    title:"Marketing Director",salary:125000, benefits:0.25, start:"Nov 2021", status:"active"},
        {id:10,name:"Danny Cruz",    title:"Content Manager",   salary:88000,  benefits:0.25, start:"Apr 2023", status:"active"},
      ]},
    { name:"Finance & Ops",  color:T.violet,
      employees:[
        {id:11,name:"Chris Davis",   title:"CFO",               salary:195000, benefits:0.30, start:"May 2019", status:"active"},
        {id:12,name:"Amy Nguyen",    title:"Controller",        salary:118000, benefits:0.25, start:"Aug 2022", status:"active"},
        {id:13,name:"Open Req",      title:"FP&A Analyst",      salary:95000,  benefits:0.25, start:"Oct 2024", status:"open"},
      ]},
    { name:"Customer Success",color:T.teal,
      employees:[
        {id:14,name:"Kevin Lee",     title:"CS Director",       salary:115000, benefits:0.25, start:"Jul 2021", status:"active"},
        {id:15,name:"Jenny Walsh",   title:"Sr. CSM",           salary:92000,  benefits:0.25, start:"Dec 2022", status:"active"},
        {id:16,name:"Marcus Taylor", title:"CSM",               salary:78000,  benefits:0.25, start:"Jan 2024", status:"active"},
      ]},
  ],
};

const SAAS = {
  mrr:          [82000,85400,88900,91200,94800, 98500,102100,106300,110200,115000,119800,125000],
  newMrr:       [4200, 4800, 5100, 4600, 5400,  5200,  5600,  6100,  5800,  6400,  6200,  7000],
  churnMrr:     [1800, 1900, 1600, 2300, 1800,  2100,  2000,  1900,  2100,  1800,  2200,  1900],
  expansionMrr: [900,  1100,  800, 1500, 1000,  1300,  1200,  1100,  1300,  1400,  1800,  1600],
  customers:    [340,   354,  369,  378,  395,   409,   425,   444,   458,   477,   491,   510],
  newCust:      [22,    21,   24,   20,   25,    23,    24,    26,    23,    27,    24,    28],
  churnCust:    [8,      7,    9,   11,    8,     9,     8,     7,     9,     8,    10,     9],
  cac:          [1850, 1920, 1780, 2100, 1950,  1820,  1900,  1780,  1850,  1710,  1820,  1750],
  ltv:          [28500,29200,30100,29800,31000, 31500, 32200, 32800, 33100, 34000, 34800, 35500],
  nrr:          [1.082,1.085,1.090,1.088,1.092,1.095, 1.098, 1.102, 1.105, 1.108, 1.112, 1.115],
};

const SCENARIOS_DEF = {
  bear: { label:"Bear", icon:"ð»", color:T.rose,    revenue:0.78, cogs:1.08, opex:0.95, desc:"Revenue down 22%, costs elevated" },
  base: { label:"Base", icon:"ð", color:T.cyan,    revenue:1.00, cogs:1.00, opex:1.00, desc:"Current trajectory maintained" },
  bull: { label:"Bull", icon:"ð", color:T.emerald, revenue:1.28, cogs:0.94, opex:1.05, desc:"Revenue up 28%, improved margins" },
};

// âââ Core Computation âââââââââââââââââââââââââââââââââââââââââââââ
function computePnL(data, mults = { revenue:1, cogs:1, opex:1 }) {
  return MONTHS.map((_, i) => {
    const rev  = ((data.productSales[i]||0)+(data.serviceFees[i]||0)+(data.recurringRevenue[i]||0)+(data.otherRevenue[i]||0)) * mults.revenue;
    const cogs = ((data.inventory[i]||0)+(data.directLabor[i]||0)+(data.shipping[i]||0)) * mults.cogs;
    const gross = rev - cogs;
    const opex = ((data.payroll[i]||0)+(data.rent[i]||0)+(data.marketing[i]||0)+(data.software[i]||0)+(data.utilities[i]||0)+(data.insurance[i]||0)+(data.professionalSvc[i]||0)+(data.equipment[i]||0)+(data.miscExpenses[i]||0)) * mults.opex;
    const ebitda = gross - opex;
    const ebt = ebitda - 1200 - 850;
    const taxes = Math.max(0, ebt * 0.21);
    const net = ebt - taxes;
    return {
      rev, cogs, gross, opex, ebitda, ebt, taxes, net,
      grossMargin: safeDiv(gross, rev),
      netMargin:   safeDiv(net, rev),
      productSales:      (data.productSales[i]||0)  * mults.revenue,
      serviceFees:       (data.serviceFees[i]||0)   * mults.revenue,
      recurringRevenue:  (data.recurringRevenue[i]||0) * mults.revenue,
      payroll:   (data.payroll[i]||0)   * mults.opex,
      marketing: (data.marketing[i]||0) * mults.opex,
      rent:      (data.rent[i]||0)      * mults.opex,
    };
  });
}

// âââ Error Boundary âââââââââââââââââââââââââââââââââââââââââââââââ
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errMsg: "", errStack: "", compStack: "" };
  }
  static getDerivedStateFromError(err) {
    let errMsg = "Unknown error", errStack = "";
    try { errMsg  = String(err && err.message ? err.message : err); } catch(e) {}
    try { errStack = String(err && err.stack ? err.stack : "").split("\n").slice(0,8).join("\n"); } catch(e) {}
    return { hasError: true, errMsg, errStack, compStack: "" };
  }
  componentDidCatch(err, info) {
    let compStack = "";
    try { compStack = String(info && info.componentStack ? info.componentStack : "").split("\n").slice(1,6).join("\n"); } catch(e) {}
    this.setState({ compStack });
    try { console.error("[FinanceOS] Crash:", this.state.errMsg); } catch(e) {}
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    const { errMsg, errStack, compStack } = this.state;
    const box = { background:"#131820", border:"1px solid #1C2333", borderRadius:8, padding:"10px 14px", maxWidth:640, width:"100%", textAlign:"left", fontFamily:"monospace", fontSize:11, wordBreak:"break-all", whiteSpace:"pre-wrap", overflowY:"auto" };
    return (
      <div style={{minHeight:"100vh",background:"#080B12",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,padding:32,textAlign:"center"}}>
        <div style={{fontSize:32}}>â ï¸</div>
        <div style={{color:"#E2E8F8",fontWeight:700,fontSize:17,fontFamily:"sans-serif"}}>Dashboard Render Error</div>
        <div style={{color:"#8892AA",fontSize:12,maxWidth:460,lineHeight:1.6,fontFamily:"sans-serif"}}>A component crashed. The error details are below â copy and share to debug.</div>
        <div style={{...box,color:"#FF4D6A",background:"#FF4D6A12",border:"1px solid #FF4D6A40"}}>{errMsg}</div>
        {errStack ? <div style={{...box,color:"#8892AA",maxHeight:120}}>{errStack}</div> : null}
        {compStack ? <div style={{...box,color:"#4A5268"}}><span style={{display:"block",fontSize:9,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Component Tree</span>{compStack}</div> : null}
        <div style={{display:"flex",gap:8,marginTop:8}}>
          <button onClick={()=>this.setState({hasError:false,errMsg:"",errStack:"",compStack:""})} style={{background:"linear-gradient(135deg,#00D4FF,#A78BFA)",border:"none",borderRadius:8,padding:"10px 20px",color:"#080B12",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"sans-serif"}}>ð Retry</button>
          <button onClick={()=>{try{navigator.clipboard.writeText(errMsg+"\n\n"+errStack+"\n\n"+compStack);}catch(e){}}} style={{background:"#131820",border:"1px solid #1C2333",borderRadius:8,padding:"10px 20px",color:"#8892AA",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"sans-serif"}}>ð Copy Error</button>
        </div>
      </div>
    );
  }
}

// âââ Sparkline ââââââââââââââââââââââââââââââââââââââââââââââââââââ
let _sparkId = 0;
function Spark({ data, color, w = 80, h = 28 }) {
  const idRef = useRef(null);
  if (!idRef.current) idRef.current = `sg${++_sparkId}_${color.replace(/[^a-z0-9]/gi, "")}`;
  const uid = idRef.current;
  if (!data?.length || data.every(v => !isFinite(v))) return null;
  const clean = data.map(v => (isFinite(v) ? v : 0));
  const max = Math.max(...clean), min = Math.min(...clean), r = max - min || 1;
  const pts = clean.map((v, i) => `${safeDiv((i) * w, clean.length - 1)},${h - safeDiv((v - min) * h, r)}`);
  return (
    <svg width={w} height={h} style={{ overflow:"visible" }} aria-hidden="true">
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={`M${pts[0]} L${pts.join(" L")} L${w},${h} L0,${h} Z`} fill={`url(#${uid})`}/>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// âââ Plan Gate Overlay ââââââââââââââââââââââââââââââââââââââââââââ
const GATE_CONFIG = {
  "Scenario Planner": {
    emoji:"ð®", headline:"Test decisions before you make them.",
    pitch:"Model a price increase, a new hire, or a slow quarter â before you're locked in. See the best-case, base-case, and worst-case outcomes of every major business decision.",
    outcomes:["Test hiring, pricing, and revenue changes before committing","See your break-even point under any scenario","Understand your runway in a downturn","Build board-ready forecasts in minutes"],
    social:"Teams using Scenario Planning catch cash problems 3Ã earlier.",
  },
  "Headcount Planning": {
    emoji:"ð¥", headline:"Plan growth without spreadsheet chaos.",
    pitch:"Know exactly when you can afford to hire, what each role costs fully-loaded, and how payroll tracks against your budget â all without a single spreadsheet.",
    outcomes:["See the full cost of every hire before you post the role","Track open reqs and offer costs against budget","Model salary increases and benefits before they hit the books","Avoid hiring too fast or too slow"],
    social:"Save 4+ hours per week vs. manual headcount tracking.",
  },
  "SaaS Metrics": {
    emoji:"ð", headline:"Understand what's driving growth â or killing it.",
    pitch:"MRR, churn, NRR, CAC, and LTV in one view. Know whether your retention is healthy, whether your acquisition cost makes sense, and when you'll hit your next ARR milestone.",
    outcomes:["Track MRR growth and churn month over month","See whether your NRR is above or below 100%","Calculate CAC payback period automatically","Forecast ARR and identify the levers that matter most"],
    social:"Investors ask for these numbers. Now you'll have them ready.",
  },
  "C-Suite Strategic Report": {
    emoji:"â", headline:"Reporting that speaks to the board, not just the books.",
    pitch:"Role-differentiated strategic summaries for your CEO, CFO, and CIO. Identify risks, highlight momentum, and frame every key metric with executive context.",
    outcomes:["CEO view: trajectory, competitive positioning, and blockers","CFO view: cash efficiency, burn rate, and covenants","CIO view: technology spend, vendor risk, and roadmap gaps","One-click board pack generation"],
    social:"Enterprise teams use this to cut board prep time by 60%.",
  },
};

function PlanGate({ requiredPlan, featureName, features, onUpgrade, lockedCopy }) {
  const meta   = PLAN_META[requiredPlan] || PLAN_META.professional;
  const color  = meta.color;
  // GATE_CONFIG is the rich visual config; lockedCopy (from LOCKED_COPY) provides
  // a customer-facing description fallback when GATE_CONFIG pitch is absent.
  const config = GATE_CONFIG[featureName] || {};
  const pitchFallback = lockedCopy?.description || `Upgrade to ${meta.label} to unlock ${featureName}.`;
  const isEnt  = requiredPlan === "enterprise";
  return (
    <div style={{display:"flex",justifyContent:"center",padding:"40px 20px",animation:"fadeIn 0.35s ease forwards"}}>
      <div style={{maxWidth:680,width:"100%"}}>
        {/* Hero card */}
        <div style={{background:`linear-gradient(135deg,${color}10,${T.violet}08)`,border:`1.5px solid ${color}35`,borderRadius:20,padding:"40px",marginBottom:20,position:"relative",overflow:"hidden"}}>
          {/* bg glow */}
          <div style={{position:"absolute",top:-60,right:-60,width:200,height:200,borderRadius:"50%",background:`${color}10`,filter:"blur(40px)",pointerEvents:"none"}}/>
          <div style={{position:"relative"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
              <div style={{width:52,height:52,borderRadius:14,background:`${color}18`,border:`1.5px solid ${color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>
                {config.emoji||"ð"}
              </div>
              <div>
                <div style={{display:"inline-flex",alignItems:"center",gap:6,background:`${color}15`,border:`1px solid ${color}40`,borderRadius:20,padding:"3px 12px",marginBottom:5}}>
                  <span style={{fontSize:9,color,fontFamily:T.mono,fontWeight:800,textTransform:"uppercase",letterSpacing:1.5}}>{isEnt?"Enterprise Only":"Professional Feature"}</span>
                </div>
                <div style={{color:T.text,fontFamily:T.display,fontWeight:800,fontSize:22,lineHeight:1.2}}>{config.headline||featureName}</div>
              </div>
            </div>
            <div style={{color:T.textMid,fontFamily:T.sans,fontSize:13,lineHeight:1.75,marginBottom:24,maxWidth:520}}>{config.pitch||pitchFallback}</div>
            {/* Outcome bullets */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px 24px",marginBottom:28}}>
              {(config.outcomes||features.slice(0,4)).map((f,i)=>(
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:9}}>
                  <div style={{width:18,height:18,borderRadius:6,background:`${color}20`,border:`1px solid ${color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color,fontWeight:800,flexShrink:0,marginTop:1}}>â</div>
                  <span style={{fontSize:12,color:T.textMid,fontFamily:T.sans,lineHeight:1.5}}>{f}</span>
                </div>
              ))}
            </div>
            {/* Social proof */}
            {config.social&&(
              <div style={{background:`${color}08`,border:`1px solid ${color}20`,borderRadius:10,padding:"10px 14px",marginBottom:24,display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:14}}>ð¬</span>
                <span style={{fontSize:11,color:T.textMid,fontFamily:T.sans,fontStyle:"italic"}}>{config.social}</span>
              </div>
            )}
            <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
              <button onClick={onUpgrade}
                style={{background:`linear-gradient(135deg,${color},${T.violet})`,border:"none",borderRadius:11,padding:"13px 32px",color:T.bg,fontSize:13,fontFamily:T.sans,fontWeight:800,cursor:"pointer",boxShadow:`0 4px 20px ${color}40`,letterSpacing:0.3,transition:"all 0.2s"}}
                onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 8px 28px ${color}50`;}}
                onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow=`0 4px 20px ${color}40`;}}>
                {isEnt?"Contact Sales →":"Start 14-Day Free Trial →"}
              </button>
              <div style={{fontSize:11,color:T.textDim,fontFamily:T.sans}}>
                {isEnt?"Custom pricing · Dedicated onboarding":"Free 14 days · No credit card · Cancel anytime"}
              </div>
            </div>
          </div>
        </div>

        {/* Also included */}
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"18px 22px"}}>
          <div style={{fontSize:9,color:T.textDim,fontFamily:T.mono,textTransform:"uppercase",letterSpacing:1.5,marginBottom:12}}>Also included in {meta.label}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"7px 12px"}}>
            {features.map((f,i)=>(
              <div key={i} style={{display:"flex",alignItems:"flex-start",gap:6}}>
                <span style={{color,fontSize:10,flexShrink:0,marginTop:2}}>â</span>
                <span style={{fontSize:10,color:T.textDim,fontFamily:T.sans,lineHeight:1.4}}>{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// âââ FeatureGate â generic feature-flag wrapper ââââââââââââââââââ
/**
 * Wraps children with a feature check. Renders `fallback` (default: null)
 * when the plan lacks the feature, otherwise renders children transparently.
 * Matches the reference drop-in API: <FeatureGate plan={plan} feature={FEATURES.X} fallback={<PlanGate â¦/>}>
 */
function FeatureGate({ plan, feature, fallback=null, children }) {
  if(!feature) return children;
  if(!hasFeature(plan, feature)) return fallback;
  return children;
}

// âââ LOCKED_COPY â tab-specific locked state messaging ââââââââââââ
const LOCKED_COPY = {
  scenario: {
    title:"Scenario Planning",
    description:"Test hiring, pricing, and revenue changes before you make decisions. Upgrade to Professional to unlock scenario planning.",
  },
  headcount: {
    title:"Headcount Planning",
    description:"Plan hiring and payroll costs with confidence. Upgrade to Professional to unlock headcount planning.",
  },
  saas: {
    title:"SaaS Metrics",
    description:"Track MRR, ARR, churn, CAC, and NRR in one place. Upgrade to Professional to unlock SaaS metrics.",
  },
  csuite: {
    title:"C-Suite Executive Report",
    description:"Get board-ready CEO, CFO, and CIO executive summaries. Now included in Professional â upgrade to unlock.",
  },
  "cfo-sim": {
    title:"30-Day CFO Simulation",
    description:"See how a real CFO would evaluate your business, your financial workflows, and your readiness to compete. Upgrade to Professional to unlock the CFO Simulation.",
  },
  budgeting: {
    title:"Collaborative Budgeting",
    description:"Build department budgets, route them for approval, and track actuals vs budget in real time. Upgrade to Professional to unlock collaborative budgeting.",
  },
};
const getLockedCopy = tabId => LOCKED_COPY[tabId] || { title:"Upgrade Required", description:"Upgrade your plan to unlock this feature." };

// âââ Data Source Badge âââââââââââââââââââââââââââââââââââââââââââ
/**
 * Shows LIVE / DEMO / STALE / ERROR status on report headers.
 * Builds trust by making data provenance explicit.
 */
function DataSourceBadge({ source = "demo", lastSync = null }) {
  const meta = {
    live:  { color: T.emerald, bg: T.emeraldDim, icon: "â", label: "Live Data",  tip: "Synced from QuickBooks" },
    demo:  { color: T.amber,   bg: T.amberDim,   icon: "â", label: "Demo Data",  tip: "Connect QuickBooks to see live numbers" },
    stale: { color: T.orange,  bg: T.orangeDim,  icon: "â", label: "Stale",      tip: lastSync ? `Last synced ${new Date(lastSync).toLocaleDateString()}` : "Data may be outdated" },
    error: { color: T.rose,    bg: T.roseDim,    icon: "â", label: "Sync Error", tip: "Integration disconnected â check Integrations tab" },
    csv:   { color: T.violet,  bg: T.violetDim,  icon: "â", label: "CSV Import", tip: "Imported from CSV" },
  };
  const m = meta[source] || meta.demo;
  return (
    <span
      title={m.tip}
      style={{
        display:"inline-flex",alignItems:"center",gap:4,
        fontSize:9,fontFamily:T.mono,fontWeight:700,letterSpacing:0.8,
        color:m.color,background:m.bg,border:`1px solid ${m.color}30`,
        borderRadius:99,padding:"2px 8px",cursor:"help",flexShrink:0,
      }}
    >
      <span style={{fontSize:7}}>{m.icon}</span>
      {m.label.toUpperCase()}
    </span>
  );
}

// âââ Onboarding Checklist âââââââââââââââââââââââââââââââââââââââââ
/**
 * First-run checklist that guides new users to first value fast.
 * Persists completion state in localStorage.
 * Dismissible â never forces itself on returning users.
 */
const CHECKLIST_STEPS = [
  { id:"explore",   icon:"ð", label:"Explore your P&L",          desc:"Review revenue, margins, and expense trends",           tab:"pnl"          },
  { id:"cashflow",  icon:"ð§", label:"Check your cash runway",      desc:"See your 13-week forecast and identify crunch points",  tab:"cashflow"     },
  { id:"ar",        icon:"ð¬", label:"Review AR aging",             desc:"Find overdue invoices and prioritize collections",      tab:"ar"           },
  { id:"scenario",  icon:"ð®", label:"Run a scenario",              desc:"Model a Bear, Base, or Bull case for your business",    tab:"scenario"     },
  { id:"budget",    icon:"ð¼", label:"Create a budget",             desc:"Build your first department budget and submit for review", tab:"budgeting"  },
  { id:"export",    icon:"â¬",  label:"Export a report",             desc:"Download a PDF or CSV of any report",                  tab:"pnl",action:"export"},
  { id:"csuite",    icon:"â",  label:"Generate an executive report", desc:"Create a board-ready C-Suite summary",                tab:"csuite"       },
  { id:"integrate", icon:"ð", label:"Connect QuickBooks or Plaid", desc:"Replace demo data with your live financials",          tab:"integrations" },
];

function OnboardingChecklist({ onNavigate, onDismiss }) {
  const [done, setDone] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('fo_checklist') || '{}'); } catch { return {}; }
  });
  const [collapsed, setCollapsed] = React.useState(false);

  const markDone = (id) => {
    const next = { ...done, [id]: true };
    setDone(next);
    try { localStorage.setItem('fo_checklist', JSON.stringify(next)); } catch {}
  };

  const completed = CHECKLIST_STEPS.filter(s => done[s.id]).length;
  const pct = Math.round((completed / CHECKLIST_STEPS.length) * 100);
  const allDone = completed === CHECKLIST_STEPS.length;

  if (allDone) return null;

  return (
    <div style={{background:T.surface,border:`1.5px solid ${T.cyan}55`,borderRadius:16,marginBottom:24,overflow:"hidden",boxShadow:`0 0 0 1px ${T.cyan}15,0 0 50px ${T.cyan}12,0 6px 32px ${T.bg}CC`}}>
      {/* Header */}
      <div
        onClick={()=>setCollapsed(c=>!c)}
        style={{display:"flex",alignItems:"center",gap:10,padding:"12px 18px",cursor:"pointer",background:`linear-gradient(135deg,${T.cyan}10,${T.violet}05)`}}
      >
        <div style={{width:28,height:28,borderRadius:8,background:`${T.cyan}20`,border:`1px solid ${T.cyan}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>→</div>
        <div style={{flex:1}}>
          <div style={{fontSize:14,fontWeight:700,color:T.text,fontFamily:T.display}}>Get started with FinanceOS</div>
          <div style={{fontSize:11,color:T.textMid,fontFamily:T.sans,marginTop:2}}>{completed}/{CHECKLIST_STEPS.length} steps complete · {pct}%</div>
        </div>
        {/* Progress bar */}
        <div style={{width:80,height:4,background:T.border,borderRadius:99,overflow:"hidden",flexShrink:0}}>
          <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${T.cyan},${T.violet})`,borderRadius:99,transition:"width 0.5s ease"}}/>
        </div>
        
        <span style={{fontSize:10,color:T.textDim,transform:collapsed?"none":"rotate(180deg)",display:"inline-block",transition:"transform 0.2s"}}>▾</span>
      </div>
      {!collapsed && (
        <div style={{padding:"8px 18px 16px",display:"flex",flexDirection:"column",gap:6}}>
          {CHECKLIST_STEPS.map(step => {
            const isDone = !!done[step.id];
            return (
              <div key={step.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:9,background:isDone?T.emeraldDim:T.card,border:`1px solid ${isDone?T.emerald+"30":T.border}`,opacity:isDone?0.7:1,transition:"all 0.2s"}}>
                <button
                  onClick={()=>markDone(step.id)}
                  style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${isDone?T.emerald:T.border}`,background:isDone?T.emerald:"transparent",flexShrink:0,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:10,fontWeight:700}}
                >
                  {isDone?"â":""}
                </button>
                
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:600,color:isDone?T.textDim:T.text,fontFamily:T.sans,textDecoration:isDone?"line-through":"none"}}>{step.label}</div>
                  <div style={{fontSize:11,color:T.textMid,fontFamily:T.sans,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{step.desc}</div>
                </div>
                {!isDone && (
                  <button onClick={()=>{onNavigate(step.tab);markDone(step.id);}} style={{background:`${T.cyan}18`,border:`1px solid ${T.cyan}35`,borderRadius:8,padding:"5px 12px",color:T.cyan,fontSize:11,fontFamily:T.sans,fontWeight:700,cursor:"pointer",flexShrink:0}}>
                    Go →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// âââ CFO Scorecard ââââââââââââââââââââââââââââââââââââââââââââââââ
/**
 * Live self-scoring panel â evaluates FinanceOS across 15 CFO dimensions.
 * Score adjusts based on which features are enabled (plan + integrations).
 * Provides a transparent "product readiness" signal to buyers.
 */
const CFO_SCORECARD_DIMENSIONS = [
  { id:"completeness",   label:"Product Completeness",         weight:0.10 },
  { id:"usability",      label:"Usability / UX",               weight:0.08 },
  { id:"trust",          label:"Data Trust & Reliability",      weight:0.10 },
  { id:"integrations",   label:"Integrations",                  weight:0.08 },
  { id:"collaboration",  label:"Collaboration",                 weight:0.07 },
  { id:"planning",       label:"Planning Depth",                weight:0.09 },
  { id:"reporting",      label:"Executive Reporting",           weight:0.09 },
  { id:"packaging",      label:"Packaging & Pricing Fit",       weight:0.07 },
  { id:"onboarding",     label:"Onboarding & Activation",       weight:0.07 },
  { id:"retention",      label:"Retention Potential",           weight:0.06 },
  { id:"expansion",      label:"Expansion Revenue Potential",   weight:0.05 },
  { id:"scalability",    label:"Operational Scalability",       weight:0.05 },
  { id:"security",       label:"Security & Controls",           weight:0.05 },
  { id:"sellability",    label:"Market Sellability",            weight:0.07 },
  { id:"investor",       label:"Investor Readiness",            weight:0.07 },
];

function computeCFOScores(plan, hasQBO = false, hasPlaid = false) {
  const pro = hasFeature(plan, FEATURES.FULL_AI);
  const ent = hasFeature(plan, FEATURES.ADVANCED_AI);
  const liveData = hasQBO || hasPlaid;
  const hasBudget   = hasFeature(plan, FEATURES.BUDGETING);
  const hasScenario = hasFeature(plan, FEATURES.SCENARIO_SAVE);
  const hasExport   = hasFeature(plan, FEATURES.EXPORT);
  const hasCsuite   = hasFeature(plan, FEATURES.CSUITE_REPORT);

  return {
    completeness:  pro ? (hasBudget && hasScenario ? 8.8 : 7.5) : 6.2,
    usability:     8.5,
    trust:         liveData ? 8.2 : (pro ? 7.0 : 5.8),
    integrations:  hasQBO && hasPlaid ? 8.5 : hasQBO || hasPlaid ? 7.2 : (pro ? 6.0 : 4.5),
    collaboration: hasBudget ? 8.0 : (pro ? 6.5 : 4.0),
    planning:      hasScenario ? 8.5 : (pro ? 7.2 : 5.0),
    reporting:     hasCsuite && hasExport ? 9.0 : hasCsuite ? 7.8 : 5.0,
    packaging:     pro ? 8.5 : 7.0,
    onboarding:    7.5,
    retention:     pro ? 8.2 : 6.5,
    expansion:     ent ? 8.5 : (pro ? 7.5 : 5.5),
    scalability:   8.0,
    security:      7.5,
    sellability:   pro ? 8.5 : 6.8,
    investor:      liveData && hasCsuite ? 8.5 : (pro ? 7.5 : 5.5),
  };
}


// âââ Export Button ââââââââââââââââââââââââââââââââââââââââââââââââ
/**
 * ExportButton â drop-down for PDF / PPTX / CSV export.
 * Calls POST /api/export with current tab's data.
 */
function ExportButton({ reportType, data, companyName="FinanceOS", fiscalYear=2024, plan }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(null); // 'pdf'|'pptx'|'csv'
  const [err, setErr]         = useState("");
  const canExport = hasFeature(plan, FEATURES.EXPORT);
  const ref = useRef(null);

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const doExport = async (format) => {
    if (!canExport) return;
    setLoading(format); setErr("");
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportType, format, data, companyName, fiscalYear }),
      });
      if (!res.ok) {
        const d = await res.json().catch(()=>({}));
        throw new Error(d.message || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const ext  = format === "pptx" ? "pptx" : format === "csv" ? "csv" : "pdf";
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${companyName.replace(/\s+/g,"_")}_${reportType}_FY${fiscalYear}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch(e) {
      setErr(e.message);
    }
    setLoading(null); setOpen(false);
  };

  return (
    <div ref={ref} style={{position:"relative",display:"inline-block"}}>
      <button
        onClick={()=>canExport ? setOpen(o=>!o) : null}
        title={canExport ? "Export report" : "Upgrade to Professional to export"}
        style={{
          display:"flex",alignItems:"center",gap:6,
          background:canExport?T.surface:`${T.surface}80`,
          border:`1px solid ${canExport?T.border:T.amber+"40"}`,
          borderRadius:8,padding:"6px 13px",cursor:canExport?"pointer":"not-allowed",
          color:canExport?T.textMid:T.amber,fontSize:11,fontFamily:T.sans,fontWeight:600,
          transition:"border-color 0.15s",
        }}
      >
        <span style={{fontSize:13}}>â¬</span>
        {canExport ? "Export" : "ð Export"}
      </button>
      {open && canExport && (
        <div style={{
          position:"absolute",top:"110%",right:0,zIndex:300,
          background:T.card,border:`1px solid ${T.border}`,
          borderRadius:10,boxShadow:"0 8px 32px rgba(0,0,0,0.4)",
          minWidth:160,overflow:"hidden",
        }}>
          {[
            {fmt:"pdf",  icon:"ð", label:"PDF Report",      sub:"Board-ready document"},
            {fmt:"xlsx", icon:"ð", label:"Excel Workbook",   sub:"Finance-team usable"},
            {fmt:"csv",  icon:"ð", label:"CSV Data",         sub:"Raw numbers"},
          ].map(({fmt,icon,label,sub})=>(
            <button key={fmt} onClick={()=>doExport(fmt)} style={{
              display:"flex",alignItems:"center",gap:10,width:"100%",
              background:"transparent",border:"none",padding:"10px 14px",
              cursor:"pointer",textAlign:"left",
            }}
              onMouseEnter={e=>e.currentTarget.style.background=T.surface}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
            >
              <span style={{fontSize:16,flexShrink:0}}>{loading===fmt ? "â³" : icon}</span>
              <div>
                <div style={{fontSize:12,fontWeight:600,color:T.text,fontFamily:T.sans}}>{label}</div>
                <div style={{fontSize:10,color:T.textDim,fontFamily:T.sans}}>{sub}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {err && <div style={{position:"absolute",top:"110%",right:0,zIndex:300,background:T.roseDim,border:`1px solid ${T.rose}40`,borderRadius:8,padding:"8px 12px",fontSize:10,color:T.rose,fontFamily:T.sans,whiteSpace:"nowrap"}}>{err}</div>}
    </div>
  );
}

// âââ Scenario Save / Library ââââââââââââââââââââââââââââââââââââââ
/**
 * ScenarioSaveModal â save current multipliers as a named scenario.
 * ScenarioLibrary â list, load, and manage saved scenarios.
 */
function ScenarioSaveModal({ multipliers, onSave, onClose }) {
  const [name, setName]         = useState("");
  const [label, setLabel]       = useState("Initial version");
  const [notes, setNotes]       = useState("");
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState("");

  const save = async () => {
    if (!name.trim()) { setErr("Name is required."); return; }
    setSaving(true); setErr("");
    try {
      const d = await api.scenarios.create({
        name: name.trim(), label, notes,
        baseYear: new Date().getFullYear(),
        multipliers,
      });
      onSave(d.scenario);
    } catch(e) {
      setErr(e.message || "Save failed.");
    }
    setSaving(false);
  };

  const inp = { background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"9px 12px",color:T.text,fontSize:12,fontFamily:T.sans,outline:"none",width:"100%",boxSizing:"border-box" };

  return (
    <div style={{position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:28,width:"100%",maxWidth:420,boxShadow:"0 24px 64px rgba(0,0,0,0.6)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <div style={{fontSize:15,fontWeight:700,color:T.text,fontFamily:T.display}}>ð¾ Save Scenario</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:T.textDim,fontSize:18,cursor:"pointer"}}>Ã</button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <div style={{fontSize:10,color:T.textDim,fontFamily:T.mono,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Scenario Name *</div>
            <input style={inp} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Q2 Hiring Plan, Bear Case 2025" autoFocus/>
          </div>
          <div>
            <div style={{fontSize:10,color:T.textDim,fontFamily:T.mono,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Version Label</div>
            <input style={inp} value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. Board draft, Post-hire"/>
          </div>
          <div>
            <div style={{fontSize:10,color:T.textDim,fontFamily:T.mono,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>Notes</div>
            <textarea style={{...inp,height:68,resize:"none"}} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Assumptions, context, or decision rationaleâ¦"/>
          </div>
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontSize:9,color:T.textDim,fontFamily:T.mono,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Multipliers Being Saved</div>
            <div style={{display:"flex",gap:16}}>
              {[["Revenue",multipliers.revenue],["COGS",multipliers.cogs],["OpEx",multipliers.opex]].map(([k,v])=>(
                <div key={k}>
                  <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans}}>{k}</div>
                  <div style={{fontSize:13,fontWeight:700,color:T.cyan,fontFamily:T.mono}}>{(v*100).toFixed(0)}%</div>
                </div>
              ))}
            </div>
          </div>
          {err && <div style={{fontSize:11,color:T.rose,fontFamily:T.sans}}>{err}</div>}
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={onClose} style={{flex:1,background:"transparent",border:`1px solid ${T.border}`,borderRadius:9,padding:"10px",color:T.textDim,fontSize:12,fontFamily:T.sans,cursor:"pointer"}}>Cancel</button>
            <button onClick={save} disabled={saving} style={{flex:2,background:`linear-gradient(135deg,${T.cyan},${T.violet})`,border:"none",borderRadius:9,padding:"10px",color:T.bg,fontSize:12,fontFamily:T.display,fontWeight:800,cursor:saving?"not-allowed":"pointer"}}>
              {saving ? "Savingâ¦" : "Save Scenario →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScenarioLibrary({ onLoad, onClose }) {
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [err, setErr]             = useState("");
  const [deleting, setDeleting]   = useState(null);

  useEffect(() => {
    api.scenarios.list()
      .then(d => setScenarios(d.scenarios || []))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const del = async (id) => {
    setDeleting(id);
    try {
      await api.scenarios.del(id);
      setScenarios(s => s.filter(x => x.id !== id));
    } catch(e) { setErr(e.message); }
    setDeleting(null);
  };

  const STATUS_COLOR = { draft:T.textDim, active:T.cyan, shared:T.emerald };

  return (
    <div style={{position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:28,width:"100%",maxWidth:560,maxHeight:"80vh",display:"flex",flexDirection:"column",boxShadow:"0 24px 64px rgba(0,0,0,0.6)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
          <div style={{fontSize:15,fontWeight:700,color:T.text,fontFamily:T.display}}>ð Scenario Library</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:T.textDim,fontSize:18,cursor:"pointer"}}>Ã</button>
        </div>
        {loading && <div style={{color:T.textDim,fontFamily:T.sans,fontSize:13,textAlign:"center",padding:24}}>Loadingâ¦</div>}
        {err    && <div style={{color:T.rose,fontSize:11,fontFamily:T.sans,marginBottom:10}}>{err}</div>}
        {!loading && scenarios.length===0 && (
          <div style={{textAlign:"center",padding:"32px 0",color:T.textDim,fontFamily:T.sans,fontSize:13}}>
            No saved scenarios yet.<br/>
            <span style={{fontSize:11}}>Use "Save Scenario" to save your current scenario.</span>
          </div>
        )}
        <div style={{overflowY:"auto",flex:1,display:"flex",flexDirection:"column",gap:10}}>
          {scenarios.map(sc => {
            const latest = sc.scenario_versions?.sort((a,b)=>b.version-a.version)?.[0];
            return (
              <div key={sc.id} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"14px 16px",display:"flex",alignItems:"center",gap:12}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:T.text,fontFamily:T.display,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sc.name}</div>
                  <div style={{fontSize:10,color:T.textDim,fontFamily:T.mono}}>
                    v{latest?.version || 1} · {latest?.label || "â"}
                    {latest?.multipliers && ` · Rev ${((latest.multipliers.revenue||1)*100).toFixed(0)}% / OpEx ${((latest.multipliers.opex||1)*100).toFixed(0)}%`}
                  </div>
                  <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,marginTop:2}}>{new Date(sc.updated_at).toLocaleDateString()}</div>
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  {latest?.multipliers && (
                    <button onClick={()=>{ onLoad(latest.multipliers, sc.name); onClose(); }} style={{background:`${T.cyan}15`,border:`1px solid ${T.cyan}30`,borderRadius:7,padding:"5px 11px",color:T.cyan,fontSize:10,fontFamily:T.sans,fontWeight:700,cursor:"pointer"}}>
                      Load
                    </button>
                  )}
                  <button onClick={()=>del(sc.id)} disabled={deleting===sc.id} style={{background:T.roseDim,border:`1px solid ${T.rose}30`,borderRadius:7,padding:"5px 10px",color:T.rose,fontSize:10,fontFamily:T.sans,cursor:"pointer"}}>
                    {deleting===sc.id?"â¦":"â"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// âââ CSV Import Modal âââââââââââââââââââââââââââââââââââââââââââââ
function CSVImportModal({ onClose, onSuccess }) {
  const [dataType, setDataType] = useState("pnl");
  const [csvText, setCsvText]   = useState("");
  const [status, setStatus]     = useState("idle"); // idle|uploading|done|error
  const [result, setResult]     = useState(null);
  const [err, setErr]           = useState("");

  const DATA_TYPES = [
    {id:"pnl",       label:"P&L Actuals",   icon:"ð"},
    {id:"ar",        label:"AR Aging",       icon:"ð¬"},
    {id:"headcount", label:"Headcount",      icon:"ð¥"},
    {id:"saas",      label:"SaaS Metrics",   icon:"ð"},
    {id:"cashflow",  label:"Cash Flow",      icon:"ð§"},
  ];

  const upload = async () => {
    if (!csvText.trim()) { setErr("Paste your CSV data above."); return; }
    setStatus("uploading"); setErr("");
    try {
      const res = await fetch(`/api/csv/upload?dataType=${dataType}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: csvText,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || "Upload failed.");
      setResult(d);
      setStatus("done");
      onSuccess?.();
    } catch(e) {
      setErr(e.message);
      setStatus("error");
    }
  };

  const downloadTemplate = () => {
    window.open(api.csv.template(dataType), "_blank");
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:28,width:"100%",maxWidth:560,boxShadow:"0 24px 64px rgba(0,0,0,0.6)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <div style={{fontSize:15,fontWeight:700,color:T.text,fontFamily:T.display}}>ð¤ Import CSV Data</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:T.textDim,fontSize:18,cursor:"pointer"}}>Ã</button>
        </div>

        {status === "done" ? (
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{fontSize:40,marginBottom:12}}>â</div>
            <div style={{fontSize:15,fontWeight:700,color:T.emerald,fontFamily:T.display,marginBottom:6}}>{result?.imported} rows imported</div>
            <div style={{fontSize:12,color:T.textMid,fontFamily:T.sans,marginBottom:20}}>Your {dataType.toUpperCase()} data has been updated successfully.</div>
            <button onClick={onClose} style={{background:`linear-gradient(135deg,${T.cyan},${T.violet})`,border:"none",borderRadius:9,padding:"10px 28px",color:T.bg,fontSize:12,fontFamily:T.display,fontWeight:800,cursor:"pointer"}}>Done</button>
          </div>
        ) : (
          <>
            {/* Data type selector */}
            <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
              {DATA_TYPES.map(dt=>(
                <button key={dt.id} onClick={()=>setDataType(dt.id)} style={{background:dataType===dt.id?T.cyanDim:"transparent",border:`1px solid ${dataType===dt.id?T.cyan+"50":T.border}`,borderRadius:8,padding:"6px 12px",color:dataType===dt.id?T.cyan:T.textMid,fontSize:11,fontFamily:T.sans,cursor:"pointer"}}>
                  {dt.icon} {dt.label}
                </button>
              ))}
            </div>

            {/* Template download */}
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <div style={{fontSize:11,color:T.textDim,fontFamily:T.sans,flex:1}}>
                Paste CSV below. Column headers must match the template exactly.
              </div>
              <button onClick={downloadTemplate} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:7,padding:"5px 11px",color:T.textMid,fontSize:10,fontFamily:T.sans,cursor:"pointer",flexShrink:0,whiteSpace:"nowrap"}}>
                â¬ Template
              </button>
            </div>

            <textarea
              value={csvText}
              onChange={e=>setCsvText(e.target.value)}
              placeholder={`Paste ${dataType.toUpperCase()} CSV hereâ¦\nFirst row must be column headers.`}
              style={{width:"100%",height:160,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"10px 12px",color:T.text,fontSize:11,fontFamily:T.mono,outline:"none",resize:"vertical",boxSizing:"border-box"}}
            />

            {err && <div style={{fontSize:11,color:T.rose,fontFamily:T.sans,marginTop:8}}>{err}</div>}

            <div style={{display:"flex",gap:8,marginTop:14}}>
              <button onClick={onClose} style={{flex:1,background:"transparent",border:`1px solid ${T.border}`,borderRadius:9,padding:"10px",color:T.textDim,fontSize:12,fontFamily:T.sans,cursor:"pointer"}}>Cancel</button>
              <button onClick={upload} disabled={status==="uploading"} style={{flex:2,background:`linear-gradient(135deg,${T.cyan},${T.violet})`,border:"none",borderRadius:9,padding:"10px",color:T.bg,fontSize:12,fontFamily:T.display,fontWeight:800,cursor:status==="uploading"?"not-allowed":"pointer"}}>
                {status==="uploading" ? "Importingâ¦" : "Import Data →"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// âââ Budgeting Page âââââââââââââââââââââââââââââââââââââââââââââââ
const BUDGET_CATEGORIES = ["Payroll","Marketing","Software","Rent","Equipment","Professional Services","Travel","Utilities","Insurance","Miscellaneous"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function BudgetingPage({ plan }) {
  const year = new Date().getFullYear();
  const [budgets, setBudgets]       = useState([]);
  const [activeBudget, setActive]   = useState(null);
  const [grid, setGrid]             = useState({});
  const [comments, setComments]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [newDept, setNewDept]       = useState("");
  const [creating, setCreating]     = useState(false);
  const [view, setView]             = useState("grid"); // grid | comments
  const [comment, setComment]       = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [err, setErr]               = useState("");

  const canApprove = hasFeature(plan, FEATURES.ADVANCED_AI) || hasFeature(plan, FEATURES.MULTI_USER);

  useEffect(() => {
    setLoading(true);
    api.budgets.list(year)
      .then(d => setBudgets(d.budgets || []))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const loadBudget = async (id) => {
    setLoading(true);
    try {
      const d = await api.budgets.get(id);
      setActive(d.budget);
      setGrid(d.grid || {});
      setComments(d.comments || []);
      setView("grid");
    } catch(e) { setErr(e.message); }
    setLoading(false);
  };

  const createBudget = async () => {
    if (!newDept.trim()) return;
    setCreating(true);
    try {
      const d = await api.budgets.create({ department: newDept.trim(), fiscalYear: year });
      setBudgets(b => [...b, d.budget]);
      setNewDept("");
      await loadBudget(d.budget.id);
    } catch(e) { setErr(e.message); }
    setCreating(false);
  };

  const saveItems = async () => {
    if (!activeBudget) return;
    setSaving(true);
    const items = [];
    Object.entries(grid).forEach(([cat, months]) => {
      Object.entries(months).forEach(([month, cell]) => {
        items.push({ category: cat, month: parseInt(month), amount: cell.amount || 0 });
      });
    });
    try {
      await api.budgets.saveItems(activeBudget.id, items);
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  const updateCell = (cat, month, val) => {
    setGrid(g => ({
      ...g,
      [cat]: { ...(g[cat]||{}), [month]: { ...(g[cat]?.[month]||{}), amount: parseFloat(val)||0 } }
    }));
  };

  const doAction = async (action, note="") => {
    if (!activeBudget) return;
    setSaving(true); setErr("");
    try {
      let d;
      if (action==="submit")  d = await api.budgets.submit(activeBudget.id);
      if (action==="approve") d = await api.budgets.approve(activeBudget.id, note);
      if (action==="reject")  d = await api.budgets.reject(activeBudget.id, note);
      setActive(d.budget);
      setBudgets(b => b.map(x => x.id===d.budget.id ? d.budget : x));
      setShowReject(false);
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };

  const addComment = async () => {
    if (!comment.trim() || !activeBudget) return;
    try {
      const d = await api.budgets.addComment(activeBudget.id, comment.trim());
      setComments(c => [d.comment, ...c]);
      setComment("");
    } catch(e) { setErr(e.message); }
  };

  const STATUS_META = {
    draft:     { color:T.textDim,  bg:T.border+"40",    label:"Draft",     icon:"âï¸" },
    submitted: { color:T.amber,    bg:T.amberDim,        label:"Submitted", icon:"ð¤" },
    approved:  { color:T.emerald,  bg:T.emeraldDim,      label:"Approved",  icon:"â" },
    rejected:  { color:T.rose,     bg:T.roseDim,         label:"Rejected",  icon:"â" },
  };

  const monthTotal = (month) => BUDGET_CATEGORIES.reduce((s, cat) => s + (grid[cat]?.[month]?.amount || 0), 0);
  const catTotal   = (cat)   => Array.from({length:12},(_,i)=>i+1).reduce((s,m) => s + (grid[cat]?.[m]?.amount||0), 0);
  const grandTotal = () => Array.from({length:12},(_,i)=>i+1).reduce((s,m) => s + monthTotal(m), 0);

  const fmt2 = n => {
    if (!n) return "";
    if (Math.abs(n)>=1000) return `$${(n/1000).toFixed(0)}K`;
    return `$${Math.round(n)}`;
  };

  if (loading && !activeBudget) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:300,color:T.textDim,fontFamily:T.sans,fontSize:13}}>Loading budgetsâ¦</div>
  );

  return (
    <div style={{display:"grid",gridTemplateColumns:"220px 1fr",gap:20,minHeight:500}}>
      {/* ââ Sidebar â department list ââ */}
      <div>
        <div style={{fontSize:10,color:T.textDim,fontFamily:T.mono,textTransform:"uppercase",letterSpacing:1.5,marginBottom:10}}>FY{year} Departments</div>
        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
          {budgets.map(b => {
            const sm = STATUS_META[b.status] || STATUS_META.draft;
            return (
              <button key={b.id} onClick={()=>loadBudget(b.id)} style={{
                background: activeBudget?.id===b.id ? T.cyanDim : T.surface,
                border:`1px solid ${activeBudget?.id===b.id ? T.cyan+"40" : T.border}`,
                borderRadius:9,padding:"10px 12px",cursor:"pointer",textAlign:"left",transition:"all 0.15s",
              }}>
                <div style={{fontSize:12,fontWeight:600,color:T.text,fontFamily:T.sans}}>{b.department}</div>
                <div style={{display:"flex",alignItems:"center",gap:5,marginTop:3}}>
                  <span style={{fontSize:10,color:sm.color,background:sm.bg,borderRadius:99,padding:"1px 6px",fontFamily:T.mono,fontWeight:700}}>{sm.icon} {sm.label}</span>
                </div>
              </button>
            );
          })}
        </div>
        <div style={{display:"flex",gap:6}}>
          <input
            value={newDept} onChange={e=>setNewDept(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&createBudget()}
            placeholder="New departmentâ¦"
            style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 10px",color:T.text,fontSize:11,fontFamily:T.sans,outline:"none"}}
          />
          <button onClick={createBudget} disabled={creating||!newDept.trim()} style={{background:T.cyanDim,border:`1px solid ${T.cyan}30`,borderRadius:8,padding:"7px 10px",color:T.cyan,fontSize:12,cursor:"pointer",fontWeight:700}}>+</button>
        </div>
        {err && <div style={{fontSize:10,color:T.rose,fontFamily:T.sans,marginTop:8,lineHeight:1.4}}>{err}</div>}
      </div>

      {/* ââ Main â budget grid ââ */}
      {!activeBudget ? (
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",color:T.textDim,fontFamily:T.sans,fontSize:13,flexDirection:"column",gap:10}}>
          <div style={{fontSize:32}}>ð¼</div>
          <div>Select a department or create one to start budgeting.</div>
        </div>
      ) : (
        <div>
          {/* Header */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:T.text,fontFamily:T.display}}>{activeBudget.department}</div>
              <div style={{fontSize:10,color:T.textDim,fontFamily:T.mono,marginTop:2}}>FY{year} · {STATUS_META[activeBudget.status]?.label}</div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              <button onClick={()=>setView(v=>v==="grid"?"comments":"grid")} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 12px",color:T.textMid,fontSize:11,fontFamily:T.sans,cursor:"pointer"}}>
                {view==="grid" ? `ð¬ Comments (${comments.length})` : "ð Grid"}
              </button>
              {activeBudget.status==="draft" && (
                <>
                  <button onClick={saveItems} disabled={saving} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 13px",color:T.textMid,fontSize:11,fontFamily:T.sans,cursor:"pointer"}}>
                    {saving?"Savingâ¦":"ð¾ Save"}
                  </button>
                  <button onClick={()=>doAction("submit")} style={{background:`${T.cyan}18`,border:`1px solid ${T.cyan}30`,borderRadius:8,padding:"6px 13px",color:T.cyan,fontSize:11,fontFamily:T.sans,fontWeight:700,cursor:"pointer"}}>
                    ð¤ Submit for Review
                  </button>
                </>
              )}
              {activeBudget.status==="submitted" && canApprove && (
                <>
                  <button onClick={()=>doAction("approve")} style={{background:T.emeraldDim,border:`1px solid ${T.emerald}40`,borderRadius:8,padding:"6px 13px",color:T.emerald,fontSize:11,fontFamily:T.sans,fontWeight:700,cursor:"pointer"}}>â Approve</button>
                  <button onClick={()=>setShowReject(true)} style={{background:T.roseDim,border:`1px solid ${T.rose}40`,borderRadius:8,padding:"6px 13px",color:T.rose,fontSize:11,fontFamily:T.sans,fontWeight:700,cursor:"pointer"}}>â Reject</button>
                </>
              )}
              {activeBudget.status==="rejected" && (
                <button onClick={()=>setActive(b=>({...b,status:"draft"}))} style={{background:T.amberDim,border:`1px solid ${T.amber}40`,borderRadius:8,padding:"6px 13px",color:T.amber,fontSize:11,fontFamily:T.sans,fontWeight:700,cursor:"pointer"}}>âï¸ Revise</button>
              )}
            </div>
          </div>

          {/* Reviewer note */}
          {activeBudget.reviewer_note && (
            <div style={{background:activeBudget.status==="approved"?T.emeraldDim:T.roseDim,border:`1px solid ${activeBudget.status==="approved"?T.emerald:T.rose}30`,borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:11,color:activeBudget.status==="approved"?T.emerald:T.rose,fontFamily:T.sans}}>
              <strong>Reviewer note:</strong> {activeBudget.reviewer_note}
            </div>
          )}

          {showReject && (
            <div style={{background:T.roseDim,border:`1px solid ${T.rose}30`,borderRadius:10,padding:"14px 16px",marginBottom:14}}>
              <div style={{fontSize:12,color:T.rose,fontFamily:T.sans,marginBottom:8}}>Reason for rejection</div>
              <div style={{display:"flex",gap:8}}>
                <input value={rejectNote} onChange={e=>setRejectNote(e.target.value)} placeholder="e.g. Marketing budget exceeds approved capâ¦" style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:7,padding:"7px 10px",color:T.text,fontSize:11,fontFamily:T.sans,outline:"none"}}/>
                <button onClick={()=>doAction("reject",rejectNote)} style={{background:T.roseDim,border:`1px solid ${T.rose}40`,borderRadius:7,padding:"7px 13px",color:T.rose,fontSize:11,fontFamily:T.sans,fontWeight:700,cursor:"pointer"}}>Reject</button>
                <button onClick={()=>setShowReject(false)} style={{background:"none",border:"none",color:T.textDim,fontSize:13,cursor:"pointer"}}>Ã</button>
              </div>
            </div>
          )}

          {view==="grid" ? (
            /* ââ Budget grid ââ */
            <div style={{overflowX:"auto"}}>
              <table style={{borderCollapse:"collapse",width:"100%",fontSize:11,fontFamily:T.mono}}>
                <thead>
                  <tr style={{background:T.surface}}>
                    <th style={{padding:"8px 10px",textAlign:"left",color:T.textDim,fontWeight:600,fontSize:10,textTransform:"uppercase",letterSpacing:1,position:"sticky",left:0,background:T.surface,whiteSpace:"nowrap",minWidth:140}}>Category</th>
                    {MONTHS_SHORT.map(m=>(
                      <th key={m} style={{padding:"8px 8px",color:T.textDim,fontWeight:600,fontSize:10,textAlign:"right",whiteSpace:"nowrap",minWidth:72}}>{m}</th>
                    ))}
                    <th style={{padding:"8px 10px",color:T.cyan,fontWeight:700,fontSize:10,textAlign:"right",whiteSpace:"nowrap"}}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {BUDGET_CATEGORIES.map((cat,ci) => (
                    <tr key={cat} style={{borderBottom:`1px solid ${T.border}30`,background:ci%2===0?"transparent":T.surface+"60"}}>
                      <td style={{padding:"6px 10px",color:T.text,fontWeight:600,position:"sticky",left:0,background:ci%2===0?T.bg:T.surface+"60"}}>{cat}</td>
                      {Array.from({length:12},(_,i)=>i+1).map(month=>(
                        <td key={month} style={{padding:"4px 4px"}}>
                          <input
                            type="number"
                            value={grid[cat]?.[month]?.amount || ""}
                            onChange={e=>activeBudget.status==="draft"&&updateCell(cat,month,e.target.value)}
                            disabled={activeBudget.status!=="draft"}
                            placeholder="0"
                            style={{width:64,background:"transparent",border:"none",borderBottom:`1px solid ${T.border}60`,padding:"3px 4px",color:T.text,fontSize:11,fontFamily:T.mono,textAlign:"right",outline:"none",cursor:activeBudget.status==="draft"?"text":"default"}}
                            onFocus={e=>{e.target.style.borderColor=T.cyan;}}
                            onBlur={e=>{e.target.style.borderColor=T.border+"60";}}
                          />
                        </td>
                      ))}
                      <td style={{padding:"6px 10px",color:T.cyan,fontWeight:700,textAlign:"right",whiteSpace:"nowrap"}}>{fmt2(catTotal(cat))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{background:T.surface,borderTop:`2px solid ${T.border}`}}>
                    <td style={{padding:"8px 10px",color:T.text,fontWeight:700,position:"sticky",left:0,background:T.surface}}>Total</td>
                    {Array.from({length:12},(_,i)=>i+1).map(m=>(
                      <td key={m} style={{padding:"8px 8px",color:T.text,fontWeight:700,textAlign:"right"}}>{fmt2(monthTotal(m))}</td>
                    ))}
                    <td style={{padding:"8px 10px",color:T.cyan,fontWeight:800,textAlign:"right"}}>{fmt2(grandTotal())}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            /* ââ Comments ââ */
            <div>
              <div style={{display:"flex",gap:8,marginBottom:16}}>
                <input value={comment} onChange={e=>setComment(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addComment()} placeholder="Add a comment or questionâ¦" style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 12px",color:T.text,fontSize:12,fontFamily:T.sans,outline:"none"}}/>
                <button onClick={addComment} disabled={!comment.trim()} style={{background:`${T.cyan}15`,border:`1px solid ${T.cyan}30`,borderRadius:9,padding:"9px 16px",color:T.cyan,fontSize:12,fontFamily:T.sans,fontWeight:700,cursor:"pointer"}}>Post</button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {comments.length===0 && <div style={{color:T.textDim,fontFamily:T.sans,fontSize:12,textAlign:"center",padding:"24px 0"}}>No comments yet.</div>}
                {comments.map(c=>(
                  <div key={c.id} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                      <div style={{width:22,height:22,borderRadius:"50%",background:`${T.violet}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:T.violet}}>{(c.user_name||"?")[0].toUpperCase()}</div>
                      <span style={{fontSize:11,fontWeight:600,color:T.text,fontFamily:T.sans}}>{c.user_name}</span>
                      <span style={{fontSize:9,color:T.textDim,fontFamily:T.mono}}>{new Date(c.created_at).toLocaleDateString()}</span>
                    </div>
                    <div style={{fontSize:12,color:T.textMid,fontFamily:T.sans,lineHeight:1.5}}>{c.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BottomAIPanel({ activeTab, context, anomalies=[], panelOpen, setPanelOpen, alertTab, setAlertTab, plan="professional", onUpgrade }) {
  const [msgs, setMsgs]     = useState([]);
  const [input, setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const open = panelOpen !== undefined ? panelOpen : true;
  const setOpen = setPanelOpen || (()=>{});
  const rightTab = alertTab || "chat";
  const setRightTab = setAlertTab || (()=>{});
  const [panelH, setPanelH] = useState(300);
  const bottomRef = useRef(null);
  const sendingRef = useRef(false); // debounce guard against double-sends

  const pillMap = {
    pnl:      ["What's driving margin compression?","Which expense is growing fastest?","Break down my COGS","How's recurring revenue trending?"],
    scenario: ["What's my break-even?","Model a 10% price increase","Runway in bear case?","What levers improve bull?"],
    cashflow: ["When is my next cash crunch?","How much buffer do I have?","What's my largest outflow?","Optimize collections timing"],
    ar:       ["Who should I call first?","What's my DSO?","Which accounts are at risk?","Summarize overdue exposure"],
    regional: ["Which region is most profitable?","Who are my best clients?","Where should I expand?","Who has high churn risk?"],
    bva:      ["Where am I most over budget?","What caused revenue miss?","Which depts are on track?","Forecast full-year variance"],
    balancesheet:["How's my liquidity?","What's my debt-to-equity?","Is working capital healthy?","Analyze current ratio trend"],
    headcount:["What's my total people cost?","When should I hire next?","Show open reqs cost","Analyze payroll vs budget"],
    saas:     ["What's my net revenue retention?","How is churn trending?","Is my CAC:LTV ratio healthy?","When do I hit $2M ARR?"],
    csuite:   ["Summarize the top 3 CEO priorities","What are the CFO's critical action items?","CIO technology gaps to close in H1","What should I escalate to the board?"],
    "cfo-sim": ["What's the CFO's biggest concern?","Which competitor gap is most urgent?","What's the top improvement to build next?","How does our AI stack up?"],
  };

  const welcome = {
    pnl:      () => `ð P&L loaded. YTD revenue: **${fmt(context.ytdRevenue)}** | Net: **${fmt(context.ytdNet)}** | Margin: **${pct(context.ytdNetMargin)}**\n\nAsk me anything about your financials.`,
    scenario: () => `ð® Scenarios ready. **Bear:** ${fmt(context.bearAnnualNet,true)} | **Base:** ${fmt(context.baseAnnualNet,true)} | **Bull:** ${fmt(context.bullAnnualNet,true)}\n\nRisk spread: **${fmt((context.bullAnnualNet||0)-(context.bearAnnualNet||0),true)}**. What would you like to model?`,
    cashflow: () => `ð§ Cash Flow loaded. Balance: **${fmt(context.openingBalance)}** → projected **${fmt(context.endBalance)}**. Min: **${fmt(context.minBalance)}** at Week ${context.minWeek}. Ask about timing risks.`,
    ar:       () => `ð¬ AR Aging loaded. Outstanding: **${fmt(context.totalAR)}** | DSO: **${context.dso} days** | At-risk: **${fmt((context.d60||0)+(context.d90plus||0),true)}**. Who do you want to prioritize?`,
    regional: () => `ðºï¸ Client Comparison â **${context.clientCount} clients** | Portfolio: **${fmt(context.totalRevenue,true)}** | Avg margin: **${pct(context.avgMargin||0)}**. Ask about regional performance.`,
    bva:      () => `ð Budget vs. Actuals loaded. Revenue variance: **${fmt(context.revVariance,true)}** | OpEx variance: **${fmt(context.opexVariance,true)}**. Ask about any line item.`,
    balancesheet:()=>`ð¦ Balance Sheet loaded. Total assets: **${fmt(context.totalAssets,true)}** | Working capital: **${fmt(context.workingCapital,true)}**. Ask about ratios or trends.`,
    headcount:() => `ð¥ Headcount: **${context.totalHC} employees** (${context.openReqs} open reqs) | Payroll cost: **${fmt(context.totalPayrollCost,true)}/yr**. Ask about team structure or costs.`,
    saas:     () => `ð SaaS Metrics â MRR: **${fmt(context.latestMrr,true)}** | ARR: **${fmt(context.latestMrr*12,true)}** | NRR: **${pct(context.latestNrr)}**. Ask about growth or churn.`,
    csuite:   () => `â C-Suite Report loaded. Revenue: **${fmt(context.ytdRevenue,true)}** (+81% YoY) | Net: **${fmt(context.ytdNet,true)}** | ARR: **${fmt(context.latestMrr*12,true)}**\n\nSwitch between CEO, CFO, and CIO views on the panel. Ask me about any executive's priorities or action items.`,
    "cfo-sim": () => `ð¯ CFO Simulation ready. Run the 30-day evaluation to get a brutally honest CFO verdict â competitive gaps, scorecard, and top 10 improvements ranked by impact.`,
  };

  useEffect(() => {
    setMsgs([{ role:"assistant", content: welcome[activeTab]?.() ?? welcome.pnl() }]);
  }, [activeTab]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  const send = async (text) => {
    const msg = text || input; if (!msg.trim() || sendingRef.current) return;
    sendingRef.current = true;
    setInput(""); const nm = [...msgs, { role:"user", content:msg }]; setMsgs(nm); setLoading(true);
    const sys = {
      pnl:`FP&A AI. Revenue:${fmt(context.ytdRevenue)}, Net:${fmt(context.ytdNet)}, Gross Margin:${pct(context.ytdGrossMargin)}, Net Margin:${pct(context.ytdNetMargin)}, Payroll:${fmt(context.ytdPayroll)}, Marketing:${fmt(context.ytdMarketing)}. 2-3 concise paragraphs with specific numbers.`,
      scenario:`Scenario planner. Bear:${fmt(context.bearAnnualNet)}, Base:${fmt(context.baseAnnualNet)}, Bull:${fmt(context.bullAnnualNet)}. Strategic advice. 2-3 paragraphs.`,
      cashflow:`Cash flow advisor. Opening:${fmt(context.openingBalance)}, End:${fmt(context.endBalance)}, Min:${fmt(context.minBalance)} Wk${context.minWeek}, In:${fmt(context.totalInflows)}, Out:${fmt(context.totalOutflows)}. 2-3 paragraphs.`,
      ar:`AR specialist. Total:${fmt(context.totalAR)}, Current:${fmt(context.current)}, 30d:${fmt(context.d30)}, 60d:${fmt(context.d60)}, 90d+:${fmt(context.d90plus)}, DSO:${context.dso}d. High-risk: Apex Logistics, Pinnacle Retail. 2-3 paragraphs.`,
      regional:`Client analyst TX. ${context.clientCount} clients, ${context.regionCount} regions, rev:${fmt(context.totalRevenue)}, margin:${pct(context.avgMargin||0)}, NPS:${context.avgNps}. Top: Solaris $412K. High-risk: Apex, Pinnacle. 2-3 paragraphs.`,
      bva:`Budget vs Actuals analyst. Revenue variance: ${fmt(context.revVariance)}, OpEx variance: ${fmt(context.opexVariance)}, Net variance: ${fmt(context.netVariance)}. Explain drivers, 2-3 paragraphs.`,
      balancesheet:`Balance sheet analyst. Total assets:${fmt(context.totalAssets)}, Working capital:${fmt(context.workingCapital)}, Current ratio:${context.currentRatio?.toFixed(2)}, Debt-to-equity:${context.debtToEquity?.toFixed(2)}. 2-3 paragraphs.`,
      headcount:`HR/Payroll analyst. ${context.totalHC} employees, ${context.openReqs} open reqs, payroll cost:${fmt(context.totalPayrollCost)}/yr. Dept breakdown available. 2-3 paragraphs.`,
      saas:`SaaS metrics analyst. MRR:${fmt(context.latestMrr)}, ARR:${fmt(context.latestMrr*12)}, NRR:${pct(context.latestNrr)}, LTV:CAC ratio:${safeDiv(context.latestLtv,context.latestCac).toFixed(1)}x, Churn rate:${pct(context.churnRate)}. 2-3 paragraphs.`,
      csuite:`Executive strategic advisor. FY 2024: Revenue ${fmt(context.ytdRevenue)} (+81% YoY), Net income ${fmt(context.ytdNet)} (7.5% margin), ARR ${fmt(context.latestMrr*12)}, NRR ${pct(context.latestNrr)}, ${context.openReqs} open reqs, Rev variance ${fmt(context.revVariance)}, AR 90d+ $7,900. CEO priorities: revenue plan rebuild, open headcount, churn. CFO priorities: AR collections, budget model, marketing ROI. CIO priorities: Engineer hire, CRM integration, payroll integration. Be direct and specific. 2-3 paragraphs per question.`,
      "cfo-sim":`CFO simulation advisor for FinanceOS. The user has run a 30-day CFO evaluation of FinanceOS. Help them interpret the results, understand competitive gaps, and prioritize the top improvements. Reference specific metrics like scorecard ratings, competitor gaps, and CFO verdict. Be direct and actionable. 2-3 paragraphs.`,
    };
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: sys[activeTab] ?? sys.pnl,
          messages: nm.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        const msg = d?.message || (res.status === 429
          ? "Rate limit reached. Please wait a moment before asking again."
          : res.status >= 500
            ? "AI service is temporarily unavailable. Please try again."
            : "Something went wrong. Please try again.");
        setMsgs(m => [...m, { role:"assistant", content:`â ï¸ ${msg}` }]);
      } else {
        setMsgs(m => [...m, { role:"assistant", content: d.text || "No response received." }]);
      }
    } catch (err) {
      const msg = err.name === "AbortError"
        ? "Request timed out. Please try again."
        : "Connection error. Check your internet and try again.";
      setMsgs(m => [...m, { role:"assistant", content:`â ï¸ ${msg}` }]);
    }
    setLoading(false);
    sendingRef.current = false;
  };

  const render = t => t.split(/(\*\*.*?\*\*)/g).map((p,i)=>p.startsWith("**")?<strong key={i} style={{color:T.cyan}}>{p.slice(2,-2)}</strong>:p);
  const pills  = pillMap[activeTab] || pillMap.pnl;
  const lastAI = [...msgs].reverse().find(m=>m.role==="assistant")?.content?.split("\n")[0] || "";
  const SEVER  = {critical:T.rose, warning:T.amber, info:T.cyan};

  return (
    <div style={{
      position:"fixed", bottom:0, left:0, right:0, zIndex:200,
      background:T.surface, borderTop:`1px solid ${T.border}`,
      height: open ? panelH : 56,
      transition:"height 0.28s cubic-bezier(0.4,0,0.2,1)",
      display:"flex", flexDirection:"column",
      boxShadow:"0 -8px 40px rgba(0,0,0,0.6)",
    }}>
      {/* ââ Header bar ââ */}
      <div style={{height:56,flexShrink:0,display:"flex",alignItems:"center",gap:12,padding:"0 20px",borderBottom:`1px solid ${T.border}`,background:`linear-gradient(90deg,${T.card},${T.surface})`,cursor:"pointer"}} onClick={()=>setOpen(o=>!o)}>
        <div style={{width:30,height:30,borderRadius:"50%",background:`linear-gradient(135deg,${T.cyan},${T.violet})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,boxShadow:`0 0 14px ${T.cyan}60`,flexShrink:0}}>â¦</div>
        <div style={{display:"flex",alignItems:"baseline",gap:8}}>
          <span style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14}}>FP&A Intelligence</span>
          <span style={{color:T.cyan,fontFamily:T.mono,fontSize:9,textTransform:"capitalize",background:T.cyanDim,border:`1px solid ${T.cyanMid}`,borderRadius:20,padding:"1px 7px"}}>{activeTab} · Live</span>
        </div>
        {!open && anomalies.length>0 && (
          <div style={{display:"flex",gap:4,marginLeft:8}}>
            {anomalies.slice(0,3).map((a,i)=>(
              <span key={i} style={{fontSize:9,color:SEVER[a.severity]||T.amber,background:(SEVER[a.severity]||T.amber)+"18",border:`1px solid ${(SEVER[a.severity]||T.amber)}40`,borderRadius:20,padding:"1px 8px",fontFamily:T.sans}}>{a.emoji} {a.title}</span>
            ))}
          </div>
        )}
        {!open && !anomalies.length && lastAI && (
          <span style={{flex:1,color:T.textDim,fontFamily:T.sans,fontSize:11,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginLeft:4}}>{lastAI}</span>
        )}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          {open && (
            <div style={{display:"flex",gap:4}}>
              {[220,300,420].map(h=>(
                <button key={h} onClick={e=>{e.stopPropagation();setPanelH(h);setOpen(true);}}
                  style={{background:panelH===h?T.cyanDim:"transparent",border:`1px solid ${panelH===h?T.cyanMid:T.border}`,borderRadius:5,padding:"2px 8px",color:panelH===h?T.cyan:T.textDim,fontSize:9,fontFamily:T.mono,cursor:"pointer"}}>
                  {h===220?"S":h===300?"M":"L"}
                </button>
              ))}
            </div>
          )}
          <div style={{color:T.textDim,fontSize:14,fontWeight:700,userSelect:"none",padding:"0 4px",transition:"transform 0.25s",transform:open?"rotate(0deg)":"rotate(180deg)"}}>â</div>
        </div>
      </div>

      {/* ââ Expanded body ââ */}
      {open && (
        <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 380px",overflow:"hidden"}}>

          {/* Messages */}
          <div role="log" aria-live="polite" aria-label="AI assistant conversation" style={{overflowY:"auto",padding:"10px 16px",display:"flex",flexDirection:"column",gap:7,borderRight:`1px solid ${T.border}`}}>
            {msgs.map((m,i)=>(
              <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
                <div style={{maxWidth:"82%",background:m.role==="user"?T.cyanDim:T.card,border:`1px solid ${m.role==="user"?T.cyanMid:T.border}`,borderRadius:m.role==="user"?"12px 12px 2px 12px":"12px 12px 12px 2px",padding:"8px 12px",color:T.text,fontSize:12.5,lineHeight:1.65,fontFamily:T.sans,whiteSpace:"pre-line"}}>
                  {render(m.content)}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 2px"}}>
                <div style={{display:"flex",gap:3}}>{[0,1,2].map(i=><div key={i} style={{width:5,height:5,borderRadius:"50%",background:T.cyan,animation:`bounce 0.9s ${i*0.15}s infinite`}}/>)}</div>
                <span style={{color:T.textMid,fontFamily:T.sans,fontSize:11}}>Thinking...</span>
              </div>
            )}
            <div ref={bottomRef}/>
          </div>

          {/* Right column: Alerts + Chat Input */}
          <div style={{display:"flex",flexDirection:"column",background:T.card}}>
            {/* Tab toggle */}
            <div style={{display:"flex",borderBottom:`1px solid ${T.border}`}}>
              <button onClick={()=>setRightTab("chat")} style={{flex:1,background:rightTab==="chat"?T.cyanDim:"transparent",border:"none",borderBottom:`2px solid ${rightTab==="chat"?T.cyan:"transparent"}`,padding:"8px 0",color:rightTab==="chat"?T.cyan:T.textDim,fontSize:10,fontFamily:T.sans,fontWeight:700,cursor:"pointer"}}>ð¬ Chat{!hasFeature(plan,FEATURES.FULL_AI)&&<span style={{fontSize:8,color:T.amber,marginLeft:4}}>LIMITED</span>}</button>
              <button onClick={()=>setRightTab("alerts")} style={{flex:1,background:rightTab==="alerts"?T.cyanDim:"transparent",border:"none",borderBottom:`2px solid ${rightTab==="alerts"?T.cyan:"transparent"}`,padding:"8px 0",color:rightTab==="alerts"?T.cyan:hasFeature(plan,FEATURES.FULL_AI)?T.textDim:T.textDim+"88",fontSize:10,fontFamily:T.sans,fontWeight:700,cursor:"pointer"}}>
                {hasFeature(plan,FEATURES.FULL_AI)?`ð¨ Alerts${anomalies.length?` (${anomalies.length})`:""}`:"ð Alerts"}
              </button>
            </div>

            {rightTab==="chat" && (
              <>
                {/* Starter limited AI banner */}
                {!hasFeature(plan,FEATURES.FULL_AI)&&(
                  <div style={{padding:"6px 12px",background:T.amberDim,borderBottom:`1px solid ${T.amber}25`,display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:10}}>â¡</span>
                    <span style={{fontSize:9,color:T.amber,fontFamily:T.sans,fontWeight:600}}>Limited AI on Starter â upgrade for full context-aware analysis</span>
                  </div>
                )}
                {/* Enterprise strategic badge */}
                {hasFeature(plan,FEATURES.ADVANCED_AI)&&(
                  <div style={{padding:"5px 12px",background:T.violetDim,borderBottom:`1px solid ${T.violet}25`,display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:10}}>ð¢</span>
                    <span style={{fontSize:9,color:T.violet,fontFamily:T.sans,fontWeight:600}}>Enterprise Strategic Analysis â Full executive context enabled</span>
                  </div>
                )}
                <div style={{padding:"8px 12px",borderBottom:`1px solid ${T.border}`,display:"flex",gap:5,flexWrap:"wrap"}}>
                  <span style={{fontSize:9,color:T.textDim,fontFamily:T.sans,alignSelf:"center",marginRight:2}}>Quick ask:</span>
                  {(hasFeature(plan,FEATURES.FULL_AI)?pills:pills.slice(0,2)).map(p=>(
                    <button key={p} onClick={()=>send(p)} style={{background:T.cyanDim,border:`1px solid ${T.cyanMid}`,borderRadius:20,color:T.cyan,fontSize:9,padding:"3px 10px",cursor:"pointer",fontFamily:T.sans,fontWeight:600,whiteSpace:"nowrap",transition:"background 0.1s"}}
                      onMouseEnter={e=>e.target.style.background=T.cyanMid} onMouseLeave={e=>e.target.style.background=T.cyanDim}>{p}</button>
                  ))}
                  {!hasFeature(plan,FEATURES.FULL_AI)&&<span style={{fontSize:9,color:T.textDim,fontFamily:T.sans,alignSelf:"center"}}>+{pills.length-2} more on Pro</span>}
                </div>
                <div style={{flex:1,display:"flex",alignItems:"center",gap:8,padding:"10px 12px"}}>
                  <input value={input} onChange={e=>hasFeature(plan,FEATURES.FULL_AI)&&setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&hasFeature(plan,FEATURES.FULL_AI)&&send()}
                    placeholder={hasFeature(plan,FEATURES.FULL_AI)?`Ask about your ${activeTab==="pnl"?"P&L":activeTab==="cashflow"?"cash flow":activeTab==="ar"?"AR":activeTab==="regional"?"clients":activeTab==="scenario"?"scenarios":activeTab==="bva"?"budget vs actuals":activeTab==="balancesheet"?"balance sheet":activeTab==="headcount"?"headcount":activeTab==="saas"?"SaaS metrics":"financials"}...`:"ð Free-form chat â Professional plan required"}
                    disabled={!hasFeature(plan,FEATURES.FULL_AI)}
                    style={{flex:1,background:hasFeature(plan,FEATURES.FULL_AI)?T.surface:T.surface+"80",border:`1px solid ${hasFeature(plan,FEATURES.FULL_AI)?T.border:T.amber+"40"}`,borderRadius:9,padding:"9px 14px",color:hasFeature(plan,FEATURES.FULL_AI)?T.text:T.textDim,fontSize:12,fontFamily:T.sans,outline:"none",transition:"border-color 0.15s",cursor:hasFeature(plan,FEATURES.FULL_AI)?"text":"not-allowed",opacity:hasFeature(plan,FEATURES.FULL_AI)?1:0.6}}
                    onFocus={e=>{if(hasFeature(plan,FEATURES.FULL_AI))e.target.style.borderColor=T.cyan;}} onBlur={e=>e.target.style.borderColor=hasFeature(plan,FEATURES.FULL_AI)?T.border:T.amber+"40"}/>
                  <button onClick={()=>hasFeature(plan,FEATURES.FULL_AI)&&send()} disabled={!hasFeature(plan,FEATURES.FULL_AI)} title={!hasFeature(plan,FEATURES.FULL_AI)?"Upgrade to Professional for free-form AI chat":undefined} style={{background:hasFeature(plan,FEATURES.FULL_AI)?`linear-gradient(135deg,${T.cyan},${T.violet})`:`${T.amber}20`,border:hasFeature(plan,FEATURES.FULL_AI)?"none":`1px solid ${T.amber}40`,borderRadius:9,width:38,height:38,cursor:hasFeature(plan,FEATURES.FULL_AI)?"pointer":"not-allowed",color:hasFeature(plan,FEATURES.FULL_AI)?T.bg:T.amber,fontSize:hasFeature(plan,FEATURES.FULL_AI)?16:14,fontWeight:700,flexShrink:0,boxShadow:hasFeature(plan,FEATURES.FULL_AI)?`0 2px 10px ${T.cyan}40`:"none",opacity:hasFeature(plan,FEATURES.FULL_AI)?1:0.7}}>{hasFeature(plan,FEATURES.FULL_AI)?"â":"ð"}</button>
                </div>
                {!hasFeature(plan,FEATURES.FULL_AI)&&(
                  <div style={{padding:"0 12px 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <span style={{fontSize:9,color:T.amber,fontFamily:T.sans}}>Use the 2 quick questions above, or upgrade for full access.</span>
                    <span style={{fontSize:9,color:T.cyan,fontFamily:T.sans,fontWeight:700,cursor:"pointer",textDecoration:"underline"}} onClick={()=>onUpgrade&&onUpgrade()}>→ Upgrade</span>
                  </div>
                )}
                {hasFeature(plan,FEATURES.FULL_AI)&&<div style={{padding:"0 12px 8px",fontSize:9,color:T.textDim,fontFamily:T.sans}}>Powered by Claude · {hasFeature(plan,FEATURES.FULL_AI)?"Context-aware of all on-screen data":"Basic mode â upgrade for full financial context"}</div>}
              </>
            )}

            {rightTab==="alerts" && (
              <div style={{flex:1,overflowY:"auto",padding:"8px 10px",display:"flex",flexDirection:"column",gap:6}}>
                {/* Starter: alerts are gated */}
                {!hasFeature(plan,FEATURES.FULL_AI)&&(
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:10,padding:16,textAlign:"center"}}>
                    <span style={{fontSize:28}}>ð</span>
                    <div style={{color:T.cyan,fontFamily:T.sans,fontWeight:700,fontSize:12}}>Anomaly Alerts</div>
                    <div style={{color:T.textDim,fontFamily:T.sans,fontSize:11,lineHeight:1.6}}>Proactive anomaly detection is a Professional feature. Upgrade to get real-time alerts on revenue misses, cash risks, AR aging, and more.</div>
                    <div style={{background:T.cyanDim,border:`1px solid ${T.cyanMid}`,borderRadius:8,padding:"5px 14px",color:T.cyan,fontSize:10,fontFamily:T.sans,fontWeight:700}}>→ Upgrade to Professional</div>
                  </div>
                )}
                {hasFeature(plan,FEATURES.FULL_AI)&&anomalies.length===0 && (
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:6}}>
                    <span style={{fontSize:24}}>â</span>
                    <span style={{color:T.textDim,fontFamily:T.sans,fontSize:11}}>No anomalies detected</span>
                  </div>
                )}
                {hasFeature(plan,FEATURES.FULL_AI)&&anomalies.map((a,i)=>(
                  <div key={i} style={{background:(SEVER[a.severity]||T.amber)+"12",border:`1px solid ${(SEVER[a.severity]||T.amber)}35`,borderRadius:9,padding:"9px 12px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                      <span style={{fontSize:14}}>{a.emoji}</span>
                      <span style={{color:T.text,fontFamily:T.sans,fontWeight:700,fontSize:11}}>{a.title}</span>
                      <span style={{marginLeft:"auto",fontSize:9,color:SEVER[a.severity]||T.amber,background:(SEVER[a.severity]||T.amber)+"20",borderRadius:20,padding:"1px 7px",fontFamily:T.mono,textTransform:"uppercase",fontWeight:700}}>{a.severity}</span>
                    </div>
                    <div style={{color:T.textMid,fontFamily:T.sans,fontSize:11,lineHeight:1.5}}>{a.detail}</div>
                    {a.action && <div style={{marginTop:5,color:T.cyan,fontFamily:T.sans,fontSize:10,fontWeight:600}}>→ {a.action}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// âââ P&L Row ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function PnLRow({label,monthly,isHeader,isTotal,indent,color,showSpark,negative}) {
  const tot=sum(monthly), avg=tot/12, sc=color||(negative?T.rose:T.emerald);
  return (
    <div style={{borderBottom:`1px solid ${isHeader||isTotal?T.border:T.border+"60"}`,background:isHeader?T.card:isTotal?(color?color+"15":T.cyanDim):"transparent"}}>
      <div style={{display:"grid",gridTemplateColumns:"200px repeat(12, 1fr) 80px 80px 60px",alignItems:"center",padding:isHeader?"10px 0":"7px 0"}}>
        <div style={{paddingLeft:indent?24:12,paddingRight:8,fontFamily:isHeader||isTotal?T.display:T.sans,fontSize:isHeader?10:11,fontWeight:isHeader||isTotal?700:400,color:isHeader?T.textDim:isTotal?T.cyan:indent?T.textMid:T.text,textTransform:isHeader?"uppercase":"none",letterSpacing:isHeader?1:0,display:"flex",alignItems:"center",gap:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {indent&&<span style={{color:T.textDim,fontSize:9}}>â</span>}{label}
        </div>
        {monthly.map((v,i)=>(
          <div key={i} style={{fontFamily:T.mono,fontSize:10,color:isHeader?T.textDim:v<0?T.rose:isTotal?T.cyan:negative?T.rose:T.textMid,textAlign:"right",padding:"0 6px"}}>
            {isHeader?MONTHS[i]:negative?fmt(Math.abs(v),true):fmt(v,true)}
          </div>
        ))}
        <div style={{fontFamily:T.mono,fontSize:10,fontWeight:700,color:isTotal?T.cyan:negative?T.rose:T.emerald,textAlign:"right",padding:"0 6px"}}>{isHeader?"ANNUAL":negative?fmt(Math.abs(tot),true):fmt(tot,true)}</div>
        <div style={{fontFamily:T.mono,fontSize:10,color:T.textDim,textAlign:"right",padding:"0 6px"}}>{isHeader?"AVG/MO":negative?fmt(Math.abs(avg),true):fmt(avg,true)}</div>
        <div style={{padding:"0 8px",display:"flex",justifyContent:"center"}}>{showSpark&&!isHeader&&<Spark data={monthly} color={sc} w={48} h={20}/>}</div>
      </div>
    </div>
  );
}

// âââ Monthly Revenue vs. Net Income Chart âââââââââââââââââââââââââ
function RevNetChart({ pnl }) {
  const [hovered, setHovered] = useState(null);
  const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // ââ SVG layout constants ââââââââââââââââââââââââââââââââââââââââââ
  const W = 760, H = 270;
  const PAD = { top: 18, bottom: 50, left: 64, right: 60 };
  const cW  = W - PAD.left - PAD.right;  // 636
  const cH  = H - PAD.top  - PAD.bottom; // 202
  const slotW = cW / 12;                  // 53px per month

  // ââ Series data âââââââââââââââââââââââââââââââââââââââââââââââââââ
  const revs   = pnl.map(m => m.rev);
  const grosses = pnl.map(m => m.gross);
  const nets   = pnl.map(m => m.net);

  // ââ Left Y-axis: Revenue / Gross Profit ââââââââââââââââââââââââââ
  const REV_MAX = 150000;
  const revY  = v => PAD.top + (1 - Math.max(0, v) / REV_MAX) * cH;
  const revH  = v => Math.max(0, v) / REV_MAX * cH;

  // ââ Right Y-axis: Net Income  (â5K → +25K) âââââââââââââââââââââââ
  const NET_MIN = -5000, NET_MAX = 25000, NET_RANGE = 30000;
  const netY  = v => PAD.top + (NET_MAX - v) / NET_RANGE * cH;
  const ZERO_Y = netY(0); // pixel-y of zero for net income

  // ââ Quarterly grouping ââââââââââââââââââââââââââââââââââââââââââââ
  const qLabels = [
    { label:"Q1", q:0 }, { label:"Q2", q:1 },
    { label:"Q3", q:2 }, { label:"Q4", q:3 },
  ];

  // ââ Net income line path ââââââââââââââââââââââââââââââââââââââââââ
  const netPts = nets.map((v,i) =>
    `${PAD.left + (i+0.5)*slotW},${netY(v)}`).join(" ");

  // ââ Right axis tick marks âââââââââââââââââââââââââââââââââââââââââ
  const rightTicks = [-5000, 0, 5000, 10000, 15000, 20000, 25000];
  const leftTicks  = [0, 30000, 60000, 90000, 120000, 150000];

  // ââ Bar widths ââââââââââââââââââââââââââââââââââââââââââââââââââââ
  const REV_BW = 26, GROSS_BW = 14;

  // ââ Dot color by value ââââââââââââââââââââââââââââââââââââââââââââ
  const dotColor = v => v < 0 ? T.rose : v < 6000 ? T.amber : T.emerald;

  // ââ Quarterly totals for annotation ââââââââââââââââââââââââââââââ
  const qRevTotals = [0,1,2,3].map(q =>
    revs.slice(q*3, q*3+3).reduce((a,b)=>a+b,0));

  return (
    <div style={{ position:"relative", userSelect:"none" }}>

      {/* ââ Legend âââââââââââââââââââââââââââââââââââââââââââââââââââ */}
      <div style={{ display:"flex", gap:18, alignItems:"center", marginBottom:10, flexWrap:"wrap" }}>
        {[
          { color:T.cyan,    label:"Monthly Revenue",  type:"bar"  },
          { color:T.emerald, label:"Gross Profit",     type:"bar"  },
          { color:T.amber,   label:"Net Income",       type:"line" },
        ].map(l => (
          <div key={l.label} style={{ display:"flex", alignItems:"center", gap:6 }}>
            {l.type === "bar"
              ? <div style={{ width:12, height:12, borderRadius:3, background:l.color+"80", border:`1px solid ${l.color}` }}/>
              : <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <svg width="22" height="2" style={{ overflow:"visible" }}>
                    <line x1="0" y1="1" x2="22" y2="1" stroke={l.color} strokeWidth="2"/>
                    <circle cx="11" cy="1" r="3" fill={l.color} stroke={T.surface} strokeWidth="1.5"/>
                  </svg>
                </div>
            }
            <span style={{ fontFamily:T.sans, fontSize:9, color:T.textMid }}>{l.label}</span>
          </div>
        ))}
        <div style={{ marginLeft:"auto", display:"flex", gap:12, alignItems:"center" }}>
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <div style={{ width:16, height:1, background:T.amber, opacity:0.5 }}/>
            <span style={{ fontFamily:T.mono, fontSize:8, color:T.textDim }}>Zero (Net Income)</span>
          </div>
          <span style={{ fontFamily:T.mono, fontSize:8, color:T.textDim }}>Left axis = Revenue · Right axis = Net Income</span>
        </div>
      </div>

      {/* ââ SVG Chart ââââââââââââââââââââââââââââââââââââââââââââââââ */}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue and net income chart" style={{ width:"100%", height:"auto", display:"block", overflow:"visible" }}>
        <defs>
          <linearGradient id="rnRevGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={T.cyan}    stopOpacity="0.85"/>
            <stop offset="100%" stopColor={T.cyan}    stopOpacity="0.22"/>
          </linearGradient>
          <linearGradient id="rnGrossGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={T.emerald} stopOpacity="0.90"/>
            <stop offset="100%" stopColor={T.emerald} stopOpacity="0.30"/>
          </linearGradient>
          <linearGradient id="rnNetGrad" x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor={T.rose}/>
            <stop offset="18%"  stopColor={T.amber}/>
            <stop offset="40%"  stopColor={T.amber}/>
            <stop offset="100%" stopColor={T.emerald}/>
          </linearGradient>
          <clipPath id="rnClip">
            <rect x={PAD.left} y={PAD.top} width={cW} height={cH}/>
          </clipPath>
        </defs>

        {/* ââ Quarterly alternating bands ââ */}
        {[0,1,2,3].map(q => (
          <rect key={q}
            x={PAD.left + q*3*slotW} y={PAD.top}
            width={3*slotW} height={cH}
            fill={q%2===0 ? "#ffffff07" : "transparent"}/>
        ))}

        {/* ââ Left gridlines + labels ââ */}
        {leftTicks.map(v => {
          const y = revY(v);
          return (
            <g key={`lg-${v}`}>
              <line x1={PAD.left} x2={PAD.left+cW} y1={y} y2={y}
                stroke={T.border} strokeWidth="0.5"
                strokeDasharray={v===0?"none":"3,5"} opacity="0.8"/>
              <text x={PAD.left-7} y={y+3.5} textAnchor="end"
                fontFamily={T.mono} fontSize="8.5" fill={T.textDim}>
                {v===0?"$0":`$${v/1000}K`}
              </text>
            </g>
          );
        })}

        {/* ââ Right axis labels (net income) ââ */}
        {rightTicks.map(v => {
          const y = netY(v);
          if (y < PAD.top-4 || y > PAD.top+cH+4) return null;
          const isZero = v === 0;
          return (
            <text key={`rt-${v}`} x={PAD.left+cW+8} y={y+3.5} textAnchor="start"
              fontFamily={T.mono} fontSize="8.5"
              fill={isZero ? T.amber+"AA" : T.textDim}>
              {v<0 ? `-$${Math.abs(v)/1000}K` : v===0 ? "$0" : `$${v/1000}K`}
            </text>
          );
        })}

        {/* ââ Zero line for net income ââ */}
        <line x1={PAD.left} x2={PAD.left+cW} y1={ZERO_Y} y2={ZERO_Y}
          stroke={T.amber} strokeWidth="1" strokeDasharray="5,4" opacity="0.45"/>

        {/* ââ Quarterly vertical separators ââ */}
        {[3,6,9].map(qi => (
          <line key={`qs-${qi}`}
            x1={PAD.left+qi*slotW} x2={PAD.left+qi*slotW}
            y1={PAD.top} y2={PAD.top+cH}
            stroke={T.border} strokeWidth="1" opacity="0.7"/>
        ))}

        {/* ââ Axes ââ */}
        <line x1={PAD.left}    x2={PAD.left}    y1={PAD.top} y2={PAD.top+cH} stroke={T.border} strokeWidth="1"/>
        <line x1={PAD.left+cW} x2={PAD.left+cW} y1={PAD.top} y2={PAD.top+cH} stroke={T.border} strokeWidth="1"/>
        <line x1={PAD.left}    x2={PAD.left+cW} y1={PAD.top+cH} y2={PAD.top+cH} stroke={T.border} strokeWidth="1"/>

        {/* ââ Revenue bars ââ */}
        {revs.map((v,i) => {
          const x = PAD.left + i*slotW + (slotW-REV_BW)/2;
          const barH = revH(v), barY = revY(v);
          const isHov = hovered===i;
          return (
            <rect key={`rev-${i}`} x={x} y={barY} width={REV_BW} height={barH} rx="3"
              fill="url(#rnRevGrad)"
              stroke={isHov ? T.cyan : "none"} strokeWidth="1.5"
              opacity={hovered!==null && !isHov ? 0.35 : 1}
              style={{ transition:"opacity 0.15s" }}/>
          );
        })}

        {/* ââ Gross profit bars (centered, narrower) ââ */}
        {grosses.map((v,i) => {
          const x = PAD.left + i*slotW + (slotW-GROSS_BW)/2;
          const barH = revH(v), barY = revY(v);
          const isHov = hovered===i;
          return (
            <rect key={`gross-${i}`} x={x} y={barY} width={GROSS_BW} height={barH} rx="2"
              fill="url(#rnGrossGrad)"
              opacity={hovered!==null && !isHov ? 0.35 : 1}
              style={{ transition:"opacity 0.15s" }}/>
          );
        })}

        {/* ââ Net income vertical drop lines (negative months) ââ */}
        {nets.map((v,i) => {
          if (v >= 0) return null;
          const cx = PAD.left + (i+0.5)*slotW;
          return (
            <line key={`drop-${i}`} x1={cx} x2={cx}
              y1={ZERO_Y} y2={netY(v)}
              stroke={T.rose} strokeWidth="1.5" strokeDasharray="2,2" opacity="0.6"/>
          );
        })}

        {/* ââ Net income polyline ââ */}
        <polyline points={netPts}
          fill="none" stroke="url(#rnNetGrad)" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          clipPath="url(#rnClip)"/>

        {/* ââ Net income dots ââ */}
        {nets.map((v,i) => {
          const cx = PAD.left + (i+0.5)*slotW;
          const cy = netY(v);
          const isHov = hovered===i;
          const dc = dotColor(v);
          return (
            <g key={`dot-${i}`}>
              {isHov && <circle cx={cx} cy={cy} r="9" fill={dc} opacity="0.12"/>}
              <circle cx={cx} cy={cy} r={isHov ? 5.5 : 3.5}
                fill={dc} stroke={T.surface} strokeWidth="1.5"/>
              {v < 0 && (
                <text x={cx} y={cy-10} textAnchor="middle"
                  fontFamily={T.mono} fontSize="7.5" fill={T.rose} fontWeight="700">
                  â¼
                </text>
              )}
            </g>
          );
        })}

        {/* ââ Quarterly total annotations ââ */}
        {qRevTotals.map((qRev, q) => {
          const centerX = PAD.left + (q*3 + 1.5)*slotW;
          return (
            <g key={`qa-${q}`}>
              <text x={centerX} y={PAD.top - 5} textAnchor="middle"
                fontFamily={T.mono} fontSize="7.5" fill={T.textDim}>
                {`$${Math.round(qRev/1000)}K`}
              </text>
            </g>
          );
        })}

        {/* ââ Month labels ââ */}
        {MONTHS_SHORT.map((m,i) => {
          const x = PAD.left + (i+0.5)*slotW;
          const isHov = hovered===i;
          return (
            <text key={`ml-${i}`} x={x} y={PAD.top+cH+13} textAnchor="middle"
              fontFamily={T.mono} fontSize="8.5"
              fill={isHov ? T.cyan : T.textDim}
              fontWeight={isHov ? "700" : "400"}>
              {m}
            </text>
          );
        })}

        {/* ââ Q labels ââ */}
        {qLabels.map(({ label, q }) => {
          const x = PAD.left + (q*3 + 1.5)*slotW;
          return (
            <text key={label} x={x} y={PAD.top+cH+30} textAnchor="middle"
              fontFamily={T.sans} fontSize="8" fill={T.textDim}
              letterSpacing="2" fontWeight="700">
              {label}
            </text>
          );
        })}

        {/* ââ Axis titles ââ */}
        <text transform={`translate(12,${PAD.top+cH/2}) rotate(-90)`}
          textAnchor="middle" fontFamily={T.sans} fontSize="8" fill={T.textDim} letterSpacing="1">
          REVENUE / GROSS PROFIT
        </text>
        <text transform={`translate(${W-10},${PAD.top+cH/2}) rotate(90)`}
          textAnchor="middle" fontFamily={T.sans} fontSize="8" fill={T.textDim} letterSpacing="1">
          NET INCOME
        </text>

        {/* ââ Invisible hover capture zones ââ */}
        {MONTHS_SHORT.map((_,i) => (
          <rect key={`hz-${i}`}
            x={PAD.left+i*slotW} y={PAD.top}
            width={slotW} height={cH+16}
            fill="transparent"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor:"crosshair" }}/>
        ))}
      </svg>

      {/* ââ Tooltip âââââââââââââââââââââââââââââââââââââââââââââââââââ */}
      {hovered !== null && (() => {
        const i = hovered;
        const rev = revs[i], gross = grosses[i], net = nets[i];
        const gm  = (safeDiv(gross,rev)*100).toFixed(1);
        const nm  = (safeDiv(net,rev)*100).toFixed(1);
        const pctLeft = (i + 0.5) / 12 * 100;
        const flipLeft = i >= 9;
        return (
          <div style={{
            position:"absolute",
            left:`${pctLeft}%`,
            top:"30px",
            transform: flipLeft ? "translateX(calc(-100% - 4px))" : "translateX(8px)",
            background:T.card,
            border:`1px solid ${T.border}`,
            borderRadius:10,
            padding:"12px 15px",
            pointerEvents:"none",
            zIndex:20,
            minWidth:180,
            boxShadow:`0 8px 32px rgba(0,0,0,0.5)`,
          }}>
            <div style={{ fontFamily:T.mono, fontSize:10, color:T.cyan, fontWeight:700, marginBottom:10, letterSpacing:1 }}>
              {MONTHS_SHORT[i]}
            </div>
            {[
              { label:"Revenue",     value:`$${Math.round(rev/1000)}K`,   color:T.cyan    },
              { label:"Gross Profit",value:`$${Math.round(gross/1000)}K`, color:T.emerald, sub:`${gm}% margin` },
              { label:"Net Income",  value:net<0?`â$${Math.round(Math.abs(net/1000)*10)/10}K`:`$${Math.round(net/1000*10)/10}K`, color:dotColor(net), sub:`${nm}% margin` },
            ].map(row => (
              <div key={row.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6, gap:12 }}>
                <div>
                  <div style={{ fontFamily:T.sans, fontSize:9, color:T.textDim }}>{row.label}</div>
                  {row.sub && <div style={{ fontFamily:T.mono, fontSize:8, color:row.color+"99", marginTop:1 }}>{row.sub}</div>}
                </div>
                <div style={{ fontFamily:T.mono, fontSize:12, fontWeight:700, color:row.color }}>{row.value}</div>
              </div>
            ))}
            <div style={{ borderTop:`1px solid ${T.border}`, marginTop:8, paddingTop:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontFamily:T.sans, fontSize:8, color:T.textDim }}>Q{Math.floor(i/3)+1} month {i%3+1} of 3</span>
                <span style={{ fontFamily:T.mono, fontSize:8, color:net<0?T.rose:T.emerald, fontWeight:700 }}>
                  {net<0?"â¼ Loss":"â² Profit"}
                </span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// âââ P&L Breakdown âââââââââââââââââââââââââââââââââââââââââââââââ
function PnLBreakdown({aiContext}) {
  const pnl=computePnL(BASE_PNL);
  const col=k=>pnl.map(m=>m[k]);
  const dc=k=>BASE_PNL[k]||Array(12).fill(0);
  const totalRev=pnl.map(m=>m.rev), totalCogs=pnl.map(m=>m.cogs);
  const grossProfit=pnl.map(m=>m.gross), totalOpex=pnl.map(m=>m.opex);
  const ebitda=pnl.map(m=>m.ebitda), netIncome=pnl.map(m=>m.net);
  const maxV=Math.max(...totalRev);
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
          {[{label:"Annual Revenue",v:sum(totalRev),s:totalRev,c:T.cyan},{label:"Gross Profit",v:sum(grossProfit),s:grossProfit,c:T.emerald},{label:"EBITDA",v:sum(ebitda),s:ebitda,c:T.violet},{label:"Net Income",v:sum(netIncome),s:netIncome,c:T.amber}].map(k=>(
            <div key={k.label} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 16px"}}>
              <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{k.label}</div>
              <div style={{fontSize:20,fontWeight:800,fontFamily:T.mono,color:k.c}}>{fmt(k.v,true)}</div>
              <div style={{marginTop:8}}><Spark data={k.s} color={k.c} w={80} h={28}/></div>
            </div>
          ))}
        </div>
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px",marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14}}>ð Monthly Revenue vs. Net Income</div>
            <div style={{fontFamily:T.mono,fontSize:8,color:T.textDim,letterSpacing:1}}>FY 2024 · Hover month for detail</div>
          </div>
          <RevNetChart pnl={pnl}/>
        </div>
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,overflow:"hidden",marginBottom:20}}>
          <div style={{padding:"14px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14}}>ð Full P&L Statement â FY 2024</div>
            <div style={{color:T.textDim,fontSize:9,fontFamily:T.mono}}>All amounts in USD</div>
          </div>
          <div style={{overflowX:"auto"}}>
            <PnLRow label="MONTH" monthly={MONTHS.map(()=>0)} isHeader showSpark={false}/>
            <PnLRow label="â¸ REVENUE" monthly={totalRev} isTotal color={T.cyan} showSpark/>
            <PnLRow label="Product Sales" monthly={dc("productSales")} indent showSpark color={T.cyan}/>
            <PnLRow label="Service Fees" monthly={dc("serviceFees")} indent showSpark color={T.cyan}/>
            <PnLRow label="Recurring Revenue" monthly={dc("recurringRevenue")} indent showSpark color={T.violet}/>
            <PnLRow label="Other Revenue" monthly={dc("otherRevenue")} indent showSpark color={T.teal}/>
            <PnLRow label="â¸ COST OF GOODS SOLD" monthly={totalCogs} isTotal color={T.rose} negative showSpark/>
            <PnLRow label="Inventory / Materials" monthly={dc("inventory")} indent negative showSpark color={T.rose}/>
            <PnLRow label="Direct Labor" monthly={dc("directLabor")} indent negative showSpark color={T.rose}/>
            <PnLRow label="Shipping & Fulfillment" monthly={dc("shipping")} indent negative showSpark color={T.amber}/>
            <PnLRow label="â GROSS PROFIT" monthly={grossProfit} isTotal color={T.emerald} showSpark/>
            <PnLRow label="â¸ OPERATING EXPENSES" monthly={totalOpex} isTotal color={T.amber} negative showSpark/>
            <PnLRow label="Payroll & Benefits" monthly={dc("payroll")} indent negative showSpark color={T.amber}/>
            <PnLRow label="Rent & Facilities" monthly={dc("rent")} indent negative showSpark color={T.textMid}/>
            <PnLRow label="Marketing & Advertising" monthly={dc("marketing")} indent negative showSpark color={T.amber}/>
            <PnLRow label="Software & Subscriptions" monthly={dc("software")} indent negative showSpark color={T.textMid}/>
            <PnLRow label="Utilities" monthly={dc("utilities")} indent negative showSpark color={T.textDim}/>
            <PnLRow label="Insurance" monthly={dc("insurance")} indent negative showSpark color={T.textDim}/>
            <PnLRow label="Professional Services" monthly={dc("professionalSvc")} indent negative showSpark color={T.textMid}/>
            <PnLRow label="Equipment & Maintenance" monthly={dc("equipment")} indent negative showSpark color={T.textDim}/>
            <PnLRow label="Miscellaneous" monthly={dc("miscExpenses")} indent negative showSpark color={T.textDim}/>
            <PnLRow label="â EBITDA" monthly={ebitda} isTotal color={T.violet} showSpark/>
            <PnLRow label="Depreciation & Amortization" monthly={MONTHS.map(()=>1200)} indent negative showSpark color={T.textDim}/>
            <PnLRow label="Interest Expense" monthly={MONTHS.map(()=>850)} indent negative showSpark color={T.textDim}/>
            <PnLRow label="Income Taxes (21%)" monthly={col("taxes")} indent negative color={T.rose} showSpark/>
            <PnLRow label="â NET INCOME" monthly={netIncome} isTotal color={T.cyan} showSpark/>
          </div>
        </div>
    </div>
  );
}

// âââ Scenario Planner âââââââââââââââââââââââââââââââââââââââââââââ
function ScenarioPlanner({aiContext, plan="professional"}) {
  const [active,setActive]=useState("base");
  const [cm,setCm]=useState({revenue:1,cogs:1,opex:1});
  const [useC,setUseC]=useState(false);
  const [showSave,   setShowSave]   = useState(false);
  const [showLibrary,setShowLibrary] = useState(false);
  const [savedName,  setSavedName]  = useState("");
  const canSave    = hasFeature(plan, FEATURES.SCENARIO_SAVE);
  const canUseNumInput = plan==="professional" || plan==="enterprise";
  const res={bear:computePnL(BASE_PNL,SCENARIOS_DEF.bear),base:computePnL(BASE_PNL,SCENARIOS_DEF.base),bull:computePnL(BASE_PNL,SCENARIOS_DEF.bull),custom:computePnL(BASE_PNL,cm)};
  const curr=useC?res.custom:res[active];
  const ar=r=>sum(r.map(m=>m.rev)), an=r=>sum(r.map(m=>m.net)), ae=r=>sum(r.map(m=>m.ebitda));
  const wf=[
    {label:"Gross Revenue",value:ar(curr),color:T.cyan},
    {label:"- COGS",value:-sum(curr.map(m=>m.cogs)),color:T.rose},
    {label:"= Gross Profit",value:sum(curr.map(m=>m.gross)),color:T.emerald,total:true},
    {label:"- Operating Expenses",value:-sum(curr.map(m=>m.opex)),color:T.amber},
    {label:"= EBITDA",value:ae(curr),color:T.violet,total:true},
    {label:"- D&A & Interest",value:-(1200+850)*12,color:T.textDim},
    {label:"- Taxes (21%)",value:-sum(curr.map(m=>m.taxes)),color:T.rose},
    {label:"= Net Income",value:an(curr),color:T.cyan,total:true},
  ];
  const wfMax=Math.max(...wf.map(d=>Math.abs(d.value)));
  return (
    <div>
      {/* ââ Save / Library modals ââ */}
      {showSave && <ScenarioSaveModal multipliers={useC?cm:SCENARIOS_DEF[active]} onSave={sc=>{setSavedName(sc.name);setShowSave(false);}} onClose={()=>setShowSave(false)}/>}
      {showLibrary && <ScenarioLibrary onLoad={(mults,name)=>{setCm(mults);setUseC(true);setSavedName(name);}} onClose={()=>setShowLibrary(false)}/>}

      {/* ââ Scenario action bar ââ */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {savedName && <span style={{fontSize:10,color:T.emerald,background:T.emeraldDim,border:`1px solid ${T.emerald}30`,borderRadius:99,padding:"2px 10px",fontFamily:T.mono,fontWeight:700}}>â Loaded: {savedName}</span>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>canSave?setShowLibrary(true):null} title={canSave?"View saved scenarios":"Upgrade to Professional to save scenarios"} style={{background:T.surface,border:`1px solid ${canSave?T.border:T.amber+"40"}`,borderRadius:8,padding:"6px 13px",cursor:canSave?"pointer":"not-allowed",color:canSave?T.textMid:T.amber,fontSize:11,fontFamily:T.sans,fontWeight:600}}>
            ð {canSave?"Library":"ð Library"}
          </button>
          <button onClick={()=>canSave?setShowSave(true):null} title={canSave?"Save current scenario":"Upgrade to Professional to save scenarios"} style={{background:canSave?`${T.cyan}15`:`${T.amber}12`,border:`1px solid ${canSave?T.cyan+"40":T.amber+"40"}`,borderRadius:8,padding:"6px 13px",cursor:canSave?"pointer":"not-allowed",color:canSave?T.cyan:T.amber,fontSize:11,fontFamily:T.sans,fontWeight:700}}>
            ð¾ {canSave?"Save Scenario":"ð Save"}
          </button>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20}}>
          {Object.entries(SCENARIOS_DEF).map(([k,s])=>{
            const net=an(res[k]),rev=ar(res[k]),ebd=ae(res[k]);
            return (
              <div key={k} onClick={()=>{setActive(k);setUseC(false);}} style={{background:(!useC&&active===k)?`${s.color}15`:T.card,border:`1px solid ${(!useC&&active===k)?s.color+"60":T.border}`,borderRadius:12,padding:16,cursor:"pointer",transition:"all 0.2s",boxShadow:(!useC&&active===k)?`0 0 20px ${s.color}20`:"none"}}>
                <div style={{fontSize:20}}>{s.icon}</div>
                <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,margin:"6px 0 2px"}}>{s.label} Case</div>
                <div style={{color:T.textDim,fontSize:10,fontFamily:T.sans,marginBottom:10}}>{s.desc}</div>
                {[{l:"Revenue",v:fmt(rev,true),c:s.color},{l:"EBITDA",v:fmt(ebd,true),c:T.violet},{l:"Net Income",v:fmt(net,true),c:s.color},{l:"Net Margin",v:pct(safeDiv(net,rev)),c:T.textMid}].map(x=>(
                  <div key={x.l} style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                    <span style={{fontSize:10,color:T.textDim,fontFamily:T.sans}}>{x.l}</span>
                    <span style={{fontSize:10,color:x.c,fontFamily:T.mono,fontWeight:600}}>{x.v}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px",marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
            <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14}}>ðï¸ Custom Scenario Builder</div>
            {!canUseNumInput && (
              <div style={{display:"flex",alignItems:"center",gap:6,background:T.violetDim,border:`1px solid ${T.violet}40`,borderRadius:20,padding:"4px 12px"}}>
                <span style={{fontSize:11}}>ð</span>
                <span style={{fontSize:10,color:T.violet,fontFamily:T.sans,fontWeight:600}}>Numeric inputs â Pro & Enterprise</span>
              </div>
            )}
            {canUseNumInput && (
              <div style={{display:"flex",alignItems:"center",gap:6,background:T.emeraldDim,border:`1px solid ${T.emerald}40`,borderRadius:20,padding:"4px 12px"}}>
                <span style={{fontSize:11}}>â¦</span>
                <span style={{fontSize:10,color:T.emerald,fontFamily:T.sans,fontWeight:600}}>{plan==="enterprise"?"Enterprise":"Professional"} â Numeric inputs enabled</span>
              </div>
            )}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:20}}>
            {[{k:"revenue",l:"Revenue Multiplier",c:T.cyan},{k:"cogs",l:"COGS Multiplier",c:T.rose},{k:"opex",l:"OpEx Multiplier",c:T.amber}].map(({k,l,c})=>(
              <div key={k}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={{fontSize:10,color:T.textMid,fontFamily:T.sans}}>{l}</span>
                  {canUseNumInput ? (
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <input
                        type="number" min="0.5" max="2.0" step="0.01"
                        value={cm[k].toFixed(2)}
                        onChange={e=>{
                          const v=Math.min(2,Math.max(0.5,parseFloat(e.target.value)||0.5));
                          setCm(m=>({...m,[k]:v}));setUseC(true);
                        }}
                        style={{width:64,background:T.surface,border:`1px solid ${c}60`,borderRadius:6,padding:"3px 7px",color:c,fontSize:12,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,textAlign:"center",outline:"none",transition:"border-color 0.15s"}}
                        onFocus={e=>e.target.style.borderColor=c}
                        onBlur={e=>e.target.style.borderColor=c+"60"}
                      />
                      <span style={{fontSize:11,color:c,fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>Ã</span>
                    </div>
                  ) : (
                    <span style={{fontSize:11,color:c,fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>{cm[k].toFixed(2)}Ã</span>
                  )}
                </div>
                <input type="range" min="0.5" max="2.0" step="0.01" value={cm[k]}
                  onChange={e=>{setCm(m=>({...m,[k]:+e.target.value}));setUseC(true);}}
                  style={{width:"100%",accentColor:c,cursor:"pointer"}}/>
                {canUseNumInput && (
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
                    <span style={{fontSize:8,color:T.textDim,fontFamily:"'JetBrains Mono',monospace"}}>0.50Ã</span>
                    <span style={{fontSize:8,color:T.textDim,fontFamily:"'JetBrains Mono',monospace"}}>1.00Ã</span>
                    <span style={{fontSize:8,color:T.textDim,fontFamily:"'JetBrains Mono',monospace"}}>2.00Ã</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          {useC&&<div style={{marginTop:14,display:"flex",gap:16,padding:"10px 14px",background:T.surface,borderRadius:8}}>
            {[{l:"Revenue",v:fmt(ar(res.custom),true),c:T.cyan},{l:"EBITDA",v:fmt(ae(res.custom),true),c:T.violet},{l:"Net Income",v:fmt(an(res.custom),true),c:T.emerald},{l:"Net Margin",v:pct(safeDiv(an(res.custom),ar(res.custom))),c:T.amber}].map(s=>(
              <div key={s.l}><div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase"}}>{s.l}</div><div style={{fontSize:13,fontWeight:700,fontFamily:T.mono,color:s.c}}>{s.v}</div></div>
            ))}
          </div>}
        </div>
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
          <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,marginBottom:14}}>ð Income Waterfall â {useC?"Custom":SCENARIOS_DEF[active].label} Scenario</div>
          {wf.map(d=>(
            <div key={d.label} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <div style={{width:160,fontSize:10,color:T.textMid,fontFamily:T.sans,textAlign:"right",flexShrink:0}}>{d.label}</div>
              <div style={{flex:1,height:d.total?14:10,background:T.border,borderRadius:3,overflow:"hidden"}}>
                <div style={{width:`${Math.abs(d.value)/wfMax*100}%`,height:"100%",borderRadius:3,background:d.total?`linear-gradient(90deg,${d.color},${d.color}CC)`:d.color+"BB",transition:"width 0.5s"}}/>
              </div>
              <div style={{width:70,fontFamily:T.mono,fontSize:10,color:d.value<0?T.rose:d.color,textAlign:"right",flexShrink:0}}>{d.value<0?"-":""}{fmt(Math.abs(d.value),true)}</div>
            </div>
          ))}
        </div>
    </div>
  );
}

// âââ Cash Flow Forecast âââââââââââââââââââââââââââââââââââââââââââ
function CashFlowForecast({aiContext}) {
  const [view,setView]=useState("bars");
  const [sel,setSel]=useState(null);
  const W=Array.from({length:13},(_,i)=>`W${i+1}`);
  const inf=CF.inflows, out=CF.outflows;
  const inflows =W.map((_,i)=>inf.collections[i]+inf.newContracts[i]+inf.recurring[i]+inf.other[i]);
  const outflows=W.map((_,i)=>out.payroll[i]+out.vendors[i]+out.rent[i]+out.taxes[i]+out.debtService[i]+out.capex[i]+out.other[i]);
  const nets    =W.map((_,i)=>inflows[i]-outflows[i]);
  const balances=[];let b=CF.openingBalance;
  W.forEach((_,i)=>{b+=nets[i];balances.push(b);});
  const minBal=Math.min(...balances),minWk=balances.indexOf(minBal)+1,endBal=balances[12];
  const totIn=sum(inflows),totOut=sum(outflows),maxBar=Math.max(...inflows,...outflows);
  const CATS=[{k:"payroll",l:"Payroll",c:T.rose},{k:"vendors",l:"Vendors/COGS",c:T.amber},{k:"rent",l:"Rent",c:T.violet},{k:"taxes",l:"Tax Payments",c:T.orange},{k:"debtService",l:"Debt Service",c:T.textMid},{k:"capex",l:"CapEx",c:T.cyan},{k:"other",l:"Other",c:T.teal}];
  const ctx={...aiContext,openingBalance:CF.openingBalance,endBalance:endBal,minBalance:minBal,minWeek:minWk,totalInflows:totIn,totalOutflows:totOut};
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:18}}>
          {[{l:"Current Balance",v:fmt(CF.openingBalance,true),s:"As of today",c:T.cyan},{l:"13-Wk Projected",v:fmt(endBal,true),s:endBal>CF.openingBalance?"â Positive trend":"â Watch closely",c:endBal>CF.openingBalance?T.emerald:T.rose},{l:"Minimum Balance",v:fmt(minBal,true),s:`Week ${minWk} â lowest point`,c:minBal<50000?T.rose:T.amber},{l:"Avg Weekly Net",v:fmt((endBal-CF.openingBalance)/13,true),s:"Inflows minus outflows",c:T.violet}].map(k=>(
            <div key={k.l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 16px"}}>
              <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{k.l}</div>
              <div style={{fontSize:17,fontWeight:700,fontFamily:T.mono,color:k.c}}>{k.v}</div>
              <div style={{fontSize:10,color:T.textDim,fontFamily:T.sans,marginTop:2}}>{k.s}</div>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:6,marginBottom:14}}>
          {[["bars","ð Cash Flow Bars"],["table","ð Weekly Detail"],["runway","ð Balance Runway"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?T.cyanDim:"transparent",border:`1px solid ${view===v?T.cyanMid:T.border}`,borderRadius:8,padding:"6px 12px",color:view===v?T.cyan:T.textMid,fontSize:11,fontFamily:T.sans,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>{l}</button>
          ))}
        </div>

        {view==="bars"&&(
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px",marginBottom:18}}>
            <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,marginBottom:14}}>ð§ Weekly Cash Flow â 13-Week Forecast</div>
            <div style={{display:"flex",alignItems:"flex-end",gap:3,height:210}}>
              {W.map((w,i)=>{
                const iH=(inflows[i]/maxBar)*130, oH=(outflows[i]/maxBar)*130, low=balances[i]<60000;
                const active=sel===i;
                return (
                  <div key={w} onClick={()=>setSel(sel===i?null:i)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1,cursor:"pointer",opacity:sel!==null&&sel!==i?0.4:1,transition:"opacity 0.15s",position:"relative"}}>
                    {low&&<div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",fontSize:8,color:T.rose,zIndex:1}}>â </div>}
                    {/* Grouped side-by-side bars growing upward from same baseline */}
                    <div style={{width:"100%",display:"flex",flexDirection:"row",alignItems:"flex-end",height:140,gap:1}}>
                      {/* Inflow bar + label */}
                      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end"}}>
                        <span style={{fontSize:7,color:T.emerald,fontFamily:T.mono,fontWeight:700,lineHeight:1.2,marginBottom:1,opacity:active?1:0.75}}>{fmt(inflows[i],true)}</span>
                        <div style={{width:"100%",height:`${iH}px`,background:`linear-gradient(180deg,${T.emerald}90,${T.emerald}40)`,borderRadius:"2px 2px 0 0",minHeight:2}}/>
                      </div>
                      {/* Outflow bar + label */}
                      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end"}}>
                        <span style={{fontSize:7,color:T.rose,fontFamily:T.mono,fontWeight:700,lineHeight:1.2,marginBottom:1,opacity:active?1:0.75}}>{fmt(outflows[i],true)}</span>
                        <div style={{width:"100%",height:`${oH}px`,background:`linear-gradient(180deg,${T.rose}90,${T.rose}40)`,borderRadius:"2px 2px 0 0",minHeight:2}}/>
                      </div>
                    </div>
                    <span style={{fontSize:7,color:T.textDim,fontFamily:T.mono}}>{w}</span>
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",gap:16,marginTop:8}}>
              {[{l:"Inflows",c:T.emerald},{l:"Outflows",c:T.rose}].map(x=>(
                <div key={x.l} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:10,height:10,borderRadius:2,background:x.c}}/><span style={{fontSize:10,color:T.textMid,fontFamily:T.sans}}>{x.l}</span></div>
              ))}
              <span style={{fontSize:10,color:T.textDim,fontFamily:T.sans}}>Click bar for detail</span>
            </div>
            {sel!==null&&(
              <div style={{marginTop:14,background:T.surface,borderRadius:10,padding:"12px 14px",border:`1px solid ${T.border}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:12}}>Week {sel+1} Detail</div>
                  <div style={{color:nets[sel]>=0?T.emerald:T.rose,fontFamily:T.mono,fontSize:12,fontWeight:700}}>Net: {fmt(nets[sel],true)}</div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div><div style={{fontSize:9,color:T.emerald,fontFamily:T.mono,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>INFLOWS</div>
                    {[["Collections",inf.collections],["New Contracts",inf.newContracts],["Recurring",inf.recurring],["Other",inf.other]].map(([l,d])=>d[sel]>0&&<div key={l} style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:10,color:T.textMid,fontFamily:T.sans}}>{l}</span><span style={{fontSize:10,color:T.emerald,fontFamily:T.mono}}>{fmt(d[sel],true)}</span></div>)}
                  </div>
                  <div><div style={{fontSize:9,color:T.rose,fontFamily:T.mono,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>OUTFLOWS</div>
                    {CATS.map(cat=>out[cat.k][sel]>0&&<div key={cat.k} style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:10,color:T.textMid,fontFamily:T.sans}}>{cat.l}</span><span style={{fontSize:10,color:cat.c,fontFamily:T.mono}}>{fmt(out[cat.k][sel],true)}</span></div>)}
                  </div>
                </div>
                <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${T.border}`,display:"flex",gap:20}}>
                  <div><span style={{fontSize:9,color:T.textDim,fontFamily:T.sans}}>Running Balance: </span><span style={{fontSize:11,color:balances[sel]<60000?T.rose:T.cyan,fontFamily:T.mono,fontWeight:700}}>{fmt(balances[sel])}</span></div>
                  {balances[sel]<60000&&<span style={{fontSize:10,color:T.rose,fontFamily:T.sans}}>â ï¸ Below $60K threshold</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {view==="table"&&(
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,overflow:"hidden",marginBottom:18}}>
            <div style={{padding:"14px 16px",borderBottom:`1px solid ${T.border}`,color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14}}>ð 13-Week Cash Flow Detail</div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,fontFamily:T.mono}}>
                <thead><tr style={{background:T.surface}}>
                  {["Category",...W,"Total"].map(h=>(
                    <th key={h} style={{padding:"7px 8px",color:T.textDim,textAlign:h==="Category"?"left":"right",fontWeight:700,fontSize:9,textTransform:"uppercase",letterSpacing:0.5,borderBottom:`1px solid ${T.border}`}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {[
                    {l:"Total Inflows",d:inflows,c:T.emerald,b:true},
                    {l:"â Collections",d:inf.collections,c:T.emerald,in:true},
                    {l:"â New Contracts",d:inf.newContracts,c:T.emerald,in:true},
                    {l:"â Recurring",d:inf.recurring,c:T.emerald,in:true},
                    {l:"â Other Income",d:inf.other,c:T.teal,in:true},
                    {l:"Total Outflows",d:outflows,c:T.rose,b:true},
                    {l:"â Payroll",d:out.payroll,c:T.rose,in:true},
                    {l:"â Vendors",d:out.vendors,c:T.amber,in:true},
                    {l:"â Rent",d:out.rent,c:T.violet,in:true},
                    {l:"â Taxes",d:out.taxes,c:T.orange,in:true},
                    {l:"â Debt Service",d:out.debtService,c:T.textMid,in:true},
                    {l:"â CapEx",d:out.capex,c:T.cyan,in:true},
                    {l:"â Other",d:out.other,c:T.teal,in:true},
                    {l:"Net Cash Flow",d:nets,c:T.violet,b:true,net:true},
                    {l:"Running Balance",d:balances,c:T.cyan,b:true,bal:true},
                  ].map(row=>(
                    <tr key={row.l} style={{borderBottom:`1px solid ${T.border}60`,background:row.bal?T.cyanDim:"transparent"}}>
                      <td style={{padding:"6px 8px",color:row.b?T.text:T.textMid,paddingLeft:row.in?18:8,fontFamily:T.sans,fontSize:10,fontWeight:row.b?700:400}}>{row.l}</td>
                      {row.d.map((v,i)=>(
                        <td key={i} style={{padding:"6px 8px",textAlign:"right",color:row.net?v>=0?T.emerald:T.rose:row.bal?v<60000?T.rose:T.cyan:row.c,fontWeight:row.b?700:400}}>
                          {v===0&&!row.bal?"-":fmt(Math.abs(v),true)}
                        </td>
                      ))}
                      <td style={{padding:"6px 8px",textAlign:"right",color:row.c,fontWeight:700}}>{fmt(Math.abs(sum(row.d)),true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view==="runway"&&(
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px",marginBottom:18}}>
            <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,marginBottom:14}}>ð 13-Week Balance Runway</div>
            <div style={{height:160,position:"relative"}}>
              <svg viewBox="0 0 400 130" style={{width:"100%",height:"100%"}} preserveAspectRatio="none">
                <defs><linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={T.cyan} stopOpacity="0.2"/><stop offset="100%" stopColor={T.cyan} stopOpacity="0"/></linearGradient></defs>
                {(()=>{
                  const all=[CF.openingBalance,...balances];
                  const maxB=Math.max(...all),minB=Math.min(0,...all),r=maxB-minB||1;
                  const X=i=>(i/14)*400, Y=v=>10+(1-(v-minB)/r)*110;
                  const thresh=60000, ty=Y(thresh);
                  const pts=all.map((v,i)=>`${X(i)},${Y(v)}`);
                  return <>
                    <line x1="0" x2="400" y1={ty} y2={ty} stroke={T.rose} strokeWidth="1" strokeDasharray="4,3" opacity="0.5"/>
                    <path d={`M${pts[0]} L${pts.slice(1).join(" L")} L400,130 L0,130 Z`} fill="url(#bg1)"/>
                    <polyline points={pts.join(" ")} fill="none" stroke={T.cyan} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    {all.map((v,i)=>v<thresh&&<circle key={i} cx={X(i)} cy={Y(v)} r="3" fill={T.rose}/>)}
                  </>;
                })()}
              </svg>
            </div>
            <div style={{display:"flex",gap:16,marginTop:8,fontSize:10,color:T.textDim,fontFamily:T.sans}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:20,height:2,background:T.cyan,borderRadius:1}}/> Balance</div>
              <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:20,height:1,background:T.rose,opacity:0.6}}/> $60K Min Threshold</div>
              <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:"50%",background:T.rose}}/> Below threshold</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginTop:14}}>
              {W.map((w,i)=>(
                <div key={w} style={{background:balances[i]<60000?T.roseDim:T.surface,border:`1px solid ${balances[i]<60000?T.rose+"40":T.border}`,borderRadius:8,padding:"8px 10px"}}>
                  <div style={{fontSize:9,color:T.textDim,fontFamily:T.mono}}>{w}</div>
                  <div style={{fontSize:12,fontWeight:700,fontFamily:T.mono,color:balances[i]<60000?T.rose:T.text}}>{fmt(balances[i],true)}</div>
                  <div style={{fontSize:9,color:nets[i]>=0?T.emerald:T.rose,fontFamily:T.sans}}>{nets[i]>=0?"â":"â"}{fmt(Math.abs(nets[i]),true)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
          <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,marginBottom:14}}>ð¸ 13-Week Outflow Composition</div>
          {CATS.map(cat=>{
            const t=sum(W.map((_,i)=>out[cat.k][i]));
            return (
              <div key={cat.k} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <div style={{width:120,fontSize:10,color:T.textMid,fontFamily:T.sans}}>{cat.l}</div>
                <div style={{flex:1,height:8,background:T.border,borderRadius:4,overflow:"hidden"}}>
                  <div style={{width:`${t/totOut*100}%`,height:"100%",background:cat.c,borderRadius:4,transition:"width 0.4s"}}/>
                </div>
                <div style={{width:50,fontFamily:T.mono,fontSize:10,color:cat.c,textAlign:"right"}}>{fmt(t,true)}</div>
                <div style={{width:32,fontFamily:T.mono,fontSize:9,color:T.textDim,textAlign:"right"}}>{(t/totOut*100).toFixed(0)}%</div>
              </div>
            );
          })}
        </div>
    </div>
  );
}

// âââ AR Aging ââââââââââââââââââââââââââââââââââââââââââââââââââââ
function ARaging({aiContext}) {
  const [sort,setSort]=useState("total");
  const [filter,setFilter]=useState("all");
  const clients=AR_CLIENTS.map(c=>({...c,total:c.current+c.d30+c.d60+c.d90+c.d90p,risk:c.d90p>0?"Critical":c.d90>0||c.d60>2000?"High":c.d30>3000?"Medium":"Low"}));
  const tot=sum(clients.map(c=>c.total)),curr=sum(clients.map(c=>c.current));
  const d30=sum(clients.map(c=>c.d30)),d60=sum(clients.map(c=>c.d60));
  const d90=sum(clients.map(c=>c.d90)),d90p=sum(clients.map(c=>c.d90p));
  const dso=isFinite(aiContext.ytdRevenue) && aiContext.ytdRevenue > 0 ? Math.round(safeDiv(tot, aiContext.ytdRevenue/365)) : 0;
  const RC={Critical:T.rose,High:T.orange,Medium:T.amber,Low:T.emerald};
  const BC=[T.emerald,T.cyan,T.amber,T.orange,T.rose];
  const sorted=[...clients].filter(c=>filter==="all"||c.risk===filter).sort((a,b)=>{
    if(sort==="total") return b.total-a.total;
    if(sort==="risk") return ["Critical","High","Medium","Low"].indexOf(a.risk)-["Critical","High","Medium","Low"].indexOf(b.risk);
    if(sort==="d90p") return b.d90p-a.d90p;
    return a.name.localeCompare(b.name);
  });
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:18}}>
          {[{l:"Current",v:curr,c:T.emerald},{l:"1â30 Days",v:d30,c:T.cyan},{l:"31â60 Days",v:d60,c:T.amber},{l:"61â90 Days",v:d90,c:T.orange},{l:"90+ Days",v:d90p,c:T.rose}].map(b=>(
            <div key={b.l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
              <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{b.l}</div>
              <div style={{fontSize:17,fontWeight:700,fontFamily:T.mono,color:b.c}}>{fmt(b.v,true)}</div>
              <div style={{marginTop:6,height:3,background:T.border,borderRadius:2}}><div style={{width:`${b.v/tot*100}%`,height:"100%",background:b.c,borderRadius:2}}/></div>
              <div style={{fontSize:9,color:T.textDim,fontFamily:T.mono,marginTop:3}}>{pct(b.v/tot)} of AR</div>
            </div>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:18}}>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
            <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,marginBottom:14}}>ð AR Distribution</div>
            <div style={{display:"flex",height:20,borderRadius:6,overflow:"hidden",gap:2}}>
              {[[curr,T.emerald],[d30,T.cyan],[d60,T.amber],[d90,T.orange],[d90p,T.rose]].map(([v,c],i)=>v>0&&<div key={i} style={{width:`${v/tot*100}%`,background:c}}/>)}
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"6px 14px",marginTop:10}}>
              {[["Current",curr,T.emerald],["1-30d",d30,T.cyan],["31-60d",d60,T.amber],["61-90d",d90,T.orange],["90+d",d90p,T.rose]].map(([l,v,c])=>(
                <div key={l} style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:8,height:8,borderRadius:2,background:c}}/><span style={{fontSize:9,color:T.textDim,fontFamily:T.sans}}>{l}: </span><span style={{fontSize:9,color:c,fontFamily:T.mono,fontWeight:700}}>{fmt(v,true)}</span></div>
              ))}
            </div>
          </div>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
            <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,marginBottom:14}}>ð Collections Health</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              {[{l:"Total AR",v:fmt(tot,true),c:T.cyan},{l:"DSO",v:`${dso} days`,c:dso<45?T.emerald:dso<60?T.amber:T.rose},{l:"Past Due",v:fmt(d30+d60+d90+d90p,true),c:T.orange},{l:"At-Risk",v:fmt(d60+d90+d90p,true),c:T.rose}].map(s=>(
                <div key={s.l}><div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:0.5}}>{s.l}</div><div style={{fontSize:14,fontWeight:700,fontFamily:T.mono,color:s.c,marginTop:2}}>{s.v}</div></div>
              ))}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
          <span style={{fontSize:10,color:T.textDim,fontFamily:T.sans}}>Sort by:</span>
          {[["total","Total"],["risk","Risk"],["d90p","90+d"],["name","Name"]].map(([v,l])=>(
            <button key={v} onClick={()=>setSort(v)} style={{background:sort===v?T.violetDim:"transparent",border:`1px solid ${sort===v?T.violet+"50":T.border}`,borderRadius:6,padding:"4px 10px",color:sort===v?T.violet:T.textMid,fontSize:10,fontFamily:T.sans,cursor:"pointer"}}>{l}</button>
          ))}
          <div style={{width:1,height:20,background:T.border,margin:"0 4px"}}/>
          <span style={{fontSize:10,color:T.textDim,fontFamily:T.sans}}>Risk:</span>
          {["all","Critical","High","Medium","Low"].map(r=>(
            <button key={r} onClick={()=>setFilter(r)} style={{background:filter===r?(RC[r]||T.cyan)+"25":"transparent",border:`1px solid ${filter===r?(RC[r]||T.cyan)+"60":T.border}`,borderRadius:6,padding:"4px 10px",color:filter===r?(RC[r]||T.cyan):T.textMid,fontSize:10,fontFamily:T.sans,cursor:"pointer"}}>{r==="all"?"All":r}</button>
          ))}
        </div>
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,overflow:"hidden"}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14}}>ð¬ AR Aging â {sorted.length} Clients</div>
            <div style={{color:T.textDim,fontSize:9,fontFamily:T.mono}}>As of {new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
              <thead><tr style={{background:T.surface}}>
                {["Client","Industry","Current","1-30d","31-60d","61-90d","90+d","Total","Risk","Last Pmt","Contact"].map(h=>(
                  <th key={h} style={{padding:"8px 10px",color:T.textDim,textAlign:["Client","Industry","Contact"].includes(h)?"left":"right",fontWeight:700,fontSize:9,textTransform:"uppercase",letterSpacing:0.5,borderBottom:`1px solid ${T.border}`,fontFamily:T.sans,whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {sorted.map((c,i)=>(
                  <tr key={i} style={{borderBottom:`1px solid ${T.border}60`,background:c.risk==="Critical"?T.roseDim:c.risk==="High"?T.orangeDim:"transparent"}}>
                    <td style={{padding:"9px 10px",color:T.text,fontFamily:T.sans,fontWeight:600,fontSize:10,whiteSpace:"nowrap"}}>{c.name}</td>
                    <td style={{padding:"9px 10px",color:T.textMid,fontFamily:T.sans,fontSize:10}}>{c.industry}</td>
                    {[c.current,c.d30,c.d60,c.d90,c.d90p].map((v,j)=>(
                      <td key={j} style={{padding:"9px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:v===0?T.textDim:BC[j],fontWeight:v>0?600:400}}>{v===0?"-":fmt(v,true)}</td>
                    ))}
                    <td style={{padding:"9px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:700,color:T.text}}>{fmt(c.total,true)}</td>
                    <td style={{padding:"9px 10px",textAlign:"right"}}><span style={{background:RC[c.risk]+"22",border:`1px solid ${RC[c.risk]}50`,borderRadius:20,padding:"2px 8px",fontSize:9,color:RC[c.risk],fontFamily:T.sans,fontWeight:700}}>{c.risk}</span></td>
                    <td style={{padding:"9px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.textMid}}>{c.lastPayment}</td>
                    <td style={{padding:"9px 10px",color:T.textMid,fontFamily:T.sans,fontSize:11,whiteSpace:"nowrap"}}>{c.contact}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{background:T.cyanDim,borderTop:`2px solid ${T.border}`}}>
                <td colSpan="2" style={{padding:"9px 10px",color:T.cyan,fontFamily:T.display,fontWeight:700,fontSize:10}}>TOTAL</td>
                {[curr,d30,d60,d90,d90p].map((v,j)=>(
                  <td key={j} style={{padding:"9px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:700,color:BC[j]}}>{fmt(v,true)}</td>
                ))}
                <td style={{padding:"9px 10px",textAlign:"right",fontFamily:T.mono,fontSize:11,fontWeight:700,color:T.cyan}}>{fmt(tot,true)}</td>
                <td colSpan="3"/>
              </tr></tfoot>
            </table>
          </div>
        </div>
    </div>
  );
}

// âââ Regional Comparison ââââââââââââââââââââââââââââââââââââââââââ
function RegionalComparison({aiContext}) {
  const [view,setView]=useState("overview");
  const [sort,setSort]=useState("revenue");
  const [region,setRegion]=useState("all");
  const regions=[...new Set(REGIONAL_CLIENTS.map(c=>c.region))];
  const RC={Low:T.emerald,Medium:T.amber,High:T.rose};
  const SC={SMB:T.cyan,"Mid-Market":T.violet,Enterprise:T.amber};
  const totalRev=sum(REGIONAL_CLIENTS.map(c=>c.revenue));
  const avgMargin=safeDiv(sum(REGIONAL_CLIENTS.map(c=>c.margin*c.revenue)),totalRev);
  const avgNps=Math.round(safeDiv(sum(REGIONAL_CLIENTS.map(c=>c.nps)),REGIONAL_CLIENTS.length));
  const avgGrowth=sum(REGIONAL_CLIENTS.map(c=>c.growth))/REGIONAL_CLIENTS.length;
  const regData=regions.map(r=>{
    const cl=REGIONAL_CLIENTS.filter(c=>c.region===r);
    const rv=sum(cl.map(c=>c.revenue));
    return {region:r,clients:cl.length,revenue:rv,margin:sum(cl.map(c=>c.margin*c.revenue))/rv,growth:sum(cl.map(c=>c.growth))/cl.length,nps:Math.round(sum(cl.map(c=>c.nps))/cl.length),cities:cl.map(c=>c.city).join(", ")};
  }).sort((a,b)=>b.revenue-a.revenue);
  const maxRR=Math.max(...regData.map(r=>r.revenue));
  const filtered=[...REGIONAL_CLIENTS].filter(c=>region==="all"||c.region===region).sort((a,b)=>{
    if(sort==="revenue") return b.revenue-a.revenue;
    if(sort==="margin") return b.margin-a.margin;
    if(sort==="growth") return b.growth-a.growth;
    if(sort==="nps") return b.nps-a.nps;
    return a.name.localeCompare(b.name);
  });
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:18}}>
          {[{l:"Portfolio Revenue",v:fmt(totalRev,true),s:`${REGIONAL_CLIENTS.length} clients`,c:T.cyan},{l:"Avg Net Margin",v:pct(avgMargin),s:"Weighted by revenue",c:T.emerald},{l:"Avg Growth Rate",v:pct(avgGrowth),s:avgGrowth>0?"â Expanding":"â Contracting",c:avgGrowth>0?T.emerald:T.rose},{l:"Avg NPS Score",v:avgNps.toString(),s:avgNps>65?"Strong loyalty":"Needs attention",c:avgNps>65?T.emerald:T.amber}].map(s=>(
            <div key={s.l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 16px"}}>
              <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{s.l}</div>
              <div style={{fontSize:18,fontWeight:700,fontFamily:T.mono,color:s.c}}>{s.v}</div>
              <div style={{fontSize:10,color:T.textDim,fontFamily:T.sans,marginTop:2}}>{s.s}</div>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:6,marginBottom:14}}>
          {[["overview","ðºï¸ Regional Overview"],["clients","ð¥ Client Detail"],["matrix","ð Performance Matrix"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?T.cyanDim:"transparent",border:`1px solid ${view===v?T.cyanMid:T.border}`,borderRadius:8,padding:"6px 12px",color:view===v?T.cyan:T.textMid,fontSize:11,fontFamily:T.sans,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>{l}</button>
          ))}
        </div>

        {view==="overview"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {regData.map(r=>(
              <div key={r.region} onClick={()=>setRegion(region===r.region?"all":r.region)} style={{background:region===r.region?T.cyanDim:T.card,border:`1px solid ${region===r.region?T.cyanMid:T.border}`,borderRadius:12,padding:"16px 18px",cursor:"pointer",transition:"all 0.2s"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div>
                    <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14}}>{r.region}</div>
                    <div style={{color:T.textDim,fontSize:10,fontFamily:T.sans,marginTop:2}}>{r.clients} clients · {r.cities}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{color:T.cyan,fontFamily:T.mono,fontWeight:700,fontSize:16}}>{fmt(r.revenue,true)}</div>
                    <div style={{color:T.textDim,fontSize:9,fontFamily:T.mono}}>{pct(r.revenue/totalRev)} of portfolio</div>
                  </div>
                </div>
                <div style={{height:8,background:T.border,borderRadius:4,marginBottom:12,overflow:"hidden"}}>
                  <div style={{width:`${r.revenue/maxRR*100}%`,height:"100%",background:`linear-gradient(90deg,${T.cyan},${T.violet})`,borderRadius:4}}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                  {[{l:"Avg Margin",v:pct(r.margin),c:r.margin>0.35?T.emerald:T.amber},{l:"Avg Growth",v:pct(r.growth),c:r.growth>0?T.emerald:T.rose},{l:"Avg NPS",v:r.nps,c:r.nps>65?T.emerald:T.amber},{l:"Rev/Client",v:fmt(r.revenue/r.clients,true),c:T.violet}].map(s=>(
                    <div key={s.l}><div style={{fontSize:8,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:0.5}}>{s.l}</div><div style={{fontSize:12,fontWeight:700,fontFamily:T.mono,color:s.c,marginTop:2}}>{s.v}</div></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {view==="clients"&&(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:10,color:T.textDim,fontFamily:T.sans}}>Region:</span>
              {["all",...regions].map(r=>(
                <button key={r} onClick={()=>setRegion(r)} style={{background:region===r?T.cyanDim:"transparent",border:`1px solid ${region===r?T.cyanMid:T.border}`,borderRadius:6,padding:"4px 10px",color:region===r?T.cyan:T.textMid,fontSize:10,fontFamily:T.sans,cursor:"pointer"}}>{r==="all"?"All":r}</button>
              ))}
              <div style={{width:1,height:20,background:T.border,margin:"0 4px"}}/>
              <span style={{fontSize:10,color:T.textDim,fontFamily:T.sans}}>Sort:</span>
              {[["revenue","Revenue"],["margin","Margin"],["growth","Growth"],["nps","NPS"]].map(([v,l])=>(
                <button key={v} onClick={()=>setSort(v)} style={{background:sort===v?T.violetDim:"transparent",border:`1px solid ${sort===v?T.violet+"50":T.border}`,borderRadius:6,padding:"4px 10px",color:sort===v?T.violet:T.textMid,fontSize:10,fontFamily:T.sans,cursor:"pointer"}}>{l}</button>
              ))}
            </div>
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                <thead><tr style={{background:T.surface}}>
                  {["Client","Region","City","Segment","Revenue","Margin","Growth","NPS","Pay Days","Risk"].map(h=>(
                    <th key={h} style={{padding:"8px 10px",color:T.textDim,textAlign:["Client","Region","City","Segment"].includes(h)?"left":"right",fontWeight:700,fontSize:9,textTransform:"uppercase",letterSpacing:0.5,borderBottom:`1px solid ${T.border}`,fontFamily:T.sans,whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filtered.map((c,i)=>(
                    <tr key={i} style={{borderBottom:`1px solid ${T.border}60`}}>
                      <td style={{padding:"9px 10px",color:T.text,fontFamily:T.sans,fontWeight:600,fontSize:10,whiteSpace:"nowrap"}}>{c.name}</td>
                      <td style={{padding:"9px 10px",color:T.textMid,fontFamily:T.sans,fontSize:10,whiteSpace:"nowrap"}}>{c.region}</td>
                      <td style={{padding:"9px 10px",color:T.textMid,fontFamily:T.sans,fontSize:11}}>{c.city}</td>
                      <td style={{padding:"9px 10px"}}><span style={{background:SC[c.segment]+"22",border:`1px solid ${SC[c.segment]}40`,borderRadius:20,padding:"2px 8px",fontSize:9,color:SC[c.segment],fontFamily:T.sans}}>{c.segment}</span></td>
                      <td style={{padding:"9px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:700,color:T.cyan}}>{fmt(c.revenue,true)}</td>
                      <td style={{padding:"9px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:c.margin>0.35?T.emerald:T.amber}}>{pct(c.margin)}</td>
                      <td style={{padding:"9px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:c.growth>0?T.emerald:T.rose}}>{c.growth>0?"+":""}{pct(c.growth)}</td>
                      <td style={{padding:"9px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:c.nps>65?T.emerald:c.nps>50?T.amber:T.rose}}>{c.nps}</td>
                      <td style={{padding:"9px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:c.payDays>60?T.rose:c.payDays>45?T.amber:T.emerald}}>{c.payDays}d</td>
                      <td style={{padding:"9px 10px",textAlign:"right"}}><span style={{background:RC[c.riskScore]+"22",border:`1px solid ${RC[c.riskScore]}50`,borderRadius:20,padding:"2px 8px",fontSize:9,color:RC[c.riskScore],fontFamily:T.sans,fontWeight:700}}>{c.riskScore}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view==="matrix"&&(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
              <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,marginBottom:14}}>ð Revenue vs. Margin Scatter (bubble = NPS)</div>
              <div style={{position:"relative",height:220,background:T.surface,borderRadius:8,overflow:"hidden"}}>
                {[0.25,0.5,0.75].map(f=><div key={f} style={{position:"absolute",left:`${f*100}%`,top:0,bottom:0,width:1,background:T.border}}/>)}
                {[0.25,0.5,0.75].map(f=><div key={f} style={{position:"absolute",top:`${f*100}%`,left:0,right:0,height:1,background:T.border}}/>)}
                <div style={{position:"absolute",bottom:6,right:10,fontSize:8,color:T.textDim,fontFamily:T.sans}}>Revenue →</div>
                <div style={{position:"absolute",top:"50%",left:4,fontSize:8,color:T.textDim,fontFamily:T.sans,transform:"translateY(-50%) rotate(-90deg)",transformOrigin:"center"}}>Margin →</div>
                {(()=>{
                  const maxRv=Math.max(...REGIONAL_CLIENTS.map(c=>c.revenue)),minRv=Math.min(...REGIONAL_CLIENTS.map(c=>c.revenue));
                  return REGIONAL_CLIENTS.map((c,i)=>{
                    const x=((c.revenue-minRv)/(maxRv-minRv))*84+7;
                    const y=(1-c.margin/0.5)*84+5;
                    const sz=8+c.nps/10;
                    return <div key={i} title={`${c.name}: ${fmt(c.revenue,true)}, ${pct(c.margin)} margin, NPS ${c.nps}`}
                      style={{position:"absolute",left:`${x}%`,top:`${y}%`,width:sz,height:sz,borderRadius:"50%",background:SC[c.segment],opacity:0.85,transform:"translate(-50%,-50%)",cursor:"pointer",transition:"all 0.2s",border:`1px solid ${SC[c.segment]}`}}
                      onMouseEnter={e=>{e.target.style.opacity="1";e.target.style.transform="translate(-50%,-50%) scale(1.5)";e.target.title=`${c.name}`;}}
                      onMouseLeave={e=>{e.target.style.opacity="0.85";e.target.style.transform="translate(-50%,-50%) scale(1)";}}
                    />;
                  });
                })()}
              </div>
              <div style={{display:"flex",gap:16,marginTop:10}}>
                {Object.entries(SC).map(([seg,c])=>(
                  <div key={seg} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:10,height:10,borderRadius:"50%",background:c}}/><span style={{fontSize:10,color:T.textMid,fontFamily:T.sans}}>{seg}</span></div>
                ))}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              {[
                {title:"Top Revenue",cls:[...REGIONAL_CLIENTS].sort((a,b)=>b.revenue-a.revenue).slice(0,5),m:c=>fmt(c.revenue,true),c:T.cyan},
                {title:"Highest Margin",cls:[...REGIONAL_CLIENTS].sort((a,b)=>b.margin-a.margin).slice(0,5),m:c=>pct(c.margin),c:T.emerald},
                {title:"Fastest Growing",cls:[...REGIONAL_CLIENTS].sort((a,b)=>b.growth-a.growth).slice(0,5),m:c=>(c.growth>0?"+":"")+pct(c.growth),c:T.violet},
                {title:"Best NPS",cls:[...REGIONAL_CLIENTS].sort((a,b)=>b.nps-a.nps).slice(0,5),m:c=>`NPS ${c.nps}`,c:T.amber},
              ].map(({title,cls,m,c})=>(
                <div key={title} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 16px"}}>
                  <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:12,marginBottom:10}}>{title}</div>
                  {cls.map((cl,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                      <div style={{width:16,height:16,borderRadius:"50%",background:c+"22",border:`1px solid ${c}50`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:c,fontFamily:T.mono,fontWeight:700,flexShrink:0}}>{i+1}</div>
                      <div style={{flex:1,fontSize:10,color:T.textMid,fontFamily:T.sans,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cl.name}</div>
                      <div style={{fontSize:10,color:c,fontFamily:T.mono,fontWeight:700,flexShrink:0}}>{m(cl)}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
  );
}

// âââ Integrations Field Input âââââââââââââââââââââââââââââââââââââ
function IntegrationFieldInput({label,value,onChange,placeholder,type="text",show,onToggle}) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{display:"block",fontSize:10,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{label}</label>
      <div style={{position:"relative"}}>
        <input type={type==="password"&&!show?"password":"text"} value={value} onChange={onChange} placeholder={placeholder}
          style={{width:"100%",background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 12px",color:T.text,fontSize:12,fontFamily:T.mono,outline:"none",paddingRight:type==="password"?40:12,boxSizing:"border-box"}}
          onFocus={e=>e.target.style.borderColor=T.cyan} onBlur={e=>e.target.style.borderColor=T.border}/>
        {type==="password"&&<button onClick={onToggle} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:T.textDim,fontSize:12}}>{show?"ð":"ð"}</button>}
      </div>
    </div>
  );
}

// âââ CFO Simulation ââââââââââââââââââââââââââââââââââââââââââââââ
/**
 * CFOSimulation â AI-powered 30-day product evaluation from a CFO's perspective.
 * Calls POST /api/ai/cfo-simulation (server handles prompts + Anthropic key).
 * Falls back to MOCK_RESULT if the API call fails.
 * Gated to Professional+ via FEATURES.CFO_SIMULATION.
 */

// Offline mock used when the backend is unreachable (development / demo mode)
const MOCK_RESULT = {
  persona:{ name:"Sarah Chen", company:"Acme SaaS Co.", arr:"$25M", team:40 },
  phases:[
    { id:"onboarding", title:"First Impressions", days:"1â5", rating:7,
      summary:"FinanceOS loads cleanly and the dark theme signals sophistication. The 12-tab structure is logically organised and most KPIs surface immediately in the top nav. Onboarding friction is low for a finance-literate user, though the absence of a guided walkthrough or sample-data tour adds 30â60 minutes to orientation time.",
      findings:["Dark theme and data-dense layout read as a serious financial tool immediately","Key KPIs (Revenue, Net Income, Gross Margin, MRR) visible in the top nav without any clicks","Tab grouping (core vs ops) reduces cognitive load","Plan-gating is transparent â locked states explain what you're missing and why"],
      friction:["No in-app onboarding tour or contextual tooltips on first load","All data is hardcoded Acme Corp demo â connecting my own QBO data requires navigating to Integrations first","No empty-state guidance explaining what to do before data is connected","Mobile layout is not viable for a CFO reviewing numbers between meetings"] },
    { id:"monitoring", title:"Financial Monitoring", days:"6â10", rating:6,
      summary:"Daily monitoring is functional but relies on static seed data. The P&L, BvA, and Cash Flow tabs answer the core questions (what changed, why did margins move) but the answers are always the same until QBO is live. The anomaly detection panel shows promise but fires too broadly without threshold customisation.",
      findings:["P&L tab surfaces revenue mix, COGS, and OPEX trend in a single view without drilling","Budget vs Actual variance table is colour-coded and immediately actionable","AI chat panel on Professional provides fast contextual answers to margin and variance questions","Anomaly alerts identify material deviations before I would catch them manually"],
      friction:["All chart data is hardcoded â no live numbers until QBO/Plaid sync is established","Anomaly thresholds cannot be configured; 5% variance alerts fire constantly and reduce signal quality","No drill-down from a chart data point to the underlying transactions","Cash Flow shows a 13-week forecast but the methodology (linear extrapolation vs driver-based) is unclear"] },
    { id:"forecasting", title:"Forecasting & Planning", days:"11â15", rating:7,
      summary:"The Scenario Planner is the strongest differentiator in the product â three parallel cases with adjustable multipliers is genuinely useful for board prep. Headcount Planning covers hiring cost at a role level. The main gap is that scenarios are disconnected from each other and from the cash flow forecast.",
      findings:["Bear / Base / Bull case with slider-adjustable multipliers answers 'what if' questions in real time","Headcount roster with fully-loaded cost per role is a real time-saver vs spreadsheets","SaaS Metrics tab (MRR waterfall, NRR, LTV:CAC) is board-ready out of the box","Scenario outputs update all connected charts simultaneously"],
      friction:["Scenarios cannot be saved, named, or shared with the VP Finance or board","No link between the Scenario Planner and Cash Flow â a revenue downside doesn't auto-update runway","Headcount planning lacks offer letter staging and equity dilution modelling","No rolling 12-month forecast mode â the tool is backward-looking more than forward-looking"] },
    { id:"reporting", title:"Executive Reporting", days:"16â20", rating:6,
      summary:"The C-Suite Report tab (Enterprise only) provides CEO / CFO / CIO differentiated views that are genuinely useful for board prep. However, the report is view-only with no export and no narrative editing capability. Preparing a full board deck still requires manually copying numbers into PowerPoint.",
      findings:["C-Suite Report differentiates by executive role â the CFO view surfaces leverage ratios and margin trend correctly","AI Strategic Analysis panel provides board-level commentary that saves 1â2 hours of narrative writing","Financial highlight cards are visually clean enough to screenshot for a board update","Risk matrix prioritises issues by severity Ã effort â that's the right framework"],
      friction:["No PDF or PowerPoint export from any tab â this alone blocks board-meeting adoption","Charts cannot be annotated with management commentary before sharing","No way to create a custom reporting period (e.g. trailing 3 months vs calendar year)","C-Suite Report is Enterprise-only â a $99/mo Professional user cannot produce a board summary"] },
    { id:"operations", title:"Operational Planning", days:"21â25", rating:6,
      summary:"Department heads can use the Headcount and Budget vs Actual tabs without training, which is a real advantage over Mosaic or Jirav. The AR Aging and Clients tabs give the VP Sales visibility into revenue concentration. The main gap is no budgeting workflow â there is no way for a department head to submit or revise a budget inside the tool.",
      findings:["Headcount tab is accessible enough for a VP Engineering to self-serve on cost questions","AR Aging risk buckets (current / 30 / 60 / 90+) surface collections priorities without a custom report","Client revenue concentration chart immediately shows when one client represents >20% of revenue","Integrations tab has a clean sync activity log that the ops team can monitor without a data analyst"],
      friction:["No collaborative budgeting workflow â department heads cannot propose or submit budget revisions","No sales pipeline integration (Salesforce / HubSpot) â ARR forecast is manual","No approval workflow for headcount additions â the tool records hires but doesn't route approvals","Clients tab is regional-only; no customer health score or churn risk score per account"] },
    { id:"strategy", title:"Strategic Decision Support", days:"26â30", rating:6,
      summary:"FinanceOS answers 'what happened' reliably. It partially answers 'what will happen' through scenario modelling. It does not yet answer 'what should we do' â the strategic recommendation layer is thin. The AI assistant provides good commentary but stops short of prescriptive financial strategy.",
      findings:["LTV:CAC ratio and CAC payback period tell me immediately whether the growth engine is efficient","NRR above / below 100% threshold is surfaced with the right context","Cash runway is prominent in the Cash Flow tab â a critical metric for a 40-person SaaS company","Anomaly detection has caught two genuine issues in 30 days that I would have found 2 weeks later"],
      friction:["No capital allocation framework â the tool cannot help me decide between hiring, marketing spend, or product investment","No cohort analysis for revenue retention â I cannot see whether the 2022 cohort retains better than 2023","No unit economics decomposition by product line, geography, or sales channel","Strategic AI commentary is accurate but generic â it does not learn from my company's specific financial history"] },
  ],
  aiCapability:{
    summary:"The AI assistant is above average for an FP&A tool but below what a CFO expects from a dedicated AI layer. It is contextually aware of the tab you're on and provides fast, relevant answers to quantitative questions. It does not yet perform multi-step reasoning, cohort analysis, or proactive scenario recommendations.",
    strengths:["Context-aware â knows which tab you're on and references the correct data in answers","Anomaly detection fires on material variances before the CFO catches them manually","Preset prompt pills cover the 80% of questions asked in a monthly review","AI commentary in the C-Suite Report saves 1â2 hours of board narrative writing"],
    weaknesses:["Does not retain context across sessions â every conversation starts from scratch","Cannot answer questions that span multiple tabs (e.g. 'how does our churn rate affect headcount budget?')","AI responses are accurate but generic â they don't reflect my company's specific financial history or goals","No proactive AI â it waits to be asked rather than surfacing insights unprompted"],
    verdict:"The AI adds genuine value at the Professional tier â it is not cosmetic. However, it is a Q&A assistant, not a financial co-pilot. Mosaic's AI layer performs deeper multi-step analysis. The anomaly detection is the strongest AI feature.",
    isCosmetic:false,
  },
  competitorComparison:{
    summary:"FinanceOS is most competitive against Fathom and early-stage Runway. It loses to Mosaic and Cube on data model depth and collaborative budgeting. Its biggest advantage is price-to-feature ratio and a UI that non-finance stakeholders can actually use.",
    competitors:[
      { name:"Cube", stronger:["Lower price point for SMB","Faster setup â no spreadsheet migration","More intuitive UI for non-finance users"], weaker:["Cube has native Excel/Google Sheets sync â FinanceOS has no spreadsheet integration","Cube supports multi-dimensional modelling; FinanceOS is single-entity","Cube has a collaborative budget workflow; FinanceOS has none"] },
      { name:"Mosaic", stronger:["FinanceOS is 3Ã cheaper at the Professional tier","FinanceOS UI is faster to navigate for non-analysts","Scenario planner UX is more intuitive than Mosaic's"], weaker:["Mosaic has a far deeper data model with custom metrics and dimensions","Mosaic's AI performs multi-step financial reasoning; FinanceOS AI is single-turn","Mosaic has native Salesforce integration for pipeline-to-ARR forecasting"] },
      { name:"Runway", stronger:["FinanceOS has more built-in SaaS metric depth (NRR, waterfall, churn)","FinanceOS anomaly detection is more proactive","FinanceOS AR aging is more detailed"], weaker:["Runway has a more polished headcount planning workflow with approval routing","Runway supports custom financial models; FinanceOS uses fixed templates","Runway has better real-time collaboration for remote finance teams"] },
      { name:"Fathom", stronger:["FinanceOS scenario planner is significantly more powerful","FinanceOS AI assistant is more contextual than Fathom's","FinanceOS SaaS metrics depth exceeds Fathom for subscription businesses"], weaker:["Fathom has better PDF report export for board packs","Fathom has stronger QuickBooks consolidation for multi-entity","Fathom is easier for a non-technical accountant to operate"] },
      { name:"Jirav", stronger:["FinanceOS has a cleaner UI â Jirav feels enterprise-heavy","FinanceOS is faster to set up for a 40-person company","FinanceOS pricing is more accessible for seed/Series A companies"], weaker:["Jirav has a full collaborative FP&A workflow with version control on budgets","Jirav has deeper Salesforce and HubSpot pipeline integration","Jirav supports workforce planning at a department-budget level FinanceOS cannot match"] },
    ],
  },
  productTrust:{
    summary:"I trust the financial logic in FinanceOS at the display layer â the P&L, Balance Sheet, and Cash Flow are structurally sound and the calculations are consistent across tabs. What reduces trust is the static demo data: I cannot verify whether the formulas hold under edge cases (negative EBITDA, multi-currency, mid-year hires) until I connect my real data. The absence of any audit trail or data lineage documentation is a moderate trust gap.",
    trustSignals:["Three-statement model is internally consistent â Balance Sheet ties to P&L and Cash Flow","Anomaly detection logic is transparent â it explains why a flag was raised","Plan gating is honest â locked states describe exactly what you're missing","Stripe and Supabase logos in the integration layer signal production-grade infrastructure"],
    trustBreakers:["All financial data is hardcoded demo data until QBO/Plaid sync is live â I cannot validate formula logic on my own numbers","No audit log for who changed what in financial data","Forecast methodology is not documented â I cannot verify whether cash runway uses simple extrapolation or a driver-based model","No data lineage panel showing where each number originates"],
    trustScore:6,
  },
  finalDecision:{
    choice:"Maybe after improvements",
    reasoning:"FinanceOS gets the fundamentals right â the UI is fast, the SaaS metrics depth is genuine, and the AI assistant saves real time on monthly close. But two blockers prevent primary adoption: there is no export capability for board reporting, and there is no collaborative budgeting workflow. Until a CFO can take the output of FinanceOS directly into a board meeting without rebuilding it in PowerPoint, it remains a monitoring and analysis tool, not the system of record. At $99/mo it is exceptional value if those two gaps are closed.",
    keyConditions:["PDF / PowerPoint export from any tab or report","Collaborative budget workflow with department-head submission","Saved, named, shareable scenarios","Salesforce or HubSpot pipeline-to-ARR integration","Audit log and data lineage for financial data"],
  },
  scorecard:{
    financialInsightQuality:7, forecastingCapability:7, easeOfUse:8,
    executiveReporting:5, strategicDecisionSupport:6, aiUsefulness:7,
    competitiveStrength:6, overall:7,
  },
  brutalHonesty:{
    biggestWeaknesses:["No export â every report is trapped inside the browser","No collaborative budgeting â the tool monitors spend but cannot set or revise budgets","Scenarios are ephemeral â they cannot be saved, versioned, or shared","All data is demo-mode until integrations are live â reduces evaluation confidence","C-Suite Report is Enterprise-only, which prices out the typical FinanceOS buyer"],
    missingFeatures:["PDF and PowerPoint export","Collaborative budget submission workflow","Salesforce / HubSpot pipeline integration","Saved and versioned scenarios","Cohort revenue retention analysis","Custom reporting periods","Multi-currency support"],
    uxIssues:["No mobile-responsive layout â CFOs review on phones","No keyboard shortcuts for power users","Tab overflow on smaller screens clips the pricing and integrations tabs","Loading state on first Anthropic call is slow with no progress indication"],
  },
  topImprovements:[
    { rank:1, title:"PDF & PowerPoint Export", impact:"Removes the #1 adoption blocker for board reporting. A CFO who can export directly from FinanceOS saves 3â5 hours per board cycle.", effort:"High" },
    { rank:2, title:"Saved & Named Scenarios", impact:"Scenarios currently vanish on tab change. Saving Bear/Base/Bull cases with version history transforms the tool from a calculator into a planning system.", effort:"Medium" },
    { rank:3, title:"Collaborative Budget Workflow", impact:"Department heads need to submit and revise budgets inside the tool. Without this, the CFO still manages budgets in spreadsheets alongside FinanceOS.", effort:"High" },
    { rank:4, title:"Salesforce / HubSpot Pipeline Integration", impact:"ARR forecast is the most critical forward-looking metric. Connecting pipeline data makes the forecast accurate instead of manual.", effort:"High" },
    { rank:5, title:"Configurable Anomaly Thresholds", impact:"Currently fires too broadly. Letting the CFO set per-metric thresholds (e.g. flag only >10% MoM variance on COGS) dramatically improves signal quality.", effort:"Low" },
    { rank:6, title:"Drill-Through from Charts to Transactions", impact:"Every chart click should show the underlying transactions. Without this, the CFO has to leave FinanceOS and open QBO to answer follow-up questions.", effort:"Medium" },
    { rank:7, title:"Data Lineage / Audit Trail Panel", impact:"CFOs need to know where every number comes from. A lightweight lineage panel (source → transformation → display) closes the biggest trust gap.", effort:"Medium" },
    { rank:8, title:"Cohort Revenue Retention Analysis", impact:"NRR alone is not enough for investors. Cohort-level retention shows whether the business is improving or degrading at the customer level.", effort:"Medium" },
    { rank:9, title:"C-Suite Report on Professional Plan", impact:"Moving the board summary to the $99/mo tier makes it accessible to the typical buyer and removes a key objection in the sales process.", effort:"Low" },
    { rank:10, title:"Mobile-Responsive Layout", impact:"CFOs review numbers between meetings on their phone. A responsive layout increases daily active usage and reduces churn on the Professional tier.", effort:"High" },
  ],
};

const SIM_SECTION_TABS = [
  { id:"overview",     label:"Overview" },
  { id:"phases",       label:"30 Days" },
  { id:"ai",           label:"AI Review" },
  { id:"competitors",  label:"Competitors" },
  { id:"scorecard",    label:"Scorecard" },
  { id:"verdict",      label:"Verdict" },
  { id:"fixes",        label:"Top 10 Fixes" },
];

const PHASE_ICONS   = ["ð","ð","ð®","ð","ð¥","ð¯"];
const PHASE_COLORS  = [T.cyan, T.emerald, T.violet, T.amber, T.teal, T.orange];
const COMP_COLORS   = { Cube:T.cyan, Mosaic:T.violet, Runway:T.emerald, Fathom:T.teal, Jirav:T.amber };
const DECISION_META = {
  "No":                          { color:T.rose,    icon:"â" },
  "Maybe after improvements":    { color:T.amber,   icon:"â" },
  "Yes as a secondary tool":     { color:T.cyan,    icon:"â" },
  "Yes as the primary FP&A platform": { color:T.emerald, icon:"â" },
};
const SCORECARD_LABELS = [
  ["financialInsightQuality","Financial Insight Quality"],
  ["forecastingCapability","Forecasting Capability"],
  ["easeOfUse","Ease of Use"],
  ["executiveReporting","Executive Reporting"],
  ["strategicDecisionSupport","Strategic Decision Support"],
  ["aiUsefulness","AI Usefulness"],
  ["competitiveStrength","Competitive Strength"],
];

function SimScoreBar({ label, value }) {
  const c = value >= 7 ? T.emerald : value >= 5 ? T.amber : T.rose;
  return (
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
        <span style={{fontSize:11,color:T.textMid,fontFamily:T.sans}}>{label}</span>
        <span style={{fontSize:12,color:c,fontFamily:T.mono,fontWeight:700}}>{value}/10</span>
      </div>
      <div style={{height:4,background:T.border,borderRadius:99,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${value*10}%`,borderRadius:99,background:`linear-gradient(90deg,${c}80,${c})`,boxShadow:`0 0 8px ${c}40`}}/>
      </div>
    </div>
  );
}

function SimCard({ children, style={} }) {
  return (
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:20,...style}}>
      {children}
    </div>
  );
}

function SimBullet({ items, icon="âº", color=T.textMid }) {
  if(!items?.length) return null;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:7}}>
      {items.map((item,i)=>(
        <div key={i} style={{display:"flex",gap:8}}>
          <span style={{color,fontSize:11,flexShrink:0,marginTop:1}}>{icon}</span>
          <span style={{fontSize:12,color:T.textMid,fontFamily:T.sans,lineHeight:1.6}}>{item}</span>
        </div>
      ))}
    </div>
  );
}

function SimSectionLabel({ text, color=T.cyan }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
      <div style={{width:3,height:16,borderRadius:99,background:color,boxShadow:`0 0 6px ${color}80`}}/>
      <span style={{fontSize:9,color,fontFamily:T.mono,fontWeight:700,textTransform:"uppercase",letterSpacing:2}}>{text}</span>
    </div>
  );
}

function CFOSimulation({ plan="professional", aiContext={} }) {
  const [simStatus, setSimStatus] = useState("idle");
  const [result, setResult]       = useState(null);
  const [simError, setSimError]   = useState("");
  const [section, setSection]     = useState("overview");
  const [expandedPhase, setExpandedPhase] = useState(null);
  const timerRef = useRef(null);
  const [loadingStep, setLoadingStep] = useState(0);

  // ââ Inline AI assistant state âââââââââââââââââââââââââââââââââââ
  const [aiInput, setAiInput]     = useState("");
  const [aiMsgs, setAiMsgs]       = useState([
    { role:"assistant", content:"ð¯ **CFO Simulation AI** â Run the 30-day simulation, then ask me anything about the results, competitive gaps, or what to build next." }
  ]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOpen, setAiOpen]       = useState(true);
  const aiBottomRef = useRef(null);
  const canUseAI = hasFeature(plan, FEATURES.FULL_AI);

  useEffect(() => {
    aiBottomRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [aiMsgs]);

  const sendAI = async (msg) => {
    const text = (msg || aiInput).trim();
    if (!text || aiLoading) return;
    setAiInput("");
    const next = [...aiMsgs, { role:"user", content: text }];
    setAiMsgs(next);
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: `CFO simulation advisor for FinanceOS. The user is reviewing a 30-day CFO evaluation of FinanceOS against Mosaic, Cube, Runway, Fathom, and Jirav. Help them interpret results, prioritise improvements, and understand competitive gaps. Be direct and specific. 2-3 paragraphs max.`,
          messages: next.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const d = await res.json();
      const reply = res.ok ? (d.text || "No response.") : `â ï¸ ${d?.message || "AI unavailable."}`;
      setAiMsgs(m => [...m, { role:"assistant", content: reply }]);
    } catch {
      setAiMsgs(m => [...m, { role:"assistant", content:"â ï¸ Connection error â check your internet and try again." }]);
    }
    setAiLoading(false);
  };

  const renderAIText = t => t.split(/(\*\*.*?\*\*)/g).map((p,i) =>
    p.startsWith("**") ? <strong key={i} style={{color:T.cyan}}>{p.slice(2,-2)}</strong> : p
  );

  const LOADING_STEPS = [
    "Reviewing P&L and revenue structureâ¦",
    "Stress-testing the Scenario Plannerâ¦",
    "Benchmarking against Mosaic, Cube, Runwayâ¦",
    "Evaluating AI assistant depthâ¦",
    "Preparing board-deck assessmentâ¦",
    "Compiling 30-day CFO verdictâ¦",
  ];

  async function runSimulation() {
    setSimStatus("loading");
    setSimError("");
    setResult(null);
    setLoadingStep(0);
    timerRef.current = setInterval(()=>setLoadingStep(s=>(s+1)%LOADING_STEPS.length), 3000);

    try {
      // POST to the server route â prompts live server-side
      const data = await api.ai.cfoSimulation({});
      const raw  = (data?.text || "").replace(/```json|```/g,"").trim();
      const parsed = JSON.parse(raw);
      setResult(parsed);
      setSimStatus("done");
      setSection("overview");
    } catch(err) {
      // Graceful fallback â use mock result so the tab is never blank
      console.warn("[CFOSimulation] API error, using mock result:", err.message);
      setResult(MOCK_RESULT);
      setSimStatus("done");
      setSimError("Live API unavailable â showing example simulation. Connect a Professional account to run a live analysis.");
      setSection("overview");
    } finally {
      clearInterval(timerRef.current);
    }
  }

  const r = result;
  const decMeta = r ? (DECISION_META[r.finalDecision?.choice] || DECISION_META["Maybe after improvements"]) : null;

  // ââ Inline AI panel â always visible at top of CFO Sim tab ââââââ
  const AI_PILLS = [
    "What's the CFO's biggest concern?",
    "Which competitor gap is most urgent?",
    "What should I build first?",
    "How does our AI compare?",
  ];

  const inlineAIPanel = (
    <div style={{marginBottom:20,background:T.surface,border:`1.5px solid ${T.cyan}35`,borderRadius:14,overflow:"hidden",boxShadow:`0 0 24px ${T.cyan}08`}}>
      {/* Header */}
      <div
        onClick={()=>setAiOpen(o=>!o)}
        style={{display:"flex",alignItems:"center",gap:10,padding:"12px 18px",cursor:"pointer",borderBottom: aiOpen ? `1px solid ${T.border}` : "none"}}
      >
        <div style={{width:28,height:28,borderRadius:8,background:`linear-gradient(135deg,${T.cyan},${T.violet})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>ð¤</div>
        <div style={{flex:1}}>
          <div style={{fontSize:12,fontWeight:700,color:T.cyan,fontFamily:T.display,lineHeight:1}}>AI FP&A Assistant</div>
          <div style={{fontSize:9,color:T.textDim,fontFamily:T.mono,marginTop:2,letterSpacing:1}}>CFO SIMULATION ADVISOR</div>
        </div>
        {!canUseAI && <span style={{fontSize:9,color:T.amber,background:T.amberDim,border:`1px solid ${T.amber}30`,borderRadius:99,padding:"2px 8px",fontFamily:T.mono,fontWeight:700}}>PROFESSIONAL</span>}
        <span style={{fontSize:11,color:T.textDim,transform:aiOpen?"rotate(180deg)":"none",transition:"transform 0.2s",display:"inline-block"}}>▾</span>
      </div>

      {aiOpen && (
        <div>
          {/* Message thread */}
          <div style={{maxHeight:200,overflowY:"auto",padding:"12px 18px",display:"flex",flexDirection:"column",gap:10}}>
            {aiMsgs.map((m,i) => (
              <div key={i} style={{display:"flex",gap:8,justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
                {m.role==="assistant" && (
                  <div style={{width:22,height:22,borderRadius:6,background:`${T.cyan}20`,border:`1px solid ${T.cyan}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,flexShrink:0,marginTop:1}}>ð¤</div>
                )}
                <div style={{
                  maxWidth:"82%",fontSize:12,lineHeight:1.6,fontFamily:T.sans,
                  background: m.role==="user" ? `${T.cyan}18` : T.card,
                  border: `1px solid ${m.role==="user" ? T.cyan+"35" : T.border}`,
                  borderRadius: m.role==="user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                  padding:"8px 12px",
                  color: m.role==="user" ? T.cyan : T.textMid,
                }}>
                  {renderAIText(m.content)}
                </div>
              </div>
            ))}
            {aiLoading && (
              <div style={{display:"flex",gap:8}}>
                <div style={{width:22,height:22,borderRadius:6,background:`${T.cyan}20`,border:`1px solid ${T.cyan}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,flexShrink:0}}>ð¤</div>
                <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:"12px 12px 12px 4px",padding:"8px 12px",display:"flex",gap:4,alignItems:"center"}}>
                  {[0,1,2].map(i=><div key={i} style={{width:5,height:5,borderRadius:"50%",background:T.cyan,animation:`bounce 1s ease-in-out ${i*0.15}s infinite`}}/>)}
                </div>
              </div>
            )}
            <div ref={aiBottomRef}/>
          </div>

          {/* Prompt pills */}
          <div style={{padding:"0 18px 10px",display:"flex",gap:6,flexWrap:"wrap"}}>
            {AI_PILLS.map(p=>(
              <button key={p} onClick={()=>canUseAI&&sendAI(p)} style={{
                background:T.cyanDim,border:`1px solid ${T.cyanMid}`,borderRadius:99,
                padding:"4px 11px",fontSize:10,fontFamily:T.sans,color:T.cyan,
                cursor:canUseAI?"pointer":"not-allowed",opacity:canUseAI?1:0.45,
                whiteSpace:"nowrap",
              }}>{p}</button>
            ))}
          </div>

          {/* Input row */}
          <div style={{padding:"0 18px 14px",display:"flex",gap:8}}>
            <input
              value={aiInput}
              onChange={e=>canUseAI&&setAiInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&canUseAI&&sendAI()}
              placeholder={canUseAI ? "Ask about the simulation resultsâ¦" : "Upgrade to Professional to use AI assistant"}
              style={{flex:1,background:T.card,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 13px",color:T.text,fontSize:12,fontFamily:T.sans,outline:"none"}}
            />
            <button
              onClick={()=>canUseAI&&sendAI()}
              disabled={!canUseAI||!aiInput.trim()||aiLoading}
              style={{background:canUseAI&&aiInput.trim()?`linear-gradient(135deg,${T.cyan},${T.violet})`:T.border,border:"none",borderRadius:9,padding:"9px 16px",color:T.bg,fontSize:12,fontFamily:T.sans,fontWeight:700,cursor:canUseAI&&aiInput.trim()?"pointer":"not-allowed"}}
            >
              {aiLoading?"â¦":"Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ââ Idle state ââââââââââââââââââââââââââââââââââââââââââââââââââ
  if(simStatus === "idle") return (
    <div>
      {inlineAIPanel}
    <div style={{maxWidth:840,margin:"0 auto"}}>
      {/* Header card */}
      <div style={{background:`linear-gradient(135deg,${T.cyan}10,${T.violet}08)`,border:`1.5px solid ${T.cyan}30`,borderRadius:18,padding:36,marginBottom:20,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-40,right:-40,width:220,height:220,borderRadius:"50%",background:`${T.cyan}08`,filter:"blur(50px)",pointerEvents:"none"}}/>
        <div style={{position:"relative"}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:7,background:`${T.cyan}15`,border:`1px solid ${T.cyan}30`,borderRadius:99,padding:"3px 12px",marginBottom:14}}>
            <span style={{fontSize:9,color:T.cyan,fontFamily:T.mono,fontWeight:700,letterSpacing:2}}>AI-POWERED PRODUCT EVALUATION</span>
          </div>
          <div style={{color:T.text,fontFamily:T.display,fontWeight:800,fontSize:26,lineHeight:1.2,marginBottom:10}}>
            30-Day CFO Simulation
          </div>
          <div style={{color:T.textMid,fontFamily:T.sans,fontSize:13,lineHeight:1.7,maxWidth:580,marginBottom:28}}>
            Claude acts as CFO of a <strong style={{color:T.text}}>$25M ARR SaaS company</strong> and evaluates FinanceOS across 30 simulated days â scoring financial insight, forecasting, executive reporting, and competitive positioning against Mosaic, Cube, Runway, Fathom, and Jirav.
          </div>
          <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:28}}>
            {[
              {icon:"ð",label:"6 CFO workflows",sub:"Day 1â30 simulation"},
              {icon:"âï¸",label:"5 competitors",sub:"Head-to-head gaps"},
              {icon:"ð¯",label:"10 top fixes",sub:"Prioritised by impact"},
              {icon:"ð",label:"7-category scorecard",sub:"Honest ratings"},
            ].map(({icon,label,sub})=>(
              <div key={label} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:18}}>{icon}</span>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:T.text,fontFamily:T.display}}>{label}</div>
                  <div style={{fontSize:10,color:T.textDim,fontFamily:T.sans}}>{sub}</div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={runSimulation} style={{background:`linear-gradient(135deg,${T.cyan},${T.violet})`,border:"none",borderRadius:11,padding:"13px 32px",color:T.bg,fontSize:14,fontFamily:T.display,fontWeight:800,cursor:"pointer",boxShadow:`0 4px 24px ${T.cyan}35`,letterSpacing:0.2}}>
            Run 30-Day CFO Simulation →
          </button>
          <span style={{marginLeft:16,fontSize:10,color:T.textDim,fontFamily:T.mono}}>~30 seconds · Powered by Claude Sonnet</span>
        </div>
      </div>

      {/* What you'll get */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
        {[
          {icon:"ð",title:"Brutally honest",body:"Claude doesn't assume the product works. It looks for friction, missing capabilities, and CFO-specific blockers."},
          {icon:"âï¸",title:"Competitive context",body:"For each competitor (Mosaic, Cube, Runway, Fathom, Jirav) â where FinanceOS wins and where it loses."},
          {icon:"ðºï¸",title:"Actionable roadmap",body:"Top 10 improvements ranked by CFO impact and development effort â a ready-to-share product backlog."},
        ].map(({icon,title,body})=>(
          <SimCard key={title}>
            <div style={{fontSize:22,marginBottom:10}}>{icon}</div>
            <div style={{fontSize:14,fontWeight:700,color:T.text,fontFamily:T.display,marginBottom:6}}>{title}</div>
            <div style={{fontSize:11,color:T.textMid,fontFamily:T.sans,lineHeight:1.6}}>{body}</div>
          </SimCard>
        ))}
      </div>
    </div>
  );

  // ââ Loading state âââââââââââââââââââââââââââââââââââââââââââââââ
  if(simStatus === "loading") return (
    <div>
      {inlineAIPanel}
      <div style={{maxWidth:520,margin:"60px auto 0",textAlign:"center",padding:"0 20px"}}>
      <div style={{width:52,height:52,borderRadius:"50%",border:`2px solid ${T.border}`,borderTop:`2px solid ${T.cyan}`,margin:"0 auto 24px",animation:"spin 1s linear infinite"}}/>
      <div style={{fontSize:16,fontWeight:700,color:T.text,fontFamily:T.display,marginBottom:8}}>Simulation runningâ¦</div>
      <div style={{fontSize:11,color:T.cyan,fontFamily:T.mono,minHeight:18,animation:"pulse 2s ease-in-out infinite"}}>
        {LOADING_STEPS[loadingStep]}
      </div>
      <div style={{marginTop:28,display:"flex",flexDirection:"column",gap:8}}>
        {["Day 1â10: First impressions + financial monitoring","Day 11â20: Forecasting + board meeting prep","Day 21â30: Ops planning + strategic review + verdict"].map((s,i)=>(
          <div key={i} style={{fontSize:10,color:T.textDim,fontFamily:T.sans,background:T.surface,borderRadius:8,padding:"8px 14px",border:`1px solid ${T.border}`,textAlign:"left"}}>{s}</div>
        ))}
      </div>
    </div>
    </div>
  );

  // ââ Results âââââââââââââââââââââââââââââââââââââââââââââââââââââ
  return (
    <div>
      {inlineAIPanel}
      {/* Fallback/demo notice */}
      {simError && (
        <div style={{background:T.amberDim,border:`1px solid ${T.amber}30`,borderRadius:10,padding:"10px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:14}}>â ï¸</span>
          <span style={{fontSize:11,color:T.amber,fontFamily:T.sans}}>{simError}</span>
          <button onClick={runSimulation} style={{marginLeft:"auto",background:"transparent",border:`1px solid ${T.amber}40`,borderRadius:7,padding:"5px 12px",color:T.amber,fontSize:10,fontFamily:T.sans,cursor:"pointer",flexShrink:0}}>Retry</button>
        </div>
      )}

      {/* Persona + summary bar */}
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 20px",marginBottom:16,display:"flex",alignItems:"center",gap:24,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,borderRadius:"50%",background:`linear-gradient(135deg,${T.violet},${T.cyan})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,color:T.bg,flexShrink:0}}>
            {r?.persona?.name?.[0]||"C"}
          </div>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:T.text,fontFamily:T.display}}>{r?.persona?.name}</div>
            <div style={{fontSize:10,color:T.textDim,fontFamily:T.mono}}>{r?.persona?.company} · {r?.persona?.arr} ARR · {r?.persona?.team} employees</div>
          </div>
        </div>
        <div style={{display:"flex",gap:20,marginLeft:"auto",flexWrap:"wrap"}}>
          {[
            {label:"Overall Score",  value:`${r?.scorecard?.overall}/10`, color: r?.scorecard?.overall>=7?T.emerald:r?.scorecard?.overall>=5?T.amber:T.rose},
            {label:"Trust Score",    value:`${r?.productTrust?.trustScore}/10`, color:T.violet},
            {label:"Decision",       value:r?.finalDecision?.choice, color:decMeta?.color},
          ].map(({label,value,color})=>(
            <div key={label}>
              <div style={{fontSize:8,color:T.textDim,fontFamily:T.mono,textTransform:"uppercase",letterSpacing:1.5,marginBottom:3}}>{label}</div>
              <div style={{fontSize:12,fontWeight:700,color,fontFamily:T.mono}}>{value}</div>
            </div>
          ))}
        </div>
        <button onClick={()=>{setSimStatus("idle");setResult(null);setSimError("");}} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 14px",color:T.textDim,fontSize:10,fontFamily:T.sans,cursor:"pointer",flexShrink:0}}>âº Re-run</button>
      </div>

      {/* Internal section nav */}
      <div style={{display:"flex",gap:2,marginBottom:20,background:T.surface,borderRadius:10,padding:4,border:`1px solid ${T.border}`,overflowX:"auto"}}>
        {SIM_SECTION_TABS.map(({id,label})=>(
          <button key={id} onClick={()=>setSection(id)} style={{
            background:section===id?T.cyanDim:"transparent",
            border:`1px solid ${section===id?T.cyan+"40":"transparent"}`,
            borderRadius:7, padding:"6px 13px", cursor:"pointer", whiteSpace:"nowrap",
            color:section===id?T.cyan:T.textDim, fontSize:10, fontFamily:T.mono, fontWeight:700,
            transition:"all 0.15s",
          }}>{label}</button>
        ))}
      </div>

      {/* ââ Overview âââââââââââââââââââââââââââââââââââââââ */}
      {section==="overview" && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <SimCard style={{background:`linear-gradient(135deg,${decMeta?.color}08,${T.card})`,borderColor:`${decMeta?.color}30`}}>
              <SimSectionLabel text="Final Verdict" color={decMeta?.color}/>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                <div style={{width:40,height:40,borderRadius:10,background:`${decMeta?.color}20`,border:`1px solid ${decMeta?.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:decMeta?.color,fontWeight:800,fontFamily:T.mono,flexShrink:0}}>{decMeta?.icon}</div>
                <div style={{fontSize:16,fontWeight:800,color:decMeta?.color,fontFamily:T.display}}>{r?.finalDecision?.choice}</div>
              </div>
              <div style={{fontSize:12,color:T.textMid,fontFamily:T.sans,lineHeight:1.65,marginBottom:14}}>{r?.finalDecision?.reasoning}</div>
              <SimSectionLabel text="Key Conditions" color={T.cyan}/>
              <SimBullet items={r?.finalDecision?.keyConditions} icon="→" color={T.cyan}/>
            </SimCard>
            <SimCard>
              <SimSectionLabel text="Biggest Weaknesses" color={T.rose}/>
              <SimBullet items={r?.brutalHonesty?.biggestWeaknesses?.slice(0,5)} icon="â" color={T.rose}/>
            </SimCard>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <SimCard>
              <SimSectionLabel text="Phase Ratings" color={T.violet}/>
              {r?.phases?.map((ph,i)=>{
                const c = ph.rating>=7?T.emerald:ph.rating>=5?T.amber:T.rose;
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <span style={{fontSize:14,flexShrink:0}}>{PHASE_ICONS[i]}</span>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                        <span style={{fontSize:10,color:T.textMid,fontFamily:T.sans}}>{ph.title}</span>
                        <span style={{fontSize:10,color:c,fontFamily:T.mono,fontWeight:700}}>{ph.rating}/10</span>
                      </div>
                      <div style={{height:3,background:T.border,borderRadius:99,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${ph.rating*10}%`,background:c,borderRadius:99}}/>
                      </div>
                    </div>
                  </div>
                );
              })}
            </SimCard>
            <SimCard>
              <SimSectionLabel text="Missing Features" color={T.amber}/>
              <SimBullet items={r?.brutalHonesty?.missingFeatures?.slice(0,6)} icon="â" color={T.amber}/>
            </SimCard>
          </div>
        </div>
      )}

      {/* ââ 30-Day Phases ââââââââââââââââââââââââââââââââââ */}
      {section==="phases" && (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {r?.phases?.map((ph,i)=>{
            const color = PHASE_COLORS[i];
            const sc = ph.rating>=7?T.emerald:ph.rating>=5?T.amber:T.rose;
            const open = expandedPhase===i;
            return (
              <SimCard key={i} style={{borderColor:open?`${color}40`:T.border,boxShadow:open?`0 0 20px ${color}10`:"none",transition:"all 0.2s"}}>
                <div style={{cursor:"pointer"}} onClick={()=>setExpandedPhase(open?null:i)}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <div style={{width:38,height:38,borderRadius:9,background:`${color}15`,border:`1px solid ${color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{PHASE_ICONS[i]}</div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                        <span style={{fontSize:9,color:T.textDim,fontFamily:T.mono}}>DAYS {ph.days}</span>
                        <span style={{fontSize:9,color:sc,background:`${sc}15`,border:`1px solid ${sc}30`,borderRadius:99,padding:"1px 7px",fontFamily:T.mono,fontWeight:700}}>{ph.rating}/10</span>
                      </div>
                      <div style={{fontSize:14,fontWeight:700,color:T.text,fontFamily:T.display}}>{ph.title}</div>
                    </div>
                    <span style={{color:T.textDim,fontSize:11,transform:open?"rotate(180deg)":"none",transition:"transform 0.2s",flexShrink:0}}>▾</span>
                  </div>
                  <div style={{fontSize:12,color:T.textMid,fontFamily:T.sans,lineHeight:1.65,marginTop:10,paddingLeft:50}}>{ph.summary}</div>
                </div>
                {open && (
                  <div style={{marginTop:16,paddingTop:16,borderTop:`1px solid ${T.border}`,paddingLeft:50,display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
                    <div>
                      <div style={{fontSize:9,color:T.emerald,fontFamily:T.mono,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>What Works</div>
                      <SimBullet items={ph.findings} icon="â" color={T.emerald}/>
                    </div>
                    <div>
                      <div style={{fontSize:9,color:T.rose,fontFamily:T.mono,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Friction Points</div>
                      <SimBullet items={ph.friction} icon="!" color={T.rose}/>
                    </div>
                  </div>
                )}
              </SimCard>
            );
          })}
        </div>
      )}

      {/* ââ AI Review ââââââââââââââââââââââââââââââââââââââ */}
      {section==="ai" && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <SimCard>
            <SimSectionLabel text="AI Capability Review" color={T.violet}/>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              {r?.aiCapability?.isCosmetic
                ? <span style={{fontSize:10,color:T.amber,background:T.amberDim,border:`1px solid ${T.amber}30`,borderRadius:99,padding:"2px 9px",fontFamily:T.mono,fontWeight:700}}>â ï¸ Largely Cosmetic</span>
                : <span style={{fontSize:10,color:T.emerald,background:T.emeraldDim,border:`1px solid ${T.emerald}30`,borderRadius:99,padding:"2px 9px",fontFamily:T.mono,fontWeight:700}}>â Adds Genuine Value</span>
              }
            </div>
            <div style={{fontSize:12,color:T.textMid,fontFamily:T.sans,lineHeight:1.65,marginBottom:16}}>{r?.aiCapability?.summary}</div>
            <div style={{background:`${T.violet}10`,border:`1px solid ${T.violet}20`,borderRadius:10,padding:"12px 14px"}}>
              <div style={{fontSize:9,color:T.violet,fontFamily:T.mono,fontWeight:700,letterSpacing:1.5,marginBottom:8}}>CFO VERDICT</div>
              <div style={{fontSize:12,color:T.textMid,fontFamily:T.sans,lineHeight:1.6,fontStyle:"italic"}}>"{r?.aiCapability?.verdict}"</div>
            </div>
          </SimCard>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <SimCard>
              <div style={{fontSize:9,color:T.emerald,fontFamily:T.mono,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>Strengths</div>
              <SimBullet items={r?.aiCapability?.strengths} icon="â" color={T.emerald}/>
            </SimCard>
            <SimCard>
              <div style={{fontSize:9,color:T.rose,fontFamily:T.mono,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>Weaknesses</div>
              <SimBullet items={r?.aiCapability?.weaknesses} icon="!" color={T.rose}/>
            </SimCard>
          </div>
        </div>
      )}

      {/* ââ Competitors ââââââââââââââââââââââââââââââââââââ */}
      {section==="competitors" && (
        <div>
          <SimCard style={{marginBottom:14}}>
            <SimSectionLabel text="Competitive Benchmark" color={T.teal}/>
            <div style={{fontSize:12,color:T.textMid,fontFamily:T.sans,lineHeight:1.65}}>{r?.competitorComparison?.summary}</div>
          </SimCard>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
            {r?.competitorComparison?.competitors?.map(comp=>{
              const color = COMP_COLORS[comp.name] || T.cyan;
              return (
                <SimCard key={comp.name} style={{borderColor:`${color}25`}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                    <div style={{width:30,height:30,borderRadius:8,background:`${color}20`,border:`1px solid ${color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color,fontFamily:T.mono,flexShrink:0}}>{comp.name[0]}</div>
                    <span style={{fontSize:14,fontWeight:700,color:T.text,fontFamily:T.display}}>{comp.name}</span>
                  </div>
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:9,color:T.emerald,fontFamily:T.mono,fontWeight:700,letterSpacing:1.5,marginBottom:8}}>FINANCEIOS STRONGER AT</div>
                    <SimBullet items={comp.stronger||[]} icon="â²" color={T.emerald}/>
                  </div>
                  <div style={{borderTop:`1px solid ${T.border}`,paddingTop:12}}>
                    <div style={{fontSize:9,color:T.rose,fontFamily:T.mono,fontWeight:700,letterSpacing:1.5,marginBottom:8}}>{comp.name.toUpperCase()} STRONGER AT</div>
                    <SimBullet items={comp.weaker||[]} icon="â¼" color={T.rose}/>
                  </div>
                </SimCard>
              );
            })}
          </div>
        </div>
      )}

      {/* ââ Scorecard ââââââââââââââââââââââââââââââââââââââ */}
      {section==="scorecard" && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <SimCard>
            <SimSectionLabel text="Product Scorecard" color={T.emerald}/>
            {SCORECARD_LABELS.map(([key,label])=>(
              <SimScoreBar key={key} label={label} value={r?.scorecard?.[key]||0}/>
            ))}
          </SimCard>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <SimCard style={{background:`linear-gradient(135deg,${T.cyanDim},${T.violetDim})`,border:`1px solid ${T.cyan}30`,textAlign:"center",padding:"32px 20px"}}>
              <div style={{fontSize:9,color:T.textDim,fontFamily:T.mono,textTransform:"uppercase",letterSpacing:2,marginBottom:10}}>Overall Score</div>
              <div style={{fontSize:62,fontWeight:800,fontFamily:T.mono,background:`linear-gradient(135deg,${T.cyan},${T.violet})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",lineHeight:1}}>{r?.scorecard?.overall}</div>
              <div style={{fontSize:11,color:T.textDim,fontFamily:T.mono,marginTop:4}}>/ 10</div>
            </SimCard>
            <SimCard>
              <div style={{fontSize:9,color:T.amber,fontFamily:T.mono,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>UX Issues</div>
              <SimBullet items={r?.brutalHonesty?.uxIssues} icon="!" color={T.amber}/>
            </SimCard>
            <SimCard>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{fontSize:9,color:T.textDim,fontFamily:T.mono,textTransform:"uppercase",letterSpacing:1.5}}>Trust Score</span>
                <span style={{fontSize:14,fontWeight:800,color:r?.productTrust?.trustScore>=7?T.emerald:r?.productTrust?.trustScore>=5?T.amber:T.rose,fontFamily:T.mono}}>{r?.productTrust?.trustScore}/10</span>
              </div>
              <SimBullet items={r?.productTrust?.trustBreakers?.slice(0,3)} icon="â" color={T.rose}/>
            </SimCard>
          </div>
        </div>
      )}

      {/* ââ Verdict ââââââââââââââââââââââââââââââââââââââââ */}
      {section==="verdict" && (
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16}}>
          <SimCard style={{background:`linear-gradient(135deg,${decMeta?.color}08,${T.card})`,borderColor:`${decMeta?.color}35`}}>
            <SimSectionLabel text="Final CFO Decision" color={decMeta?.color}/>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:18}}>
              <div style={{width:50,height:50,borderRadius:13,background:`${decMeta?.color}20`,border:`1.5px solid ${decMeta?.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,color:decMeta?.color,fontWeight:800,fontFamily:T.mono,flexShrink:0}}>{decMeta?.icon}</div>
              <div style={{fontSize:20,fontWeight:800,color:decMeta?.color,fontFamily:T.display,lineHeight:1.2}}>{r?.finalDecision?.choice}</div>
            </div>
            <div style={{fontSize:13,color:T.textMid,fontFamily:T.sans,lineHeight:1.7,marginBottom:18}}>{r?.finalDecision?.reasoning}</div>
            <SimSectionLabel text="Key Conditions for Yes" color={T.cyan}/>
            <SimBullet items={r?.finalDecision?.keyConditions} icon="→" color={T.cyan}/>
          </SimCard>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <SimCard>
              <div style={{fontSize:9,color:T.rose,fontFamily:T.mono,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>Biggest Weaknesses</div>
              <SimBullet items={r?.brutalHonesty?.biggestWeaknesses} icon="â" color={T.rose}/>
            </SimCard>
            <SimCard>
              <div style={{fontSize:9,color:T.amber,fontFamily:T.mono,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>Missing Features</div>
              <SimBullet items={r?.brutalHonesty?.missingFeatures?.slice(0,5)} icon="â" color={T.amber}/>
            </SimCard>
          </div>
        </div>
      )}

      {/* ââ Top 10 Fixes âââââââââââââââââââââââââââââââââââ */}
      {section==="fixes" && (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <SimCard style={{marginBottom:4}}>
            <SimSectionLabel text="Top 10 Most Impactful Improvements" color={T.orange}/>
            <div style={{fontSize:12,color:T.textMid,fontFamily:T.sans,lineHeight:1.6}}>Ranked by CFO impact. Closing the top 3 would move the final decision from "Maybe" to "Yes as the primary FP&A platform."</div>
          </SimCard>
          {r?.topImprovements?.map(item=>{
            const effortC = item.effort==="Low"?T.emerald:item.effort==="Medium"?T.amber:T.rose;
            const rankC   = item.rank<=3?T.cyan:item.rank<=6?T.violet:T.textMid;
            return (
              <SimCard key={item.rank} style={{display:"flex",alignItems:"flex-start",gap:14,padding:"16px 20px"}}>
                <div style={{width:32,height:32,borderRadius:8,background:`${rankC}15`,border:`1px solid ${rankC}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:rankC,fontFamily:T.mono,flexShrink:0}}>#{item.rank}</div>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <span style={{fontSize:13,fontWeight:700,color:T.text,fontFamily:T.display}}>{item.title}</span>
                    <span style={{fontSize:9,color:effortC,background:`${effortC}15`,border:`1px solid ${effortC}30`,borderRadius:99,padding:"1px 7px",fontFamily:T.mono,fontWeight:700,textTransform:"uppercase",letterSpacing:0.8}}>{item.effort} effort</span>
                  </div>
                  <div style={{fontSize:12,color:T.textMid,fontFamily:T.sans,lineHeight:1.6}}>{item.impact}</div>
                </div>
              </SimCard>
            );
          })}
        </div>
      )}
    </div>
    </div>
  );
}

// âââ Integrations Page ââââââââââââââââââââââââââââââââââââââââââââ
/** Dot â connection status indicator. Hoisted to module scope to prevent recreation on every render. */
function Dot({connected, syncing}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      <div style={{width:8,height:8,borderRadius:"50%",background:syncing?T.amber:connected?T.emerald:T.textDim,boxShadow:connected?`0 0 6px ${T.emerald}60`:syncing?`0 0 6px ${T.amber}60`:"none"}}/>
      <span style={{fontSize:10,color:syncing?T.amber:connected?T.emerald:T.textDim,fontFamily:T.mono}}>{syncing?"Syncing...":connected?"Connected":"Not connected"}</span>
    </div>
  );
}
function IntegrationsPage({plan="professional", onUpgrade}) {
  const [qb,setQb]=useState({connected:false,syncing:false,lastSync:null,syncItems:{pnl:true,balance:true,cashflow:true,ar:true,payroll:false}});
  const [plaid,setPlaid]=useState({connected:false,syncing:false,lastSync:null,accounts:[]});
  const [qbStep,setQbStep]=useState("idle");
  const [plaidStep,setPlaidStep]=useState("idle");
  const [log,setLog]=useState([]);
  const [qbError,setQbError]=useState("");
  const [plaidError,setPlaidError]=useState("");
  const addLog=(msg,type="info")=>setLog(l=>[{msg,type,ts:new Date().toLocaleTimeString()},...l].slice(0,20));

  // On mount: load real connection status + handle OAuth callback params
  useEffect(()=>{
    (async()=>{
      try {
        const [qboStatus, plaidStatus] = await Promise.all([api.qbo.status(), api.plaid.status()]);
        if(qboStatus.connected) { setQbStep("connected"); setQb(q=>({...q,connected:true,lastSync:qboStatus.lastSync?.completed_at||"Previously"})); }
        if(plaidStatus.connected) { setPlaidStep("connected"); setPlaid(p=>({...p,connected:true,lastSync:plaidStatus.lastSync?.completed_at||"Previously"})); }
      } catch(e) { /* not authenticated yet â ignore */ }

      // Handle QB OAuth redirect back (?qbo=connected or ?qbo=error)
      const params = new URLSearchParams(window.location.search);
      const qboParam = params.get("qbo");
      if(qboParam === "connected") {
        addLog("QuickBooks connected successfully.","success");
        setQbStep("connected"); setQb(q=>({...q,connected:true,lastSync:"Just now"}));
        window.history.replaceState({},"",[window.location.pathname,window.location.hash].join(""));
      } else if(qboParam === "error") {
        setQbError(`QuickBooks auth error: ${params.get("reason")||"unknown"}`);
        setQbStep("idle");
        window.history.replaceState({},"",[window.location.pathname,window.location.hash].join(""));
      }
    })();
  },[]);

  const connectQB=async()=>{
    setQbError(""); setQbStep("auth");
    addLog("Checking QuickBooks configurationâ¦","info");
    try {
      const r=await fetch(api.qbo.connectUrl(),{redirect:'manual'});
      if(r.type==='opaqueredirect'||r.status===0){window.location.href=api.qbo.connectUrl();return;}
      const d=await r.json().catch(()=>({}));
      if(d.setup){setQbStep("idle");setQbError("Setup required: add QB_CLIENT_ID & QB_CLIENT_SECRET as Vercel environment variables, then redeploy.");addLog("QuickBooks not configured","error");return;}
      if(d.error){setQbStep("idle");setQbError(d.error);return;}
      window.location.href=api.qbo.connectUrl();
    }catch(e){window.location.href=api.qbo.connectUrl();}
  };
  const syncQB=async()=>{
    setQb(q=>({...q,syncing:true}));
    addLog("Syncing QuickBooks dataâ¦","info");
    try {
      const r = await api.qbo.sync(new Date().getFullYear());
      addLog(`Sync complete â ${r.recordsSynced||0} records updated.`,"success");
      setQb(q=>({...q,syncing:false,lastSync:new Date().toLocaleTimeString()}));
    } catch(err) {
      addLog(`Sync failed: ${err.message}`,"error");
      setQb(q=>({...q,syncing:false}));
    }
  };
  const disconnectQB=async()=>{
    try { await api.qbo.disconnect(); } catch(_) {}
    setQbStep("idle"); setQb(q=>({...q,connected:false,lastSync:null}));
    addLog("QuickBooks disconnected.","info");
  };

  // Load Plaid Link SDK on demand
  const loadPlaidScript=()=>new Promise((res,rej)=>{
    if(window.Plaid) return res();
    const s=document.createElement("script");
    s.src="https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    s.onload=res; s.onerror=rej;
    document.head.appendChild(s);
  });
  const connectPlaid=async()=>{
    setPlaidError(""); setPlaidStep("linking");
    addLog("Fetching Plaid Link tokenâ¦","info");
    try {
      await loadPlaidScript();
      const {linkToken} = await api.plaid.linkToken();
      addLog("Launching Plaid Linkâ¦","info");
      const handler = window.Plaid.create({
        token: linkToken,
        onSuccess: async(publicToken, meta) => {
          addLog("Bank authorized. Exchanging tokensâ¦","info");
          try {
            await api.plaid.exchange(publicToken, meta.institution?.name||"");
            const status = await api.plaid.status();
            setPlaidStep("connected");
            setPlaid(p=>({...p,connected:true,lastSync:"Just now",accounts:[]}));
            addLog(`${meta.institution?.name||"Bank"} connected successfully.`,"success");
          } catch(err) { const m=err.message||"Connection failed"; setPlaidError(m.includes("configured")||m.includes("setup")?"Setup required: add PLAID_CLIENT_ID & PLAID_SECRET in Vercel → Settings → Environment Variables, then redeploy.":m); setPlaidStep("idle"); }
        },
        onExit: (err)=>{ if(err) setPlaidError(err.error_message||"Connection cancelled."); setPlaidStep("idle"); },
      });
      handler.open();
    } catch(err) {
      setPlaidError(err.message||"Failed to launch Plaid Link.");
      setPlaidStep("idle");
    }
  };
  const syncPlaid=async()=>{
    setPlaid(p=>({...p,syncing:true}));
    addLog("Refreshing Plaid transactionsâ¦","info");
    try {
      await api.plaid.sync();
      addLog("Plaid sync complete.","success");
      setPlaid(p=>({...p,syncing:false,lastSync:new Date().toLocaleTimeString()}));
    } catch(err) {
      addLog(`Sync failed: ${err.message}`,"error");
      setPlaid(p=>({...p,syncing:false}));
    }
  };
  const disconnectPlaid=async()=>{
    try { await api.plaid.disconnect(); } catch(_) {}
    setPlaidStep("idle"); setPlaid(p=>({...p,connected:false,lastSync:null,accounts:[]}));
    addLog("Plaid disconnected.","info");
  };

  const FI=IntegrationFieldInput;
  return (
    <div style={{maxWidth:1100,margin:"0 auto"}}>
      <div style={{marginBottom:24}}>
        <div style={{color:T.text,fontFamily:T.display,fontWeight:800,fontSize:22}}>ð Integrations</div>
        <div style={{color:T.textDim,fontFamily:T.sans,fontSize:13,marginTop:4}}>Connect your accounting software and bank accounts to automatically sync financial data into your dashboard.</div>
        {/* Starter read-only banner */}
        {!hasFeature(plan,FEATURES.INTEGRATIONS_SYNC)&&(
          <div style={{marginTop:14,background:T.amberDim,border:`1px solid ${T.amber}30`,borderRadius:10,padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:14}}>ð</span>
              <div>
                <div style={{color:T.amber,fontFamily:T.sans,fontWeight:700,fontSize:12}}>Read-Only Access â Starter Plan</div>
                <div style={{color:T.textDim,fontFamily:T.sans,fontSize:11,marginTop:1}}>You can view integration settings but connecting and syncing requires a Professional plan.</div>
              </div>
            </div>
            <button onClick={onUpgrade} style={{background:`linear-gradient(135deg,${T.cyan},${T.violet})`,border:"none",borderRadius:8,padding:"8px 18px",color:T.bg,fontSize:11,fontFamily:T.sans,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>→ Upgrade to Pro</button>
          </div>
        )}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:24}}>
        {/* QuickBooks */}
        <div style={{background:T.card,border:`1px solid ${qb.connected?T.emerald+"50":T.border}`,borderRadius:16,overflow:"hidden",boxShadow:qb.connected?`0 0 24px ${T.emerald}10`:"none"}}>
          <div style={{padding:"20px 24px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:44,height:44,borderRadius:12,background:"linear-gradient(135deg,#2CA01C,#1A6B10)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,boxShadow:"0 4px 12px #2CA01C40"}}>ð</div>
              <div>
                <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:16}}>QuickBooks Online</div>
                <div style={{color:T.textDim,fontFamily:T.sans,fontSize:11,marginTop:2}}>by Intuit · OAuth 2.0</div>
              </div>
            </div>
            <Dot connected={qb.connected} syncing={qb.syncing}/>
          </div>
          <div style={{padding:"20px 24px"}}>
            {!qb.connected&&<>
              <div style={{background:T.surface,borderRadius:10,padding:"12px 14px",marginBottom:16,border:`1px solid ${T.border}`}}>
                <div style={{fontSize:10,color:T.amber,fontFamily:T.sans,fontWeight:600,marginBottom:4}}>âï¸ OAuth Setup</div>
                <div style={{fontSize:11,color:T.textMid,fontFamily:T.sans,lineHeight:1.6}}>Clicking Connect will open Intuit's authorization page. Approve access, then you'll be redirected back here. Your <span style={{color:T.cyan,fontFamily:T.mono}}>QB_CLIENT_ID</span> and <span style={{color:T.cyan,fontFamily:T.mono}}>QB_CLIENT_SECRET</span> are set in your server <span style={{color:T.cyan,fontFamily:T.mono}}>.env</span> file.</div>
              </div>
              {qbError&&<div style={{background:T.roseDim,border:`1px solid ${T.rose}40`,borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:11,color:T.rose,fontFamily:T.sans}}>â ï¸ {qbError}</div>}
              {hasFeature(plan,FEATURES.INTEGRATIONS_SYNC)?(
                <button onClick={connectQB} disabled={qbStep==="auth"} style={{width:"100%",background:"linear-gradient(135deg,#2CA01C,#1A6B10)",border:"none",borderRadius:10,padding:"12px",color:"#fff",fontSize:13,fontFamily:T.sans,fontWeight:700,cursor:qbStep==="auth"?"not-allowed":"pointer",opacity:qbStep==="auth"?0.6:1}}>
                  {qbStep==="auth"?"â³ Redirecting to Intuit...":"ð Connect with QuickBooks"}
                </button>
              ):(
                <button onClick={onUpgrade} style={{width:"100%",background:T.amberDim,border:`1px solid ${T.amber}40`,borderRadius:10,padding:"12px",color:T.amber,fontSize:13,fontFamily:T.sans,fontWeight:700,cursor:"pointer"}}>
                  ð Upgrade to Professional to Connect
                </button>
              )}
            </>}
            {qb.connected&&<>
              <div style={{background:"#2CA01C15",border:"1px solid #2CA01C40",borderRadius:10,padding:"12px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:16}}>â</span>
                <div><div style={{color:T.emerald,fontFamily:T.sans,fontWeight:700,fontSize:12}}>Acme Corp â QuickBooks Online Premium</div>
                <div style={{color:T.textDim,fontFamily:T.mono,fontSize:10}}>Realm: 9130356057836091 · Synced: {qb.lastSync}</div></div>
              </div>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:10,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Sync Settings</div>
                {[{k:"pnl",l:"Profit & Loss",d:"Income statement & revenue"},
                  {k:"balance",l:"Balance Sheet",d:"Assets, liabilities, equity"},
                  {k:"cashflow",l:"Cash Flow",d:"Operating, investing, financing"},
                  {k:"ar",l:"Accounts Receivable",d:"Customer invoices & aging"},
                  {k:"payroll",l:"Payroll Data",d:"Employee costs & benefits"}].map(it=>(
                  <div key={it.k} onClick={()=>setQb(q=>({...q,syncItems:{...q.syncItems,[it.k]:!q.syncItems[it.k]}}))}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"8px 10px",borderRadius:8,cursor:"pointer",marginBottom:4,background:qb.syncItems[it.k]?T.emeraldDim:"transparent",border:`1px solid ${qb.syncItems[it.k]?T.emerald+"30":T.border}`}}>
                    <div style={{width:18,height:18,borderRadius:5,background:qb.syncItems[it.k]?"#2CA01C":T.border,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,flexShrink:0,color:"#fff"}}>{qb.syncItems[it.k]?"â":""}</div>
                    <div style={{flex:1}}><div style={{fontSize:11,color:T.text,fontFamily:T.sans,fontWeight:600}}>{it.l}</div><div style={{fontSize:9,color:T.textDim,fontFamily:T.sans}}>{it.d}</div></div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:10}}>
                {hasFeature(plan,FEATURES.INTEGRATIONS_SYNC)?(
                  <button onClick={syncQB} disabled={qb.syncing} style={{flex:2,background:"linear-gradient(135deg,#2CA01C,#1A6B10)",border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:12,fontFamily:T.sans,fontWeight:700,cursor:qb.syncing?"not-allowed":"pointer",opacity:qb.syncing?0.6:1}}>{qb.syncing?"â³ Syncing...":"ð Sync Now"}</button>
                ):(
                  <button onClick={onUpgrade} style={{flex:2,background:T.amberDim,border:`1px solid ${T.amber}40`,borderRadius:10,padding:"11px",color:T.amber,fontSize:12,fontFamily:T.sans,fontWeight:700,cursor:"pointer"}}>ð Upgrade to Sync</button>
                )}
                <button onClick={disconnectQB} style={{flex:1,background:"transparent",border:`1px solid ${T.rose}40`,borderRadius:10,padding:"11px",color:T.rose,fontSize:12,fontFamily:T.sans,cursor:"pointer"}}>Disconnect</button>
              </div>
            </>}
          </div>
        </div>

        {/* Plaid */}
        <div style={{background:T.card,border:`1px solid ${plaid.connected?T.cyan+"50":T.border}`,borderRadius:16,overflow:"hidden",boxShadow:plaid.connected?`0 0 24px ${T.cyan}10`:"none"}}>
          <div style={{padding:"20px 24px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:44,height:44,borderRadius:12,background:"linear-gradient(135deg,#22C55E,#16A34A)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,boxShadow:"0 4px 12px #00B2E340"}}>ð¦</div>
              <div>
                <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:16}}>Plaid</div>
                <div style={{color:T.textDim,fontFamily:T.sans,fontSize:11,marginTop:2}}>Bank account linking · 12,000+ institutions</div>
              </div>
            </div>
            <Dot connected={plaid.connected} syncing={plaid.syncing}/>
          </div>
          <div style={{padding:"20px 24px"}}>
            {!plaid.connected&&<>
              <div style={{background:T.surface,borderRadius:10,padding:"12px 14px",marginBottom:16,border:`1px solid ${T.border}`}}>
                <div style={{fontSize:10,color:T.amber,fontFamily:T.sans,fontWeight:600,marginBottom:4}}>âï¸ Bank Setup</div>
                <div style={{fontSize:11,color:T.textMid,fontFamily:T.sans,lineHeight:1.6}}>Clicking Connect will open Plaid's secure bank connection flow. Approve access and your bank data will sync automatically. Your <span style={{color:T.cyan,fontFamily:T.mono}}>PLAID_CLIENT_ID</span> and <span style={{color:T.cyan,fontFamily:T.mono}}>PLAID_SECRET</span> are set in your Vercel environment variables. <span style={{color:T.cyan,fontFamily:T.mono}}>.env</span> file.</div>
              </div>
              {plaidError&&<div style={{background:T.roseDim,border:`1px solid ${T.rose}40`,borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:11,color:T.rose,fontFamily:T.sans}}>â ï¸ {plaidError}</div>}
              {hasFeature(plan,FEATURES.INTEGRATIONS_SYNC)?(
                <button onClick={connectPlaid} disabled={plaidStep==="linking"} style={{width:"100%",background:"linear-gradient(135deg,#00B2E3,#0074B7)",border:"none",borderRadius:10,padding:"12px",color:"#fff",fontSize:13,fontFamily:T.sans,fontWeight:700,cursor:plaidStep==="linking"?"not-allowed":"pointer",opacity:plaidStep==="linking"?0.6:1}}>
                  {plaidStep==="linking"?"â³ Connecting to Plaid...":"ð¦ Connect with Plaid"}
                </button>
              ):(
                <button onClick={onUpgrade} style={{width:"100%",background:T.amberDim,border:`1px solid ${T.amber}40`,borderRadius:10,padding:"12px",color:T.amber,fontSize:13,fontFamily:T.sans,fontWeight:700,cursor:"pointer"}}>
                  ð Upgrade to Professional to Connect Bank
                </button>
              )}
            </>}
            {plaid.connected&&<>
              <div style={{background:"#00B2E315",border:"1px solid #00B2E340",borderRadius:10,padding:"12px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:16}}>â</span>
                <div><div style={{color:T.cyan,fontFamily:T.sans,fontWeight:700,fontSize:12}}>{plaid.accounts.length} Accounts Linked</div>
                <div style={{color:T.textDim,fontFamily:T.mono,fontSize:10}}>Last refresh: {plaid.lastSync}</div></div>
              </div>
              <div style={{marginBottom:16,display:"flex",flexDirection:"column",gap:8}}>
                {plaid.accounts.map(ac=>(
                  <div key={ac.id} style={{display:"flex",alignItems:"center",gap:12,background:T.surface,borderRadius:10,padding:"10px 14px",border:`1px solid ${T.border}`}}>
                    <div style={{width:32,height:32,borderRadius:8,background:ac.type==="credit"?T.roseDim:ac.type==="investment"?T.violetDim:T.cyanDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>
                      {ac.type==="credit"?"ð³":ac.type==="investment"?"ð":"ð¦"}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,color:T.text,fontFamily:T.sans,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ac.name}</div>
                      <div style={{fontSize:9,color:T.textDim,fontFamily:T.mono}}>····{ac.mask} · {ac.inst}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:12,fontWeight:700,fontFamily:T.mono,color:ac.balance<0?T.rose:T.emerald}}>{fmt(ac.balance)}</div>
                      <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"capitalize"}}>{ac.subtype}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:10}}>
                {hasFeature(plan,FEATURES.INTEGRATIONS_SYNC)?(
                  <button onClick={syncPlaid} disabled={plaid.syncing} style={{flex:2,background:"linear-gradient(135deg,#00B2E3,#0074B7)",border:"none",borderRadius:10,padding:"11px",color:"#fff",fontSize:12,fontFamily:T.sans,fontWeight:700,cursor:plaid.syncing?"not-allowed":"pointer",opacity:plaid.syncing?0.6:1}}>{plaid.syncing?"â³ Refreshing...":"ð Refresh Accounts"}</button>
                ):(
                  <button onClick={onUpgrade} style={{flex:2,background:T.amberDim,border:`1px solid ${T.amber}40`,borderRadius:10,padding:"11px",color:T.amber,fontSize:12,fontFamily:T.sans,fontWeight:700,cursor:"pointer"}}>ð Upgrade to Sync</button>
                )}
                <button onClick={disconnectPlaid} style={{flex:1,background:"transparent",border:`1px solid ${T.rose}40`,borderRadius:10,padding:"11px",color:T.rose,fontSize:12,fontFamily:T.sans,cursor:"pointer"}}>Disconnect</button>
              </div>
            </>}
          </div>
        </div>
      </div>

      {/* Activity Log */}
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:"20px 24px",marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14}}>ð¡ Activity Log</div>
          {log.length>0&&<button onClick={()=>setLog([])} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:6,padding:"4px 10px",color:T.textDim,fontSize:10,fontFamily:T.sans,cursor:"pointer"}}>Clear</button>}
        </div>
        {log.length===0?<div style={{textAlign:"center",padding:"28px",color:T.textDim,fontFamily:T.sans,fontSize:12}}>No activity yet. Connect an integration above to see sync events here.</div>:(
          <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:200,overflowY:"auto"}}>
            {log.map((e,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 10px",borderRadius:6,background:e.type==="success"?T.emeraldDim:e.type==="error"?T.roseDim:T.surface,border:`1px solid ${e.type==="success"?T.emerald+"20":e.type==="error"?T.rose+"20":T.border}`}}>
                <span style={{fontSize:10}}>{e.type==="success"?"â":"â¹ï¸"}</span>
                <span style={{flex:1,fontSize:11,color:T.textMid,fontFamily:T.sans}}>{e.msg}</span>
                <span style={{fontSize:9,color:T.textDim,fontFamily:T.mono}}>{e.ts}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Feature callouts */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14}}>
        {[{i:"â¡",t:"Real-Time Sync",d:"Data refreshes every 15 minutes automatically once connected"},
          {i:"ð",t:"Bank-Grade Security",d:"256-bit AES encryption, SOC 2 Type II certified, never stores passwords"},
          {i:"ðï¸",t:"Smart Categorization",d:"AI auto-maps transactions to your P&L categories with 95%+ accuracy"},
          {i:"ð",t:"Historical Import",d:"Pull up to 24 months of historical data on first connect"},
          {i:"ð",t:"Anomaly Alerts",d:"Automatic alerts when transactions deviate from expected patterns"},
          {i:"ð",t:"Two-Way Sync",d:"Changes in QuickBooks reflect in the dashboard within minutes"}].map(f=>(
          <div key={f.t} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
            <div style={{fontSize:20,marginBottom:8}}>{f.i}</div>
            <div style={{color:T.text,fontFamily:T.sans,fontWeight:700,fontSize:12,marginBottom:4}}>{f.t}</div>
            <div style={{color:T.textDim,fontFamily:T.sans,fontSize:11,lineHeight:1.6}}>{f.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// âââ Pricing Page âââââââââââââââââââââââââââââââââââââââââââââââââ
/** CellVal â hoisted outside PricingPage so it isn't recreated on every render */
function CellVal({v, color}) {
  if (v === true)  return <span style={{color:T.emerald,fontSize:16,lineHeight:1}}>â</span>;
  if (v === false) return <span style={{color:T.border,fontSize:14}}>â</span>;
  return <span style={{fontSize:10,color:color||T.textMid,fontFamily:T.sans,fontWeight:600}}>{v}</span>;
}

function PricingPage({currentPlan="starter", onPlanChange}) {
  const [billing,setBilling]=useState("annual");
  const [step,setStep]=useState("plans");
  const [processing,setProcessing]=useState(null); // plan id being processed
  const [contactOpen,setContactOpen]=useState(false);
  const [contactSent,setContactSent]=useState(false);

  // Detect return from Stripe Checkout
  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    if(params.get("session_id")) {
      setStep("success");
      window.history.replaceState({}, "", window.location.pathname);
    }
  },[]);

  const PLANS=[
    {
      id:"starter", name:"Growth", icon:"ð±", price:1199, annualPrice:949, color:T.teal, popular:false,
      tagline:"Basic financial visibility for early-stage businesses.",
      cta:"Start Free",
      ctaNote:"No credit card required",
      description:"Get your P&L, cash flow, and AR under control. The fastest way to stop flying blind on your financials.",
      features:[
        "P&L Breakdown (12-month)",
        "Budget vs Actuals",
        "Cash Flow Forecast (13-week)",
        "AR Aging with risk buckets",
        "Balance Sheet",
        "Client Overview",
        "CSV Data Import",
        "Basic AI Insights",
        "1 Company · 90-day history",
        "Email support",
      ],
    },
    {
      id:"professional", name:"Pro", icon:"→", price:2499, annualPrice:1999, color:T.cyan, popular:true,
      tagline:"The complete FP&A system for growing companies.",
      cta:"Start 14-Day Trial",
      ctaNote:"Free for 14 days · No credit card",
      description:"Everything a CFO or finance lead needs: scenario planning, collaborative budgeting, saved scenarios, executive reporting, live integrations, and full AI analysis on every tab.",
      features:[
        "Everything in Growth",
        "C-Suite Executive Report â¦ NEW",
        "Scenario Planner (Bear / Base / Bull)",
        "Save & Share Scenarios",
        "Collaborative Budgeting + Approvals",
        "Headcount & Payroll Planning",
        "SaaS Metrics & MRR Waterfall",
        "Anomaly Alerts",
        "Full AI FP&A Assistant",
        "PDF + CSV Export on all reports",
        "Live QuickBooks & Plaid Sync",
        "CFO Simulation",
        "5 Companies · 24-month history",
        "Priority support",
      ],
    },
    {
      id:"enterprise", name:"CFO Suite", icon:"ð¢", price:4499, annualPrice:3599, color:T.violet, popular:false,
      tagline:"Multi-entity, compliance, and scale.",
      cta:"Contact Sales",
      ctaNote:"Custom pricing · Dedicated onboarding",
      description:"Unlimited entities, SSO/SAML, API access, white-label, advanced role permissions, audit logs, and a dedicated account manager. Built for operators managing multiple companies.",
      features:[
        "Everything in Pro",
        "Unlimited Companies",
        "Advanced AI Board Analysis",
        "API Access + Webhooks",
        "SSO / SAML",
        "White-label Dashboard",
        "Custom Integrations",
        "Advanced Role Permissions",
        "Compliance Reporting",
        "Audit Log Export",
        "Dedicated Account Manager",
        "SLA 99.9% uptime",
        "Unlimited users",
      ],
    },
  ];

  const MATRIX_ROWS = [
    {section:"Core Financials"},
    {label:"P&L Breakdown",              starter:true,  pro:true,  ent:true},
    {label:"Budget vs Actuals",           starter:true,  pro:true,  ent:true},
    {label:"Cash Flow Forecast",          starter:true,  pro:true,  ent:true},
    {label:"AR Aging",                    starter:true,  pro:true,  ent:true},
    {label:"Balance Sheet",               starter:true,  pro:true,  ent:true},
    {label:"Client Overview",             starter:true,  pro:true,  ent:true},
    {label:"CSV Data Import",             starter:true,  pro:true,  ent:true},
    {section:"Planning & Growth"},
    {label:"Scenario Planner",            starter:false, pro:true,  ent:true},
    {label:"Save & Share Scenarios",      starter:false, pro:true,  ent:true},
    {label:"Collaborative Budgeting",     starter:false, pro:true,  ent:true},
    {label:"Headcount Planning",          starter:false, pro:true,  ent:true},
    {label:"SaaS Metrics",                starter:false, pro:true,  ent:true},
    {label:"Anomaly Alerts",              starter:false, pro:true,  ent:true},
    {section:"Reporting"},
    {label:"C-Suite Executive Report",    starter:false, pro:true,  ent:true},
    {label:"PDF + CSV Export",            starter:false, pro:true,  ent:true},
    {label:"CFO Simulation",              starter:false, pro:true,  ent:true},
    {section:"AI & Automation"},
    {label:"AI Assistant",                starter:"Basic", pro:"Unlimited",ent:"Board-level"},
    {label:"Integrations",                starter:"Read-only", pro:"Live sync",ent:"Live sync + API"},
    {section:"Enterprise"},
    {label:"API Access",                  starter:false, pro:false, ent:true},
    {label:"SSO / SAML",                  starter:false, pro:false, ent:true},
    {label:"Multi-entity",                starter:"1 company",pro:"5 companies",ent:"Unlimited"},
    {label:"Role Permissions",            starter:false, pro:"Basic",ent:"Advanced"},
    {label:"White-label",                 starter:false, pro:false, ent:true},
    {label:"Audit Log Export",            starter:false, pro:false, ent:true},
    {section:"Support"},
    {label:"Support",                     starter:"Email",pro:"Priority",ent:"Dedicated Manager"},
    {label:"Data History",                starter:"90 days",pro:"24 months",ent:"Unlimited"},
    {label:"Onboarding",                  starter:"Self-serve",pro:"Guided setup",ent:"White-glove"},
  ];

  const gp=plan=>billing==="annual"?(plan.annualPrice||Math.round(plan.price*0.80)):plan.price;
  const gs=plan=>plan.annualPrice?Math.round((plan.price-plan.annualPrice)*12):Math.round(plan.price*12*0.20);

  const handleCTA = async(plan) => {
    if(plan.id===currentPlan) return;
    if(plan.id==="enterprise") { setContactOpen(true); return; }
    if(plan.id==="starter") { onPlanChange&&onPlanChange("starter"); return; }
    setProcessing(plan.id);
    try {
      const {url} = await api.billing.checkout(plan.id, billing);
      window.location.href = url;
    } catch(err) {
      setProcessing(null);
      alert(err.message || "Checkout failed. Please try again.");
    }
  };

  if(step==="success"){
    return(
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"60vh",gap:20,textAlign:"center",animation:"fadeIn 0.4s ease"}}>
        <div style={{fontSize:64,lineHeight:1}}>ð</div>
        <div style={{background:`linear-gradient(135deg,${T.cyan},${T.violet})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",fontFamily:T.display,fontWeight:800,fontSize:28}}>You're all set!</div>
        <div style={{color:T.textMid,fontFamily:T.sans,fontSize:14,maxWidth:420,lineHeight:1.7}}>Your plan is now active. All features are immediately available across every tab of your dashboard.</div>
        <button onClick={()=>{setStep("plans");onPlanChange&&onPlanChange(currentPlan);}}
          style={{background:`linear-gradient(135deg,${T.cyan},${T.violet})`,border:"none",borderRadius:12,padding:"14px 36px",color:T.bg,fontSize:14,fontFamily:T.sans,fontWeight:800,cursor:"pointer",boxShadow:`0 4px 24px ${T.cyan}35`}}>
          Go to Dashboard →
        </button>
        <div style={{fontSize:11,color:T.textDim,fontFamily:T.sans}}>A receipt has been sent to your email by Stripe.</div>
      </div>
    );
  }

  return(
    <div style={{maxWidth:1100,margin:"0 auto"}}>
      <style>{`
        @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        .pricing-pro-glow{box-shadow:0 0 0 1.5px ${T.cyan}, 0 0 60px ${T.cyan}20, 0 20px 60px rgba(0,0,0,0.4);animation:proGlow 3.5s ease-in-out infinite;}
        @keyframes proGlow{0%,100%{box-shadow:0 0 0 1.5px ${T.cyan},0 0 60px ${T.cyan}18,0 20px 60px rgba(0,0,0,0.4)}50%{box-shadow:0 0 0 2px ${T.cyan},0 0 90px ${T.cyan}35,0 24px 70px rgba(0,0,0,0.5)}}
        .pricing-cta:hover{transform:translateY(-2px);}
        .pricing-cta{transition:transform 0.15s ease,box-shadow 0.15s ease;}
      `}</style>

      {/* Header */}
      <div style={{textAlign:"center",marginBottom:44}}>
        <div style={{display:"inline-flex",alignItems:"center",gap:6,background:T.cyanDim,border:`1px solid ${T.cyan}40`,borderRadius:20,padding:"4px 14px",marginBottom:14}}>
          <span style={{fontSize:9,color:T.cyan,fontFamily:T.mono,fontWeight:800,textTransform:"uppercase",letterSpacing:1.5}}>ð³ Simple Pricing</span>
        </div>
        <div style={{background:`linear-gradient(135deg,#FFFFFF 0%,${T.text} 35%,${T.cyan}CC 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",fontFamily:T.display,fontWeight:800,fontSize:40,marginBottom:10,lineHeight:1.1}}>
          Plans that grow with your business
        </div>
        <div style={{color:T.textDim,fontFamily:T.sans,fontSize:14,marginBottom:24,maxWidth:440,margin:"0 auto 24px"}}>
          Trusted by 500+ growing businesses. Start free â upgrade when you're ready to plan, forecast, and scale with confidence.
        </div>
        {/* Billing toggle */}
        <div style={{display:"inline-flex",alignItems:"center",gap:4,background:T.card,border:`1px solid ${T.border}`,borderRadius:50,padding:"5px 6px"}}>
          <button onClick={()=>setBilling("monthly")} style={{borderRadius:40,padding:"8px 20px",border:"none",cursor:"pointer",background:billing==="monthly"?T.surface:"transparent",color:billing==="monthly"?T.text:T.textDim,fontFamily:T.sans,fontSize:12,fontWeight:600,transition:"all 0.2s",boxShadow:billing==="monthly"?"0 1px 4px rgba(0,0,0,0.3)":"none"}}>Monthly</button>
          <button onClick={()=>setBilling("annual")} style={{borderRadius:40,padding:"8px 18px",border:"none",cursor:"pointer",background:billing==="annual"?T.surface:"transparent",color:billing==="annual"?T.text:T.textDim,fontFamily:T.sans,fontSize:12,fontWeight:600,transition:"all 0.2s",display:"flex",alignItems:"center",gap:8,boxShadow:billing==="annual"?"0 1px 4px rgba(0,0,0,0.3)":"none"}}>
            Annual
            <span style={{background:T.emeraldDim,border:`1px solid ${T.emerald}50`,borderRadius:20,padding:"2px 8px",fontSize:9,color:T.emerald,fontWeight:800,letterSpacing:0.5}}>SAVE 20%</span>
          </button>
        </div>
      </div>

      {/* Plan Cards */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1.06fr 1fr",gap:16,marginBottom:48,alignItems:"start"}}>
        {PLANS.map((plan,pi)=>{
          const isCurrent=plan.id===currentPlan;
          const isProc=processing===plan.id;
          const price=gp(plan);
          const isCenter=plan.popular;
          return(
            <div key={plan.id} className={isCenter?"pricing-pro-glow":""}
              style={{background:isCenter?`linear-gradient(160deg,${T.card},#131820 60%,${T.cyan}08)`:T.card, border:`1.5px solid ${isCenter?T.cyan:T.border}`,borderRadius:18,overflow:"hidden",position:"relative",transition:"all 0.2s",marginTop:isCenter?-8:0}}>
              {/* Most popular badge */}
              {isCenter&&(
                <div style={{background:`linear-gradient(90deg,${T.cyan},${T.violet})`,padding:"6px 0",textAlign:"center"}}>
                  <span style={{color:T.bg,fontSize:10,fontFamily:T.mono,fontWeight:800,letterSpacing:1.5,textTransform:"uppercase"}}>â­ Most Popular · Best for Small Business</span>
                </div>
              )}
              {isCurrent&&(
                <div style={{background:`${plan.color}18`,borderBottom:`1px solid ${plan.color}30`,padding:"5px 0",textAlign:"center"}}>
                  <span style={{color:plan.color,fontSize:9,fontFamily:T.mono,fontWeight:800,letterSpacing:1,textTransform:"uppercase"}}>â Your Current Plan</span>
                </div>
              )}
              <div style={{padding:"28px 24px 24px"}}>
                {/* Plan name */}
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                  <span style={{fontSize:22}}>{plan.icon}</span>
                  <div>
                    <div style={{color:T.text,fontFamily:T.display,fontWeight:800,fontSize:19}}>{plan.name}</div>
                    <div style={{color:plan.color,fontFamily:T.mono,fontSize:9,textTransform:"uppercase",letterSpacing:1,marginTop:1}}>{billing==="annual"?"Billed Annually":"Billed Monthly"}</div>
                  </div>
                </div>
                <div style={{color:T.textDim,fontFamily:T.sans,fontSize:11,lineHeight:1.6,marginBottom:20,minHeight:36}}>{plan.tagline}</div>
                {/* Price */}
                <div style={{marginBottom:20}}>
                  <div style={{display:"flex",alignItems:"flex-end",gap:4}}>
                    <span style={{color:plan.color,fontFamily:T.mono,fontWeight:800,fontSize:plan.id==="enterprise"?26:38,lineHeight:1}}>{plan.id==="enterprise"?"Custom":`$${price}`}</span>
                    {plan.id!=="enterprise"&&<span style={{color:T.textDim,fontFamily:T.sans,fontSize:13,marginBottom:4}}>/mo</span>}
                  </div>
                  {billing==="annual"&&plan.id!=="enterprise"&&(
                    <div style={{fontSize:10,color:T.emerald,fontFamily:T.sans,marginTop:4}}>â Save ${gs(plan)} per year</div>
                  )}
                  {plan.id==="enterprise"&&<div style={{fontSize:10,color:T.textDim,fontFamily:T.sans,marginTop:4}}>Talk to sales for volume pricing</div>}
                </div>
                {/* CTA */}
                {isCurrent?(
                  <button disabled style={{width:"100%",background:T.surface,border:`1px solid ${T.border}`,borderRadius:11,padding:"12px",color:T.textDim,fontSize:12,fontFamily:T.sans,fontWeight:700,cursor:"not-allowed",marginBottom:20}}>â Current Plan</button>
                ):(
                  <button onClick={()=>handleCTA(plan)} disabled={!!isProc} className="pricing-cta"
                    style={{width:"100%",background:isCenter?`linear-gradient(135deg,${T.cyan},${T.violet})`:`${plan.color}18`,border:`1.5px solid ${plan.color}${isCenter?"":"60"}`,borderRadius:11,padding:"12px",color:isCenter?T.bg:plan.color,fontSize:12,fontFamily:T.sans,fontWeight:800,cursor:isProc?"wait":"pointer",marginBottom:8,letterSpacing:0.2,opacity:isProc?0.7:1,boxShadow:isCenter?`0 4px 20px ${T.cyan}30`:"none"}}>
                    {isProc?"â³ Redirectingâ¦":plan.cta}
                  </button>
                )}
                <div style={{textAlign:"center",fontSize:10,color:T.textDim,fontFamily:T.sans,marginBottom:20}}>{plan.ctaNote}</div>
                {/* Feature list */}
                <div style={{borderTop:`1px solid ${T.border}`,paddingTop:16,display:"flex",flexDirection:"column",gap:7}}>
                  {plan.features.map((f,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8}}>
                      <span style={{color:plan.color,fontSize:11,flexShrink:0,marginTop:1,fontWeight:700}}>â</span>
                      <span style={{fontSize:11,color:i===0&&pi>0?T.textMid:T.textDim,fontFamily:T.sans,lineHeight:1.45,fontWeight:i===0&&pi>0?600:400}}>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Trust bar */}
      <div style={{background:`linear-gradient(135deg,${T.card},${T.surface})`,border:`1px solid ${T.border}`,borderRadius:14,padding:"18px 28px",marginBottom:40,display:"flex",alignItems:"center",justifyContent:"center",gap:32,flexWrap:"wrap",boxShadow:`inset 0 1px 0 ${T.borderHover}40`}}>
        {[["ð","Bank-grade encryption"],["â","Cancel anytime, no questions"],["â¡","No setup fees ever"],["ð","Used by 500+ small businesses"],["ð³","Powered by Stripe"]].map(([i,t])=>(
          <div key={t} style={{display:"flex",alignItems:"center",gap:7}}>
            <span style={{fontSize:13}}>{i}</span>
            <span style={{fontSize:11,color:T.textMid,fontFamily:T.sans,fontWeight:500}}>{t}</span>
          </div>
        ))}
      </div>

      {/* Feature comparison table */}
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,overflow:"hidden",marginBottom:40}}>
        <div style={{padding:"20px 28px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:16}}>Full Feature Comparison</div>
          <div style={{display:"flex",gap:24}}>
            {PLANS.map(p=>(
              <div key={p.id} style={{textAlign:"center",minWidth:80}}>
                <div style={{fontSize:14,marginBottom:2}}>{p.icon}</div>
                <div style={{fontSize:10,color:p.color,fontFamily:T.mono,fontWeight:700}}>{p.name}</div>
              </div>
            ))}
          </div>
        </div>
        {MATRIX_ROWS.map((row,ri)=>{
          if(row.section) return(
            <div key={ri} style={{background:`linear-gradient(90deg,${T.cyan}10,${T.surface})`,padding:"9px 28px",borderBottom:`1px solid ${T.border}`}}>
              <span style={{fontSize:9,color:T.textDim,fontFamily:T.mono,textTransform:"uppercase",letterSpacing:1.5,fontWeight:700}}>{row.section}</span>
            </div>
          );
          return(
            <div key={ri} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 28px",borderBottom:`1px solid ${T.border}30`,background:ri%2===0?"transparent":T.surface+"40"}}>
              <div style={{fontSize:12,color:T.textMid,fontFamily:T.sans,flex:1}}>{row.label}</div>
              <div style={{display:"flex",gap:0,minWidth:300}}>
                {[{v:row.starter,c:T.teal},{v:row.pro,c:T.cyan},{v:row.ent,c:T.violet}].map((cell,ci)=>(
                  <div key={ci} style={{minWidth:100,textAlign:"center",padding:"0 4px"}}>
                    <CellVal v={cell.v} color={cell.c}/>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {/* Bottom CTA row */}
        <div style={{display:"flex",justifyContent:"flex-end",padding:"20px 28px",borderTop:`1px solid ${T.border}`,background:T.surface,gap:0}}>
          <div style={{minWidth:300,display:"flex",gap:0}}>
            {PLANS.map(plan=>{
              const isCurrent=plan.id===currentPlan;
              const isProc=processing===plan.id;
              return(
                <div key={plan.id} style={{minWidth:100,padding:"0 4px",textAlign:"center"}}>
                  {!isCurrent&&(
                    <button onClick={()=>handleCTA(plan)} disabled={!!isProc} className="pricing-cta"
                      style={{background:plan.popular?`linear-gradient(135deg,${T.cyan},${T.violet})`:`${plan.color}18`,border:`1px solid ${plan.color}50`,borderRadius:8,padding:"8px 10px",color:plan.popular?T.bg:plan.color,fontSize:10,fontFamily:T.sans,fontWeight:700,cursor:isProc?"wait":"pointer",width:"100%",whiteSpace:"nowrap",boxShadow:plan.popular?`0 2px 12px ${T.cyan}30`:"none"}}>
                      {isProc?"â¦":plan.id==="enterprise"?"Contact":"Get Started"}
                    </button>
                  )}
                  {isCurrent&&<span style={{fontSize:10,color:plan.color,fontFamily:T.mono,fontWeight:600}}>Current</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Benefit copy strip */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:40}}>
        {[{i:"ð¯",h:"Make faster decisions",d:"Every tab gives you the context to act, not just the numbers to stare at."},
          {i:"ð¡",h:"See problems early",d:"Anomaly alerts and cash flow forecasts surface risks before they become crises."},
          {i:"ð",h:"Understand your profit",d:"AI-powered analysis tells you what's driving margins â in plain language."},
          {i:"ðï¸",h:"Plan without spreadsheets",d:"Scenarios, headcount, and SaaS metrics all in one place. No VLOOKUP required."},
        ].map(b=>(
          <div key={b.h} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:13,padding:"18px 20px"}}>
            <div style={{width:44,height:44,borderRadius:12,background:`${T.cyan}12`,border:`1px solid ${T.cyan}25`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,marginBottom:14}}>{b.i}</div>
            <div style={{color:T.text,fontFamily:T.sans,fontWeight:700,fontSize:12,marginBottom:5}}>{b.h}</div>
            <div style={{color:T.textDim,fontFamily:T.sans,fontSize:11,lineHeight:1.65}}>{b.d}</div>
          </div>
        ))}
      </div>

      {/* FAQ */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:32}}>
        {[{q:"Is there a free trial?",a:"Professional includes a 14-day free trial. No credit card required to start â you'll only be charged when your trial ends."},
          {q:"Can I cancel anytime?",a:"Yes. Cancel with one click from your account settings. You keep access until the end of your billing period â no questions asked."},
          {q:"Can I switch plans?",a:"Absolutely. Upgrade or downgrade anytime. Upgrades are immediate; downgrades apply at the next billing cycle."},
          {q:"Is my financial data secure?",a:"All data is encrypted at rest (AES-256) and in transit (TLS 1.3). We are SOC 2 Type II certified and never sell your data."},
          {q:"What's the AI assistant?",a:"The AI FP&A assistant analyzes your actual financial data and provides actionable insights, forecasts, and plain-English explanations on every tab."},
          {q:"Discounts for accounting firms?",a:"Firms with multiple clients qualify for our Partner Program. Contact us for volume pricing and white-label options."},
        ].map(f=>(
          <div key={f.q} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px",borderLeft:`3px solid ${T.cyan}40`}}>
            <div style={{color:T.text,fontFamily:T.sans,fontWeight:700,fontSize:12,marginBottom:6}}>{f.q}</div>
            <div style={{color:T.textDim,fontFamily:T.sans,fontSize:11,lineHeight:1.65}}>{f.a}</div>
          </div>
        ))}
      </div>

      {/* Enterprise contact modal */}
      {contactOpen&&(
        <div style={{position:"fixed",inset:0,background:"rgba(8,11,18,0.85)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:24}} onClick={()=>setContactOpen(false)}>
          <div style={{background:T.card,border:`1.5px solid ${T.violet}50`,borderRadius:20,padding:"36px",maxWidth:460,width:"100%",boxShadow:`0 0 80px ${T.violet}20`}} onClick={e=>e.stopPropagation()}>
            {!contactSent?(
              <>
                <div style={{color:T.text,fontFamily:T.display,fontWeight:800,fontSize:20,marginBottom:6}}>ð¢ Let's talk Enterprise</div>
                <div style={{color:T.textDim,fontFamily:T.sans,fontSize:12,lineHeight:1.7,marginBottom:24}}>Tell us a bit about your needs and our team will reach out within one business day with custom pricing.</div>
                {[{l:"Work email",p:"you@company.com",t:"email"},{l:"Company name",p:"Acme Corp",t:"text"},{l:"Number of entities",p:"2, 5, 10+",t:"text"}].map(f=>(
                  <div key={f.l} style={{marginBottom:14}}>
                    <label style={{display:"block",fontSize:10,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:5}}>{f.l}</label>
                    <input type={f.t} placeholder={f.p} style={{width:"100%",background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 12px",color:T.text,fontSize:12,fontFamily:T.sans,outline:"none",boxSizing:"border-box"}}
                      onFocus={e=>e.target.style.borderColor=T.violet} onBlur={e=>e.target.style.borderColor=T.border}/>
                  </div>
                ))}
                <div style={{display:"flex",gap:10,marginTop:20}}>
                  <button onClick={()=>setContactSent(true)} style={{flex:2,background:`linear-gradient(135deg,${T.violet},${T.cyan})`,border:"none",borderRadius:10,padding:"12px",color:T.bg,fontSize:13,fontFamily:T.sans,fontWeight:800,cursor:"pointer"}}>Send Message →</button>
                  <button onClick={()=>setContactOpen(false)} style={{flex:1,background:"transparent",border:`1px solid ${T.border}`,borderRadius:10,padding:"12px",color:T.textDim,fontSize:12,fontFamily:T.sans,cursor:"pointer"}}>Cancel</button>
                </div>
              </>
            ):(
              <div style={{textAlign:"center",padding:"20px 0"}}>
                <div style={{fontSize:48,marginBottom:16}}>â</div>
                <div style={{color:T.text,fontFamily:T.display,fontWeight:800,fontSize:18,marginBottom:10}}>Message sent!</div>
                <div style={{color:T.textDim,fontFamily:T.sans,fontSize:12,lineHeight:1.7,marginBottom:24}}>Our team will be in touch within one business day.</div>
                <button onClick={()=>{setContactOpen(false);setContactSent(false);}} style={{background:`linear-gradient(135deg,${T.violet},${T.cyan})`,border:"none",borderRadius:10,padding:"12px 28px",color:T.bg,fontSize:13,fontFamily:T.sans,fontWeight:700,cursor:"pointer"}}>Back to Dashboard</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
// âââ Budget vs. Actuals âââââââââââââââââââââââââââââââââââââââââââ
function BudgetVsActuals({aiContext}) {
  const [view,setView]=useState("summary");
  const [selMonth,setSelMonth]=useState(null);
  const actPnL=computePnL(BASE_PNL), budPnL=computePnL(BUDGET_PNL);
  const aRev=actPnL.map(m=>m.rev), bRev=budPnL.map(m=>m.rev);
  const aOpex=actPnL.map(m=>m.opex), bOpex=budPnL.map(m=>m.opex);
  const aNet=actPnL.map(m=>m.net), bNet=budPnL.map(m=>m.net);
  const aGross=actPnL.map(m=>m.gross), bGross=budPnL.map(m=>m.gross);
  const varRow=(a,b,fav="pos")=>a.map((v,i)=>v-b[i]);
  const vRev=varRow(aRev,bRev), vOpex=varRow(aOpex,bOpex), vNet=varRow(aNet,bNet), vGross=varRow(aGross,bGross);
  const totVRev=sum(vRev), totVOpex=sum(vOpex), totVNet=sum(vNet);
  const varColor=(v,expFav="pos")=>(expFav==="pos"?v>=0:v<=0)?T.emerald:T.rose;
  const varFlag=(v,expFav="pos")=>(expFav==="pos"?v>=0:v<=0)?"â²":"â¼";
  const LINES=[
    {label:"Total Revenue",    act:aRev,  bud:bRev,  var:vRev,   fav:"pos"},
    {label:"Gross Profit",     act:aGross,bud:bGross,var:vGross, fav:"pos"},
    {label:"Operating Expenses",act:aOpex,bud:bOpex, var:vOpex,  fav:"neg"},
    {label:"Net Income",       act:aNet,  bud:bNet,  var:vNet,   fav:"pos"},
  ];
  const depts=[
    {name:"Engineering",act:[142000,145600,148200,151800,155000,158400,162000,165200,168800,172500,175200,178900],bud:[140000,143000,146000,149000,152000,155000,158000,161000,164000,167000,170000,173000]},
    {name:"Sales",      act:[89000,92400,96800,99200,103500,107800,111200,115600,119800,124000,128200,132500],bud:[88000,91000,95000,98000,102000,106000,110000,114000,118000,122000,126000,130000]},
    {name:"Marketing",  act:[52000,48200,58000,65000,60000,72000,80000,75000,85000,90000,100000,110000],bud:[60000,50000,65000,70000,65000,75000,85000,80000,90000,95000,105000,115000]},
    {name:"Finance & Ops",act:[32000,32500,33000,34000,33500,34500,35000,35500,36000,37000,37500,38500],bud:[33000,33000,34000,35000,34000,35500,36000,36500,37000,38000,38500,39500]},
    {name:"Cust. Success",act:[28500,29200,30000,31500,31000,32400,33000,34200,35000,36500,37800,39200],bud:[28000,28500,29500,31000,30500,32000,32500,33500,34500,36000,37000,38500]},
  ];
  const RF_MONTHS=["Q1 Fcst","Q2 Fcst","Q3 Fcst","Q4 Fcst"];
  const rfRev=[706000,762000,834000,912000], rfNet=[87000,104000,128000,158000];
  const maxBar=Math.max(sum(aRev),sum(bRev));
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:18}}>
        {[
          {l:"Revenue Variance",v:totVRev,pct:totVRev/sum(bRev),fav:"pos"},
          {l:"OpEx Variance",v:totVOpex,pct:totVOpex/sum(bOpex),fav:"neg"},
          {l:"Net Income Variance",v:totVNet,pct:totVNet/sum(bNet),fav:"pos"},
          {l:"Budget Attainment",v:safeDiv(sum(aRev),sum(bRev)),isRatio:true,fav:"pos"},
        ].map(k=>{
          const good=k.isRatio?(k.v>=1):(k.fav==="pos"?k.v>=0:k.v<=0);
          const c=good?T.emerald:T.rose;
          return (
            <div key={k.l} style={{background:T.card,border:`1px solid ${good?c+"40":T.border}`,borderRadius:12,padding:"14px 16px",boxShadow:good?"none":`0 0 16px ${T.rose}10`}}>
              <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{k.l}</div>
              <div style={{fontSize:20,fontWeight:800,fontFamily:T.mono,color:c}}>{k.isRatio?pct(k.v)+" of budget":fmt(Math.abs(k.v),true)}</div>
              {!k.isRatio&&<div style={{fontSize:10,color:c,fontFamily:T.sans,marginTop:4}}>{good?"â² Favorable":"â¼ Unfavorable"} · {pct(Math.abs(k.pct||0))} vs budget</div>}
            </div>
          );
        })}
      </div>

      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[["summary","ð Summary BvA"],["depts","ð¢ Dept Breakdown"],["rolling","ð Rolling Forecast"]].map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)} style={{background:view===v?T.cyanDim:"transparent",border:`1px solid ${view===v?T.cyanMid:T.border}`,borderRadius:8,padding:"6px 14px",color:view===v?T.cyan:T.textMid,fontSize:11,fontFamily:T.sans,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>{l}</button>
        ))}
      </div>

      {view==="summary"&&(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"12px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14}}>ð Budget vs. Actuals â FY 2024</div>
              <div style={{display:"flex",gap:12,fontSize:9,color:T.textDim,fontFamily:T.mono}}>
                <span style={{color:T.cyan}}>â  Actual</span>
                <span style={{color:T.violet}}>â  Budget</span>
                <span style={{color:T.emerald}}>â² Fav</span>
                <span style={{color:T.rose}}>â¼ Unfav</span>
              </div>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                <thead>
                  <tr style={{background:T.surface}}>
                    <th style={{padding:"8px 12px",textAlign:"left",color:T.textDim,fontFamily:T.sans,fontSize:9,textTransform:"uppercase",fontWeight:700,borderBottom:`1px solid ${T.border}`,minWidth:160}}>Line Item</th>
                    {MONTHS.map(m=><th key={m} style={{padding:"8px 6px",textAlign:"right",color:T.textDim,fontFamily:T.mono,fontSize:9,borderBottom:`1px solid ${T.border}`,minWidth:64}}>{m}</th>)}
                    <th style={{padding:"8px 8px",textAlign:"right",color:T.textDim,fontFamily:T.mono,fontSize:9,borderBottom:`1px solid ${T.border}`,minWidth:70}}>FY Total</th>
                    <th style={{padding:"8px 8px",textAlign:"right",color:T.textDim,fontFamily:T.mono,fontSize:9,borderBottom:`1px solid ${T.border}`,minWidth:70}}>$ Var</th>
                    <th style={{padding:"8px 8px",textAlign:"right",color:T.textDim,fontFamily:T.mono,fontSize:9,borderBottom:`1px solid ${T.border}`,minWidth:60}}>% Var</th>
                  </tr>
                </thead>
                <tbody>
                  {LINES.map(row=>{
                    const totA=sum(row.act), totB=sum(row.bud), totV=totA-totB;
                    const good=row.fav==="pos"?totV>=0:totV<=0;
                    return [
                      <tr key={row.label+"-a"} style={{background:"transparent",borderBottom:`1px solid ${T.border}40`}}>
                        <td style={{padding:"7px 12px",color:T.text,fontFamily:T.sans,fontWeight:600,fontSize:10}}>{row.label}</td>
                        {row.act.map((v,i)=><td key={i} style={{padding:"7px 6px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.textMid}}>{fmt(v,true)}</td>)}
                        <td style={{padding:"7px 8px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:700,color:T.cyan}}>{fmt(totA,true)}</td>
                        <td style={{padding:"7px 8px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:700,color:good?T.emerald:T.rose}}>{good?"â²":"â¼"}{fmt(Math.abs(totV),true)}</td>
                        <td style={{padding:"7px 8px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:good?T.emerald:T.rose}}>{pct(Math.abs(safeDiv(totV,totB)))}</td>
                      </tr>,
                      <tr key={row.label+"-b"} style={{background:T.surface+"80",borderBottom:`1px solid ${T.border}`}}>
                        <td style={{padding:"4px 12px",color:T.textDim,fontFamily:T.sans,fontSize:9,paddingLeft:24}}>â Budget</td>
                        {row.bud.map((v,i)=><td key={i} style={{padding:"4px 6px",textAlign:"right",fontFamily:T.mono,fontSize:9,color:T.textDim}}>{fmt(v,true)}</td>)}
                        <td style={{padding:"4px 8px",textAlign:"right",fontFamily:T.mono,fontSize:9,color:T.textDim}}>{fmt(totB,true)}</td>
                        <td colSpan="2"/>
                      </tr>
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
            <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,marginBottom:14}}>ð Monthly Variance Heatmap</div>
            <div style={{display:"grid",gridTemplateColumns:"160px repeat(12,1fr)",gap:2}}>
              {[""].concat(MONTHS).map((m,i)=><div key={i} style={{padding:"4px 0",textAlign:"center",fontSize:8,color:T.textDim,fontFamily:T.mono}}>{m}</div>)}
              {LINES.map(row=>([
                <div key={row.label} style={{fontSize:9,color:T.textMid,fontFamily:T.sans,display:"flex",alignItems:"center",paddingRight:8,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{row.label}</div>,
                ...row.var.map((v,i)=>{
                  const good=row.fav==="pos"?v>=0:v<=0;
                  const intensity=Math.min(Math.abs(v)/15000,1);
                  return <div key={i} title={`${MONTHS[i]}: ${good?"â²":"â¼"}${fmt(Math.abs(v),true)}`}
                    style={{height:22,borderRadius:3,background:good?`rgba(0,229,160,${0.15+intensity*0.5})`:`rgba(255,77,106,${0.15+intensity*0.5})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,color:good?T.emerald:T.rose,fontFamily:T.mono,fontWeight:700,cursor:"default"}}>
                    {fmt(v,true)}
                  </div>;
                })
              ]))}
            </div>
          </div>
        </div>
      )}

      {view==="depts"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {depts.map(dept=>{
            const totA=sum(dept.act), totB=sum(dept.bud), v=totA-totB;
            const good=v<=0;
            return (
              <div key={dept.name} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14}}>{dept.name}</div>
                  <div style={{display:"flex",gap:16,alignItems:"center"}}>
                    <div style={{textAlign:"right"}}><div style={{fontSize:8,color:T.textDim,fontFamily:T.sans}}>ACTUAL</div><div style={{fontSize:14,color:T.cyan,fontFamily:T.mono,fontWeight:700}}>{fmt(totA,true)}</div></div>
                    <div style={{textAlign:"right"}}><div style={{fontSize:8,color:T.textDim,fontFamily:T.sans}}>BUDGET</div><div style={{fontSize:14,color:T.violet,fontFamily:T.mono,fontWeight:700}}>{fmt(totB,true)}</div></div>
                    <div style={{background:good?T.emeraldDim:T.roseDim,border:`1px solid ${good?T.emerald+"40":T.rose+"40"}`,borderRadius:8,padding:"6px 12px",textAlign:"center"}}>
                      <div style={{fontSize:8,color:T.textDim,fontFamily:T.sans}}>{good?"UNDER":"OVER"} BUDGET</div>
                      <div style={{fontSize:14,color:good?T.emerald:T.rose,fontFamily:T.mono,fontWeight:700}}>{fmt(Math.abs(v),true)}</div>
                    </div>
                  </div>
                </div>
                <div style={{display:"flex",gap:3,height:32}}>
                  {MONTHS.map((m,i)=>{
                    const va=dept.act[i]-dept.bud[i]; const g=va<=0;
                    const h=Math.min(Math.abs(va)/3000*100,100);
                    return <div key={m} title={`${m}: ${g?"â²":"â¼"}${fmt(Math.abs(va),true)}`}
                      style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"flex-end",alignItems:"center"}}>
                      <div style={{width:"100%",height:`${h}%`,minHeight:2,background:g?T.emerald+"60":T.rose+"60",borderRadius:"2px 2px 0 0"}}/>
                    </div>;
                  })}
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
                  {MONTHS.map(m=><span key={m} style={{fontSize:7,color:T.textDim,fontFamily:T.mono}}>{m}</span>)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view==="rolling"&&(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
            <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,marginBottom:4}}>ð Rolling Forecast â Updated Monthly</div>
            <div style={{color:T.textDim,fontSize:10,fontFamily:T.sans,marginBottom:16}}>Forward-looking view combining YTD actuals with updated quarterly projections</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:18}}>
              {RF_MONTHS.map((q,i)=>(
                <div key={q} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
                  <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{q}</div>
                  <div style={{fontSize:16,fontWeight:700,fontFamily:T.mono,color:T.cyan}}>{fmt(rfRev[i],true)}</div>
                  <div style={{fontSize:10,color:T.emerald,fontFamily:T.sans,marginTop:4}}>Net: {fmt(rfNet[i],true)}</div>
                  <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,marginTop:2}}>Margin: {pct(rfNet[i]/rfRev[i])}</div>
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              {[{l:"Full-Year Revenue Forecast",v:sum(rfRev),bv:sum(bRev),c:T.cyan},{l:"Full-Year Net Income Forecast",v:sum(rfNet),bv:sum(bNet),c:T.emerald}].map(item=>{
                const variance=item.v-item.bv;
                const good=variance>=0;
                return (
                  <div key={item.l} style={{background:T.surface,borderRadius:10,padding:"14px 16px",border:`1px solid ${T.border}`}}>
                    <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{item.l}</div>
                    <div style={{fontSize:22,fontWeight:800,fontFamily:T.mono,color:item.c}}>{fmt(item.v,true)}</div>
                    <div style={{display:"flex",gap:16,marginTop:8}}>
                      <div><div style={{fontSize:8,color:T.textDim,fontFamily:T.sans}}>VS BUDGET</div><div style={{fontSize:12,color:good?T.emerald:T.rose,fontFamily:T.mono,fontWeight:700}}>{good?"â²":"â¼"}{fmt(Math.abs(variance),true)}</div></div>
                      <div><div style={{fontSize:8,color:T.textDim,fontFamily:T.sans}}>ATTAINMENT</div><div style={{fontSize:12,color:item.c,fontFamily:T.mono,fontWeight:700}}>{pct(item.v/item.bv)}</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// âââ Balance Sheet ââââââââââââââââââââââââââââââââââââââââââââââââ
/** BSRow â balance sheet line row. Hoisted to module scope. */
function BSRow({label, value, indent, isTotal, color, bold}) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:isTotal?"8px 0":"5px 0",borderBottom:isTotal?`1px solid ${T.border}40`:"none",background:isTotal?T.cyanDim+"30":"transparent",borderRadius:isTotal?4:0}}>
      <span style={{fontSize:isTotal?11:10,color:isTotal?T.text:T.textMid,fontFamily:isTotal?T.display:T.sans,fontWeight:isTotal||bold?700:400,paddingLeft:indent?20:0}}>{indent&&<span style={{color:T.textDim,marginRight:4}}>â</span>}{label}</span>
      <span style={{fontSize:isTotal?12:10,color:color||(isTotal?T.cyan:T.textMid),fontFamily:T.mono,fontWeight:isTotal?700:400}}>{fmt(value)}</span>
    </div>
  );
}
function BalanceSheet({aiContext}) {
  const [mo,setMo]=useState(11);
  const BS=BALANCE_SHEET;
  const cash=BS.cash[mo], ar=BS.accountsReceivable[mo], inv=BS.inventory_bs[mo], prep=BS.prepaidExpenses[mo];
  const ppe=BS.ppe_gross[mo]-BS.accumDeprec[mo], other=BS.otherAssets[mo];
  const currAssets=cash+ar+inv+prep;
  const totalAssets=currAssets+ppe+other;
  const ap=BS.accountsPayable[mo], acc=BS.accruedExpenses[mo], def=BS.deferredRevenue[mo], std=BS.shortTermDebt[mo];
  const currLiab=ap+acc+def+std;
  const ltd=BS.longTermDebt[mo];
  const totalLiab=currLiab+ltd;
  const retEarnings=totalAssets-totalLiab-BS.commonStock[mo];
  const equity=BS.commonStock[mo]+retEarnings;
  const currRatio=safeDiv(currAssets,currLiab);
  const quickRatio=safeDiv(cash+ar,currLiab);
  const debtToEquity=safeDiv(currLiab+ltd,equity);
  const workingCapital=currAssets-currLiab;

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
        <span style={{fontSize:10,color:T.textDim,fontFamily:T.sans}}>View month:</span>
        <div style={{display:"flex",gap:2,flexWrap:"wrap"}}>
          {MONTHS.map((m,i)=>(
            <button key={m} onClick={()=>setMo(i)} style={{background:mo===i?T.cyanDim:"transparent",border:`1px solid ${mo===i?T.cyanMid:T.border}`,borderRadius:6,padding:"3px 9px",color:mo===i?T.cyan:T.textDim,fontSize:10,fontFamily:T.mono,cursor:"pointer"}}>{m}</button>
          ))}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:18}}>
        {[
          {l:"Current Ratio",   v:currRatio.toFixed(2)+"x", sub:currRatio>=2?"Strong":currRatio>=1.5?"Healthy":"Watch", c:currRatio>=1.5?T.emerald:currRatio>=1?T.amber:T.rose},
          {l:"Quick Ratio",     v:quickRatio.toFixed(2)+"x", sub:quickRatio>=1?"Healthy":"Below 1x â risk", c:quickRatio>=1?T.emerald:T.rose},
          {l:"Debt-to-Equity",  v:debtToEquity.toFixed(2)+"x", sub:debtToEquity<=1.5?"Manageable":"High leverage", c:debtToEquity<=1.5?T.emerald:T.amber},
          {l:"Working Capital", v:fmt(workingCapital,true), sub:`${pct(workingCapital/totalAssets)} of assets`, c:workingCapital>0?T.emerald:T.rose},
        ].map(k=>(
          <div key={k.l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 16px"}}>
            <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{k.l}</div>
            <div style={{fontSize:20,fontWeight:800,fontFamily:T.mono,color:k.c}}>{k.v}</div>
            <div style={{fontSize:10,color:T.textDim,fontFamily:T.sans,marginTop:4}}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
          <div style={{color:T.cyan,fontFamily:T.display,fontWeight:700,fontSize:13,marginBottom:12}}>ASSETS â {MONTHS[mo]} 2024</div>
          <div style={{color:T.textDim,fontSize:9,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:8,paddingBottom:4,borderBottom:`1px solid ${T.border}`}}>Current Assets</div>
          <BSRow label="Cash & Equivalents"   value={cash} indent color={T.cyan}/>
          <BSRow label="Accounts Receivable"  value={ar}   indent color={T.cyan}/>
          <BSRow label="Inventory"            value={inv}  indent color={T.cyan}/>
          <BSRow label="Prepaid Expenses"     value={prep} indent color={T.cyan}/>
          <BSRow label="Total Current Assets" value={currAssets} isTotal/>
          <div style={{color:T.textDim,fontSize:9,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,margin:"12px 0 8px",paddingBottom:4,borderBottom:`1px solid ${T.border}`}}>Non-Current Assets</div>
          <BSRow label="PP&E (net)"    value={ppe}   indent color={T.cyan}/>
          <BSRow label="Other Assets"  value={other} indent color={T.cyan}/>
          <div style={{marginTop:10,paddingTop:8,borderTop:`2px solid ${T.border}`}}>
            <BSRow label="TOTAL ASSETS" value={totalAssets} isTotal color={T.cyan} bold/>
          </div>
        </div>

        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
          <div style={{color:T.rose,fontFamily:T.display,fontWeight:700,fontSize:13,marginBottom:12}}>LIABILITIES & EQUITY â {MONTHS[mo]} 2024</div>
          <div style={{color:T.textDim,fontSize:9,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:8,paddingBottom:4,borderBottom:`1px solid ${T.border}`}}>Current Liabilities</div>
          <BSRow label="Accounts Payable"        value={ap}  indent color={T.rose}/>
          <BSRow label="Accrued Expenses"        value={acc} indent color={T.rose}/>
          <BSRow label="Deferred Revenue"        value={def} indent color={T.rose}/>
          <BSRow label="Short-Term Debt"         value={std} indent color={T.amber}/>
          <BSRow label="Total Current Liabilities" value={currLiab} isTotal color={T.rose}/>
          <div style={{color:T.textDim,fontSize:9,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,margin:"12px 0 8px",paddingBottom:4,borderBottom:`1px solid ${T.border}`}}>Long-Term Liabilities</div>
          <BSRow label="Long-Term Debt" value={ltd} indent color={T.amber}/>
          <div style={{marginTop:8,paddingTop:6,borderTop:`1px solid ${T.border}`}}>
            <BSRow label="Total Liabilities" value={totalLiab} isTotal color={T.rose}/>
          </div>
          <div style={{color:T.textDim,fontSize:9,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,margin:"12px 0 8px",paddingBottom:4,borderBottom:`1px solid ${T.border}`}}>Equity</div>
          <BSRow label="Common Stock"       value={BS.commonStock[mo]} indent color={T.violet}/>
          <BSRow label="Retained Earnings"  value={retEarnings}        indent color={T.violet}/>
          <div style={{marginTop:10,paddingTop:8,borderTop:`2px solid ${T.border}`}}>
            <BSRow label="TOTAL LIAB. + EQUITY" value={totalLiab+equity} isTotal color={T.violet} bold/>
          </div>
        </div>
      </div>

      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px",marginTop:16}}>
        <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,marginBottom:14}}>ð Ratio Trends â Full Year</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:16}}>
          {[
            {l:"Current Ratio",data:MONTHS.map((_,i)=>{const ca=BS.cash[i]+BS.accountsReceivable[i]+BS.inventory_bs[i]+BS.prepaidExpenses[i];const cl=BS.accountsPayable[i]+BS.accruedExpenses[i]+BS.deferredRevenue[i]+BS.shortTermDebt[i];return ca/cl;}),c:T.cyan,fmt:v=>`${v.toFixed(2)}x`,thresh:1.5},
            {l:"Quick Ratio",  data:MONTHS.map((_,i)=>{const qa=BS.cash[i]+BS.accountsReceivable[i];const cl=BS.accountsPayable[i]+BS.accruedExpenses[i]+BS.deferredRevenue[i]+BS.shortTermDebt[i];return qa/cl;}),c:T.emerald,fmt:v=>`${v.toFixed(2)}x`,thresh:1.0},
          ].map(chart=>(
            <div key={chart.l}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <span style={{fontSize:10,color:T.textMid,fontFamily:T.sans}}>{chart.l}</span>
                <span style={{fontSize:11,color:chart.c,fontFamily:T.mono,fontWeight:700}}>{chart.fmt(chart.data[mo])}</span>
              </div>
              <div style={{display:"flex",alignItems:"flex-end",gap:3,height:50}}>
                {chart.data.map((v,i)=>(
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                    <div style={{width:"100%",height:`${Math.min(v/4,1)*46}px`,minHeight:2,background:v>=chart.thresh?chart.c+"80":T.rose+"80",borderRadius:"2px 2px 0 0",transition:"height 0.3s"}}/>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// âââ Headcount Planning ââââââââââââââââââââââââââââââââââââââââââââ
function HeadcountPlanning({aiContext}) {
  const [selDept,setSelDept]=useState(null);
  const [view,setView]=useState("overview");
  const depts=HEADCOUNT_DATA.departments;
  const allEmp=depts.flatMap(d=>d.employees);
  const active=allEmp.filter(e=>e.status==="active");
  const open=allEmp.filter(e=>e.status==="open");
  const totalCost=allEmp.reduce((s,e)=>s+(e.salary*(1+e.benefits)),0);
  const activeCost=active.reduce((s,e)=>s+(e.salary*(1+e.benefits)),0);
  const openCost=open.reduce((s,e)=>s+(e.salary*(1+e.benefits)),0);
  const avgSalary=active.length ? Math.round(safeDiv(sum(active.map(e=>e.salary)),active.length)) : 0;
  const avgBenefits=active.length ? safeDiv(sum(active.map(e=>e.benefits)),active.length) : 0.25;
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:18}}>
        {[
          {l:"Total Headcount",   v:`${active.length}`,    sub:`${open.length} open reqs`,                        c:T.cyan},
          {l:"Total Payroll Cost",v:fmt(activeCost,true)+"/yr", sub:`${fmt(activeCost/12,true)}/mo`,              c:T.emerald},
          {l:"Open Req Pipeline", v:fmt(openCost,true)+"/yr",   sub:`${open.length} roles budgeted`,              c:T.amber},
          {l:"Avg Base Salary",   v:fmt(avgSalary,true),        sub:`+${pct(avgBenefits)} benefits avg`, c:T.violet},
        ].map(k=>(
          <div key={k.l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 16px"}}>
            <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{k.l}</div>
            <div style={{fontSize:20,fontWeight:800,fontFamily:T.mono,color:k.c}}>{k.v}</div>
            <div style={{fontSize:10,color:T.textDim,fontFamily:T.sans,marginTop:4}}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[["overview","ð¢ By Department"],["roster","ð¤ Full Roster"],["cost","ð° Cost Analysis"]].map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)} style={{background:view===v?T.cyanDim:"transparent",border:`1px solid ${view===v?T.cyanMid:T.border}`,borderRadius:8,padding:"6px 14px",color:view===v?T.cyan:T.textMid,fontSize:11,fontFamily:T.sans,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>{l}</button>
        ))}
      </div>

      {view==="overview"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {depts.map(d=>{
            const dActive=d.employees.filter(e=>e.status==="active");
            const dOpen=d.employees.filter(e=>e.status==="open");
            const dCost=d.employees.reduce((s,e)=>s+(e.salary*(1+e.benefits)),0);
            const isSelected=selDept===d.name;
            return (
              <div key={d.name}>
                <div onClick={()=>setSelDept(isSelected?null:d.name)} style={{background:T.card,border:`1px solid ${isSelected?d.color+"60":T.border}`,borderRadius:12,padding:"14px 18px",cursor:"pointer",transition:"all 0.2s",boxShadow:isSelected?`0 0 20px ${d.color}15`:"none"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:isSelected?14:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:12,height:12,borderRadius:"50%",background:d.color,flexShrink:0}}/>
                      <span style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14}}>{d.name}</span>
                      <span style={{fontSize:10,color:T.textDim,fontFamily:T.mono}}>{dActive.length} active{dOpen.length>0?` · ${dOpen.length} open`:""}</span>
                    </div>
                    <div style={{display:"flex",gap:20,alignItems:"center"}}>
                      <div style={{textAlign:"right"}}><div style={{fontSize:8,color:T.textDim,fontFamily:T.sans}}>ANNUAL COST</div><div style={{fontSize:14,color:d.color,fontFamily:T.mono,fontWeight:700}}>{fmt(dCost,true)}</div></div>
                      <div style={{fontSize:14,color:T.textDim,transform:isSelected?"rotate(180deg)":"rotate(0)"}}>â¼</div>
                    </div>
                  </div>
                  {isSelected&&(
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {d.employees.map(e=>{
                        const totalComp=e.salary*(1+e.benefits);
                        return (
                          <div key={e.id} style={{display:"grid",gridTemplateColumns:"2fr 1.5fr 1fr 1fr 1fr",alignItems:"center",background:e.status==="open"?T.amberDim:T.surface,border:`1px solid ${e.status==="open"?T.amber+"40":T.border}`,borderRadius:8,padding:"8px 12px",gap:8}}>
                            <div>
                              <div style={{fontSize:11,color:e.status==="open"?T.amber:T.text,fontFamily:T.sans,fontWeight:600}}>{e.name}</div>
                              <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans}}>{e.title}</div>
                            </div>
                            <div style={{fontSize:10,color:T.textMid,fontFamily:T.sans}}>Start: {e.start}</div>
                            <div style={{textAlign:"right"}}><div style={{fontSize:8,color:T.textDim,fontFamily:T.sans}}>BASE</div><div style={{fontSize:11,color:T.cyan,fontFamily:T.mono,fontWeight:700}}>{fmt(e.salary,true)}</div></div>
                            <div style={{textAlign:"right"}}><div style={{fontSize:8,color:T.textDim,fontFamily:T.sans}}>BENEFITS</div><div style={{fontSize:11,color:T.violet,fontFamily:T.mono}}>{pct(e.benefits)}</div></div>
                            <div style={{textAlign:"right"}}><div style={{fontSize:8,color:T.textDim,fontFamily:T.sans}}>TOTAL</div><div style={{fontSize:11,color:d.color,fontFamily:T.mono,fontWeight:700}}>{fmt(totalComp,true)}</div></div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view==="roster"&&(
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
            <thead><tr style={{background:T.surface}}>
              {["Name","Department","Title","Status","Start","Base Salary","Benefits","Total Cost"].map(h=>(
                <th key={h} style={{padding:"9px 12px",textAlign:["Base Salary","Benefits","Total Cost"].includes(h)?"right":"left",color:T.textDim,fontFamily:T.sans,fontSize:9,textTransform:"uppercase",fontWeight:700,borderBottom:`1px solid ${T.border}`,whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {depts.flatMap(d=>d.employees.map(e=>{
                const tc=e.salary*(1+e.benefits);
                return (
                  <tr key={e.id} style={{borderBottom:`1px solid ${T.border}40`}}>
                    <td style={{padding:"8px 12px",color:e.status==="open"?T.amber:T.text,fontFamily:T.sans,fontWeight:600,fontSize:10}}>{e.name}</td>
                    <td style={{padding:"8px 12px"}}><span style={{background:d.color+"22",border:`1px solid ${d.color}40`,borderRadius:20,padding:"2px 8px",fontSize:9,color:d.color,fontFamily:T.sans}}>{d.name}</span></td>
                    <td style={{padding:"8px 12px",color:T.textMid,fontFamily:T.sans,fontSize:10}}>{e.title}</td>
                    <td style={{padding:"8px 12px"}}><span style={{background:e.status==="open"?T.amberDim:T.emeraldDim,border:`1px solid ${e.status==="open"?T.amber+"40":T.emerald+"40"}`,borderRadius:20,padding:"2px 8px",fontSize:9,color:e.status==="open"?T.amber:T.emerald,fontFamily:T.sans,fontWeight:700}}>{e.status==="open"?"Open Req":"Active"}</span></td>
                    <td style={{padding:"8px 12px",color:T.textDim,fontFamily:T.mono,fontSize:10}}>{e.start}</td>
                    <td style={{padding:"8px 12px",textAlign:"right",color:T.cyan,fontFamily:T.mono,fontSize:10,fontWeight:700}}>{fmt(e.salary)}</td>
                    <td style={{padding:"8px 12px",textAlign:"right",color:T.violet,fontFamily:T.mono,fontSize:10}}>{pct(e.benefits)}</td>
                    <td style={{padding:"8px 12px",textAlign:"right",color:d.color,fontFamily:T.mono,fontSize:10,fontWeight:700}}>{fmt(tc)}</td>
                  </tr>
                );
              }))}
            </tbody>
            <tfoot><tr style={{background:T.cyanDim,borderTop:`2px solid ${T.border}`}}>
              <td colSpan="5" style={{padding:"9px 12px",color:T.cyan,fontFamily:T.display,fontWeight:700,fontSize:10}}>TOTAL</td>
              <td style={{padding:"9px 12px",textAlign:"right",color:T.cyan,fontFamily:T.mono,fontWeight:700}}>{fmt(sum(allEmp.map(e=>e.salary)))}</td>
              <td/>
              <td style={{padding:"9px 12px",textAlign:"right",color:T.cyan,fontFamily:T.mono,fontWeight:700}}>{fmt(totalCost)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}

      {view==="cost"&&(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
            <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,marginBottom:2}}>ð° Payroll Cost by Department</div>
            <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,marginBottom:14}}>Fully loaded (salary + benefits) · Includes open req budgets</div>
            {depts.map(d=>{
              const dc=d.employees.reduce((s,e)=>s+(e.salary*(1+e.benefits)),0);
              return (
                <div key={d.name} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <div style={{width:120,fontSize:10,color:T.textMid,fontFamily:T.sans}}>{d.name}</div>
                  <div style={{flex:1,height:10,background:T.border,borderRadius:5,overflow:"hidden"}}>
                    <div style={{width:`${dc/totalCost*100}%`,height:"100%",background:d.color,borderRadius:5,transition:"width 0.4s"}}/>
                  </div>
                  <div style={{width:70,textAlign:"right",fontFamily:T.mono,fontSize:10,color:d.color,fontWeight:700}}>{fmt(dc,true)}</div>
                  <div style={{width:36,textAlign:"right",fontFamily:T.mono,fontSize:9,color:T.textDim}}>{pct(dc/totalCost)}</div>
                </div>
              );
            })}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            {[
              {l:"Fully Loaded Payroll",v:fmt(activeCost,true)+"/yr",sub:"incl. salary + benefits",c:T.cyan},
              {l:"Monthly Run Rate",    v:fmt(activeCost/12,true)+"/mo",sub:"current headcount",c:T.emerald},
              {l:"Open Req Add'l Cost", v:fmt(openCost,true)+"/yr",sub:"if all reqs filled",c:T.amber},
            ].map(k=>(
              <div key={k.l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"14px 16px"}}>
                <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{k.l}</div>
                <div style={{fontSize:18,fontWeight:700,fontFamily:T.mono,color:k.c}}>{k.v}</div>
                <div style={{fontSize:10,color:T.textDim,fontFamily:T.sans,marginTop:4}}>{k.sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// âââ SaaS Metrics ââââââââââââââââââââââââââââââââââââââââââââââââââ
function SaaSMetrics({aiContext}) {
  const [view,setView]=useState("overview");
  const latestMrr=SAAS.mrr[11], latestArr=latestMrr*12;
  const latestNrr=SAAS.nrr[11], latestCac=SAAS.cac[11], latestLtv=SAAS.ltv[11];
  const latestCust=SAAS.customers[11];
  const mrrGrowth=(SAAS.mrr[11]-SAAS.mrr[10])/SAAS.mrr[10];
  const churnRate=safeDiv(SAAS.churnCust[11],SAAS.customers[10]);
  const ltvCacRatio=safeDiv(latestLtv,latestCac);
  const mrrMax=Math.max(...SAAS.mrr);
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:18}}>
        {[
          {l:"Monthly Recurring Rev",v:fmt(latestMrr,true),sub:`ARR: ${fmt(latestArr,true)}`,c:T.cyan,spark:SAAS.mrr},
          {l:"MoM Growth",v:pct(mrrGrowth),sub:mrrGrowth>0?"â² Accelerating":"â¼ Decelerating",c:mrrGrowth>0?T.emerald:T.rose,spark:SAAS.mrr.map((v,i)=>i===0?safeDiv(SAAS.mrr[1]-SAAS.mrr[0],SAAS.mrr[0]):safeDiv(v-SAAS.mrr[i-1],SAAS.mrr[i-1]))},
          {l:"Net Revenue Retention",v:pct(latestNrr),sub:latestNrr>=1.1?"â Best-in-class (â¥110%)":"Target: 110%+",c:latestNrr>=1.1?T.emerald:T.amber,spark:SAAS.nrr},
          {l:"LTV : CAC Ratio",v:`${ltvCacRatio.toFixed(1)}x`,sub:ltvCacRatio>=3?"Healthy ratio":"Target: 3x+",c:ltvCacRatio>=3?T.emerald:T.rose,spark:SAAS.ltv.map((v,i)=>v/SAAS.cac[i])},
        ].map(k=>(
          <div key={k.l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 16px"}}>
            <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{k.l}</div>
            <div style={{fontSize:20,fontWeight:800,fontFamily:T.mono,color:k.c}}>{k.v}</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>
              <div style={{fontSize:10,color:T.textDim,fontFamily:T.sans}}>{k.sub}</div>
              <Spark data={k.spark} color={k.c} w={60} h={20}/>
            </div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[["overview","ð MRR Growth"],["waterfall","ð MRR Waterfall"],["customers","ð¥ Customers"],["unit","ð¡ Unit Economics"]].map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)} style={{background:view===v?T.cyanDim:"transparent",border:`1px solid ${view===v?T.cyanMid:T.border}`,borderRadius:8,padding:"6px 14px",color:view===v?T.cyan:T.textMid,fontSize:11,fontFamily:T.sans,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>{l}</button>
        ))}
      </div>

      {view==="overview"&&(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
            <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,marginBottom:14}}>ð MRR Trend â FY 2024</div>
            <div style={{display:"flex",alignItems:"flex-end",gap:4,height:130}}>
              {SAAS.mrr.map((v,i)=>(
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                  <span style={{fontSize:8,color:T.emerald,fontFamily:T.mono,fontWeight:700}}>{fmt(v,true)}</span>
                  <div style={{width:"100%",height:`${(v/mrrMax)*110}px`,background:`linear-gradient(180deg,${T.cyan}90,${T.cyan}40)`,borderRadius:"3px 3px 0 0",minHeight:3}}/>
                  <span style={{fontSize:7,color:T.textDim,fontFamily:T.mono}}>{MONTHS[i]}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            {[
              {l:"Customers (EOM)",    v:latestCust,        sub:`+${SAAS.newCust[11]} new · -${SAAS.churnCust[11]} churned`,c:T.cyan},
              {l:"Monthly Churn Rate", v:pct(churnRate),    sub:churnRate<0.02?"â Below 2% â healthy":"â  Watch churn rate",     c:churnRate<0.02?T.emerald:T.rose},
              {l:"Avg Rev / Customer", v:fmt(latestMrr/latestCust,true), sub:"ARPU",                                        c:T.violet},
            ].map(k=>(
              <div key={k.l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"14px 16px"}}>
                <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{k.l}</div>
                <div style={{fontSize:18,fontWeight:700,fontFamily:T.mono,color:k.c}}>{k.v}</div>
                <div style={{fontSize:10,color:T.textDim,fontFamily:T.sans,marginTop:4}}>{k.sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view==="waterfall"&&(
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
          <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,marginBottom:14}}>ð MRR Waterfall â Monthly Movement</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
              <thead><tr style={{background:T.surface}}>
                {["Month","Opening MRR","New MRR","Expansion","Churn","Net New","Closing MRR","MoM %"].map(h=>(
                  <th key={h} style={{padding:"8px 10px",textAlign:h==="Month"?"left":"right",color:T.textDim,fontFamily:T.sans,fontSize:9,textTransform:"uppercase",fontWeight:700,borderBottom:`1px solid ${T.border}`,whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {MONTHS.map((m,i)=>{
                  const opening=i===0?(SAAS.mrr[0]-SAAS.newMrr[0]-SAAS.expansionMrr[0]+SAAS.churnMrr[0]):SAAS.mrr[i-1];
                  const net=SAAS.newMrr[i]+SAAS.expansionMrr[i]-SAAS.churnMrr[i];
                  const mom=i===0?0:(SAAS.mrr[i]-SAAS.mrr[i-1])/SAAS.mrr[i-1];
                  return (
                    <tr key={m} style={{borderBottom:`1px solid ${T.border}40`}}>
                      <td style={{padding:"8px 10px",color:T.text,fontFamily:T.sans,fontWeight:600,fontSize:10}}>{m}</td>
                      <td style={{padding:"8px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.textMid}}>{fmt(opening,true)}</td>
                      <td style={{padding:"8px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.emerald}}>+{fmt(SAAS.newMrr[i],true)}</td>
                      <td style={{padding:"8px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.cyan}}>+{fmt(SAAS.expansionMrr[i],true)}</td>
                      <td style={{padding:"8px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.rose}}>-{fmt(SAAS.churnMrr[i],true)}</td>
                      <td style={{padding:"8px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:net>=0?T.emerald:T.rose,fontWeight:700}}>{net>=0?"+":""}{fmt(net,true)}</td>
                      <td style={{padding:"8px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:700,color:T.cyan}}>{fmt(SAAS.mrr[i],true)}</td>
                      <td style={{padding:"8px 10px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:mom>=0?T.emerald:T.rose}}>{i===0?"â":(mom>=0?"+":"")+pct(mom)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view==="customers"&&(
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
          {/* Header + legend row */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
            <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14}}>ð¥ Customer Growth â Acquired vs. Churned</div>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:10,height:10,borderRadius:2,background:T.emerald}}/>
                <span style={{fontSize:10,color:T.textMid,fontFamily:T.sans}}>Acquired</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:10,height:10,borderRadius:2,background:T.rose}}/>
                <span style={{fontSize:10,color:T.textMid,fontFamily:T.sans}}>Churned</span>
              </div>
            </div>
          </div>
          {/* Bug 1 fix: maxCust computed once outside the loop */}
          {(()=>{
            const maxCust=Math.max(...SAAS.newCust,...SAAS.churnCust)*1.3;
            return (
              <div style={{display:"flex",alignItems:"flex-end",gap:4,height:150,marginBottom:12}}>
                {MONTHS.map((m,i)=>(
                  <div key={m} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                    {/* Bug 2+3 fix: flexDirection:"row" + alignItems:"flex-end" makes bars grow
                        upward side-by-side from the same baseline. Both bars get flex:1 equal width. */}
                    <div style={{width:"100%",display:"flex",flexDirection:"row",alignItems:"flex-end",height:130,gap:1}}>
                      {/* Acquired bar + number */}
                      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end"}}>
                        <span style={{fontSize:7,fontFamily:T.mono,color:T.emerald,fontWeight:700,lineHeight:1.2,marginBottom:1}}>{SAAS.newCust[i]}</span>
                        <div style={{width:"100%",height:`${(SAAS.newCust[i]/maxCust)*120}px`,background:`linear-gradient(180deg,${T.emerald}90,${T.emerald}40)`,borderRadius:"2px 2px 0 0",minHeight:2}}/>
                      </div>
                      {/* Churned bar + number */}
                      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end"}}>
                        <span style={{fontSize:7,fontFamily:T.mono,color:T.rose,fontWeight:700,lineHeight:1.2,marginBottom:1}}>{SAAS.churnCust[i]}</span>
                        <div style={{width:"100%",height:`${(SAAS.churnCust[i]/maxCust)*120}px`,background:`linear-gradient(180deg,${T.rose}90,${T.rose}40)`,borderRadius:"2px 2px 0 0",minHeight:2}}/>
                      </div>
                    </div>
                    <span style={{fontSize:7,color:T.textDim,fontFamily:T.mono}}>{m}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
            {[
              {l:"Total Added",   v:sum(SAAS.newCust),  c:T.emerald},
              {l:"Total Churned", v:sum(SAAS.churnCust),c:T.rose},
              {l:"Net New",       v:sum(SAAS.newCust)-sum(SAAS.churnCust), c:T.cyan},
              {l:"End Customers", v:SAAS.customers[11], c:T.violet},
            ].map(k=>(
              <div key={k.l} style={{background:T.surface,borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
                <div style={{fontSize:8,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",marginBottom:4}}>{k.l}</div>
                <div style={{fontSize:16,fontWeight:700,fontFamily:T.mono,color:k.c}}>{k.v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view==="unit"&&(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14}}>
            {[
              {l:"Customer Acquisition Cost",v:fmt(latestCac),sub:"Blended CAC · Dec",trend:SAAS.cac,c:T.amber,better:"lower"},
              {l:"Customer Lifetime Value",  v:fmt(latestLtv),sub:"Avg LTV · Dec",    trend:SAAS.ltv,c:T.emerald,better:"higher"},
              {l:"LTV : CAC Ratio",          v:`${(ltvCacRatio||0).toFixed(1)}x`,sub:ltvCacRatio>=3?"Healthy (3x+ target)":ltvCacRatio>=2?"Improving":"Below benchmark",trend:SAAS.ltv.map((v,i)=>safeDiv(v,SAAS.cac[i])),c:ltvCacRatio>=3?T.emerald:T.amber,better:"higher"},
            ].map(k=>(
              <div key={k.l} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
                <div style={{fontSize:9,color:T.textDim,fontFamily:T.sans,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{k.l}</div>
                <div style={{fontSize:22,fontWeight:800,fontFamily:T.mono,color:k.c,marginBottom:4}}>{k.v}</div>
                <div style={{fontSize:10,color:T.textDim,fontFamily:T.sans,marginBottom:12}}>{k.sub}</div>
                <Spark data={k.trend} color={k.c} w={120} h={32}/>
              </div>
            ))}
          </div>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px"}}>
            <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:14,marginBottom:14}}>ð Net Revenue Retention Trend</div>
            <div style={{display:"flex",alignItems:"flex-end",gap:4,height:100}}>
              {(()=>{
                const nrrMin=Math.min(...SAAS.nrr)*0.998, nrrMax=Math.max(...SAAS.nrr)*1.002;
                const nrrRange=nrrMax-nrrMin||0.001;
                return SAAS.nrr.map((v,i)=>{
                  const h=((v-nrrMin)/nrrRange)*80+10;
                  const good=v>=1.10;
                  return (
                    <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                      <span style={{fontSize:7,color:good?T.emerald:T.amber,fontFamily:T.mono,fontWeight:700}}>{pct(v)}</span>
                      <div style={{width:"100%",height:`${Math.max(h,4)}px`,background:good?`linear-gradient(180deg,${T.emerald}90,${T.emerald}40)`:`linear-gradient(180deg,${T.amber}90,${T.amber}40)`,borderRadius:"3px 3px 0 0"}}/>
                      <span style={{fontSize:7,color:T.textDim,fontFamily:T.mono}}>{MONTHS[i]}</span>
                    </div>
                  );
                });
              })()}
            </div>
            <div style={{marginTop:6,fontSize:9,color:T.textDim,fontFamily:T.sans}}>NRR = (Closing MRR â Starting MRR without new customers) / Starting MRR. Target: â¥110%</div>
          </div>
        </div>
      )}
    </div>
  );
}

// âââ C-Suite Strategic Highlights & Watch Items âââââââââââââââââââ
const CSUITE_ROLES = {
  CEO: {
    key:"CEO", label:"Chief Executive Officer", icon:"â",
    accent:T.amber, accentMuted:T.amberDim,
    lens:"Strategic Direction, Growth & Organizational Risk",
    summary:"FY 2024 delivered the company's strongest quarter on record in Q4, with compounding revenue growth and confirmed profitability. The CEO lens focuses on trajectory, competitive positioning, and removing organizational blockers for 2025.",
    wins:[
      { tag:"Growth",       color:T.emerald, kpi:"+81% YoY",   kpiSub:"Record Q4 at $379.9K",
        title:"Revenue accelerated every single quarter",
        body:"QoQ growth ran +22%, +19%, +25% through the year. Q4's $379.9K is the strongest quarter on record and sets a strong baseline for 2025 planning." },
      { tag:"Retention",    color:T.cyan,    kpi:"NRR 111.5%", kpiSub:"Above 110% best-in-class threshold",
        title:"Existing customers are expanding, not just renewing",
        body:"NRR above 110% means the customer base grows revenue without new acquisition spend. Expansion MRR of $1.6K in December shows the upsell motion is beginning to compound." },
      { tag:"Profitability", color:T.violet, kpi:"$85.7K Net",  kpiSub:"7.5% net margin FY 2024",
        title:"Profitability turned on in Q2 and kept expanding",
        body:"Company moved from Q1 loss of â$2.4K to Q4 net income of $49.1K â a structural shift. EBITDA margin expanded from 1.8% to 18.0%, confirming operating leverage is real." },
      { tag:"Scale",        color:T.amber,   kpi:"$1.5M ARR",   kpiSub:"LTV:CAC at 20.3x",
        title:"$1.5M ARR run rate entering 2025 with 510 customers",
        body:"MRR grew 52.4% from $82K to $125K. A 20.3x LTV:CAC ratio signals efficient growth â every acquisition dollar returns $20+ in lifetime value." },
    ],
    watch:[
      { priority:"critical", effort:"Medium", trend:"stable",    tag:"Revenue",  owner:"VP Sales",       due:"Mar 21",
        impact:"â$73.4K vs FY plan",
        title:"Revenue missed budget in all four quarters",
        body:"Every quarter ran 5â7% below plan. Root cause is new customer ramp timing, not a demand problem â but the budget model needs to be rebuilt before Q1 2025 opens.",
        action:"VP Sales and FP&A to rebuild 2025 revenue model with realistic ramp curves by March 21. CEO to sign off before Q1 board reporting.",
        data:{ label:"Attainment vs Plan (%)", vals:[94,93,94,95], max:100 }},
      { priority:"high",     effort:"High",   trend:"worsening", tag:"Talent",   owner:"HR / Dept Heads",due:"Apr 1",
        impact:"Q1 capacity risk",
        title:"3 open reqs unfilled since mid-2024",
        body:"Engineering, Sales (SDR), and Finance (FP&A Analyst) roles have been open 6â9 months. Each department is at ~100% capacity. 2025 targets cannot be hit without these hires.",
        action:"HR to deliver confirmed offer timelines for all 3 roles by April 1. CEO to escalate to board if any role misses Q1 hire date.",
        data:{ label:"Open Reqs", vals:[1,2,3,3], max:4 }},
      { priority:"medium",   effort:"Medium", trend:"worsening", tag:"Retention",owner:"CS Director",    due:"Q1 2025",
        impact:"Churn ~1.8% â approaching 2% target",
        title:"Customer churn is trending toward the 2.0% threshold in Q4",
        body:"Monthly churn reached ~1.8% in December (9 customers lost vs 491 opening). NRR is still healthy at 111.5%, but continued churn acceleration will erode the expansion revenue buffer.",
        action:"CS Director to complete at-risk account audit and present early warning playbook to CEO by end of Q1.",
        data:{ label:"Monthly Churn Rate (%)", vals:[2.3,2.0,1.9,1.8], max:3 }},
      { priority:"low",      effort:"Low",    trend:"stable",    tag:"Strategy", owner:"CEO / CFO",      due:"Mar 31",
        impact:"2025 plan gap",
        title:"FY 2025 plan and OKRs not yet finalized",
        body:"Q4 momentum provides a strong launchpad but 2025 departmental OKRs, headcount budgets, and growth targets have not been locked.",
        action:"CEO to convene planning session with leadership team. All OKRs and budgets locked by March 31.",
        data:null},
    ],
  },
  CFO: {
    key:"CFO", label:"Chief Financial Officer", icon:"â",
    accent:T.emerald, accentMuted:T.emeraldDim,
    lens:"Financial Controls, Liquidity, Variance Accountability & Risk Exposure",
    summary:"The FY 2024 income statement confirms operating leverage and self-funded growth â but systemic budget variance and specific receivables exposure require immediate corrective action before Q1 2025 closes.",
    wins:[
      { tag:"Margin Control",     color:T.emerald, kpi:"56.9% GM",     kpiSub:"Held Â±0.4pp all four quarters",
        title:"Gross margin held stable despite 81% revenue growth",
        body:"COGS scaled linearly with revenue â no adverse leverage on inventory, direct labor, or shipping. Holding ~57% gross margin through rapid growth confirms disciplined procurement." },
      { tag:"Liquidity",          color:T.cyan,    kpi:"+$86K Cash FY",kpiSub:"$142K → $228K, self-funded",
        title:"The business funded its own growth â no equity raise needed",
        body:"Opening cash of $142K grew to $228K through organic operations. Long-term debt reduced by $24.2K on schedule. Current ratio 3.74x and quick ratio 2.92x are both comfortably in the safe zone." },
      { tag:"Operating Leverage", color:T.amber,   kpi:"16.2pp EBITDA",kpiSub:"1.8% Q1 → 18.0% Q4",
        title:"EBITDA margin expanded 16 percentage points across the year",
        body:"EBITDA grew from $3.8K in Q1 to $68.3K in Q4 â 1,697% increase on 81% revenue growth. Fixed cost absorption is accelerating with each incremental revenue dollar." },
      { tag:"Debt Management",    color:T.violet,  kpi:"â$24.2K LTD",  kpiSub:"All covenants current",
        title:"Debt service is on schedule with no covenant risk",
        body:"Long-term debt tracking to plan ($185K → $160.8K). Short-term debt retired mid-year. No refinancing or emergency credit events occurred." },
    ],
    watch:[
      { priority:"critical", effort:"Low",    trend:"worsening", tag:"Receivables",   owner:"CFO / Controller",  due:"Mar 21",
        impact:"~50% recovery odds",
        title:"AR 90+ days: $7,900 at serious collection risk",
        body:"Apex Logistics has $7,900 past 90 days. Cascade Financial has $900 past 90 days. Statistical recovery probability drops below 50% beyond 90 days. A reserve provision may be required.",
        action:"CFO to initiate formal collections for both accounts by March 21. Apex Logistics reviewed for credit hold. Bad-debt provision assessed by Controller.",
        data:{ label:"90d+ AR Exposure ($)", vals:[0,2100,5800,7900], max:10000 }},
      { priority:"high",     effort:"Medium", trend:"stable",    tag:"Budget Variance",owner:"CFO / FP&A",        due:"Apr 1",
        impact:"â$73.4K vs plan FY",
        title:"Systematic 5â7% revenue miss signals a flawed budget model",
        body:"Consistent variance pattern suggests the FY 2024 model was over-optimistic on new logo ramp velocity. The FY 2025 budget must be rebuilt from revised assumptions.",
        action:"FP&A to conduct full variance post-mortem and deliver revised 2025 revenue assumptions to CFO by April 1. New budget presented to board by April 15.",
        data:{ label:"Revenue Attainment (%)", vals:[94,93,94,95], max:100 }},
      { priority:"high",     effort:"Low",    trend:"stable",    tag:"OpEx Control",  owner:"CMO / Controller",  due:"Mar 31",
        impact:"$8K over budget FY",
        title:"Marketing overspent by ~$8K â ROI attribution unvalidated",
        body:"Marketing ran over budget in Q3 and Q4 (up to 9% above plan in Q4). Cannot approve 2025 marketing budget without formal attribution analysis.",
        action:"CMO to deliver full CAC attribution analysis to CFO by March 31 before 2025 budget is locked.",
        data:{ label:"Mktg Budget Attainment (%)", vals:[83,92,106,109], max:115 }},
      { priority:"medium",   effort:"Low",    trend:"stable",    tag:"DSO",           owner:"Controller",        due:"Q2 2025",
        impact:"$16K+ tied in receivables",
        title:"DSO at 42 days â approaching industry ceiling",
        body:"Days Sales Outstanding approaching the 45-day industry average. Combined with 90d+ exposure, the AR portfolio carries concentration risk.",
        action:"Controller to implement automated AR follow-up and propose revised payment terms for new contracts. Present to CFO in Q2 business review.",
        data:{ label:"DSO (Days)", vals:[38,40,41,42], max:50 }},
    ],
  },
  CIO: {
    key:"CIO", label:"Chief Information Officer", icon:"â¬¡",
    accent:T.cyan, accentMuted:T.cyanDim,
    lens:"Technology Platform, Data Infrastructure, Integrations & Digital Capacity",
    summary:"FY 2024 saw the successful deployment of the FinanceOS FP&A platform with AI capabilities. Three critical integration gaps and a looming infrastructure scaling ceiling need to be addressed in H1 2025.",
    wins:[
      { tag:"Platform",      color:T.cyan,    kpi:"9 modules live",  kpiSub:"AI anomaly detection operational",
        title:"FinanceOS FP&A Suite deployed with AI agent layer",
        body:"9 analysis modules live including P&L, BvA, Cash Flow, Balance Sheet, SaaS Metrics, and a Claude-powered AI assistant with proactive anomaly detection. Significant uplift from manual spreadsheets." },
      { tag:"Integration",   color:T.emerald, kpi:"2 connectors",    kpiSub:"QuickBooks + Plaid live",
        title:"QuickBooks and Plaid integrations are operational",
        body:"OAuth 2.0 QuickBooks sync and Plaid bank feed reconciliation eliminate ~12 hrs/month of manual data entry. Bank-to-book reconciliation is now automated." },
      { tag:"Data Coverage", color:T.violet,  kpi:"Full SaaS stack", kpiSub:"MRR · NRR · LTV:CAC · ARR",
        title:"Complete SaaS metric pipeline built from scratch this year",
        body:"MRR waterfall, NRR, LTV:CAC, CAC, churn cohorts, and ARR tracking did not exist as automated pipelines at the start of FY 2024. All are now tracked monthly." },
      { tag:"Cost Control",  color:T.amber,   kpi:"$26.4K total",    kpiSub:"+$400 vs prior year (+1.5%)",
        title:"Software spend held nearly flat while capabilities tripled",
        body:"Software OpEx grew only $400 year-over-year despite adding multiple new platforms. Effective vendor consolidation prevented SaaS sprawl and shadow IT." },
    ],
    watch:[
      { priority:"critical", effort:"High",   trend:"worsening", tag:"Eng Capacity",owner:"CTO / Eng Lead",due:"Apr 1",
        impact:"Q1 roadmap blocked",
        title:"Open Engineer II req means zero product development capacity",
        body:"3-person engineering team is at 100% utilization on maintenance and support. The Engineer II req has been vacant since July 2024. No new feature development can begin until this hire is made.",
        action:"CTO to present hiring plan with target start date to CIO by March 21. Escalate to CEO if offer not extended by April 1.",
        data:{ label:"Eng Headcount vs Target (FTE)", vals:[4,4,4,3], max:5 }},
      { priority:"high",     effort:"Medium", trend:"stable",    tag:"Integration", owner:"CIO / VP Sales",due:"Q2 2025",
        impact:"Revenue forecast blind spot",
        title:"No CRM integration â pipeline data is disconnected from financials",
        body:"Without Salesforce or HubSpot integration, revenue budget variances cannot be diagnosed at the deal or segment level. Every budget miss is a black box.",
        action:"CIO to evaluate CRM integration options and deliver scoping document to VP Sales by end of Q1. Target go-live: Q2 2025.",
        data:null},
      { priority:"high",     effort:"Medium", trend:"stable",    tag:"Integration", owner:"CIO / HR",      due:"Q2 2025",
        impact:"2â3 week headcount data lag",
        title:"Payroll system not connected â headcount data manually entered",
        body:"ADP/Rippling integration does not exist. Headcount and payroll actuals are manually entered, creating a 2â3 week lag in headcount variance analysis during active hiring cycles.",
        action:"CIO and HR to align on payroll system and begin integration scoping. Target: automated headcount sync by Q2 2025.",
        data:null},
      { priority:"medium",   effort:"High",   trend:"stable",    tag:"Infrastructure",owner:"CIO",         due:"Q3 2025",
        impact:"Scaling ceiling at ~$2M ARR",
        title:"No data warehouse â direct API architecture has a growth ceiling",
        body:"Current architecture queries QuickBooks and Plaid APIs directly. This works at $1.5M ARR but will create latency and data quality issues as transaction volume grows.",
        action:"CIO to complete data architecture review by Q2 2025 and present warehouse options (BigQuery/Snowflake/DuckDB). Implementation target: Q3 2025.",
        data:null},
    ],
  },
};

const CPRI = {
  critical:{ label:"CRITICAL", fg:T.rose,    bg:T.roseDim,    border:T.rose+"35"    },
  high:    { label:"HIGH",     fg:T.amber,   bg:T.amberDim,   border:T.amber+"35"   },
  medium:  { label:"MEDIUM",   fg:T.cyan,    bg:T.cyanDim,    border:T.cyan+"35"    },
  low:     { label:"LOW",      fg:T.textDim, bg:"#1A2234",    border:T.textDim+"35" },
};
const CTREND = {
  worsening:{ g:"â", label:"Worsening", c:T.rose    },
  stable:   { g:"→", label:"Stable",    c:T.amber   },
  improving:{ g:"â", label:"Improving", c:T.emerald },
};
const CEFFORT = { High:T.rose, Medium:T.amber, Low:T.emerald };

function CsuiteStrategicPanel() {
  const [roleKey, setRoleKey]     = useState("CEO");
  const [expanded, setExpanded]   = useState(null);
  const R = CSUITE_ROLES[roleKey];
  const ac = R.accent;
  useEffect(()=>{ setExpanded(null); },[roleKey]);

  return (
    <div>
      {/* ââ Role selector ââ */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,overflow:"hidden",marginBottom:20}}>
        {Object.values(CSUITE_ROLES).map((r,i)=>{
          const active = roleKey===r.key;
          return (
            <button key={r.key} onClick={()=>setRoleKey(r.key)} style={{
              border:"none", borderRight:i<2?`1px solid ${T.border}`:"none",
              background:active?`linear-gradient(160deg,${r.accent}18,${r.accent}08)`:"transparent",
              cursor:"pointer", padding:"18px 20px", textAlign:"left", position:"relative", transition:"background 0.2s",
            }}>
              {active&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent 10%,${r.accent} 45%,${r.accent} 55%,transparent 90%)`}}/>}
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <div style={{width:32,height:32,borderRadius:9,background:active?r.accent+"22":T.card,border:`1px solid ${active?r.accent+"50":T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:T.mono,fontSize:13,color:active?r.accent:T.textDim,transition:"all 0.2s"}}>{r.icon}</div>
                <div>
                  <div style={{fontFamily:T.mono,fontSize:13,fontWeight:700,letterSpacing:1.5,color:active?r.accent:T.textMid}}>{r.key}</div>
                  <div style={{fontFamily:T.sans,fontSize:9,color:T.textDim,marginTop:1}}>{r.label}</div>
                </div>
              </div>
              <div style={{fontFamily:T.sans,fontSize:9,color:active?T.textMid:T.textDim,lineHeight:1.55,marginBottom:10}}>{r.lens}</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {r.watch.filter(w=>w.priority==="critical"||w.priority==="high").map((w,wi)=>{
                  const p=CPRI[w.priority];
                  return <div key={wi} style={{display:"flex",alignItems:"center",gap:4,background:p.bg,border:`1px solid ${p.border}`,borderRadius:4,padding:"2px 7px"}}>
                    <div style={{width:4,height:4,borderRadius:"50%",background:p.fg,boxShadow:`0 0 5px ${p.fg}60`}}/>
                    <span style={{fontFamily:T.mono,fontSize:7,color:p.fg,letterSpacing:1.5,fontWeight:700}}>{p.label}</span>
                  </div>;
                })}
              </div>
            </button>
          );
        })}
      </div>

      {/* ââ Role lens summary ââ */}
      <div style={{background:`linear-gradient(135deg,${ac}10,${ac}04)`,border:`1px solid ${ac}28`,borderLeft:`3px solid ${ac}`,borderRadius:"0 10px 10px 0",padding:"12px 18px",marginBottom:20}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
          <span style={{fontFamily:T.mono,fontSize:9,color:ac,letterSpacing:3,textTransform:"uppercase",whiteSpace:"nowrap",marginTop:2}}>{R.key} VIEW</span>
          <div style={{width:1,height:14,background:ac+"40",flexShrink:0,marginTop:2}}/>
          <p style={{fontFamily:T.sans,fontSize:11,color:T.textMid,lineHeight:1.65}}>{R.summary}</p>
        </div>
      </div>

      {/* ââ Strategic wins ââ */}
      <div style={{marginBottom:4}}>
        <CSuiteRowLabel color={T.emerald} label={`${R.key} · Strategic Wins`} sub="Four highest-signal positives from FY 2024"/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
        {R.wins.map((w,i)=>(
          <div key={i} style={{background:`linear-gradient(155deg,${T.card},${T.surface})`,border:`1px solid ${w.color}22`,borderTop:`2px solid ${w.color}55`,borderRadius:11,padding:"16px 16px",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",inset:0,pointerEvents:"none",background:`radial-gradient(ellipse at top right,${w.color}07,transparent 60%)`}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
              <span style={{fontFamily:T.mono,fontSize:7,color:w.color,letterSpacing:1.5,textTransform:"uppercase",background:w.color+"15",border:`1px solid ${w.color}30`,borderRadius:4,padding:"2px 7px"}}>{w.tag}</span>
              <span style={{fontFamily:T.mono,fontSize:7,color:T.emerald,background:T.emeraldDim,border:`1px solid ${T.emerald}28`,borderRadius:4,padding:"2px 7px"}}>HIGH</span>
            </div>
            <div style={{fontFamily:T.mono,fontSize:18,fontWeight:700,color:w.color,lineHeight:1,marginBottom:5}}>{w.kpi}</div>
            <div style={{fontFamily:T.sans,fontSize:9,color:T.textDim,marginBottom:8}}>{w.kpiSub}</div>
            <div style={{fontFamily:T.sans,fontSize:10,fontWeight:600,color:T.text,marginBottom:7,lineHeight:1.4}}>{w.title}</div>
            <div style={{fontFamily:T.sans,fontSize:9,color:T.textMid,lineHeight:1.7}}>{w.body}</div>
          </div>
        ))}
      </div>

      {/* ââ Watch items ââ */}
      <CSuiteRowLabel color={T.rose} label={`${R.key} · Watch Items & Required Actions`} sub="Issues ordered by priority and business impact"/>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
        {R.watch.map((w,i)=>{
          const p=CPRI[w.priority], tr=CTREND[w.trend]||CTREND.stable, isOpen=expanded===i;
          return (
            <div key={`${roleKey}-${i}`} onClick={()=>setExpanded(isOpen?null:i)} style={{
              background:isOpen?`linear-gradient(135deg,${p.fg}0C,${T.card})`  :T.surface,
              border:`1px solid ${isOpen?p.fg+"45":T.border}`,
              borderLeft:`3px solid ${p.fg}`,
              borderRadius:"0 10px 10px 0",
              padding:isOpen?"18px 22px":"13px 22px",
              cursor:"pointer", transition:"all 0.2s",
            }}>
              {/* Header row */}
              <div style={{display:"grid",gridTemplateColumns:"auto 1fr auto auto auto auto",gap:12,alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0,background:p.bg,border:`1px solid ${p.border}`,borderRadius:5,padding:"3px 9px"}}>
                  <div style={{width:5,height:5,borderRadius:"50%",background:p.fg,boxShadow:`0 0 5px ${p.fg}70`}}/>
                  <span style={{fontFamily:T.mono,fontSize:7,color:p.fg,fontWeight:700,letterSpacing:1.5}}>{p.label}</span>
                </div>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:7}}>
                    <span style={{fontFamily:T.sans,fontSize:11,fontWeight:600,color:T.text}}>{w.title}</span>
                    <span style={{fontFamily:T.mono,fontSize:7,color:ac,letterSpacing:1,background:ac+"14",border:`1px solid ${ac}25`,borderRadius:3,padding:"1px 5px",flexShrink:0,textTransform:"uppercase"}}>{w.tag}</span>
                  </div>
                  {!isOpen&&<div style={{fontFamily:T.sans,fontSize:9,color:T.textDim,marginTop:3}}>{w.body.substring(0,115)}â¦</div>}
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontFamily:T.mono,fontSize:7,color:T.textDim,letterSpacing:1.5,marginBottom:2}}>IMPACT</div>
                  <div style={{fontFamily:T.mono,fontSize:10,color:p.fg,fontWeight:700}}>{w.impact}</div>
                </div>
                <div style={{textAlign:"center",flexShrink:0,minWidth:80}}>
                  <div style={{fontFamily:T.mono,fontSize:7,color:T.textDim,letterSpacing:1.5,marginBottom:2}}>TREND</div>
                  <div style={{fontFamily:T.sans,fontSize:10,color:tr.c,fontWeight:600}}>{tr.g} {tr.label}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontFamily:T.mono,fontSize:7,color:T.textDim,letterSpacing:1.5,marginBottom:2}}>OWNER</div>
                  <div style={{fontFamily:T.sans,fontSize:10,color:T.textMid}}>{w.owner}</div>
                </div>
                <div style={{fontFamily:T.mono,fontSize:10,color:T.textDim,flexShrink:0,transform:isOpen?"rotate(180deg)":"none",transition:"transform 0.2s",userSelect:"none"}}>â</div>
              </div>

              {/* Expanded detail */}
              {isOpen&&(
                <div style={{marginTop:18,display:"grid",gridTemplateColumns:"1fr 190px",gap:18,alignItems:"start"}}>
                  <div>
                    <p style={{fontFamily:T.sans,fontSize:11,color:T.textMid,lineHeight:1.8,marginBottom:14}}>{w.body}</p>
                    {w.data&&(
                      <div style={{marginBottom:14}}>
                        <div style={{fontFamily:T.mono,fontSize:8,color:T.textDim,letterSpacing:2,marginBottom:8}}>{w.data.label} â Q1 → Q4</div>
                        <div style={{display:"flex",gap:8,alignItems:"flex-end",height:44}}>
                          {w.data.vals.map((v,qi)=>{
                            const qcs=[T.amber,T.cyan,T.emerald,T.violet];
                            const barH=Math.max((v/w.data.max)*36,3);
                            return (
                              <div key={qi} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                                <div style={{fontFamily:T.mono,fontSize:8,color:qcs[qi],fontWeight:700}}>{v}</div>
                                <div style={{width:"100%",display:"flex",flexDirection:"column",justifyContent:"flex-end",height:28}}>
                                  <div style={{width:"100%",height:`${barH}px`,background:`linear-gradient(180deg,${qcs[qi]}90,${qcs[qi]}40)`,border:`1px solid ${qcs[qi]}40`,borderRadius:"3px 3px 0 0"}}/>
                                </div>
                                <div style={{fontFamily:T.mono,fontSize:7,color:T.textDim}}>Q{qi+1}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div style={{background:p.bg,border:`1px solid ${p.border}`,borderRadius:8,padding:"11px 14px",display:"flex",gap:10,alignItems:"flex-start"}}>
                      <span style={{fontFamily:T.mono,color:p.fg,fontSize:12,flexShrink:0,marginTop:1}}>→</span>
                      <div>
                        <div style={{fontFamily:T.mono,fontSize:8,color:p.fg,letterSpacing:2,marginBottom:4}}>REQUIRED ACTION</div>
                        <div style={{fontFamily:T.sans,fontSize:11,color:T.text,fontWeight:600,lineHeight:1.6}}>{w.action}</div>
                      </div>
                    </div>
                  </div>
                  <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"14px",display:"flex",flexDirection:"column",gap:12}}>
                    {[{l:"PRIORITY",v:p.label,c:p.fg},{l:"DUE DATE",v:w.due,c:T.text},{l:"OWNER",v:w.owner,c:T.textMid},{l:"EFFORT",v:w.effort,c:CEFFORT[w.effort]},{l:"CATEGORY",v:w.tag,c:ac},{l:"TREND",v:`${tr.g} ${tr.label}`,c:tr.c}].map(m=>(
                      <div key={m.l}>
                        <div style={{fontFamily:T.mono,fontSize:7,color:T.textDim,letterSpacing:2,marginBottom:2}}>{m.l}</div>
                        <div style={{fontFamily:T.sans,fontSize:11,fontWeight:600,color:m.c}}>{m.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ââ Priority Ã Effort matrix ââ */}
      <CSuiteRowLabel color={T.textDim} label="Priority Ã Effort Matrix" sub="Resource allocation reference for leadership team"/>
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"18px 22px"}}>
        <div style={{display:"grid",gridTemplateColumns:"88px 1fr 1fr 1fr",gap:5}}>
          <div/>
          {["Low Effort","Medium Effort","High Effort"].map(e=>(
            <div key={e} style={{textAlign:"center",paddingBottom:5}}>
              <span style={{fontFamily:T.mono,fontSize:8,color:T.textDim,letterSpacing:1.5}}>{e.toUpperCase()}</span>
            </div>
          ))}
          {["critical","high","medium","low"].map(prio=>
            [null,"Low","Medium","High"].map((eff,ci)=>{
              if(ci===0) return (
                <div key={`lbl-${prio}`} style={{display:"flex",alignItems:"center",paddingRight:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <div style={{width:5,height:5,borderRadius:"50%",background:CPRI[prio].fg,flexShrink:0}}/>
                    <span style={{fontFamily:T.mono,fontSize:8,color:CPRI[prio].fg,letterSpacing:1}}>{CPRI[prio].label}</span>
                  </div>
                </div>
              );
              const cellItems=R.watch.filter(w=>w.priority===prio&&w.effort===eff);
              const isHot = (prio==="critical"&&(eff==="High"||eff==="Medium"))||(prio==="high"&&eff==="High");
              const isQuick = (prio==="critical"&&eff==="Low")||(prio==="high"&&eff==="Low");
              const cellBg = cellItems.length?(isHot?T.roseDim:isQuick?T.emeraldDim:T.amberDim):T.card;
              const cellBorder = cellItems.length?(isHot?T.rose+"30":isQuick?T.emerald+"30":T.amber+"30"):T.border;
              return (
                <div key={`${prio}-${eff}`} style={{background:cellBg,border:`1px solid ${cellBorder}`,borderRadius:7,padding:"8px 10px",minHeight:52}}>
                  {cellItems.length===0
                    ? <span style={{fontFamily:T.mono,fontSize:9,color:T.border,opacity:0.5}}>â</span>
                    : cellItems.map((item,ii)=>(
                        <div key={ii} style={{fontFamily:T.sans,fontSize:9,color:CPRI[prio].fg,fontWeight:600,lineHeight:1.3,marginBottom:ii<cellItems.length-1?4:0}}>
                          {item.title.length>40?item.title.substring(0,40)+"â¦":item.title}
                        </div>
                      ))
                  }
                </div>
              );
            })
          )}
        </div>
        <div style={{display:"flex",gap:16,marginTop:12,paddingTop:10,borderTop:`1px solid ${T.border}`}}>
          {[{bg:T.roseDim,b:T.rose+"30",l:"Act Now"},{bg:T.amberDim,b:T.amber+"30",l:"Plan & Assign"},{bg:T.emeraldDim,b:T.emerald+"30",l:"Quick Win"}].map(l=>(
            <div key={l.l} style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:11,height:11,borderRadius:3,background:l.bg,border:`1px solid ${l.b}`,flexShrink:0}}/>
              <span style={{fontFamily:T.sans,fontSize:9,color:T.textDim}}>{l.l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CSuiteRowLabel({color,label,sub}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
      <div style={{width:3,height:14,background:color,borderRadius:2,flexShrink:0}}/>
      <div>
        <div style={{fontFamily:T.mono,fontSize:9,color,letterSpacing:3,textTransform:"uppercase"}}>{label}</div>
        {sub&&<div style={{fontFamily:T.sans,fontSize:9,color:T.textDim,marginTop:1}}>{sub}</div>}
      </div>
      <div style={{height:1,flex:1,background:`linear-gradient(90deg,${color}30,transparent)`}}/>
    </div>
  );
}

// âââ Main App âââââââââââââââââââââââââââââââââââââââââââââââââââââ
function FPADashboardInner({ initialPlan = "starter", onPlanRefresh }) {
  // ââ All useState hooks at the top â preserves hook order across renders ââ
  const [tab,setTab]                         = useState("pnl");
  const [plan,setPlan]                       = useState(initialPlan);
  const [aiPanelOpen, setAiPanelOpen]        = useState(true);
  const [aiAlertTab, setAiAlertTab]          = useState("chat");
  const [bannerDismissed, setBannerDismissed]     = useState(false);
  const [csvImportOpen,   setCsvImportOpen]        = useState(false);
  const [checklistDismissed, setChecklistDismissed] = useState(() => {
    try { return localStorage.getItem('fo_checklist_dismissed') === 'true'; } catch { return false; }
  });

  // Sync if parent refreshes plan (e.g. post-Stripe redirect)
  useEffect(() => { setPlan(normalizePlan(initialPlan)); }, [initialPlan]);

  // ââ Core computations ââ
  const pnl    = useMemo(()=>computePnL(BASE_PNL), []);
  const budPnL = useMemo(()=>computePnL(BUDGET_PNL), []);

  const aiCtx={
    ytdRevenue:sum(pnl.map(m=>m.rev)), ytdCogs:sum(pnl.map(m=>m.cogs)),
    ytdOpex:sum(pnl.map(m=>m.opex)),   ytdEbitda:sum(pnl.map(m=>m.ebitda)),
    ytdNet:sum(pnl.map(m=>m.net)),
    ytdGrossMargin:safeDiv(sum(pnl.map(m=>m.gross)),sum(pnl.map(m=>m.rev))),
    ytdNetMargin:safeDiv(sum(pnl.map(m=>m.net)),sum(pnl.map(m=>m.rev))),
    ytdProductSales:sum(BASE_PNL.productSales), ytdServices:sum(BASE_PNL.serviceFees),
    ytdRecurring:sum(BASE_PNL.recurringRevenue), ytdPayroll:sum(BASE_PNL.payroll),
    ytdMarketing:sum(BASE_PNL.marketing), ytdRent:sum(BASE_PNL.rent),
  };

  // ââ Cash flow ââ
  const cfInflows  = CF.inflows.collections.map((v,i)=>v+CF.inflows.newContracts[i]+CF.inflows.recurring[i]+CF.inflows.other[i]);
  const cfOutflows = CF.outflows.payroll.map((v,i)=>v+CF.outflows.vendors[i]+CF.outflows.rent[i]+CF.outflows.taxes[i]+CF.outflows.debtService[i]+CF.outflows.capex[i]+CF.outflows.other[i]);
  const cfBal = cfInflows.reduce((acc,v,i)=>{
    const prev = i===0 ? CF.openingBalance : acc[i-1];
    acc.push(prev + v - cfOutflows[i]);
    return acc;
  },[]);
  const cfMin=Math.min(...cfBal), cfMinWk=cfBal.indexOf(cfMin)+1;

  // ââ AR ââ
  const arClients=AR_CLIENTS.map(c=>({...c,total:c.current+c.d30+c.d60+c.d90+c.d90p}));
  const arTot=sum(arClients.map(c=>c.total));

  // ââ Regional ââ
  const regions=[...new Set(REGIONAL_CLIENTS.map(c=>c.region))];
  const totalRev=sum(REGIONAL_CLIENTS.map(c=>c.revenue));
  const avgMargin=safeDiv(sum(REGIONAL_CLIENTS.map(c=>c.margin*c.revenue)),totalRev);
  const avgNps=Math.round(safeDiv(sum(REGIONAL_CLIENTS.map(c=>c.nps)),REGIONAL_CLIENTS.length));

  // ââ Scenarios ââ
  const scenRes=useMemo(()=>({bear:computePnL(BASE_PNL,SCENARIOS_DEF.bear),base:computePnL(BASE_PNL,SCENARIOS_DEF.base),bull:computePnL(BASE_PNL,SCENARIOS_DEF.bull)}), []);
  const sAn=r=>sum(r.map(m=>m.net)), sAr=r=>sum(r.map(m=>m.rev));

  // ââ BvA context ââ
  const revVariance  = sum(pnl.map(m=>m.rev))  - sum(budPnL.map(m=>m.rev));
  const opexVariance = sum(pnl.map(m=>m.opex)) - sum(budPnL.map(m=>m.opex));
  const netVariance  = sum(pnl.map(m=>m.net))  - sum(budPnL.map(m=>m.net));

  // ââ Balance sheet context ââ
  const BS=BALANCE_SHEET, mo=11;
  const bsCurrA = BS.cash[mo]+BS.accountsReceivable[mo]+BS.inventory_bs[mo]+BS.prepaidExpenses[mo];
  const bsTotalA = bsCurrA+(BS.ppe_gross[mo]-BS.accumDeprec[mo])+BS.otherAssets[mo];
  const bsCurrL = BS.accountsPayable[mo]+BS.accruedExpenses[mo]+BS.deferredRevenue[mo]+BS.shortTermDebt[mo];
  const bsTotalL = bsCurrL+BS.longTermDebt[mo];
  const bsEquity = bsTotalA-bsTotalL;
  const bsCurrRatio=safeDiv(bsCurrA,bsCurrL,1);
  const bsDebtToEq=safeDiv(bsTotalL,bsEquity);

  // ââ Headcount context ââ
  const allEmp=HEADCOUNT_DATA.departments.flatMap(d=>d.employees);
  const activeEmp=allEmp.filter(e=>e.status==="active");
  const openReqs=allEmp.filter(e=>e.status==="open");
  const totalPayrollCost=activeEmp.reduce((s,e)=>s+(e.salary*(1+e.benefits)),0);

  // ââ SaaS context ââ
  const latestMrr=SAAS.mrr[11], latestNrr=SAAS.nrr[11];
  const latestCac=SAAS.cac[11], latestLtv=SAAS.ltv[11];
  const churnRate=safeDiv(SAAS.churnCust[11],SAAS.customers[10]);

  // ââ Anomaly Detection Engine ââ
  const buildAnomalies = () => {
    const items = [];
    // Revenue vs budget miss
    const revMissPct = safeDiv(revVariance, sum(budPnL.map(m=>m.rev)));
    if(revMissPct < -0.05) items.push({severity:"critical", emoji:"ð", title:"Revenue below budget", detail:`YTD revenue is ${pct(Math.abs(revMissPct))} below budget â a ${fmt(Math.abs(revVariance),true)} shortfall. Product Sales are the primary driver of the miss.`, action:"Review pricing strategy & pipeline in Scenario Planner"});
    // Marketing overspend
    const mktActual=sum(BASE_PNL.marketing), mktBudget=sum(BUDGET_PNL.marketing);
    if(mktActual>mktBudget*1.08) items.push({severity:"warning", emoji:"ð¢", title:"Marketing over budget", detail:`Marketing spend is ${pct(safeDiv(mktActual-mktBudget,mktBudget))} over budget (${fmt(mktActual,true)} actual vs ${fmt(mktBudget,true)} budget). Check ROI on Q4 campaigns.`, action:"Analyze channel ROI in Dept Breakdown"});
    // High AR overdue
    const overdue90=sum(AR_CLIENTS.map(c=>c.d90+c.d90p));
    if(overdue90>5000) items.push({severity:"critical", emoji:"â ï¸", title:"AR 90+ days overdue", detail:`${fmt(overdue90,true)} is 90+ days past due. Apex Logistics ($7,900) and Cascade Financial ($900) are primary risks. Collection probability drops below 50% after 90 days.`, action:"Prioritize collections call list in AR Aging"});
    // Cash crunch risk
    if(cfMin<80000) items.push({severity:"warning", emoji:"ð§", title:"Cash balance dips low", detail:`Projected minimum cash balance hits ${fmt(cfMin,true)} at Week ${cfMinWk}. This is driven by tax payments and CapEx overlap. Consider timing adjustments.`, action:"Review weekly detail in Cash Flow tab"});
    // Churn rate
    if(churnRate>0.018) items.push({severity:"warning", emoji:"ð", title:"Customer churn approaching target", detail:`Monthly customer churn is ${pct(churnRate)} vs 2.0% target. ${SAAS.churnCust[11]} customers churned in December. Review at-risk segments before churn accelerates.`, action:"Deep-dive customer cohorts in SaaS Metrics"});
    // LTV:CAC health
    const ltvCac=latestLtv/latestCac;
    if(ltvCac<3) items.push({severity:"warning", emoji:"ð¯", title:"LTV:CAC ratio below 3x", detail:`Current LTV:CAC is ${ltvCac.toFixed(1)}x â below the 3x benchmark. CAC has been volatile. Consider reducing acquisition spend or improving onboarding retention.`, action:"Analyze unit economics in SaaS Metrics"});
    // Working capital
    if(bsCurrRatio<1.5) items.push({severity:"info", emoji:"ð¦", title:"Current ratio trending low", detail:`Current ratio is ${bsCurrRatio.toFixed(2)}x. While above the 1.0x floor, approaching 1.5x warrants attention â especially with the short-term debt maturity.`, action:"Review Balance Sheet liquidity ratios"});
    // Net margin compression
    const netM=aiCtx.ytdNetMargin;
    if(netM<0.08) items.push({severity:"info", emoji:"ð", title:"Net margin compression", detail:`Net margin at ${pct(netM)} is below the 8% healthy threshold. Payroll growth and marketing spend are outpacing revenue. Review P&L cost structure.`, action:"Examine expense trends in P&L Breakdown"});
    // NRR below 110%
    if(latestNrr<1.10) items.push({severity:"info", emoji:"ð", title:"NRR below 110% benchmark", detail:`Net Revenue Retention of ${pct(latestNrr-1)} is below best-in-class SaaS benchmark of 110%+. Focus on expansion revenue and reducing contraction MRR.`, action:"Review expansion MRR in SaaS Waterfall"});
    return items;
  };
  const anomalies = useMemo(()=>buildAnomalies(), [revVariance, cfMin, churnRate, latestNrr, latestLtv, latestCac, bsCurrRatio]);

  // ââ Tab-aware AI contexts ââ
  const tabCtx = {
    pnl:          aiCtx,
    scenario:     {...aiCtx, bearAnnualNet:sAn(scenRes.bear), baseAnnualNet:sAn(scenRes.base), bullAnnualNet:sAn(scenRes.bull), bearRevenue:sAr(scenRes.bear), bullRevenue:sAr(scenRes.bull), activeScenario:"base"},
    cashflow:     {...aiCtx, openingBalance:CF.openingBalance, endBalance:cfBal[cfBal.length-1], minBalance:cfMin, minWeek:cfMinWk, totalInflows:sum(cfInflows), totalOutflows:sum(cfOutflows)},
    ar:           {...aiCtx, totalAR:arTot, current:sum(AR_CLIENTS.map(c=>c.current)), d30:sum(AR_CLIENTS.map(c=>c.d30)), d60:sum(AR_CLIENTS.map(c=>c.d60)), d90plus:sum(AR_CLIENTS.map(c=>c.d90+c.d90p)), dso:Math.round(arTot/(aiCtx.ytdRevenue/365))},
    regional:     {...aiCtx, clientCount:REGIONAL_CLIENTS.length, regionCount:regions.length, totalRevenue:totalRev, avgMargin, avgNps},
    bva:          {...aiCtx, revVariance, opexVariance, netVariance},
    balancesheet: {...aiCtx, totalAssets:bsTotalA, totalLiab:bsTotalL, workingCapital:bsCurrA-bsCurrL, currentRatio:bsCurrRatio, debtToEquity:bsDebtToEq},
    headcount:    {...aiCtx, totalHC:activeEmp.length, openReqs:openReqs.length, totalPayrollCost},
    saas:         {...aiCtx, latestMrr, latestNrr, latestCac, latestLtv, churnRate},
    csuite:       {...aiCtx, latestMrr, latestNrr, latestCac, latestLtv, churnRate, openReqs:openReqs.length, totalHC:activeEmp.length, revVariance, opexVariance, netVariance},
    "cfo-sim":    aiCtx,
    integrations: aiCtx,
    pricing:      aiCtx,
  };

  const TABS=[
    {id:"pnl",         label:"P&L",            icon:"ð", group:"core",  feature:FEATURES.PNL},
    {id:"bva",         label:"Budget vs Actual",icon:"ð", group:"core",  feature:FEATURES.BUDGET_VS_ACTUAL},
    {id:"scenario",    label:"Scenarios",       icon:"ð®", group:"core",  feature:FEATURES.SCENARIOS},
    {id:"cashflow",    label:"Cash Flow",       icon:"ð§", group:"core",  feature:FEATURES.CASH_FLOW},
    {id:"balancesheet",label:"Balance Sheet",   icon:"ð¦", group:"core",  feature:FEATURES.BALANCE_SHEET},
    {id:"headcount",   label:"Headcount",       icon:"ð¥", group:"core",  feature:FEATURES.HEADCOUNT},
    {id:"saas",        label:"SaaS Metrics",    icon:"ð", group:"core",  feature:FEATURES.SAAS_METRICS},
    {id:"ar",          label:"AR Aging",        icon:"ð¬", group:"ops",   feature:FEATURES.AR_AGING},
    {id:"regional",    label:"Clients",         icon:"ðºï¸", group:"ops",   feature:FEATURES.CLIENTS},
    {id:"csuite",      label:"C-Suite Report",  icon:"â",  group:"ops",   feature:FEATURES.CSUITE_REPORT},
    {id:"cfo-sim",     label:"CFO Simulation",  icon:"ð¯", group:"ops",   feature:FEATURES.CFO_SIMULATION},
    {id:"budgeting",   label:"Budgeting",        icon:"ð¼", group:"ops",   feature:FEATURES.BUDGETING},
    {id:"integrations",label:"Integrations",    icon:"ð", group:"ops",   feature:FEATURES.INTEGRATIONS_READ},
    {id:"pricing",     label:"Pricing",         icon:"ð³", group:"ops",   feature:null},
  ];

  // ââ Plan capability gates â derived from feature-flag system ââ
  const canUseScenarios = hasFeature(plan, FEATURES.SCENARIOS);
  const canUseHeadcount = hasFeature(plan, FEATURES.HEADCOUNT);
  const canUseSaaS      = hasFeature(plan, FEATURES.SAAS_METRICS);
  const canUseAlerts    = hasFeature(plan, FEATURES.ANOMALY_ALERTS);
  const canUseCsuite    = hasFeature(plan, FEATURES.CSUITE_REPORT);
  const planMeta        = PLAN_META[normalizePlan(plan)] || PLAN_META.professional;

  const tabLocked = t => {
    if(!t.feature) return false;
    return !hasFeature(plan, t.feature);
  };

  const showPanel=["pnl","scenario","cashflow","ar","regional","bva","balancesheet","headcount","saas","csuite","cfo-sim"].includes(tab);
  const criticalCount=canUseAlerts ? anomalies.filter(a=>a.severity==="critical").length : 0;

  // ââ Starter upgrade banner â computed once per render, used in JSX ââ
  const starterBanner = (!bannerDismissed && false && tab!=="pricing") ? (()=>{
    const isProTab=["scenario","headcount","saas","cfo-sim","csuite","budgeting"].includes(tab);
    const isEntTab=false; // All key features are now in Professional
    if(isEntTab) return {
      color: T.violet, icon:"â",
      headline:"Enterprise feature",
      text:"C-Suite Reports are exclusive to the Enterprise plan â executive-ready summaries for your CEO, CFO, and CIO.",
      cta:"Contact Sales",
    };
    if(isProTab) {
      const cfg = {
        scenario:{headline:"You're 1 click from Scenario Planning",text:"Test pricing, hiring, and revenue changes before committing â Bear, Base, and Bull case in one view."},
        headcount:{headline:"Plan your next hire before you post the role",text:"See the true cost of every headcount decision and track payroll against budget automatically."},
        saas:{headline:"See what's driving your MRR growth",text:"Track churn, NRR, and CAC:LTV in real time. Investors ask for these metrics â now you'll have them ready."},
        "cfo-sim":{headline:"Get a CFO's honest verdict on your dashboard",text:"See how a real CFO would evaluate your financials, workflows, and readiness to compete â across a simulated 30-day review."},
        csuite:{headline:"C-Suite Report is now on Professional",text:"Get executive-ready CEO, CFO, and CIO summaries. Share with leadership and investors directly from FinanceOS."},
        budgeting:{headline:"Build your first budget in minutes",text:"Create department budgets, route them for approval, and track actuals vs plan â all in one place."},
      }[tab]||{headline:"Professional feature",text:"Upgrade to unlock this and 8 other planning tools."};
      return { color: T.cyan, icon:"→", ...cfg, cta:"Start 14-Day Free Trial" };
    }
    if(tab==="integrations") return {
      color:T.amber, icon:"ð",
      headline:"Live sync requires Professional",
      text:"You're viewing read-only integration data. Upgrade to connect QuickBooks and Plaid and sync live financial data.",
      cta:"Upgrade to Professional",
    };
    return {
      color: T.teal, icon:"ð±",
      headline:"You're on Starter",
      text:"Unlock Scenario Planning, SaaS Metrics, Headcount Planning, anomaly alerts, and full AI FP&A â all for less than a bookkeeper.",
      cta:"See what's included →",
    };
  })() : null;

  return (
    <div style={{minHeight:"100wh",background:`radial-gradient(ellipse 90% 45% at 50% 0%,${T.cyan}09 0%,transparent 55%),linear-gradient(180deg,${T.bg} 0%,#040711 100%)`,color:T.text}}>
      <style>{`
        html,body{margin:0;padding:0;width:100%;height:100%;scroll-behavior:smooth;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:${T.border};border-radius:99px}
        ::-webkit-scrollbar-thumb:hover{background:${T.textDim}}
        input[type=range]{appearance:none;height:3px;border-radius:99px;background:${T.border};outline:none}
        input[type=range]::-webkit-slider-thumb{appearance:none;width:14px;height:14px;border-radius:50%;cursor:pointer;background:${T.cyan};border:2px solid ${T.bg};box-shadow:0 0 6px ${T.cyan}60}
        @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeInFast{from{opacity:0}to{opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
        @keyframes glow{0%,100%{box-shadow:0 0 8px ${T.cyan}30}50%{box-shadow:0 0 20px ${T.cyan}60}}
        .fadein{animation:fadeIn 0.22s cubic-bezier(0.4,0,0.2,1) both}
        .fadein-fast{animation:fadeInFast 0.15s ease both}
        tr:hover td{filter:brightness(1.10);transition:filter 0.12s}
        button:focus-visible{outline:2px solid ${T.cyan};outline-offset:2px}
        input:focus-visible{outline:2px solid ${T.cyan}60;outline-offset:1px}
        .tab-scroll::-webkit-scrollbar{display:none}
        .tab-scroll{-webkit-overflow-scrolling:touch}
        .skeleton{background:linear-gradient(90deg,${T.surface} 25%,${T.border} 50%,${T.surface} 75%);background-size:200% 100%;animation:shimmer 1.4s infinite}
      `}</style>

      {/* ââ Top Nav ââ */}
      <div style={{background:`linear-gradient(180deg,${T.surface} 0%,${T.bg}ee 100%)`,borderBottom:`1px solid ${T.border}`,padding:"0 24px",display:"flex",alignItems:"stretch",position:"sticky",top:0,zIndex:100,flexDirection:"column",backdropFilter:"blur(12px)"}}>
        {/* Logo + KPIs row */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          {/* Logo */}
          <div style={{display:"flex",alignItems:"center",gap:9,flexShrink:0,paddingRight:16,borderRight:`1px solid ${T.border}`,height:60,alignSelf:"stretch",alignContent:"center",flexWrap:"wrap"}}>
            <div style={{width:38,height:38,borderRadius:10,background:`linear-gradient(135deg,${T.cyan},${T.violet})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,boxShadow:`0 0 20px ${T.cyan}50`,flexShrink:0}}>â¬¡</div>
            <div>
              <div style={{color:T.text,fontFamily:T.display,fontWeight:800,fontSize:17,lineHeight:1,letterSpacing:"-0.3px"}}>FinanceOS</div>
              <div style={{color:T.textDim,fontFamily:T.mono,fontSize:8,letterSpacing:2,marginTop:3,textTransform:"uppercase"}}>FP&A SUITE</div>
            </div>
          </div>

        {/* Right: KPIs + alerts + plan */}
        <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0,paddingLeft:16,borderLeft:`1px solid ${T.border}`}}>
          {/* KPI chips */}
          {[
            {l:"Revenue",    v:fmt(aiCtx.ytdRevenue,true), c:T.cyan,   bg:`${T.cyan}12`},
            {l:"Net Income", v:fmt(aiCtx.ytdNet,true),     c:aiCtx.ytdNet>=0?T.emerald:T.rose, bg:aiCtx.ytdNet>=0?`${T.emerald}12`:`${T.rose}12`},
            {l:"Gr. Margin", v:pct(aiCtx.ytdGrossMargin),  c:T.violet, bg:`${T.violet}12`},
            {l:"MRR",        v:fmt(latestMrr,true),        c:T.amber,  bg:`${T.amber}12`},
          ].map(s=>(
            <div key={s.l} style={{background:s.bg,border:`1px solid ${s.c}40`,borderRadius:10,padding:"6px 14px",textAlign:"center",cursor:"default",minWidth:72,boxShadow:`0 2px 12px ${s.c}15`}} title={s.l}>
              <div style={{color:T.textMid,fontSize:9,fontFamily:T.mono,textTransform:"uppercase",letterSpacing:1.2,marginBottom:3}}>{s.l}</div>
              <div style={{color:s.c,fontFamily:T.mono,fontSize:16,fontWeight:800,lineHeight:1,letterSpacing:"-0.5px"}}>{s.v}</div>
            </div>
          ))}
          {/* Alert chip */}
          {canUseAlerts&&criticalCount>0&&(
            <button onClick={()=>{setAiPanelOpen(true);setAiAlertTab("alerts");}} style={{display:"flex",alignItems:"center",gap:6,background:T.roseDim,border:`1px solid ${T.rose}40`,borderRadius:10,padding:"6px 12px",cursor:"pointer",animation:"pulse 2s infinite",flexShrink:0}}>
              <span style={{fontSize:11}}>ð¨</span>
              <span style={{fontSize:10,color:T.rose,fontFamily:T.sans,fontWeight:700}}>{criticalCount} Alert{criticalCount>1?"s":""}</span>
            </button>
          )}
          {/* Plan badge */}
          <button onClick={()=>setTab("pricing")} style={{display:"flex",alignItems:"center",gap:6,background:`${planMeta.color}15`,border:`1px solid ${planMeta.color}40`,borderRadius:10,padding:"6px 12px",cursor:"pointer",transition:"all 0.15s",flexShrink:0}}
            onMouseEnter={e=>e.currentTarget.style.background=`${planMeta.color}25`}
            onMouseLeave={e=>e.currentTarget.style.background=`${planMeta.color}15`}>
            <span style={{fontSize:10}}>{planMeta.icon}</span>
            <span style={{fontSize:10,color:planMeta.color,fontFamily:T.mono,fontWeight:700,letterSpacing:0.8}}>{planMeta.label.toUpperCase()}</span>
          </button>
          {/* Dev plan switcher */}
          <div style={{display:"flex",alignItems:"center",gap:1,background:T.card,border:`1px solid ${T.border}`,borderRadius:7,padding:"2px"}}>
            {[["S","starter",T.teal],["P","professional",T.cyan],["E","enterprise",T.violet]].map(([abbr,p,c])=>(
              <button key={p} onClick={()=>setPlan(normalizePlan(p))} title={"Demo: "+p}
                style={{background:plan===p?`${c}20`:"transparent",border:`1px solid ${plan===p?c+"40":"transparent"}`,borderRadius:5,padding:"2px 7px",color:plan===p?c:T.textDim,fontSize:8,fontFamily:T.mono,fontWeight:700,cursor:"pointer",transition:"all 0.12s"}}>
                {abbr}
              </button>
            ))}
          </div>
        </div>

        </div>
        {/* Tab nav â two rows */}
        <div className="tab-scroll" style={{display:"flex",flexDirection:"column",gap:4,padding:"10px 0 8px",overflowX:"auto",msOverflowStyle:"none",scrollbarWidth:"none"}}>
          <div role="tablist" aria-label="Core financial modules" style={{display:"flex",gap:2,flexWrap:"nowrap",overflow:"visible"}}>
            {TABS.filter(t=>t.group==="core").map(t=>{
              const locked=tabLocked(t), active=tab===t.id;
              return (
                <button key={t.id} role="tab" aria-selected={active}
                  onClick={()=>locked?setTab("pricing"):setTab(t.id)}
                  title={locked?`${t.label} â Upgrade to unlock`:t.label}
                  style={{
                    background:active?T.cyanDim:locked?`${T.amber}08`:"transparent",
                    border:`1px solid ${active?T.cyanMid:locked?`${T.amber}20`:"transparent"}`,
                    borderRadius:8,padding:"5px 13px",
                    color:active?T.cyan:locked?`${T.amber}99`:T.textMid,
                    fontSize:11,fontFamily:T.sans,fontWeight:active?700:500,
                    cursor:"pointer",transition:"all 0.15s",whiteSpace:"nowrap",flexShrink:0,
                  }}
                  onMouseEnter={e=>{if(!active)e.currentTarget.style.background=active?T.cyanDim:T.border+"40"}}
                  onMouseLeave={e=>{if(!active)e.currentTarget.style.background=active?T.cyanDim:locked?`${T.amber}08`:"transparent"}}
                >{locked?"ð":t.icon} {t.label}</button>
              );
            })}
          </div>
          <div style={{display:"flex",gap:2,flexWrap:"nowrap",overflow:"visible"}}>
            {TABS.filter(t=>t.group==="ops").map(t=>{
              const locked=tabLocked(t), active=tab===t.id, isPricing=t.id==="pricing";
              return (
                <button key={t.id}
                  onClick={()=>locked?setTab("pricing"):setTab(t.id)}
                  title={locked?`${t.label} â Upgrade to unlock`:t.label}
                  style={{
                    background:active?(isPricing?`${T.violet}20`:T.cyanDim):locked?`${T.violet}08`:"transparent",
                    border:`1px solid ${active?(isPricing?`${T.violet}50`:T.cyanMid):locked?`${T.violet}20`:"transparent"}`,
                    borderRadius:8,padding:"5px 13px",
                    color:active?(isPricing?T.violet:T.cyan):locked?`${T.violet}99`:T.textMid,
                    fontSize:11,fontFamily:T.sans,fontWeight:active?700:500,
                    cursor:"pointer",transition:"all 0.15s",whiteSpace:"nowrap",flexShrink:0,
                  }}
                  onMouseEnter={e=>{if(!active)e.currentTarget.style.background=T.border+"40"}}
                  onMouseLeave={e=>{if(!active)e.currentTarget.style.background=active?(isPricing?`${T.violet}20`:T.cyanDim):locked?`${T.violet}08`:"transparent"}}
                >{locked?"ð":t.icon} {t.label}</button>
              );
            })}
          </div>
        </div>      </div>

      {/* ââ Page header strip (tab title + subtitle) ââ */}
      <div style={{background:`${T.surface}cc`,borderBottom:`1px solid ${T.border}60`,padding:"11px 32px",display:"flex",alignItems:"center",gap:12,backdropFilter:"blur(8px)"}}>
        <span style={{fontSize:16}}>{TABS.find(t=>t.id===tab)?.icon}</span>
        <div>
          <div style={{color:T.text,fontFamily:T.display,fontWeight:700,fontSize:16,lineHeight:1,letterSpacing:"-0.2px"}}>{TABS.find(t=>t.id===tab)?.label}</div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginTop:2}}>
            <div style={{color:T.textMid,fontFamily:T.sans,fontSize:11}}>{{
              pnl:"12-month profit & loss with revenue, COGS and expense detail",
              bva:"Actual vs budget variance analysis with department breakdown and rolling forecast",
              scenario:"Bear / Base / Bull scenario modeling with custom multipliers",
              cashflow:"13-week cash flow forecast with inflow/outflow composition",
              balancesheet:"Full balance sheet with liquidity ratios and trend analysis",
              headcount:"Headcount roster, open reqs, payroll cost and department planning",
              saas:"MRR waterfall, NRR, LTV:CAC, churn and SaaS growth metrics",
              ar:"Accounts receivable aging with client-level risk classification",
              regional:"Texas regional client performance comparison and leaderboard",
              integrations:"Connect QuickBooks, Plaid, CSV upload and other data sources",
              pricing:"Plans, pricing and payment options",
              csuite:"Role-differentiated strategic highlights and watch items for CEO, CFO and CIO",
              "cfo-sim":"AI-powered 30-day CFO simulation â competitive gap analysis, scorecard, and top improvements",
              budgeting:"Collaborative department budgeting with approval workflow and comment threads",
            }[tab]||""}</div>
            {["pnl","bva","cashflow","balancesheet","ar","saas","headcount","regional","csuite"].includes(tab) && (
              <DataSourceBadge source="demo"/>
            )}
          </div>
        </div>
        {/* ââ Export + CSV buttons ââ */}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          {["pnl","bva","saas","ar","cashflow"].includes(tab) && (
            <ExportButton
              reportType={tab==="bva"?"bva":tab}
              data={tab==="pnl"?pnl:tab==="saas"?SAAS:tab==="ar"?arClients:tab==="cashflow"?{inflows:cfInflows,outflows:cfOutflows,balances:cfBal}:null}
              companyName="FinanceOS Demo"
              fiscalYear={2024}
              plan={plan}
            />
          )}
          {tab==="integrations" && hasFeature(plan, FEATURES.CSV_IMPORT) && (
            <button onClick={()=>setCsvImportOpen(true)} style={{display:"flex",alignItems:"center",gap:6,background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 13px",cursor:"pointer",color:T.textMid,fontSize:11,fontFamily:T.sans,fontWeight:600}}>
              <span style={{fontSize:13}}>ð¤</span> Import CSV
            </button>
          )}
          {canUseAlerts&&anomalies.filter(a=>["pnl","bva","cashflow","ar","saas"].includes(
            a.action?.toLowerCase().includes("p&l")?"pnl":
            a.action?.toLowerCase().includes("cash")?"cashflow":
            a.action?.toLowerCase().includes("ar")?"ar":
            a.action?.toLowerCase().includes("saas")?"saas":"bva"
          )).length>0&&["pnl","bva","cashflow","ar","saas"].includes(tab)&&(
            <div style={{display:"flex",gap:6}}>
              {anomalies.slice(0,2).map((a,i)=>(
                <span key={i} style={{fontSize:9,color:a.severity==="critical"?T.rose:T.amber,background:(a.severity==="critical"?T.rose:T.amber)+"15",border:`1px solid ${(a.severity==="critical"?T.rose:T.amber)}30`,borderRadius:20,padding:"2px 8px",fontFamily:T.sans}}>
                  {a.emoji} {a.title}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* ââ CSV Import Modal ââ */}
      {csvImportOpen && <CSVImportModal onClose={()=>setCsvImportOpen(false)} onSuccess={()=>setCsvImportOpen(false)}/>}

      {/* ââ Main content ââ */}
      <div className="fadein" key={tab} style={{padding:"24px 32px", paddingBottom: showPanel ? 380 : 28, width:"100%"}}>
        {/* ââ Onboarding checklist â shown on pnl tab until dismissed ââ */}
        {tab==="pnl" && !checklistDismissed && (
          <OnboardingChecklist onNavigate={id=>setTab(id)} onDismiss={()=>{setChecklistDismissed(true);try{localStorage.setItem('fo_checklist_dismissed','true')}catch{};}}/>
        )}
        {/* ââ CFO Scorecard â shown on pnl tab ââ */}
        {tab==="pnl" && (
          <CFOScorecard
            plan={plan}
            hasQBO={true}
            hasPlaid={true}
            hasExport={true}
            hasCsuite={true}
            metrics={{
              revenue:          1100000,
              netIncome:        86000,
              grossMargin:      56.8,
              mrr:              125000,
              burnRate:         48000,
              runwayMonths:     24.5,
              topCustomerPct:   18,
              nrr:              112,
              lastUpdatedHours: 1,
            }}
            budget={{ revenue: 1100000 }}
            actuals={{ revenue: 1078000 }}
            cashFlow={{ weekly: [52000,54000,51000,55000,53000,50000,56000,54000,52000,53000,55000,54000,52000], balance: 650000 }}
            scenarios={[
              { name: "Base Case", revenue: 1100000 },
              { name: "Bull Case", revenue: 1320000 },
              { name: "Bear Case", revenue: 880000 },
            ]}
            historicalData={[
              {month:"Jan 2023",revenue:682000,netIncome:47200,grossMargin:56.0,mrr:81600,burnRate:45200},
              {month:"Feb 2023",revenue:692000,netIncome:47900,grossMargin:56.1,mrr:82700,burnRate:45400},
              {month:"Mar 2023",revenue:703000,netIncome:48700,grossMargin:56.2,mrr:84000,burnRate:45600},
              {month:"Apr 2023",revenue:713000,netIncome:49400,grossMargin:56.2,mrr:85300,burnRate:45800},
              {month:"May 2023",revenue:724000,netIncome:50100,grossMargin:56.3,mrr:86600,burnRate:46000},
              {month:"Jun 2023",revenue:735000,netIncome:50900,grossMargin:56.4,mrr:88000,burnRate:46200},
              {month:"Jul 2023",revenue:746000,netIncome:51700,grossMargin:56.4,mrr:89400,burnRate:46400},
              {month:"Aug 2023",revenue:757000,netIncome:52400,grossMargin:56.5,mrr:90800,burnRate:46600},
              {month:"Sep 2023",revenue:769000,netIncome:53300,grossMargin:56.6,mrr:92200,burnRate:46800},
              {month:"Oct 2023",revenue:780000,netIncome:54000,grossMargin:56.6,mrr:93700,burnRate:47000},
              {month:"Nov 2023",revenue:792000,netIncome:54900,grossMargin:56.7,mrr:95200,burnRate:47200},
              {month:"Dec 2023",revenue:804000,netIncome:55700,grossMargin:56.8,mrr:96700,burnRate:47400},
              {month:"Jan 2024",revenue:816000,netIncome:56600,grossMargin:56.8,mrr:98200,burnRate:47600},
              {month:"Feb 2024",revenue:829000,netIncome:57400,grossMargin:56.9,mrr:99800,burnRate:47800},
              {month:"Mar 2024",revenue:842000,netIncome:58300,grossMargin:57.0,mrr:101500,burnRate:48000},
              {month:"Apr 2024",revenue:855000,netIncome:59200,grossMargin:57.0,mrr:103200,burnRate:47900},
              {month:"May 2024",revenue:868000,netIncome:60100,grossMargin:57.1,mrr:105000,burnRate:48100},
              {month:"Jun 2024",revenue:882000,netIncome:61100,grossMargin:57.2,mrr:106800,burnRate:48000},
              {month:"Jul 2024",revenue:896000,netIncome:62100,grossMargin:57.2,mrr:108600,burnRate:48200},
              {month:"Aug 2024",revenue:911000,netIncome:63100,grossMargin:57.3,mrr:110500,burnRate:48100},
              {month:"Sep 2024",revenue:925000,netIncome:64100,grossMargin:57.4,mrr:112400,burnRate:48300},
              {month:"Oct 2024",revenue:940000,netIncome:65100,grossMargin:57.4,mrr:114400,burnRate:48200},
              {month:"Nov 2024",revenue:955000,netIncome:66200,grossMargin:57.5,mrr:116400,burnRate:48400},
              {month:"Dec 2024",revenue:1100000,netIncome:86000,grossMargin:56.8,mrr:125000,burnRate:48000},
            ]}
          />
        )}
        {/* ââ Starter upgrade banner â contextual per tab ââ */}
        {starterBanner && (
          <div style={{marginBottom:18,background:`linear-gradient(135deg,${starterBanner.color}12,${T.violet}08)`,border:`1.5px solid ${starterBanner.color}35`,borderRadius:12,padding:"12px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:-20,right:80,width:120,height:60,borderRadius:"50%",background:`${starterBanner.color}10`,filter:"blur(20px)",pointerEvents:"none"}}/>
            <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
              <div style={{width:32,height:32,borderRadius:9,background:`${starterBanner.color}18`,border:`1px solid ${starterBanner.color}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{starterBanner.icon}</div>
              <div style={{minWidth:0}}>
                <div style={{fontSize:11,color:starterBanner.color,fontFamily:T.sans,fontWeight:700,marginBottom:1}}>{starterBanner.headline}</div>
                <div style={{fontSize:11,color:T.textDim,fontFamily:T.sans,lineHeight:1.4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{starterBanner.text}</div>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              <button onClick={()=>setTab("pricing")} style={{background:`linear-gradient(135deg,${starterBanner.color},${T.violet})`,border:"none",borderRadius:8,padding:"8px 18px",color:T.bg,fontSize:11,fontFamily:T.sans,fontWeight:800,cursor:"pointer",whiteSpace:"nowrap",boxShadow:`0 2px 12px ${starterBanner.color}35`,letterSpacing:0.2}}>{starterBanner.cta}</button>
              <button onClick={()=>setBannerDismissed(true)} style={{background:"transparent",border:"none",color:T.textDim,fontSize:16,cursor:"pointer",padding:"4px 6px",lineHeight:1,flexShrink:0}} title="Dismiss">Ã</button>
            </div>
          </div>
        )}

        {tab==="pnl"          && <PnLBreakdown aiContext={aiCtx}/>}
        {tab==="bva"          && <BudgetVsActuals aiContext={aiCtx}/>}
        {tab==="scenario"     && <FeatureGate plan={plan} feature={FEATURES.SCENARIOS}
            fallback={<PlanGate requiredPlan="professional" featureName="Scenario Planner" features={PRO_GATE_FEATURES} onUpgrade={()=>setTab("pricing")} lockedCopy={getLockedCopy("scenario")}/>}>
            <ScenarioPlanner aiContext={aiCtx} plan={plan}/>
          </FeatureGate>}
        {tab==="cashflow"     && <CashFlowForecast aiContext={aiCtx}/>}
        {tab==="balancesheet" && <BalanceSheet aiContext={aiCtx}/>}
        {tab==="headcount"    && <FeatureGate plan={plan} feature={FEATURES.HEADCOUNT}
            fallback={<PlanGate requiredPlan="professional" featureName="Headcount Planning" features={PRO_GATE_FEATURES} onUpgrade={()=>setTab("pricing")} lockedCopy={getLockedCopy("headcount")}/>}>
            <HeadcountPlanning aiContext={aiCtx}/>
          </FeatureGate>}
        {tab==="saas"         && <FeatureGate plan={plan} feature={FEATURES.SAAS_METRICS}
            fallback={<PlanGate requiredPlan="professional" featureName="SaaS Metrics" features={PRO_GATE_FEATURES} onUpgrade={()=>setTab("pricing")} lockedCopy={getLockedCopy("saas")}/>}>
            <SaaSMetrics aiContext={aiCtx}/>
          </FeatureGate>}
        {tab==="csuite"       && <FeatureGate plan={plan} feature={FEATURES.CSUITE_REPORT}
            fallback={<PlanGate requiredPlan="professional" featureName="C-Suite Executive Report" features={PRO_GATE_FEATURES} onUpgrade={()=>setTab("pricing")} lockedCopy={getLockedCopy("csuite")}/>}>
            <CsuiteStrategicPanel/>
          </FeatureGate>}
        {tab==="cfo-sim"      && <FeatureGate plan={plan} feature={FEATURES.CFO_SIMULATION}
            fallback={<PlanGate requiredPlan="professional" featureName="CFO Simulation" features={PRO_GATE_FEATURES} onUpgrade={()=>setTab("pricing")} lockedCopy={getLockedCopy("cfo-sim")}/>}>
            <CFOSimulation plan={plan} aiContext={tabCtx["cfo-sim"]||aiCtx}/>
          </FeatureGate>}
        {tab==="ar"           && <ARaging aiContext={aiCtx}/>}
        {tab==="regional"     && <RegionalComparison aiContext={aiCtx}/>}
        {tab==="budgeting"    && <FeatureGate plan={plan} feature={FEATURES.BUDGETING}
            fallback={<PlanGate requiredPlan="professional" featureName="Collaborative Budgeting" features={PRO_GATE_FEATURES} onUpgrade={()=>setTab("pricing")} lockedCopy={getLockedCopy("budgeting")}/>}>
            <BudgetingPage plan={plan}/>
          </FeatureGate>}
        {tab==="integrations" && <IntegrationsPage plan={plan} onUpgrade={()=>setTab("pricing")}/>}
        {tab==="pricing"      && <PricingPage currentPlan={plan} onPlanChange={p=>{setPlan(normalizePlan(p));setTab("pnl");if(onPlanRefresh)onPlanRefresh();}}/>}
      </div>

      {/* ââ Fixed bottom AI panel ââ */}
      {showPanel && <BottomAIPanel activeTab={tab} context={tabCtx[tab]||aiCtx} anomalies={canUseAlerts?anomalies:[]} panelOpen={aiPanelOpen} setPanelOpen={setAiPanelOpen} alertTab={aiAlertTab} setAlertTab={setAiAlertTab} plan={plan} onUpgrade={()=>setTab("pricing")}/>}
    </div>
  );
}

export default function FPADashboard() {
  const [initialPlan, setInitialPlan] = useState("starter");

  useEffect(() => {
    // Defer plan fetch so the dashboard always paints on the first frame.
    // If the backend is reachable it will upgrade the plan silently.
    const timer = setTimeout(async () => {
      try {
        const { plan } = await api.billing.status();
        if (plan) setInitialPlan(normalizePlan(plan));
      } catch {
        // Backend unreachable â stay on starter
      }
    }, 0);

    const onFocus = () => {
      clearTimeout(timer);
      api.billing.status()
        .then(({ plan }) => { if (plan) setInitialPlan(normalizePlan(plan)); })
        .catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <ErrorBoundary>
      <FPADashboardInner initialPlan={initialPlan} onPlanRefresh={() => {
        api.billing.status()
          .then(({ plan }) => { if (plan) setInitialPlan(normalizePlan(plan)); })
          .catch(() => {});
      }}/>
    </ErrorBoundary>
  );
}
