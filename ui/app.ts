// Interactive demo of conditional document requirements.
// Uses the real engine from src/; all state is in memory.
import {
  DIRECTIONS,
  LOAD_TYPES,
  SUGGESTED_COMPANY_RULES,
  TRANSPORT_MODES,
  checkDocuments,
  describeAppliesTo,
  effectiveRules,
  resolveRequirements,
  validateRule,
  type AppliesTo,
  type DocumentRule,
  type EntityRule,
  type ResolvedRequirement,
  type RuleSource,
  type ShipmentContext,
} from '../src/index.ts';

const DOC_NAMES: Record<string, string> = {
  BILL_OF_LADING: 'Bill of Lading',
  SEA_WAYBILL: 'Sea Waybill',
  TELEX_RELEASE: 'Telex Release',
  AIR_WAYBILL: 'Air Waybill',
  COURIER_WAYBILL: 'Courier Waybill',
  POSTAL_DECLARATION: 'Postal Declaration',
  PACKING_DECLARATION: 'Packing Declaration',
  PACKING_LIST: 'Packing List',
  COMMERCIAL_INVOICE: 'Invoice',
  CERTIFICATE_OF_ORIGIN: 'Certificate of Origin',
  FUMIGATION_CERTIFICATE: 'Fumigation Certificate',
  PHYTOSANITARY_CERTIFICATE: 'Phytosanitary Certificate',
  DANGEROUS_GOODS_DECLARATION: 'Dangerous Goods Declaration',
};
const ALL_DOC_TYPES = Object.keys(DOC_NAMES);
const ENTITY = { code: 'ABC', name: 'ABC Cartage company' };

const docName = (t: string) => DOC_NAMES[t] ?? t;
const label = (s: string) =>
  ['FCL', 'LCL'].includes(s) ? s : s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ---- State -----------------------------------------------------------------

type Level = 'company' | 'entity';

const state = {
  view: 'entity' as Level,
  companyRules: clone(SUGGESTED_COMPANY_RULES) as DocumentRule[],
  entityRules: [] as EntityRule[],
  preview: { mode: 'AIR', direction: 'IMPORT', preferenceClaimed: false } as ShipmentContext,
  received: new Set<string>(['AIR_WAYBILL', 'COMMERCIAL_INVOICE']),
  menuOpen: null as string | null,
  editing: null as null | { level: Level; draft: DocumentRule; isNew: boolean },
  toast: '',
};

// ---- Rule mutations --------------------------------------------------------

function entityRuleFor(t: string) {
  return state.entityRules.find((r) => r.documentType === t);
}
function setEntityRule(rule: EntityRule) {
  state.entityRules = state.entityRules.filter((r) => r.documentType !== rule.documentType).concat(rule);
}
function removeEntityRule(t: string) {
  state.entityRules = state.entityRules.filter((r) => r.documentType !== t);
}

function saveDraft() {
  const ed = state.editing!;
  const rule = ed.draft;
  if (ed.level === 'company') {
    const i = state.companyRules.findIndex((r) => r.documentType === rule.documentType);
    if (i >= 0) state.companyRules[i] = rule;
    else state.companyRules.push(rule);
  } else {
    setEntityRule({ action: 'REQUIRE', ...rule });
  }
  state.editing = null;
  flash(`Saved ${docName(rule.documentType)}`);
}

// ---- Rendering -------------------------------------------------------------

const root = document.getElementById('app')!;

function render() {
  root.innerHTML = `
    <header class="topbar">
      <div class="tabs" role="tablist">
        ${tab('entity', `Entity · ${ENTITY.code}`)}
        ${tab('company', 'Company defaults')}
      </div>
      <button class="btn ghost" data-act="reset-all" title="Reset demo data">Reset demo</button>
    </header>
    <main class="layout">
      <section class="main-col">
        ${previewBar()}
        ${state.view === 'entity' ? entityCard() : companyCard()}
      </section>
      <aside class="side-col">
        ${findingsCard()}
      </aside>
    </main>
    ${state.editing ? editorPanel() : ''}
    ${state.toast ? `<div class="toast" role="status">${esc(state.toast)}</div>` : ''}
  `;
}

function tab(v: Level, text: string) {
  return `<button role="tab" class="tab ${state.view === v ? 'on' : ''}" data-act="view" data-v="${v}" aria-selected="${state.view === v}">${esc(text)}</button>`;
}

