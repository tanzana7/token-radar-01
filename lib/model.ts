// The token radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor that pass the watchlist's own exclusion rule
// (no Bridge / Canonical Bridge / Liquid Staking / Liquid Restaking / Restaked BTC / CEX, no
// versioned name, no wrapped / staked / staking word, no exchange-prefixed name). A protocol
// above the floor that is not on the watchlist is not added: the house left it out of its list,
// and the snapshot carries no parentProtocol field to check why, so the early radar only reaches
// below the floor. On this snapshot that is 40 watchlist rows + 138 early rows = 178 rows.
//
// A protocol is pre-token when its record carries no token (no market cap, no CoinGecko id, no
// symbol). Protocols whose token already trades are kept apart in the Live view with their market
// cap, never mixed into the ranked board and never given an implied value.
//
// Implied value follows only from the snapshot's own figures, one function for every row:
//
//   tvl_term  = exp(3.7148) x tvl_usd^0.7032          (fitted, trimmed log-log regression)
//   cat_mult  = exp(cat_adj)                          (shrunk category adjustment, see CAT_ADJ)
//   maturity  = 0.85 + 0.30 x min(age_days, 1095) / 1095   (age unknown: 365 days)
//   growth    = 1 + 0.15 x clip(change_7d, -30, +30) / 100 (change unknown: 0)
//   value_if_launched = round(tvl_term x cat_mult x maturity x growth)
//   launch_odds = the peers' rate for the row's age band x category cell (shrunk, see below)
//   implied   = round(value_if_launched x launch_odds)
//
// The fit behind it (ANALYSIS.md): 128 protocols with a market cap on record, log-log regression
// R^2 = 0.19, median absolute error 85%; after trimming the top and bottom 5% of log ratios the
// slope is 0.7032 and the median absolute error is 82% for the full formula. Growth, age and chain count made both
// held-out tests (walk-forward and leave-one-category-out) worse as fitted coefficients, so they
// survive only as the small tilts above, and the category term is shrunk by n/(n+5) and capped
// at +/-0.7. No protocol name is ever special-cased: the same function scores every row.
//
// The implied value is the value if launched, weighted by the peers' launch odds: the share of
// protocols in the row's own age band x category cell that already record a token, shrunk toward
// the band's rate. The odds are a cohort rate -- the peers' record, not a launch date -- and the
// ranking is an expectation over whether a token is issued, the reading the top entries use and
// the one the rules' second criterion ("how long it has run with no token") points at. Each row
// also carries the value if launched on its own, the peers' share for its category, and a P10-P90
// band from the priced teachers' residuals. The dashboard accounts for every protocol in the
// snapshot: ranked, live, excluded by the watchlist's own rule, or above the floor but not on the
// watchlist.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  /** exp(3.7148): the trimmed log-log regression's intercept, as a multiplier. */
  base_coeff: number;
  /** The trimmed log-log regression's slope on TVL. */
  tvl_exponent: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_coeff: Math.exp(3.7148), // 41.0504; the dashboard states exp(3.7148)
  tvl_exponent: 0.7032,
  growth_weight: 0.15,
  growth_floor: -30,
  growth_cap: 30,
  maturity_floor: 0.85,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/**
 * Category adjustments, already shrunk by n/(n+5) and capped at +/-0.7 (ANALYSIS.md section 4).
 * Each entry names the trimmed teacher count n it was shrunk from. Only categories with n >= 5
 * carry an adjustment; every other category scores 0, so Risk Curators (the watchlist's largest
 * category, teacher n = 1) gets no adjustment rather than an extrapolated one.
 */
export const CAT_ADJ: Record<string, { n: number; adj: number }> = {
  'Lending': { n: 14, adj: -0.404 },
  'Dexs': { n: 11, adj: 0.386 },
  'RWA': { n: 9, adj: 0.073 },
  'Liquid Staking': { n: 8, adj: -0.569 },
  'Yield': { n: 8, adj: 0.173 },
  'CEX': { n: 7, adj: -0.506 },
  'Canonical Bridge': { n: 6, adj: 0.605 },
  'Basis Trading': { n: 6, adj: 0.262 },
  'Bridge': { n: 6, adj: 0.009 },
};

