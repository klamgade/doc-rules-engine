# doc-rules-engine

Decides which documents a customs shipment needs, based on transport mode,
direction, load type, countries and preference claims, with company defaults
and per-entity overrides. Prevents false "missing document" flags such as a
Bill of Lading being demanded on an air shipment.

See [docs/DESIGN.md](docs/DESIGN.md).

```ts
import { SUGGESTED_COMPANY_RULES, resolveRequirements, checkDocuments } from './src/index.ts';

const reqs = resolveRequirements(SUGGESTED_COMPANY_RULES, entityRules, {
  mode: 'AIR', direction: 'IMPORT', preferenceClaimed: false,
});
const findings = checkDocuments(reqs, ['AIR_WAYBILL', 'COMMERCIAL_INVOICE']);
// -> PACKING_LIST: MISSING. No Bill of Lading or Packing Declaration flags.
```

```sh
npm install
npm test
npm run typecheck
```
