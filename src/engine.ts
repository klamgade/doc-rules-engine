import {
  DIRECTIONS,
  LOAD_TYPES,
  TRANSPORT_MODES,
  type AppliesTo,
  type DocumentFinding,
  type DocumentRule,
  type EntityRule,
  type RequirementStatus,
  type ResolvedRequirement,
  type RuleSource,
  type ShipmentContext,
} from './types.ts';

type DimensionResult = { result: 'MATCH' | 'NO_MATCH' | 'UNKNOWN'; reason: string; field?: keyof ShipmentContext };

/** Compare one list-style condition against one context value. */
function checkList<T extends string>(
  label: string,
  field: keyof ShipmentContext,
  allowed: readonly T[] | undefined,
  actual: T | undefined,
): DimensionResult | undefined {
  if (allowed === undefined) return undefined; // "All" - not a constraint
  const list = allowed.join('/');
  if (actual === undefined) {
    return { result: 'UNKNOWN', reason: `${label} is not set on the shipment (rule needs ${list})`, field };
  }
  const hit = allowed.some((a) => a.toUpperCase() === actual.toUpperCase());
  return hit
    ? { result: 'MATCH', reason: `${label} ${actual} is in ${list}` }
    : { result: 'NO_MATCH', reason: `${label} ${actual} is not ${list}` };
}

/** Evaluate a rule's conditions against a shipment. */
export function evaluateAppliesTo(
  appliesTo: AppliesTo,
  ctx: ShipmentContext,
): { status: RequirementStatus; reasons: string[]; missingContext: (keyof ShipmentContext)[] } {
  const checks: DimensionResult[] = [];
  const push = (r: DimensionResult | undefined) => r && checks.push(r);

  push(checkList('Mode', 'mode', appliesTo.modes, ctx.mode));
  push(checkList('Direction', 'direction', appliesTo.directions, ctx.direction));
  push(checkList('Load type', 'loadType', appliesTo.loadTypes, ctx.loadType));
  push(checkList('Origin', 'originCountry', appliesTo.originCountries, ctx.originCountry));
  push(checkList('Destination', 'destinationCountry', appliesTo.destinationCountries, ctx.destinationCountry));

  if (appliesTo.onlyWhenPreferenceClaimed) {
    if (ctx.preferenceClaimed === undefined) {
      checks.push({
        result: 'UNKNOWN',
        reason: 'Preference claim is not set on the shipment',
        field: 'preferenceClaimed',
      });
    } else {
      checks.push(
        ctx.preferenceClaimed
          ? { result: 'MATCH', reason: 'Trade-agreement preference is claimed' }
          : { result: 'NO_MATCH', reason: 'No trade-agreement preference claimed' },
      );
    }
  }

  if (checks.length === 0) {
    return { status: 'REQUIRED', reasons: ['Applies to all shipments'], missingContext: [] };
  }

  // One definite mismatch is enough to rule the document out, even if other
  // fields are unknown. Only then do unknowns make the result undetermined.
  const noMatch = checks.filter((c) => c.result === 'NO_MATCH');
  if (noMatch.length > 0) {
    return { status: 'NOT_APPLICABLE', reasons: noMatch.map((c) => c.reason), missingContext: [] };
  }
  const unknown = checks.filter((c) => c.result === 'UNKNOWN');
  if (unknown.length > 0) {
    return {
      status: 'UNDETERMINED',
      reasons: unknown.map((c) => c.reason),
      missingContext: unknown.map((c) => c.field!),
    };
  }
  return { status: 'REQUIRED', reasons: checks.map((c) => c.reason), missingContext: [] };
}

/**
 * Merge company defaults with entity rules into one effective rule list.
 * Entity rules win per documentType; everything else is inherited.
 * Order: company defaults first (in their order), then entity-only additions.
 */