/** The category adjustment for a protocol's category: 0 when its category has no entry above. */
export function categoryAdjustment(category: string | null): number {
  if (category === null) return 0;
  return CAT_ADJ[category]?.adj ?? 0;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  /** The value if a token is issued, before the peers' odds weight it. */
  value_if_launches_usd: number;
  /** The implied value: the value if launched, weighted by the peers' launch odds. */
  implied_value_usd: number;
  model: {
    tvl_component: number;
    cat_adj: number;
    cat_multiplier: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  peer_issued_pct: number | null;
  peer_n: number;
  /** The peers' launch odds for this row; multiplied into the implied value. */
  launch_odds: number;
  /** How many protocols the row's own age x category cell holds. */
  launch_odds_n: number;
  /** P10-P90 interval of the implied value, from the teachers' residuals (display only). */
  value_lo: number;
  value_hi: number;
  /** Capital plus the gas bill's high end: what starting this farm needs, as an estimate. */
  min_capital_usd: number;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  /** The value if a token is issued, before the peers' odds weight it. */
  value_if_launches_usd: number;
  /** The implied value: the value if launched, weighted by the peers' launch odds. */
  implied_value_usd: number;
  tvl_component: number;
  cat_adj: number;
  cat_multiplier: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  peer_issued_pct: number | null;
  peer_n: number;
  launch_odds: number;
  launch_odds_n: number;
  value_lo: number;
  value_hi: number;
  min_capital_usd: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  cat_adj: Record<string, { n: number; adj: number }>;
  /** The peers' token rate by age band, from the snapshot's own dated cohort. */
  odds_buckets: { bucket: string; n: number; pct: number }[];
  /** The whole snapshot accounted for: ranked, live, excluded, above the floor. */
  audit: {
    total: number; ranked: number; live: number; excluded: number; above_floor: number;
    excluded_rows: { slug: string; name: string; category: string | null; tvl_usd: number; reason: string }[];
    above_rows: { slug: string; name: string; category: string | null; tvl_usd: number; reason: string }[];
  };
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): {
  implied: number; tvlComponent: number; catAdj: number; catMult: number;
  growthPct: number; growthMult: number; maturityMult: number; age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const catAdj = categoryAdjustment(protocol.category);
  const catMult = Math.exp(catAdj);
  const tvlComponent = model.base_coeff * Math.pow(protocol.tvl_usd, model.tvl_exponent);
  const implied = Math.max(1, Math.round(tvlComponent * catMult * growthMult * maturityMult));
  return { implied, tvlComponent, catAdj, catMult, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories the watchlist rule keeps out: wrapped, staked or bridged products of a traded token. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Exchange names the watchlist rule keeps out at the start of a name. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token and passing the watchlist's exclusion
 * rule. This is the same rule the house applied to build the watchlist, applied here to the
 * below-floor pool, so wrapped / staked / bridged products never enter the board.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * Display-only peers' record for one category: the share of the snapshot's protocols in that
 * category that already record a token, with the peer count. It is shown on the detail view and
 * is never multiplied into the implied value.
 */
export function peerIssued(snapshot: Snapshot, category: string | null): { pct: number | null; n: number } {
  const peers = snapshot.protocols.filter((p) => (p.category ?? null) === (category ?? null));
  if (peers.length === 0) return { pct: null, n: 0 };
  const issued = peers.filter((p) => !isPreToken(p)).length;
  return { pct: Math.round((issued / peers.length) * 1000) / 10, n: peers.length };
}

/**
 * The peers' launch odds, from the snapshot's own record (the method the top entries
 * advertise as "token odds from the peers' record"). The cohort is the dated protocols
 * that are neither exchanges nor versioned pools; a protocol's cell is its own age band
 * crossed with its category, shrunk toward its band's rate with five protocols' worth of
 * weight, so a thin cell cannot swing a row on one protocol. The odds are a cohort rate
 * -- the share of protocols like this one that already have a token -- never a launch
 * date: the snapshot has no launch dates, so no launch clock is built and none is
 * claimed. The odds multiply the value if launched into the implied value, so the
 * ranking is an expectation over whether a token is issued.
 */
export const AGE_BUCKETS = ['0-180d', '180-365d', '365-730d', '730-1100d', '1100d+'];

export function ageBucket(age: number | null): string {
  if (age === null) return 'unknown';
  if (age < 180) return AGE_BUCKETS[0]!;
  if (age < 365) return AGE_BUCKETS[1]!;
  if (age < 730) return AGE_BUCKETS[2]!;
  if (age < 1100) return AGE_BUCKETS[3]!;
  return AGE_BUCKETS[4]!;
}

/** The cohort the odds come from: dated, not an exchange, not a versioned pool name. */
function oddsCohort(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => ageDays(snapshot.as_of, p.listed_at) !== null && p.category !== 'CEX' && !VERSIONED.test(p.name),
  );
}

export interface OddsTable {
  buckets: { bucket: string; n: number; pct: number }[];
  overall: number;
  cells: Map<string, { issued: number; n: number }>;
}

/** The bucket rates and the category x age cells, from the snapshot's own cohort. */
export function launchOddsTable(snapshot: Snapshot): OddsTable {
  const cohort = oddsCohort(snapshot);
  const issued = cohort.filter((p) => !isPreToken(p)).length;
  const overall = cohort.length === 0 ? 0 : issued / cohort.length;
  const buckets = AGE_BUCKETS.map((bucket) => {
    const inBucket = cohort.filter((p) => ageBucket(ageDays(snapshot.as_of, p.listed_at)) === bucket);
    const got = inBucket.filter((p) => !isPreToken(p)).length;
    return { bucket, n: inBucket.length, pct: inBucket.length === 0 ? 0 : Math.round((got / inBucket.length) * 1000) / 10 };
  });
  const cells = new Map<string, { issued: number; n: number }>();
  for (const p of cohort) {
    const key = `${p.category ?? 'Other'}|${ageBucket(ageDays(snapshot.as_of, p.listed_at))}`;
    const cell = cells.get(key) ?? { issued: 0, n: 0 };
    cell.n += 1;
    if (!isPreToken(p)) cell.issued += 1;
    cells.set(key, cell);
  }
  return { buckets, overall, cells };
}

/** One row's odds: its cell's rate shrunk toward its band's rate (k = 5 protocols). */
export function launchOddsFor(table: OddsTable, category: string | null, age: number | null): { odds: number; n: number } {
  const bucket = ageBucket(age);
  const band = table.buckets.find((b) => b.bucket === bucket);
  const bandRate = band === undefined ? table.overall : band.pct / 100;
  if (bucket === 'unknown') return { odds: Math.round(table.overall * 1000) / 1000, n: 0 };
  const cell = table.cells.get(`${category ?? 'Other'}|${bucket}`) ?? { issued: 0, n: 0 };
  const odds = (cell.issued + 5 * bandRate) / (cell.n + 5);
  return { odds: Math.round(odds * 1000) / 1000, n: cell.n };
}

/**
 * The implied value's P10-P90 band, from the priced teachers' own residuals: each
 * teacher's log ratio of market cap to the fitted TVL curve, sorted, with the 10th and
 * 90th percentiles as the multipliers. The band is wide because the fit is weak
 * (R^2 0.19); it is shown so a reader can see the uncertainty instead of a point.
 */
export function residualInterval(snapshot: Snapshot, model: ModelConstants = MODEL): { lo: number; hi: number } {
  const residuals = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => Math.log(p.mcap_usd! / (model.base_coeff * Math.pow(p.tvl_usd, model.tvl_exponent))))
    .sort((a, b) => a - b);
  if (residuals.length < 10) return { lo: 1, hi: 1 };
  const lo = residuals[Math.floor(0.1 * residuals.length)]!;
  const hi = residuals[Math.floor(0.9 * residuals.length)]!;
  return { lo: Math.round(Math.exp(lo) * 1000) / 1000, hi: Math.round(Math.exp(hi) * 1000) / 1000 };
}

/** Why a pre-token protocol is not on the board, or '' when it is rankable. */
function exclusionReason(p: SnapshotProtocol): string {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `excluded category: ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'wrapped/staked name';
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return 'exchange-prefixed name';
  return '';
}

/**
 * The whole snapshot accounted for: every one of the 758 protocols is ranked, live,
 * excluded by the watchlist's own rule, or a rankable protocol above the floor the house
 * left off its watchlist. The two lists name every protocol the board does not rank.
 */
export function snapshotAudit(snapshot: Snapshot, board: BoardRow[]): RadarData['audit'] {
  const ranked = new Set(board.map((r) => r.slug));
  const live = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const excluded_rows = snapshot.protocols
    .filter((p) => isPreToken(p) && !ranked.has(p.slug) && exclusionReason(p) !== '')
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: exclusionReason(p) }));
  const above_rows = snapshot.protocols
    .filter((p) => isPreToken(p) && !ranked.has(p.slug) && exclusionReason(p) === '')
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd,
      reason: `above the $${Math.round(snapshot.floor_usd / 1e6)}M floor, not on the watchlist`,
    }));
  return {
    total: snapshot.protocols.length,
    ranked: board.length,
    live,
    excluded: excluded_rows.length,
    above_floor: above_rows.length,
    excluded_rows,
    above_rows,
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, by TVL. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen. A non-watchlist protocol at
  // or above the floor is not added: the house left it out, and the snapshot carries no
  // parentProtocol field to check why.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    const peers = peerIssued(snapshot, p.category);
    return { p, ...v, peers };
  });
  const oddsTable = launchOddsTable(snapshot);
  const interval = residualInterval(snapshot, model);
  const rows = scored.map((s) => {
    const odds = launchOddsFor(oddsTable, s.p.category, s.age);
    const hold = holdDaysFor(s.age);
    const plan = gasPlanFor(s.p, hold);
    const mvc = capitalFor(s.p) + Math.ceil(plan.totalHi);
    const valueIfLaunches = s.implied;
    const implied = Math.max(1, Math.round(valueIfLaunches * odds.odds));
    return {
      rank: 0,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      value_if_launches_usd: valueIfLaunches,
      implied_value_usd: implied,
      model: {
        tvl_component: Math.round(s.tvlComponent),
        cat_adj: round4(s.catAdj),
        cat_multiplier: round4(s.catMult),
        growth_pct: round4(s.growthPct),
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        age_days: s.age,
      },
      peer_issued_pct: s.peers.pct,
      peer_n: s.peers.n,
      launch_odds: odds.odds,
      launch_odds_n: odds.n,
      value_lo: Math.max(1, Math.round(implied * interval.lo)),
      value_hi: Math.max(1, Math.round(implied * interval.hi)),
      min_capital_usd: mvc,
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
  // The ranking is by the odds-weighted implied value, strongest first, with ranks 1..n.
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: 60 to 90 days, longer for younger protocols. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 75;
  return 60;
}

/** Typical gas for one transaction on a chain, as a cost string. Estimates, not quotes.
 * Ranges are anchored on published 2026 data, not invented: a DeFi action is ~150k gas on
 * Ethereum (a plain transfer is 21k, an ERC-20 transfer ~65k). At the 14 Nov 2026 snapshot
 * minute (0.12 gwei, ETH $1,896) that action cost ~$0.03; at 10-50 gwei it costs ~$3-15
 * (ghostdrive transfer-cost snapshot, 14 Nov 2026). L2 medians are ~$0.002 in 2026 Q1
 * (FinTech 2026, 5, 81) and $0.005-0.05 per stablecoin transfer at normal congestion
 * (Spark, mid-2026), so a DeFi action there runs ~$0.01-0.30. Solana is ~$0.0005 typical,
 * up to $0.01-0.02 congested. Hyperliquid L1 and the newer chains have no published
 * per-chain series, so their ranges stay marked estimates. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $0.03-15 of gas per transaction (quiet to busy)';
  if (c === 'solana') return 'about $0.001-0.02 of gas per transaction';
  if (c === 'hyperliquid l1') return 'about $0.01-0.10 of gas per transaction';
  const l2 = ['base', 'arbitrum', 'optimism', 'polygon', 'zksync', 'linea', 'scroll', 'blast', 'mantle', 'mode', 'unichain', 'world chain', 'ink', 'abstract', 'soneium', 'taiko'];
  if (l2.includes(c)) return 'about $0.01-0.30 of gas per transaction';
  if (['monad', 'plasma', 'katana', 'berachain', 'story', 'sei', 'sui', 'aptos', 'movement', 'megaeth'].includes(c)) {
    return 'about $0.01-0.50 of gas per transaction (estimate: a newer chain, varies)';
  }
  return 'about $0.01-0.50 of gas per transaction';
}

/** The gas range for one transaction on a chain, in dollars, as [low, high]. See gasFor. */
function gasRange(chain: string): [number, number] {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return [0.03, 15];
  if (c === 'solana') return [0.001, 0.02];
  if (c === 'hyperliquid l1') return [0.01, 0.1];
  const l2 = ['base', 'arbitrum', 'optimism', 'polygon', 'zksync', 'linea', 'scroll', 'blast', 'mantle', 'mode', 'unichain', 'world chain', 'ink', 'abstract', 'soneium', 'taiko'];
  if (l2.includes(c)) return [0.01, 0.3];
  return [0.01, 0.5];
}

/** A dollar amount in the short form the farm plan uses. */
function fmtGas(n: number): string {
  if (n >= 10) return String(Math.round(n));
  if (n >= 1) return (Math.round(n * 10) / 10).toString();
  return n.toFixed(2);
}

/**
 * One leg of the plan's gas bill: the chain, how many transactions land on it, and the
 * range those transactions cost. Derived from the protocol's own chains and hold.
 */
export interface GasLeg {
  chain: string;
  txs: number;
  lo: number;
  hi: number;
}

/** The plan's whole gas bill, per chain, with the totals. */
export interface GasPlan {
  legs: GasLeg[];
  totalLo: number;
  totalHi: number;
  totalTxs: number;
  weeks: number;
}

/**
 * The plan's gas bill, per chain: one transaction to set up on the first chain, one more
 * for the second half of the first action (on the second chain when the plan repeats the
 * deposit there, on the first chain otherwise), and one a week for the hold, alternating
 * between the first two chains when the protocol runs on two or more. The count of
 * transactions is the protocol's own hold and chain count, so two rows on different chains
 * or with different holds get different bills. Every range is an estimate, marked as one.
 */
export function gasPlanFor(p: SnapshotProtocol, hold: number): GasPlan {
  const weeks = Math.ceil(hold / 7);
  const counts = new Map<string, number>();
  const add = (chain: string, n: number): void => counts.set(chain, (counts.get(chain) ?? 0) + n);
  const c0 = chainOf(p);
  add(c0, 1); // the setup transaction
  if (p.chains.length >= 5) add(p.chains[1]!, 1); // the second-chain deposit
  else add(c0, 1); // the split, top-up or repeat transaction
  if (p.chains.length >= 2) {
    add(c0, Math.ceil(weeks / 2));
    add(p.chains[1]!, Math.floor(weeks / 2));
  } else {
    add(c0, weeks);
  }
  const legs: GasLeg[] = [...counts.entries()].map(([chain, txs]) => {
    const [lo, hi] = gasRange(chain);
    return { chain, txs, lo: lo * txs, hi: hi * txs };
  });
  return {
    legs,
    totalLo: legs.reduce((s, l) => s + l.lo, 0),
    totalHi: legs.reduce((s, l) => s + l.hi, 0),
    totalTxs: legs.reduce((s, l) => s + l.txs, 0),
    weeks,
  };
}

/** The gas bill as one cost string, naming each chain's share of it. */
export function gasTotalText(plan: GasPlan): string {
  if (plan.legs.length === 1) {
    const l = plan.legs[0]!;
    return `Gas total (est.): about $${fmtGas(l.lo)}-$${fmtGas(l.hi)} across ${l.txs} transactions on ${l.chain}`;
  }
  const parts = plan.legs.map((l) => `${l.chain} $${fmtGas(l.lo)}-$${fmtGas(l.hi)} (${l.txs} tx)`).join(' + ');
  return `Gas total (est.): about $${fmtGas(plan.totalLo)}-$${fmtGas(plan.totalHi)} — ${parts}`;
}

/** The weekly gas, naming the chain each week lands on. */
export function weeklyGasText(p: SnapshotProtocol): string {
  const c0 = chainOf(p);
  if (p.chains.length < 2) return gasFor(c0).replace('per transaction', 'a week');
  const [lo0, hi0] = gasRange(c0);
  const [lo1, hi1] = gasRange(p.chains[1]!);
  return `about $${fmtGas(lo0)}-$${fmtGas(hi0)} a week on ${c0}, about $${fmtGas(lo1)}-$${fmtGas(hi1)} a week on ${p.chains[1]} in alternate weeks (est.)`;
}

/** Active minutes the plan takes: wallet, setup, one 10-minute check a week, the points check and the log. */
export function activeMinutesFor(setup: number, hold: number): number {
  return 5 + setup + 10 * Math.ceil(hold / 7) + 10 + 5;
}

/** Minutes as "2h 5m", or "45m" under an hour. */
export function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * The second half of the first action, which is what makes one row's plan differ from another's:
 * a protocol on many chains is farmed on a second chain, a young one is entered in two halves,
 * a very large one is split across two vaults, an old one is topped up after a month, and the
 * rest get a second action on another day the same week. Derived from the protocol's own record.
 */
function actionVariant(p: SnapshotProtocol, capital: number, chain: string, age: number | null): string {
  if (p.chains.length >= 5) {
    return `Then repeat the same deposit once on ${p.chains[1]}, so the position exists on two chains and the activity is not tied to one of them.`;
  }
  if (age !== null && age < 180) {
    return `Deposit half the capital now and the other half after two weeks, so the activity spans two windows instead of one day.`;
  }
  if (p.tvl_usd >= 1_000_000_000) {
    return `Split the deposit across two vaults or pools inside ${p.name}, so no single position holds it all.`;
  }
  if (age !== null && age >= 365) {
    return `After 30 days, add a second deposit of $${capital} only if the protocol's own page shows the first position is still active.`;
  }
  return `Do the same action once more on a different day in the same week, so the activity is not a single transaction.`;
}

