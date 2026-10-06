import type { DocumentRule } from './types.ts';

/**
 * Suggested company defaults. A starting point only: confirm the Packing
 * Declaration and Certificate of Origin rules against current MPI (NZ) and
 * DAFF / ABF (AU) requirements before enabling for customers.
 */
export const SUGGESTED_COMPANY_RULES: DocumentRule[] = [
  {
    documentType: 'BILL_OF_LADING',
    appliesTo: { modes: ['SEA'] },
    acceptedAlternatives: ['SEA_WAYBILL', 'TELEX_RELEASE'],
  },
  {
    documentType: 'AIR_WAYBILL',
    appliesTo: { modes: ['AIR'] },
  },
  {
    documentType: 'COURIER_WAYBILL',
    appliesTo: { modes: ['POST', 'COURIER'] },
    acceptedAlternatives: ['POSTAL_DECLARATION'],
  },
  {
    documentType: 'PACKING_DECLARATION',
    appliesTo: { modes: ['SEA'], directions: ['IMPORT'], loadTypes: ['FCL', 'LCL'] },
  },
  { documentType: 'PACKING_LIST', appliesTo: {} },
  { documentType: 'COMMERCIAL_INVOICE', appliesTo: {} },
  {
    documentType: 'CERTIFICATE_OF_ORIGIN',
    appliesTo: { directions: ['IMPORT'], onlyWhenPreferenceClaimed: true },
  },
];

/**
 * Convert today's flat "required documents" list into rules with no
 * conditions. Running this on rollout keeps behaviour identical until someone
 * edits a document's "Applies to" setting.
 */
export function fromLegacyList(documentTypes: string[]): DocumentRule[] {
  return documentTypes.map((documentType) => ({ documentType, appliesTo: {} }));
}
