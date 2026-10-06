import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUGGESTED_COMPANY_RULES,
  checkDocuments,
  describeAppliesTo,
  effectiveRules,
  fromLegacyList,
  resolveRequirements,
  validateRule,
  type EntityRule,
  type ShipmentContext,
} from '../src/index.ts';

const required = (ctx: ShipmentContext, entity?: EntityRule[]) =>
  resolveRequirements(SUGGESTED_COMPANY_RULES, entity, ctx)
    .filter((r) => r.status === 'REQUIRED')
    .map((r) => r.documentType);

test('sea FCL import needs BL and packing declaration, not AWB', () => {
  const docs = required({ mode: 'SEA', direction: 'IMPORT', loadType: 'FCL', preferenceClaimed: false });
  assert.deepEqual(docs, ['BILL_OF_LADING', 'PACKING_DECLARATION', 'PACKING_LIST', 'COMMERCIAL_INVOICE']);
});

test('air import needs AWB, never a Bill of Lading or packing declaration', () => {
  const docs = required({ mode: 'AIR', direction: 'IMPORT', preferenceClaimed: false });
  assert.deepEqual(docs, ['AIR_WAYBILL', 'PACKING_LIST', 'COMMERCIAL_INVOICE']);
});

test('courier shipment needs courier waybill', () => {
  const docs = required({ mode: 'COURIER', direction: 'IMPORT', preferenceClaimed: false });
  assert.ok(docs.includes('COURIER_WAYBILL'));
  assert.ok(!docs.includes('BILL_OF_LADING'));
});

test('sea export does not need a packing declaration', () => {
  const docs = required({ mode: 'SEA', direction: 'EXPORT', loadType: 'FCL' });
  assert.ok(!docs.includes('PACKING_DECLARATION'));
});

test('certificate of origin only when a preference is claimed', () => {
  assert.ok(required({ mode: 'SEA', direction: 'IMPORT', loadType: 'LCL', preferenceClaimed: true }).includes('CERTIFICATE_OF_ORIGIN'));
  assert.ok(!required({ mode: 'SEA', direction: 'IMPORT', loadType: 'LCL', preferenceClaimed: false }).includes('CERTIFICATE_OF_ORIGIN'));
});

test('unknown mode makes mode-specific docs UNDETERMINED, never MISSING', () => {
  const reqs = resolveRequirements(SUGGESTED_COMPANY_RULES, [], { direction: 'IMPORT', preferenceClaimed: false });
  const bl = reqs.find((r) => r.documentType === 'BILL_OF_LADING')!;
  assert.equal(bl.status, 'UNDETERMINED');
  assert.deepEqual(bl.missingContext, ['mode']);

  const findings = checkDocuments(reqs, ['PACKING_LIST', 'COMMERCIAL_INVOICE']);
  assert.equal(findings.filter((f) => f.kind === 'MISSING').length, 0);
  assert.equal(findings.find((f) => f.documentType === 'BILL_OF_LADING')!.kind, 'NEEDS_SHIPMENT_DATA');
});

test('a definite mismatch wins over unknown fields', () => {
  // Air shipment, direction unknown: packing declaration is still clearly N/A.
  const reqs = resolveRequirements(SUGGESTED_COMPANY_RULES, [], { mode: 'AIR' });
  assert.equal(reqs.find((r) => r.documentType === 'PACKING_DECLARATION')!.status, 'NOT_APPLICABLE');
});

test('accepted alternatives satisfy the requirement', () => {
  const reqs = resolveRequirements(SUGGESTED_COMPANY_RULES, [], { mode: 'SEA', direction: 'EXPORT', loadType: 'FCL' });
  const bl = checkDocuments(reqs, ['SEA_WAYBILL']).find((f) => f.documentType === 'BILL_OF_LADING')!;
  assert.equal(bl.kind, 'SATISFIED');
  assert.equal(bl.satisfiedBy, 'SEA_WAYBILL');
});

test('air shipment with BL missing raises no false flag', () => {
  const reqs = resolveRequirements(SUGGESTED_COMPANY_RULES, [], { mode: 'AIR', direction: 'IMPORT', preferenceClaimed: false });
  const findings = checkDocuments(reqs, ['AIR_WAYBILL', 'PACKING_LIST', 'COMMERCIAL_INVOICE']);
  assert.deepEqual(findings.filter((f) => f.kind === 'MISSING'), []);
  assert.ok(!findings.some((f) => f.documentType === 'BILL_OF_LADING'));
});

test('entity rules override, exclude and add per document', () => {
  const entity: EntityRule[] = [
    // This entity only ever ships FCL, so packing declaration for FCL only.
    { action: 'REQUIRE', documentType: 'PACKING_DECLARATION', appliesTo: { modes: ['SEA'], loadTypes: ['FCL'] } },
    { action: 'EXCLUDE', documentType: 'PACKING_LIST' },
    { action: 'REQUIRE', documentType: 'FUMIGATION_CERTIFICATE', appliesTo: { modes: ['SEA'], directions: ['IMPORT'] } },
  ];
  const merged = effectiveRules(SUGGESTED_COMPANY_RULES, entity);
  assert.ok(!merged.some((m) => m.rule.documentType === 'PACKING_LIST'));
  assert.equal(merged.find((m) => m.rule.documentType === 'PACKING_DECLARATION')!.source, 'ENTITY');
  assert.equal(merged.at(-1)!.rule.documentType, 'FUMIGATION_CERTIFICATE');

  const docs = required({ mode: 'SEA', direction: 'EXPORT', loadType: 'FCL', preferenceClaimed: false }, entity);
  assert.ok(docs.includes('PACKING_DECLARATION')); // entity rule has no direction limit
  assert.ok(!docs.includes('PACKING_LIST'));
  assert.ok(!docs.includes('FUMIGATION_CERTIFICATE'));
});

test('legacy flat list keeps current behaviour', () => {
  const rules = fromLegacyList(['BILL_OF_LADING', 'INVOICE']);
  const reqs = resolveRequirements(rules, [], { mode: 'AIR' });
  assert.ok(reqs.every((r) => r.status === 'REQUIRED'));
});

test('validation catches empty lists and bad values', () => {
  assert.deepEqual(validateRule({ documentType: 'X', appliesTo: { modes: [] } }), ['modes is empty; omit it to mean "All"']);
  assert.equal(validateRule({ documentType: 'X', appliesTo: { modes: ['BOAT' as never] } }).length, 1);
  assert.equal(validateRule({ documentType: 'X', appliesTo: { destinationCountries: ['nz'] } }).length, 1);
  assert.equal(validateRule({ documentType: 'X', appliesTo: { modes: ['AIR'], loadTypes: ['FCL'] } }).length, 1);
  for (const rule of SUGGESTED_COMPANY_RULES) assert.deepEqual(validateRule(rule), [], rule.documentType);
});

test('describeAppliesTo gives short chip labels', () => {
  assert.equal(describeAppliesTo({}), 'All shipments');
  assert.equal(
    describeAppliesTo({ modes: ['SEA'], directions: ['IMPORT'], loadTypes: ['FCL', 'LCL'] }),
    'Sea · Import · FCL/LCL',
  );
  assert.equal(describeAppliesTo({ directions: ['IMPORT'], onlyWhenPreferenceClaimed: true }), 'Import · if preference claimed');
});
