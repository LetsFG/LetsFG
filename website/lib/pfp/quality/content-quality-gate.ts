/**
 * ContentQualityGate — evaluates whether an agent search session (or a route's
 * accumulated sessions) has enough data quality to publish a flight page.
 *
 * Scoring formula (weights chosen to reflect signal reliability):
 *
 *   score = 0.30 * offerRichness
 *         + 0.25 * carrierDiversity
 *         + 0.25 * priceDistributionValue
 *         + 0.20 * connectorDiversity
 *
 * Components:
 *   offerRichness           = min(log2(offerCount) / log2(400), 1.0)
 *     log2(400) ≈ 8.64 is the realistic upper bound for our 180-connector agent.
 *     Weight 30%: raw volume is the strongest single quality signal.
 *
 *   carrierDiversity        = min(carrierCount, 6) / 6
 *     Caps at 6 carriers — beyond that the page is already highly comparative.
 *     Weight 25%: multi-airline data prevents monopoly-pricing pages.
 *
 *   priceDistributionValue  = min(CV / 0.5, 1.0)
 *     CV ≥ 0.5 means prices span at least half their mean — good distribution.
 *     Weight 25%: CV doubles as a bot-detection signal (uniform prices = CV≈0).
 *
 *   connectorDiversity      = min(connectorCount, 5) / 5
 *     Multiple connectors mean prices from different booking channels.
 *     Weight 20%: independent corroboration is strong but secondary to volume.
 *
 * Decision thresholds:
 *   ≥ 0.65            → PASS → publishAs: 'published'
 *   0.45 ≤ score < 0.65 → CONDITIONAL_PASS → publishAs: 'noindex'
 *   < 0.45            → FAIL → publishAs: 'draft'
 *
 * Hard floors (checked BEFORE scoring; fail immediately if violated):
 *   offerCount < 15   → not enough data for any meaningful distribution
 *   carrierCount < 2  → no competitor comparison possible
 *   priceCV < 0.05    → suspiciously uniform prices (bot data / test data)
 *   connectorCount < 2 → single source = no independent price corroboration
 *
 * Fast-track:
 *   offerCount >= 40 AND carrierCount >= 3 AND connectorCount >= 4
 *   → bypass scoring → direct publishAs: 'published'
 *   Rationale: when we have this much diverse data we are confident the page
 *   will be high quality regardless of how the scoring splits out.
 */

export interface QualityInput {
  /** Total number of deduplicated offers in the session. */
  offerCount: number;
  /** Number of distinct carrier (airline) IATA codes across all offers. */
  carrierCount: number;
  /** Number of distinct connector sources that returned ≥1 offer. */
  connectorCount: number;
  /** Price coefficient of variation: stddev / mean. 0 = all prices identical. */
  priceCV: number;
}

export type PublishAs = 'published' | 'noindex' | 'draft';
export type GateDecision = 'PASS' | 'CONDITIONAL_PASS' | 'FAIL' | 'FAST_TRACK';

export interface ComponentScores {
  offerRichness: number;
  carrierDiversity: number;
  priceDistributionValue: number;
  connectorDiversity: number;
}

export interface QualityGateResult {
  decision: GateDecision;
  publishAs: PublishAs;
  /** Weighted aggregate score (0–1). 0 when hard floors fail. */
  score: number;
  scores: ComponentScores;
  /** Human-readable list of reasons for FAIL or CONDITIONAL_PASS decisions. */
  reasons: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LOG2_400 = Math.log2(400)

const HARD_FLOORS = {
  offerCount: 15,
  carrierCount: 2,
  priceCV: 0.05,
  connectorCount: 2,
} as const

const FAST_TRACK = {
  offerCount: 40,
  carrierCount: 3,
  connectorCount: 4,
} as const

const PASS_THRESHOLD = 0.65
const CONDITIONAL_THRESHOLD = 0.45

const ZERO_SCORES: ComponentScores = {
  offerRichness: 0,
  carrierDiversity: 0,
  priceDistributionValue: 0,
  connectorDiversity: 0,
}

// ─── ContentQualityGate ───────────────────────────────────────────────────────

export class ContentQualityGate {