function select(field: keyof ShipmentContext, options: readonly string[], value: string | undefined) {
  return `<select data-preview="${field}">
    <option value="">Not set</option>
    ${options.map((o) => `<option value="${o}" ${o === value ? 'selected' : ''}>${label(o)}</option>`).join('')}
  </select>`;
}

function previewBar() {
  const p = state.preview;
  const pref = p.preferenceClaimed === undefined ? '' : String(p.preferenceClaimed);
  return `
  <div class="card preview">
    <div class="preview-title">Preview for a shipment <span class="muted">Pick shipment details to see which documents apply</span></div>
    <div class="preview-fields">
      <label>Mode ${select('mode', TRANSPORT_MODES, p.mode)}</label>
      <label>Direction ${select('direction', DIRECTIONS, p.direction)}</label>
      <label>Load type ${select('loadType', LOAD_TYPES, p.loadType)}</label>
      <label>Preference claimed
        <select data-preview="preferenceClaimed">
          <option value="" ${pref === '' ? 'selected' : ''}>Not set</option>
          <option value="true" ${pref === 'true' ? 'selected' : ''}>Yes</option>
          <option value="false" ${pref === 'false' ? 'selected' : ''}>No</option>
        </select>
      </label>
    </div>
  </div>`;
}

function statusPill(req: ResolvedRequirement | undefined) {
  if (!req) return '';
  const map = {
    REQUIRED: ['req', 'Required'],
    NOT_APPLICABLE: ['na', 'Not needed'],
    UNDETERMINED: ['und', `Needs ${req.missingContext.map(label).join(', ')}`],
  } as const;
  const [cls, text] = map[req.status];
  return `<span class="pill ${cls}" title="${esc(req.reasons.join('\n'))}">${esc(text)}</span>`;
}

function docRow(opts: {
  rule: DocumentRule;
  source?: RuleSource;
  req?: ResolvedRequirement;
  excluded?: boolean;
  level: Level;
}) {
  const { rule, source, req, excluded, level } = opts;
  const t = rule.documentType;
  const dim = excluded || req?.status === 'NOT_APPLICABLE';
  const alts = rule.acceptedAlternatives?.length
    ? `<span class="alts">or ${rule.acceptedAlternatives.map(docName).map(esc).join(', ')}</span>`
    : '';
  const badge =
    level === 'entity'
      ? excluded
        ? '<span class="badge excl">Excluded</span>'
        : source === 'ENTITY'
          ? '<span class="badge over">Entity rule</span>'
          : '<span class="badge inh">Inherited</span>'
      : '';
  return `
  <div class="doc-row ${dim ? 'dim' : ''}">
    <div class="doc-main">
      <div class="doc-name">${esc(docName(t))} ${badge}</div>
      <div class="doc-meta">
        <button class="chip" data-act="edit" data-t="${t}" ${excluded ? 'disabled' : ''} title="Edit applies to">
          ${esc(excluded ? 'Not required for this entity' : describeAppliesTo(rule.appliesTo))}
        </button>
        ${alts}
      </div>
    </div>
    <div class="doc-right">
      ${excluded ? '' : statusPill(req)}
      <div class="menu-wrap">
        <button class="dots" data-act="menu" data-t="${t}" aria-label="Actions for ${esc(docName(t))}">⋯</button>
        ${state.menuOpen === `${level}:${t}` ? menu(level, t, source, excluded) : ''}
      </div>
    </div>
  </div>`;
}

function menu(level: Level, t: string, source?: RuleSource, excluded?: boolean) {
  const items: [string, string][] = [];
  if (!excluded) items.push(['edit', 'Edit applies to']);
  if (level === 'entity') {
    const inCompany = state.companyRules.some((r) => r.documentType === t);
    if (excluded) items.push(['restore', 'Restore (use company default)']);
    else if (source === 'ENTITY' && inCompany) items.push(['restore', 'Reset to company default']);
    if (!excluded && inCompany) items.push(['exclude', 'Exclude for this entity']);
    if (!inCompany) items.push(['delete', 'Remove document']);
  } else {
    items.push(['delete', 'Remove from defaults']);
  }
  return `<div class="menu" role="menu">${items
    .map(([a, l]) => `<button role="menuitem" data-act="${a}" data-t="${t}" class="${a === 'delete' || a === 'exclude' ? 'danger' : ''}">${l}</button>`)
    .join('')}</div>`;
}