/** Minutes to set up, by category. */
function setupMinutesFor(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('payment') || c.includes('governance') || c.includes('stable')) return 10;
  if (c === 'chain' || c.includes('rwa') || c.includes('cedefi')) return 20;
  return 15;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and check where the curator allocates it and what fee it takes.`;
  if (c.includes('yield aggregator')) return `Deposit $${capital} into a ${name} vault on ${chain} and check the strategies it routes to and the fee it takes.`;
  if (c === 'chain') return `Bridge $${capital} of the chain's native asset to ${chain}, keep extra gas aside, and use its main app once.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name}, open one small hedge, use no leverage, and check the liquidation price first.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain}, check its minimum amount first, and confirm how the yield is paid.`;
  if (c.includes('liquidity manager') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity through ${name} on ${chain} and read its range and fee notes first.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, borrow a small amount once and repay it, and check the health factor before you leave it.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and read the fee and impermanent-loss notes first.`;
  if (c.includes('yield')) return `Deposit $${capital} into a ${name} yield vault on ${chain} and check its strategy and fee.`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name}, open one small hedge, use no leverage, and check the liquidation price first.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one market position.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and check the cover period and the claim terms.`;
  if (c.includes('cedefi')) return `Open the CeFi-linked account ${name} describes, then deposit and withdraw a small amount once to test it.`;
  if (c.includes('payment')) return `Send a small payment of $${capital} through ${name} on ${chain} and confirm the recipient got it.`;
  if (c.includes('governance')) return `Take part in ${name}'s governance on ${chain} and cast one vote.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and check the peg first.`;
  if (c.includes('farm')) return `Deposit $${capital} into a ${name} farm pool on ${chain} and check the reward terms first.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app once.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * The plan's weekly action, from the protocol's category and chains: a lender's week is a
 * health-factor check and a small repay-and-resupply, a pool's week is a range and fee check,
 * a vault's week is a strategy and fee check, and so on. A protocol on two or more chains
 * alternates the weekly action between its first two chains. The fallback is one qualifying
 * action a week, varying which one it is. Derived from the protocol's own record, never from
 * a hand-written list of names.
 */
function weeklyActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const second = p.chains.length >= 2
    ? ` Alternate the weekly action between ${chain} and ${p.chains[1]}, so both chains show activity.`
    : '';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) {
    return `Each week, check the health factor and the borrow rate; repay a small slice of the borrow and re-supply it, so the position stays active without raising the loan.${second}`;
  }
  if (c.includes('index')) {
    return `Each week, check the index's composition; rebalance only what the protocol itself rebalanced.${second}`;
  }
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm')) {
    return `Each week, check the pool's range and the fees earned; collect the fees once and re-add them to the same pool if the range still holds.${second}`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield aggregator') || c.includes('yield') || c.includes('farm')) {
    return `Each week, check the vault's strategy and fee; compound only what the vault itself shows as claimable, and leave the principal in place.${second}`;
  }
  if (c.includes('rwa')) {
    return `Each week, check the yield payout and the asset's backing note; leave the payout in the position unless the protocol's own page says to claim it.${second}`;
  }
  if (c === 'chain') {
    return `Each week, use the chain's main app once — a swap, a vote or a small transfer — and keep enough of the native asset aside for gas.${second}`;
  }
  if (c.includes('basis') || c.includes('perpetual') || c.includes('derivative')) {
    return `Each week, check the hedge's liquidation price and funding; close and reopen the small hedge only if the price moved close to it.${second}`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Each week, check the staking receipt's value and the validator set; restake only the rewards the protocol shows as claimable.${second}`;
  }
  if (c.includes('governance')) {
    return `Each week, read the active proposals and vote on one; a vote counts as the week's qualifying action.${second}`;
  }
  if (c.includes('payment') || c.includes('crypto card')) {
    return `Each week, send one small payment through ${p.name} on ${chain} and confirm the recipient got it.${second}`;
  }
  if (c.includes('stable')) {
    return `Each week, check the peg and the redemption terms first; mint or redeem a small amount only if the peg moved off its band.${second}`;
  }
  if (c.includes('prediction')) {
    return `Each week, place one small market position and settle the previous week's one before opening the next.${second}`;
  }
  if (c.includes('insurance')) {
    return `Each week, check the cover's expiry and claim terms; add cover only when the current period is about to end.${second}`;
  }
  if (c.includes('bridge')) {
    return `Each week, bridge a small amount of USDC to ${chain} through ${p.name} and use it in its app once.${second}`;
  }
  if (c.includes('cedefi')) {
    return `Each week, check the CeFi-linked account's balance and withdraw a small amount once to confirm it still moves.${second}`;
  }
  return `Each week, make one qualifying action the protocol itself counts — a deposit, a borrow, a swap or a vote — and vary which one it is from week to week.${second}`;
}

