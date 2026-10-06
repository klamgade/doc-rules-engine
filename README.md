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
npm test           # engine tests
npm run typecheck
npm run dev        # interactive UI demo at http://localhost:5173 (rebuilds on save)
npm run build:ui   # writes a single self-contained dist/demo.html
```

## UI demo

`ui/app.ts` is a working mock-up of the settings screens, running on the real
engine: company default list, entity document checks (inherited / entity rule
/ excluded), the "Applies to" editor, a shipment preview, and a live document
check result. State is in memory; "Reset demo" restores the defaults.