function addRow(existing: string[]) {
  const options = ALL_DOC_TYPES.filter((t) => !existing.includes(t));
  if (!options.length) return '';
  return `
  <div class="add-row">
    <span class="plus">+</span>
    <select data-act="add" aria-label="Add document">
      <option value="">Add document</option>
      ${options.map((t) => `<option value="${t}">${esc(docName(t))}</option>`).join('')}
    </select>
  </div>`;
}

function entityCard() {
  const reqs = resolveRequirements(state.companyRules, state.entityRules, state.preview);
  const reqBy = new Map(reqs.map((r) => [r.documentType, r]));
  const eff = effectiveRules(state.companyRules, state.entityRules);
  const excluded = state.entityRules.filter((r) => r.action === 'EXCLUDE').map((r) => r.documentType);
  const required = reqs.filter((r) => r.status === 'REQUIRED').length;

  const rows = state.companyRules
    .map((cr) => {
      if (excluded.includes(cr.documentType)) return docRow({ rule: cr, excluded: true, level: 'entity' });
      const e = eff.find((x) => x.rule.documentType === cr.documentType)!;
      return docRow({ rule: e.rule, source: e.source, req: reqBy.get(cr.documentType), level: 'entity' });
    })
    .concat(
      eff
        .filter((e) => !state.companyRules.some((c) => c.documentType === e.rule.documentType))
        .map((e) => docRow({ rule: e.rule, source: e.source, req: reqBy.get(e.rule.documentType), level: 'entity' })),
    )
    .join('');

  return `
  <div class="card">
    <div class="card-head">
      <h1>Document checks for ${ENTITY.code} ${esc(ENTITY.name)}</h1>
      <button class="btn" data-act="email">Copy as email text</button>
    </div>
    <div class="section-label">Required documents <span class="muted">${required} of ${eff.length} for this shipment</span></div>
    ${rows}
    ${addRow(eff.map((e) => e.rule.documentType).concat(excluded))}
    <div class="card-foot">Inherited documents follow the company default. Edit one to create an entity rule.</div>
  </div>`;
}

function companyCard() {
  const reqs = resolveRequirements(state.companyRules, [], state.preview);
  const reqBy = new Map(reqs.map((r) => [r.documentType, r]));
  return `
  <div class="card">
    <div class="card-head">
      <h1>Customs Declarations · Default Document Types</h1>
    </div>
    <p class="muted intro">Loaded for each shipment when their conditions match. Entities inherit these and can override them.</p>
    ${state.companyRules.map((r) => docRow({ rule: r, req: reqBy.get(r.documentType), level: 'company' })).join('')}
    ${addRow(state.companyRules.map((r) => r.documentType))}
  </div>`;
}

function findingsCard() {
  const entity = state.view === 'entity' ? state.entityRules : [];
  const reqs = resolveRequirements(state.companyRules, entity, state.preview);
  const findings = checkDocuments(reqs, [...state.received]);
  const order = { MISSING: 0, NEEDS_SHIPMENT_DATA: 1, SATISFIED: 2 } as const;
  findings.sort((a, b) => order[a.kind] - order[b.kind]);

  const missing = findings.filter((f) => f.kind === 'MISSING').length;
  const list = findings.length
    ? findings
        .map((f) => {
          const [cls, text] =
            f.kind === 'MISSING'
              ? ['bad', 'Missing']
              : f.kind === 'SATISFIED'
                ? ['ok', f.satisfiedBy === f.documentType ? 'Received' : `Received as ${docName(f.satisfiedBy!)}`]
                : ['warn', `Set ${f.requirement.missingContext.map(label).join(', ')} on shipment`];
          return `<li class="finding ${cls}"><span class="dot"></span><span class="f-name">${esc(docName(f.documentType))}</span><span class="f-kind">${esc(text)}</span></li>`;
        })
        .join('')
    : '<li class="muted">No documents apply to this shipment.</li>';

  return `
  <div class="card">
    <div class="card-head"><h2>Document check result</h2>
      <span class="pill ${missing ? 'bad' : 'ok'}">${missing ? `${missing} missing` : 'All good'}</span>
    </div>
    <ul class="findings">${list}</ul>
    <div class="section-label">Documents received on this shipment</div>
    <div class="received">
      ${ALL_DOC_TYPES.map(
        (t) => `<label class="check"><input type="checkbox" data-recv="${t}" ${state.received.has(t) ? 'checked' : ''}> ${esc(docName(t))}</label>`,
      ).join('')}
    </div>
  </div>`;
}