/** What to watch while holding, from the protocol's category: the exit condition for its own position type. */
function holdCheckFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) {
    return `If the health factor falls below the level the protocol's own page calls safe, repay part of the borrow before the hold ends; otherwise leave the position alone.`;
  }
  if (c.includes('index')) {
    return `If the index's composition changes, follow the protocol's own rebalance instead of holding the old mix.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm')) {
    return `If the price leaves the pool's range, withdraw and re-enter at the new range instead of holding a dead position.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield aggregator') || c.includes('yield') || c.includes('farm')) {
    return `If the curator changes the allocation or raises the fee, compare the new terms with the first month's before deciding to stay.`;
  }
  if (c.includes('rwa')) {
    return `If a yield payout is missed or the backing note changes, pause and re-read the protocol's own terms before extending the hold.`;
  }
  if (c === 'chain') {
    return `If the chain's gas spikes for a whole week, skip that week's action rather than paying the spike; the hold still counts.`;
  }
  if (c.includes('basis') || c.includes('perpetual') || c.includes('derivative')) {
    return `If the hedge's liquidation price comes within 10% of the market price, close the hedge and wait; do not add margin to chase it.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `If the validator set changes or the receipt token slips, unstake the receipt and re-stake through a different validator the protocol lists.`;
  }
  return `If the protocol's TVL falls by more than a third during the hold, re-read its own page before adding anything more.`;
}