export function effectiveRules(
  companyRules: DocumentRule[],
  entityRules: EntityRule[] = [],
): { rule: DocumentRule; source: RuleSource }[] {
  const byType = new Map(entityRules.map((r) => [r.documentType, r]));
  const out: { rule: DocumentRule; source: RuleSource }[] = [];

  for (const rule of companyRules) {
    const override = byType.get(rule.documentType);
    if (!override) out.push({ rule, source: 'COMPANY_DEFAULT' });
    else if (override.action === 'REQUIRE') out.push({ rule: stripAction(override), source: 'ENTITY' });
    // EXCLUDE: drop it.
  }

  const companyTypes = new Set(companyRules.map((r) => r.documentType));
  for (const r of entityRules) {
    if (r.action === 'REQUIRE' && !companyTypes.has(r.documentType)) {
      out.push({ rule: stripAction(r), source: 'ENTITY' });
    }
  }
  return out;
}

function stripAction(r: Extract<EntityRule, { action: 'REQUIRE' }>): DocumentRule {
  const { action: _action, ...rule } = r;
  return rule;
}

/** Work out, for one shipment, which documents are required and why. */
export function resolveRequirements(
  companyRules: DocumentRule[],
  entityRules: EntityRule[] | undefined,
  ctx: ShipmentContext,
): ResolvedRequirement[] {
  return effectiveRules(companyRules, entityRules).map(({ rule, source }) => {
    const evaluation = evaluateAppliesTo(rule.appliesTo, ctx);
    const origin = source === 'ENTITY' ? 'Entity rule' : 'Company default';
    return {
      documentType: rule.documentType,
      status: evaluation.status,
      source,
      acceptedAlternatives: rule.acceptedAlternatives ?? [],
      reasons: [`${origin}: ${evaluation.reasons.join('; ')}`],
      missingContext: evaluation.missingContext,
    };
  });
}

/**
 * Compare resolved requirements to the documents actually received.
 * Only REQUIRED documents can be MISSING. UNDETERMINED ones are reported as
 * NEEDS_SHIPMENT_DATA so the user fixes the shipment, not chases a document.
 * NOT_APPLICABLE documents produce no finding at all.
 */
export function checkDocuments(
  requirements: ResolvedRequirement[],
  receivedDocumentTypes: string[],
): DocumentFinding[] {
  const received = new Set(receivedDocumentTypes);
  const findings: DocumentFinding[] = [];

  for (const req of requirements) {
    if (req.status === 'NOT_APPLICABLE') continue;
    const satisfiedBy = [req.documentType, ...req.acceptedAlternatives].find((t) => received.has(t));
    if (satisfiedBy) {
      findings.push({ documentType: req.documentType, kind: 'SATISFIED', satisfiedBy, requirement: req });
    } else if (req.status === 'UNDETERMINED') {
      findings.push({ documentType: req.documentType, kind: 'NEEDS_SHIPMENT_DATA', requirement: req });
    } else {
      findings.push({ documentType: req.documentType, kind: 'MISSING', requirement: req });
    }
  }
  return findings;
}

/** Reject rules that would silently behave wrongly. Returns a list of problems. */
export function validateRule(rule: DocumentRule | EntityRule): string[] {
  const errors: string[] = [];
  if (!rule.documentType?.trim()) errors.push('documentType is required');
  if ('action' in rule && rule.action === 'EXCLUDE') return errors;

  const r = rule as DocumentRule;
  const a = r.appliesTo ?? {};
  const listChecks: [string, readonly string[] | undefined, readonly string[] | null][] = [
    ['modes', a.modes, TRANSPORT_MODES],
    ['directions', a.directions, DIRECTIONS],
    ['loadTypes', a.loadTypes, LOAD_TYPES],
    ['originCountries', a.originCountries, null],
    ['destinationCountries', a.destinationCountries, null],
  ];
  for (const [name, values, allowed] of listChecks) {
    if (values === undefined) continue;
    if (values.length === 0) {
      errors.push(`${name} is empty; omit it to mean "All"`);
      continue;
    }
    for (const v of values) {
      if (allowed && !allowed.includes(v)) errors.push(`${name} has unknown value "${v}"`);
      if (!allowed && !/^[A-Z]{2}$/.test(v)) errors.push(`${name} has invalid country code "${v}"`);
    }
  }
  if (a.loadTypes && a.modes && !a.modes.some((m) => m === 'SEA' || m === 'ROAD' || m === 'RAIL')) {
    errors.push('loadTypes only make sense for SEA, ROAD or RAIL modes');
  }
  if (r.acceptedAlternatives?.includes(r.documentType)) {
    errors.push('acceptedAlternatives must not include the document itself');
  }
  return errors;
}