const FIELD_LABELS = { modes: 'Mode', directions: 'Direction', loadTypes: 'Load type' };

function toggleGroup(field: 'modes' | 'directions' | 'loadTypes', values: readonly string[], selected?: string[]) {
  const all = selected === undefined;
  return `
  <div class="field">
    <div class="field-label">${FIELD_LABELS[field]}</div>
    <div class="toggles">
      <button class="tog ${all ? 'on' : ''}" data-act="tog-all" data-f="${field}">All</button>
      ${values
        .map((v) => `<button class="tog ${!all && selected!.includes(v) ? 'on' : ''}" data-act="tog" data-f="${field}" data-v="${v}">${label(v)}</button>`)
        .join('')}
    </div>
  </div>`;
}

function editorPanel() {
  const { draft, level, isNew } = state.editing!;
  const a = draft.appliesTo;
  const errors = validateRule(draft);
  const altOptions = ALL_DOC_TYPES.filter((t) => t !== draft.documentType);
  return `
  <div class="scrim" data-act="close"></div>
  <div class="drawer" role="dialog" aria-label="Edit applies to">
    <div class="drawer-head">
      <div>
        <div class="muted small">${level === 'company' ? 'Company default' : `Entity rule · ${ENTITY.code}`}${isNew ? ' · new' : ''}</div>
        <h2>${esc(docName(draft.documentType))}</h2>
      </div>
      <button class="dots" data-act="close" aria-label="Close">✕</button>
    </div>
    <div class="summary">Required for: <strong>${esc(describeAppliesTo(a))}</strong></div>
    ${toggleGroup('modes', TRANSPORT_MODES, a.modes)}
    ${toggleGroup('directions', DIRECTIONS, a.directions)}
    ${toggleGroup('loadTypes', LOAD_TYPES, a.loadTypes)}
    <div class="field two">
      <label>Origin countries<input data-country="originCountries" placeholder="All (e.g. CN, US)" value="${esc(a.originCountries?.join(', ') ?? '')}"></label>
      <label>Destination countries<input data-country="destinationCountries" placeholder="All (e.g. NZ, AU)" value="${esc(a.destinationCountries?.join(', ') ?? '')}"></label>
    </div>
    <label class="check"><input type="checkbox" data-act="pref" ${a.onlyWhenPreferenceClaimed ? 'checked' : ''}> Only when a trade-agreement preference is claimed</label>
    <div class="field">
      <div class="field-label">Also accept instead</div>
      <div class="toggles">
        ${altOptions
          .map((t) => `<button class="tog ${draft.acceptedAlternatives?.includes(t) ? 'on' : ''}" data-act="alt" data-v="${t}">${esc(docName(t))}</button>`)
          .join('')}
      </div>
    </div>
    ${errors.length ? `<ul class="errors">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    <div class="drawer-foot">
      <button class="btn ghost" data-act="close">Cancel</button>
      <button class="btn primary" data-act="save" ${errors.length ? 'disabled' : ''}>Save</button>
    </div>
  </div>`;
}

// ---- Events ----------------------------------------------------------------

let toastTimer: number | undefined;
function flash(msg: string) {
  state.toast = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = '';
    render();
  }, 2200);
}

function currentRule(t: string, level: Level): DocumentRule | undefined {
  if (level === 'company') return state.companyRules.find((r) => r.documentType === t);
  return effectiveRules(state.companyRules, state.entityRules).find((e) => e.rule.documentType === t)?.rule;
}

function openEditor(t: string, isNew = false) {
  const rule = currentRule(t, state.view) ?? { documentType: t, appliesTo: {} };
  state.editing = { level: state.view, draft: clone(rule), isNew };
}

function emailText() {
  const reqs = resolveRequirements(state.companyRules, state.entityRules, state.preview);
  const p = state.preview;
  const ctx = [p.mode && label(p.mode), p.direction && label(p.direction), p.loadType].filter(Boolean).join(' ');
  const lines = reqs
    .filter((r) => r.status !== 'NOT_APPLICABLE')
    .map((r) => {
      const alt = r.acceptedAlternatives.length ? ` (or ${r.acceptedAlternatives.map(docName).join(' / ')})` : '';
      const tbc = r.status === 'UNDETERMINED' ? ' (if applicable)' : '';
      return `- ${docName(r.documentType)}${alt}${tbc}`;
    });
  return `Hi,\n\nTo clear your ${ctx || ''} shipment through customs, please send us:\n\n${lines.join('\n')}\n\nThanks`;
}

root.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el || el.tagName === 'SELECT') {
    if (state.menuOpen && !(ev.target as HTMLElement).closest('.menu-wrap')) {
      state.menuOpen = null;
      render();
    }
    return;
  }
  const act = el.dataset.act!;
  const t = el.dataset.t!;
  const draft = state.editing?.draft;

  switch (act) {
    case 'view':
      state.view = el.dataset.v as Level;
      state.menuOpen = null;
      break;
    case 'menu': {
      const key = `${state.view}:${t}`;
      state.menuOpen = state.menuOpen === key ? null : key;
      break;
    }
    case 'edit':
      state.menuOpen = null;
      openEditor(t);
      break;
    case 'exclude':
      setEntityRule({ action: 'EXCLUDE', documentType: t });
      state.menuOpen = null;
      flash(`${docName(t)} excluded for ${ENTITY.code}`);
      break;
    case 'restore':
      removeEntityRule(t);
      state.menuOpen = null;
      flash(`${docName(t)} now follows the company default`);
      break;
    case 'delete':
      if (state.view === 'company') state.companyRules = state.companyRules.filter((r) => r.documentType !== t);
      else removeEntityRule(t);
      state.menuOpen = null;
      break;
    case 'close':
      state.editing = null;
      break;
    case 'save':
      saveDraft();
      break;
    case 'tog-all':
      delete draft!.appliesTo[el.dataset.f as 'modes'];
      break;
    case 'tog': {
      const f = el.dataset.f as 'modes' | 'directions' | 'loadTypes';
      const v = el.dataset.v!;
      const cur = (draft!.appliesTo[f] ?? []) as string[];
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      if (next.length) (draft!.appliesTo as Record<string, string[]>)[f] = next;
      else delete draft!.appliesTo[f]; // nothing ticked -> back to "All"
      break;
    }
    case 'pref':
      if ((el as HTMLInputElement).checked) draft!.appliesTo.onlyWhenPreferenceClaimed = true;
      else delete draft!.appliesTo.onlyWhenPreferenceClaimed;
      break;
    case 'alt': {
      const v = el.dataset.v!;
      const cur = draft!.acceptedAlternatives ?? [];
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      if (next.length) draft!.acceptedAlternatives = next;
      else delete draft!.acceptedAlternatives;
      break;
    }
    case 'email': {
      const text = emailText();
      navigator.clipboard?.writeText(text).then(
        () => flash('Email text copied'),
        () => flash('Copy blocked by the browser'),
      );
      break;
    }
    case 'reset-all':
      state.companyRules = clone(SUGGESTED_COMPANY_RULES);
      state.entityRules = [];
      state.editing = null;
      flash('Demo reset');
      break;
    default:
      return;
  }
  render();
});

root.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement | HTMLSelectElement;
  if (el.dataset.preview) {
    const f = el.dataset.preview as keyof ShipmentContext;
    const p = state.preview as Record<string, unknown>;
    if (el.value === '') delete p[f];
    else p[f] = f === 'preferenceClaimed' ? el.value === 'true' : el.value;
  } else if (el.dataset.recv) {
    const t = el.dataset.recv;
    if ((el as HTMLInputElement).checked) state.received.add(t);
    else state.received.delete(t);
  } else if (el.dataset.act === 'add' && el.value) {
    openEditor(el.value, true);
  } else if (el.dataset.country && state.editing) {
    const f = el.dataset.country as 'originCountries' | 'destinationCountries';
    const codes = el.value.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    const a: AppliesTo = state.editing.draft.appliesTo;
    if (codes.length) a[f] = codes;
    else delete a[f];
  } else {
    return;
  }
  render();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && (state.editing || state.menuOpen)) {
    state.editing = null;
    state.menuOpen = null;
    render();
  }
});

render();