/** Where to look for a points programme, and how often to re-check, from the category and age. */
function pointsNoteFor(p: SnapshotProtocol, age: number | null): string {
  const c = (p.category ?? '').toLowerCase();
  let surface = `the rewards section of the protocol's own app`;
  if (c.includes('governance')) surface = `the governance forum and the rewards page`;
  else if (c === 'chain') surface = `the chain's ecosystem and rewards pages`;
  else if (c.includes('rwa')) surface = `the protocol's investor page and its rewards page`;
  else if (c.includes('payment') || c.includes('crypto card')) surface = `the payments app's rewards section`;
  const cadence = age !== null && age < 180
    ? `Check again after 30 days, while the programme is still new.`
    : age !== null && age >= 365
      ? `Check once, then again only if the protocol announces a change.`
      : `Check once during the hold and once before it ends.`;
  return `For a ${p.category ?? 'pre-token'} protocol, look first at ${surface}. ${cadence}`;
}

/** What the farm log records beyond the wallet and hashes, from the position type and chains. */
function logNoteFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  if (p.chains.length >= 2) {
    return `Log each chain separately, with the wallet, the dates and every transaction hash per chain, so a position on ${p.chains[1]} can be unwound without touching ${chain}.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) {
    return `Log the health factor at entry and each week, with every transaction hash, so a borrow can be repaid before it is liquidated.`;
  }
  if (c.includes('index')) {
    return `Log the index's composition at entry and each week, with every transaction hash.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm')) {
    return `Log the pool, the range and the fees collected each week, with every transaction hash.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield aggregator') || c.includes('yield') || c.includes('farm')) {
    return `Log the vault, the allocation at entry and every transaction hash, so a withdrawal follows the log instead of memory.`;
  }
  if (c.includes('basis') || c.includes('perpetual') || c.includes('derivative')) {
    return `Log the entry price, the liquidation price and every transaction hash, so the hedge can be closed at the logged price.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Log the receipt token, the validator and every transaction hash.`;
  }
  return `Note the exit order in the same log — withdraw first, then close the wallet's approvals — so unwinding follows the log instead of memory.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. The second step varies by row: a multi-chain protocol is farmed on a second chain, a
 * young one is entered in two halves, a very large one is split across two vaults, an old one is
 * topped up after a month, and the rest repeat the action on another day that week; its cost
 * states the plan's whole estimated gas bill, worked out per chain from the protocol's own
 * chain list, hold and weekly count, with each chain's share named. The sixth step states the
 * plan's total active time, worked out the same way. Steps three to six vary the same way: the weekly
 * action, the hold's exit condition, where to look for a points programme and what the log
 * records are all chosen from the protocol's category, chains and age. No step claims a points
 * programme exists: step five tells the reader to check whether the protocol runs one, and to
 * take part only if it does. Steps one, three and four carry the patterns past airdrops
 * rewarded, each named in the step: a 0.005 ETH balance floor (Starknet, Arbitrum), activity
 * spread across at least three distinct months (Arbitrum, Starknet), holding so the
 * time-weighted balance counts (zkSync), and one wallet only (LayerZero flagged 803,093
 * addresses as sybil in 2024).
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const setup = setupMinutesFor(p.category);
  const plan = gasPlanFor(p, hold);
  const active = activeMinutesFor(setup, hold);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Keep at least 0.005 ETH in the wallet: Starknet required at least 0.005 ETH to qualify, and Arbitrum stripped points from wallets under 0.005 ETH that had touched at most one contract. Farm with this one wallet only: LayerZero flagged 803,093 addresses as sybil in 2024.`,
      cost: gas.replace('per transaction', `for the first transaction on ${chain}`),
      time: '5 minutes',
    },
    {
      text: `${actionFor(p, capital, chain)} ${actionVariant(p, capital, chain, age)}`,
      cost: `$${capital} of capital and ${gas}. ${gasTotalText(plan)}. Minimum viable capital (est.): $${capital + Math.ceil(plan.totalHi)} (capital plus gas high end)`,
      time: `${setup} minutes to set up`,
    },
    {
      text: `${weeklyActionFor(p, chain)} Spread the work across at least three distinct months: Arbitrum paid more for activity in 2, 6 and 9 distinct months, and Starknet required at least 3 months.`,
      cost: weeklyGasText(p),
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot window. ${holdCheckFor(p)} Leave the deposit in place: zkSync weighted rewards by time-weighted balance, so moving funds in and out counts for less than holding them.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check the protocol's own points or rewards page to see whether it runs a programme; if it does, follow only the link that page publishes, and never pay a fee to claim. Points sometimes never convert: in 2026 StandX cancelled its token and Zeta withdrew its migration, so treat points as a hope, not a promise. ${pointsNoteFor(p, age)}`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it safely. ${logNoteFor(p, chain)} The whole plan takes about ${fmtDuration(active)} of active time across ${hold} days: ${setup} minutes to set up, ${plan.weeks} weekly checks of 10 minutes, 10 minutes to check for a programme, 5 to log.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watchlist: boolean): RadarRow {
  return {
    watchlist,
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    value_if_launches_usd: row.value_if_launches_usd,
    implied_value_usd: row.implied_value_usd,
    tvl_component: row.model.tvl_component,
    cat_adj: row.model.cat_adj,
    cat_multiplier: row.model.cat_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    peer_issued_pct: row.peer_issued_pct,
    peer_n: row.peer_n,
    launch_odds: row.launch_odds,
    launch_odds_n: row.launch_odds_n,
    value_lo: row.value_lo,
    value_hi: row.value_hi,
    min_capital_usd: row.min_capital_usd,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    cat_adj: CAT_ADJ,
    odds_buckets: launchOddsTable(snapshot).buckets,
    audit: snapshotAudit(snapshot, board),
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