  /**
   * Evaluate a single session's quality.
   * Checks hard floors first, then fast-track, then score-based thresholds.
   */
  evaluate(input: QualityInput): QualityGateResult {
    const floorReasons = this._checkHardFloors(input)
    if (floorReasons.length > 0) {
      return { decision: 'FAIL', publishAs: 'draft', score: 0, scores: ZERO_SCORES, reasons: floorReasons }
    }

    // Fast-track bypasses scoring entirely
    if (
      input.offerCount >= FAST_TRACK.offerCount &&
      input.carrierCount >= FAST_TRACK.carrierCount &&
      input.connectorCount >= FAST_TRACK.connectorCount
    ) {
      const scores = this._computeScores(input)
      return {
        decision: 'FAST_TRACK',
        publishAs: 'published',
        score: this._weightedScore(scores),
        scores,
        reasons: [
          `fast_track: offer_count=${input.offerCount}>=40, carrier_count=${input.carrierCount}>=3, connector_count=${input.connectorCount}>=4`,
        ],
      }
    }

    const scores = this._computeScores(input)
    const score = this._weightedScore(scores)

    if (score >= PASS_THRESHOLD) {
      return { decision: 'PASS', publishAs: 'published', score, scores, reasons: [] }
    }
    if (score >= CONDITIONAL_THRESHOLD) {
      return {
        decision: 'CONDITIONAL_PASS',
        publishAs: 'noindex',
        score,
        scores,
        reasons: [`score ${score.toFixed(4)} in conditional range [${CONDITIONAL_THRESHOLD}, ${PASS_THRESHOLD})`],
      }
    }
    return {
      decision: 'FAIL',
      publishAs: 'draft',
      score,
      scores,
      reasons: [`score ${score.toFixed(4)} < threshold ${CONDITIONAL_THRESHOLD}`],
    }
  }

  /**
   * Evaluate a route's quality across multiple sessions.
   *
   * Aggregation strategy (max-of-best):
   *   offerCount, carrierCount, connectorCount → max across all sessions
   *   priceCV → mean across all sessions
   *
   * Rationale: the route page will reflect the richest session we've seen.
   * If any session observed 40 offers, the page can display 40 offers.
   *
   * Bot detection: if 3+ sessions all return exactly the same offer_count,
   * flag as suspicious bot/test data.
   */
  evaluateRoute(sessions: QualityInput[]): QualityGateResult {
    if (sessions.length === 0) {
      return { decision: 'FAIL', publishAs: 'draft', score: 0, scores: ZERO_SCORES, reasons: ['no sessions provided'] }
    }

    // Bot detection: uniform offer count across 3+ sessions
    if (sessions.length >= 3) {
      const firstCount = sessions[0].offerCount
      if (sessions.every(s => s.offerCount === firstCount)) {
        return {
          decision: 'FAIL',
          publishAs: 'draft',
          score: 0,
          scores: ZERO_SCORES,
          reasons: [
            `bot_suspected: all ${sessions.length} sessions have identical offer_count=${firstCount}`,
          ],
        }
      }
    }

    // Aggregate: best across sessions
    const aggregate: QualityInput = {
      offerCount: Math.max(...sessions.map(s => s.offerCount)),
      carrierCount: Math.max(...sessions.map(s => s.carrierCount)),
      connectorCount: Math.max(...sessions.map(s => s.connectorCount)),
      priceCV: sessions.reduce((sum, s) => sum + s.priceCV, 0) / sessions.length,
    }

    return this.evaluate(aggregate)
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private _checkHardFloors(input: QualityInput): string[] {
    const reasons: string[] = []
    if (input.offerCount < HARD_FLOORS.offerCount) {
      reasons.push(`offer_count ${input.offerCount} < hard floor ${HARD_FLOORS.offerCount}`)
    }
    if (input.carrierCount < HARD_FLOORS.carrierCount) {
      reasons.push(`carrier_count ${input.carrierCount} < hard floor ${HARD_FLOORS.carrierCount}`)
    }
    if (input.priceCV < HARD_FLOORS.priceCV) {
      reasons.push(
        `price_cv ${input.priceCV} < hard floor ${HARD_FLOORS.priceCV} (uniform prices — possible bot/test data)`
      )
    }
    if (input.connectorCount < HARD_FLOORS.connectorCount) {
      reasons.push(
        `connector_count ${input.connectorCount} < hard floor ${HARD_FLOORS.connectorCount} (single connector — no market comparison)`
      )
    }
    return reasons
  }

  private _computeScores(input: QualityInput): ComponentScores {
    return {
      // 30%: log-scale volume — captures diminishing returns on offer count
      offerRichness: Math.min(Math.log2(input.offerCount) / LOG2_400, 1.0),
      // 25%: linear diversity — caps at 6 airlines (beyond that is redundant)
      carrierDiversity: Math.min(input.carrierCount, 6) / 6,
      // 25%: CV normalized to [0, 1] — CV ≥ 0.5 saturates the score
      priceDistributionValue: Math.min(input.priceCV / 0.5, 1.0),
      // 20%: connector diversity — caps at 5 (beyond that is diminishing returns)
      connectorDiversity: Math.min(input.connectorCount, 5) / 5,
    }
  }

  private _weightedScore(scores: ComponentScores): number {
    return (
      0.30 * scores.offerRichness +
      0.25 * scores.carrierDiversity +
      0.25 * scores.priceDistributionValue +
      0.20 * scores.connectorDiversity
    )
  }
}
