// Core vocabulary for document requirement rules.
//
// A rule says "document X is required WHEN the shipment matches these
// conditions". Rules exist at two levels: the company default list and an
// optional per-entity list that overrides it document-by-document.

export const TRANSPORT_MODES = ['SEA', 'AIR', 'ROAD', 'RAIL', 'POST', 'COURIER'] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const DIRECTIONS = ['IMPORT', 'EXPORT'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const LOAD_TYPES = ['FCL', 'LCL', 'BREAK_BULK', 'LOOSE'] as const;
export type LoadType = (typeof LOAD_TYPES)[number];

/**
 * Conditions a shipment must meet for a document to be required.
 *
 * Every field is optional. An omitted field means "applies to all" for that
 * dimension. An empty array is invalid (see validateRule) because in a UI it
 * almost always means someone unticked every box by accident.
 */
export interface AppliesTo {
  modes?: TransportMode[];
  directions?: Direction[];
  loadTypes?: LoadType[];
  /** ISO 3166-1 alpha-2 codes, e.g. "NZ", "AU". */
  originCountries?: string[];
  destinationCountries?: string[];
  /** Only required when the shipment claims a trade-agreement preference. */
  onlyWhenPreferenceClaimed?: boolean;
}

/** Company-level (default) rule: applies to every entity unless overridden. */
export interface DocumentRule {
  /** Stable code, e.g. "BILL_OF_LADING". Display names live elsewhere. */
  documentType: string;
  appliesTo: AppliesTo;
  /**
   * Other document types that satisfy this requirement, e.g. a Sea Waybill
   * or Telex Release in place of a Bill of Lading.
   */
  acceptedAlternatives?: string[];
}

/**
 * Entity-level rule. Matched to the company rule by documentType.
 *  - REQUIRE: replaces the company rule for this document (or adds a new one).
 *  - EXCLUDE: this entity never needs this document, whatever the default says.
 * Documents with no entity rule inherit the company default unchanged.
 */
export type EntityRule =
  | ({ action: 'REQUIRE' } & DocumentRule)
  | { action: 'EXCLUDE'; documentType: string };

/** What we know about the shipment being checked. Unknown fields are omitted. */
export interface ShipmentContext {
  mode?: TransportMode;
  direction?: Direction;
  loadType?: LoadType;
  originCountry?: string;
  destinationCountry?: string;
  preferenceClaimed?: boolean;
}

/**
 * REQUIRED       - the rule matches this shipment.
 * NOT_APPLICABLE - the rule does not match (e.g. Bill of Lading on an air job).
 * UNDETERMINED   - the rule depends on shipment data we don't have yet
 *                  (e.g. mode unknown). Never reported as "missing".
 */
export type RequirementStatus = 'REQUIRED' | 'NOT_APPLICABLE' | 'UNDETERMINED';

export type RuleSource = 'COMPANY_DEFAULT' | 'ENTITY';

export interface ResolvedRequirement {
  documentType: string;
  status: RequirementStatus;
  source: RuleSource;
  acceptedAlternatives: string[];
  /** Human-readable explanation, suitable for a tooltip or audit log. */
  reasons: string[];
  /** Context fields that must be filled in to decide an UNDETERMINED rule. */
  missingContext: (keyof ShipmentContext)[];
}

export type FindingKind = 'MISSING' | 'SATISFIED' | 'NEEDS_SHIPMENT_DATA';

export interface DocumentFinding {
  documentType: string;
  kind: FindingKind;
  /** Which received document satisfied the requirement, if any. */
  satisfiedBy?: string;
  requirement: ResolvedRequirement;
}
