# Conditional document requirements

## Problem

Today a required-documents list applies to every shipment for an entity. An
air shipment gets checked for a Bill of Lading, a courier parcel for a Packing
Declaration, and every job for a Certificate of Origin. The result is false
"missing document" flags, so users learn to ignore them.

## Approach

Each required document gets an **Applies to** setting. A document is required
only when the shipment matches it.

| Condition | Values | Omitted means |
|---|---|---|
| Mode | Sea, Air, Road, Rail, Post, Courier | All |
| Direction | Import, Export | All |
| Load type | FCL, LCL, Break bulk, Loose (sea/road/rail only) | All |
| Origin / destination country | ISO codes | All |
| Only when preference claimed | yes / no | no |

Plus **Accepted alternatives**: documents that satisfy the requirement, e.g.
a Sea Waybill or Telex Release instead of a Bill of Lading.

### Suggested defaults

| Document | Applies to | Alternatives |
|---|---|---|
| Bill of Lading | Sea | Sea Waybill, Telex Release |
| Air Waybill | Air | |
| Courier Waybill | Post, Courier | Postal declaration |
| Packing Declaration | Sea · Import · FCL/LCL | |
| Packing List | All | |
| Commercial Invoice | All | |
| Certificate of Origin | Import · if preference claimed | |

Confirm Packing Declaration and Certificate of Origin rules against current
MPI (NZ) and DAFF/ABF (AU) guidance before shipping these as defaults.

## Two levels: company default and entity

- **Company default** (Settings › Customs Declarations › Default Document
  Types): the base rule per document.
- **Entity** (Entity › Document checks): optional, per document:
  - *Inherit* (no row): use the company rule as-is. This is the default.
  - *Override*: replace the company rule's conditions for this entity.
  - *Exclude*: this entity never needs the document.
  - *Add*: a document the company list doesn't have.

Overrides replace the whole rule for that document rather than merging field
by field. That's easier to explain ("this entity's rule for Packing
Declaration is Sea · FCL") and avoids surprising combinations.

Inheriting by default matters: if a company default is fixed later, every
entity that hasn't overridden it picks up the fix. Today's model, where
entities copy the list, doesn't.

## Three outcomes, not two

For each document the engine returns:

- **Required**: rule matches the shipment.
- **Not applicable**: rule doesn't match. Not shown as a finding at all.
- **Undetermined**: rule depends on shipment data we don't have (e.g. mode
  not set yet). Reported as "Needs shipment data: set Mode", **never** as a
  missing document.

A definite mismatch wins over unknowns: an air shipment with no direction set
still doesn't need a Packing Declaration.

This third state is what actually stops false flags. Without it the engine
must guess when mode is blank, and either guess is wrong half the time.

## UI changes

**Document checks (entity) and Default Document Types (company):**

- Show a chip after each document name: `Sea · Import · FCL/LCL` or
  `All shipments` (`describeAppliesTo`). On the entity page also show
  `Inherited` or `Overridden`, with "Reset to default" in the `…` menu.
- `…` menu › **Edit applies to** opens a small panel with multi-select
  chips for Mode, Direction, Load type, a "Only when preference claimed"
  toggle, and Accepted alternatives. "All" is the default for each; it
  can't be saved with nothing selected.
- `…` menu on an inherited document: **Exclude for this entity**.
- Add a **Preview** row at the top: pick Mode / Direction / Load type and the
  list greys out documents that wouldn't be required. This is the fastest
  way for users to check their setup.
- "Copy as email text" should resolve against the current shipment (or the
  preview selection), so the email only asks for documents that apply.

**Shipment:** make sure Mode, Direction and Load type are captured (from the
CargoWise job where available). Show "Needs shipment data" findings next to
the field to fill in.

## Rollout

1. Create `document_requirement_rule` (`db/001_document_requirement_rules.sql`)
   and backfill existing lists with no conditions (`fromLegacyList`).
   Behaviour is unchanged.
2. Ship the engine behind the existing document check. Log resolved
   requirements with `reasons` for support and audit.
3. Ship the UI (chips, edit panel, preview).
4. Offer the suggested defaults to existing customers as a one-click update
   on the company settings page rather than changing their rules silently.

## Code

- `src/types.ts`: rule, entity rule, shipment context, result types.
- `src/engine.ts`: `effectiveRules` (merge levels), `evaluateAppliesTo`,
  `resolveRequirements`, `checkDocuments`, `validateRule`.
- `src/defaults.ts`: suggested defaults and `fromLegacyList`.
- `src/describe.ts`: chip labels.
- `test/engine.test.ts`: behaviour, including the air/BL false-flag case.

Run `npm test` (Node 22.18+) and `npm run typecheck`.
