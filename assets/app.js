// Alpine Roasters — shop admin with a campaign planner.
//
// The hash picks the page, so every page is a link and a reload comes back
// where it was. All data lives on the server: a change posts, then the page
// re-reads. No inline handlers, because the page is served under a
// Content-Security-Policy that forbids them. Clicks are delegated from
// data-act attributes at the bottom of this file.

const $ = selector => document.querySelector(selector);

const state = { counts: {}, campaigns: [], hasModel: false };
const ui = {
  running: null,          // { campaign, mode } while a run is in progress
  lastReport: null,       // { campaign, ok, report, mode } after one ends
  editing: false,
  openRuns: new Set(),
  programs: {},           // run id -> programs, once loaded
  couponFilter: 'all'
};

/* Helpers ------------------------------------------------------------------ */

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) {
    let reason = 'The shop could not complete that.';
    try { reason = (await response.json()).error || reason; } catch { /* not JSON */ }
    throw Error(reason);
  }
  return response.json();
}
const post = (path, data) => api(path, { method: 'POST', body: JSON.stringify(data) });

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ESCAPES[c]);

const money = (cents, currency = 'CHF') => `${currency} ${(cents / 100).toFixed(2)}`;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function daysAgo(isoDate) {
  if (!isoDate) return '';
  const today = new Date(new Date().toISOString().slice(0, 10));
  const days = Math.round((today - new Date(isoDate)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// SQLite writes UTC without a zone marker.
const when = value => value
  ? new Date(value.replace(' ', 'T') + 'Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  : '';

const icon = path => `<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">${path}</svg>`;
const ICONS = {
  check: icon('<path d="M3.2 8.4l3 3 6.6-6.8"/>'),
  cross: icon('<path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/>'),
  pencil: icon('<path d="M10.8 2.7l2.5 2.5-7.8 7.8H3v-2.5z"/>'),
  play: icon('<path d="M5 3.3v9.4l7.4-4.7z"/>'),
  spark: icon('<path d="M8 1.8l1.4 4.2 4.3 1.5-4.3 1.5L8 13.2 6.6 9 2.3 7.5 6.6 6z"/>'),
  draft: icon('<path d="M4 1.8h5.6L12.5 4.7v9.5H4z"/><path d="M9.3 1.8v3.2h3.2"/>'),
  warn: icon('<path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.4v3.2M8 11.4v.1"/>'),
  chevron: icon('<path d="M6 3.8l4.2 4.2L6 12.2"/>'),
  chevronDown: icon('<path d="M3.8 6l4.2 4.2L12.2 6"/>')
};

// The AI reports in Markdown. This renders the part it uses: paragraphs,
// lists, tables, bold and code. Text is escaped before any markup is added.
function markdown(text) {
  const inline = line => esc(line)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  const blocks = [];
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const body = rows.filter((row, n) => n !== 1 || !/^[\s|:-]+$/.test(row));
      const [head, ...rest] = body.map(cells);
      blocks.push(`<table class="md-table"><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${rest.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (/^\s*([-*]|\d+\.) /.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const marker = ordered ? /^\s*\d+\. / : /^\s*[-*] /;
      const items = [];
      while (i < lines.length && marker.test(lines[i])) items.push(lines[i++].replace(marker, ''));
      const tag = ordered ? 'ol' : 'ul';
      blocks.push(`<${tag}>${items.map(item => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
    } else if (line.trim() === '') {
      i++;
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^\s*(\||[-*] |\d+\. )/.test(lines[i])) para.push(lines[i++]);
      blocks.push(`<p>${para.map(inline).join('<br>')}</p>`);
    }
  }
  return `<div class="md">${blocks.join('')}</div>`;
}

let toastTimer = 0;
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 4000);
}

// A delivery note that talks to an AI is what the boundary is for, so the
// owner's view points at it.
const suspicious = note => /\b(ai|assistant|ignore)\b/i.test(note);

/* Shell -------------------------------------------------------------------- */

async function loadSnapshot() {
  const data = await api('/api/snapshot');
  state.counts = data.counts;
  state.campaigns = data.campaigns;
  state.hasModel = data.has_model;
  renderNav();
}

function renderNav() {
  const megaphone = icon('<path d="M2.5 6.3h2.3l6.4-3.3v10l-6.4-3.3H2.5z"/><path d="M4.8 9.7l.9 3.4"/><path d="M13 6.4a2 2 0 0 1 0 3.2"/>');
  $('#campaign-links').innerHTML = state.campaigns.map(c => `
    <a href="#/campaigns/${c.id}" data-page="campaign-${c.id}">
      <span class="nav-label">${megaphone}<span>${esc(c.name)}</span></span>
      ${c.drafts ? `<span class="count attention" title="${plural(c.drafts, 'draft')} waiting for approval">${c.drafts}</span>` : ''}
    </a>`).join('');
  for (const key of ['customers', 'orders', 'coupons']) {
    const element = document.querySelector(`[data-count="${key}"]`);
    if (element) element.textContent = state.counts[key] ?? '';
  }
}

function markNav(page) {
  for (const link of document.querySelectorAll('#nav a')) {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function page(html) {
  $('#main').innerHTML = `<div class="page">${html}</div>`;
}

async function route() {
  const hash = location.hash || '#/campaigns/1';
  const parts = hash.slice(2).split('/');
  try {
    if (parts[0] === 'campaigns' && parts[1] === 'new') {
      markNav('new-campaign');
      renderCampaignForm(null);
    } else if (parts[0] === 'campaigns') {
      const id = Number(parts[1]) || 1;
      markNav(`campaign-${id}`);
      await renderCampaign(id);
    } else if (parts[0] === 'customers') {
      markNav('customers');
      await renderCustomers();
    } else if (parts[0] === 'orders') {
      markNav('orders');
      await renderOrders();
    } else if (parts[0] === 'coupons') {
      markNav('coupons');
      await renderCoupons();
    } else {
      location.hash = '#/campaigns/1';
    }
  } catch (error) {
    page(`<div class="banner bad"><div class="grow"><strong>Something went wrong</strong>${esc(error.message)}</div></div>`);
  }
}

/* Campaign ----------------------------------------------------------------- */

let current = null;

async function renderCampaign(id) {
  const data = await api(`/api/campaigns/${id}`);
  current = data.campaign;
  if (ui.editing) return renderCampaignForm(current);

  const c = current;
  const drafts = c.coupons.filter(k => k.status === 'draft');
  const approved = c.coupons.filter(k => k.status === 'active' || k.status === 'used');
  const decided = c.coupons.filter(k => k.status !== 'draft');
  const sum = list => list.reduce((total, k) => total + k.amount_cents, 0);
  const left = Math.max(c.budget_cents - c.committed_cents, 0);
  const running = ui.running && ui.running.campaign === c.id;

  page(`
    <div class="crumbs">Marketing · Campaign</div>
    <div class="page-head">
      <div>
        <h1>${esc(c.name)}</h1>
        <p>You write the policy. The AI turns it into a program that proposes draft coupons, and you decide each one.</p>
      </div>
      <div class="page-actions">
        <button data-act="edit" ${running ? 'disabled' : ''}>${ICONS.pencil}Edit</button>
        <button data-act="run" data-mode="example" ${running ? 'disabled' : ''}
          title="Runs a checked-in program for the sample policy. No AI involved.">${ICONS.play}Run example program</button>
        <button class="ai" data-act="run" data-mode="agent" ${running || !state.hasModel ? 'disabled' : ''}
          title="${state.hasModel ? 'The AI writes and runs programs against the Promotions interface.' : 'Add a model key to .env to enable this.'}">${ICONS.spark}Let the AI write a program</button>
      </div>
    </div>

    ${runBanner(c)}

    <div class="stats">
      <div class="card stat">
        <span>Budget</span>
        <strong>${money(c.budget_cents, c.currency)}</strong>
        <progress class="meter" max="${c.budget_cents}" value="${Math.min(c.committed_cents, c.budget_cents)}" aria-label="Budget committed"></progress>
        <small>${money(left, c.currency)} left</small>
      </div>
      <div class="card stat">
        <span>Waiting for approval</span>
        <strong>${money(sum(drafts), c.currency)}</strong>
        <small>${plural(drafts.length, 'draft')}</small>
      </div>
      <div class="card stat">
        <span>Approved</span>
        <strong>${money(sum(approved), c.currency)}</strong>
        <small>${plural(approved.length, 'coupon')}</small>
      </div>
      <div class="card stat">
        <span>Per coupon</span>
        <strong>≤ ${money(c.max_offer_cents, c.currency)}</strong>
        <small>valid for ${plural(c.valid_days, 'day')}</small>
      </div>
    </div>

    <div class="split">
      <section class="card">
        <div class="card-head"><div><h2>Policy</h2><p>What the AI is asked to do, in the owner's words.</p></div></div>
        <div class="card-body"><p class="policy">${esc(c.policy)}</p></div>
        <div class="card-foot">The budget and per-coupon limits are enforced by the shop's own code, whatever the policy or the program says.</div>
      </section>
      ${reachCard()}
    </div>

    <section class="card section">
      <div class="card-head">
        <div>
          <h2>Waiting for approval</h2>
          <p>Nothing reaches a customer until you approve it. Check each reason against the order history the shop computed.</p>
        </div>
        ${drafts.length > 1 ? `<button class="approve" data-act="approve-all">${ICONS.check}Approve all ${drafts.length}</button>` : ''}
      </div>
      ${drafts.length ? `<div class="table-wrap">${couponTable(drafts, c, true)}</div>`
        : `<div class="empty"><strong>No drafts waiting</strong>Run the campaign to propose coupons.</div>`}
    </section>

    ${decided.length ? `
      <section class="card section">
        <div class="card-head"><div><h2>Decided</h2><p>${plural(decided.length, 'draft')} you approved or rejected.</p></div></div>
        <div class="table-wrap">${couponTable(decided, c, false)}</div>
      </section>` : ''}

    <section class="card section">
      <div class="card-head"><div><h2>Runs</h2><p>Every program that ran for this campaign: its code, whether it compiled, and what it printed.</p></div></div>
      ${c.runs.length ? c.runs.map(runHtml).join('')
        : `<div class="empty"><strong>No runs yet</strong>Run the example program, or let the AI write one.</div>`}
    </section>
  `);
}

function runBanner(c) {
  if (ui.running && ui.running.campaign === c.id) {
    return `<div class="banner info"><span class="spinner"></span><div class="grow">
      <strong>${ui.running.mode === 'agent' ? 'The AI is writing and running programs' : 'Running the example program'}</strong>
      ${ui.running.mode === 'agent' ? 'This usually takes a minute or two. Drafts appear below when it finishes.' : 'Compiling it against the Promotions interface and running it.'}
    </div></div>`;
  }
  const report = ui.lastReport;
  if (!report || report.campaign !== c.id) return '';
  return `<div class="banner ${report.ok ? 'ok' : 'bad'}">${report.ok ? ICONS.check : ICONS.warn}<div class="grow">
    <strong>${report.ok ? 'Run finished' : 'Run failed'}</strong>
    ${report.ok && report.mode === 'agent' ? markdown(report.report) : `<pre>${esc(report.report)}</pre>`}
  </div><button class="ghost small" data-act="dismiss-report">Dismiss</button></div>`;
}

function reachCard() {
  const item = (kind, glyph, text) => `<li class="${kind}">${glyph}<span>${text}</span></li>`;
  return `
    <section class="card reach">
      <div class="card-head"><div><h2>What the program can reach</h2><p>Set by the <code>Promotions</code> interface and checked when the program compiles.</p></div></div>
      <div class="card-body">
        <h3>Reads</h3>
        <ul>
          ${item('yes', ICONS.check, 'Stand-in labels: <code>customer-1</code>, <code>customer-2</code>, …')}
          ${item('yes', ICONS.check, 'Purchase dates and amounts')}
          ${item('yes', ICONS.check, 'Open coupons, without their codes')}
          ${item('yes', ICONS.check, 'The budget and per-coupon limit')}
        </ul>
        <h3>Writes</h3>
        <ul>${item('write', ICONS.draft, 'Draft coupons, for you to approve')}</ul>
        <h3>Never</h3>
        <ul>
          ${item('no', ICONS.cross, 'Names, emails, addresses, delivery notes')}
          ${item('no', ICONS.cross, 'The database, files, or the network')}
          ${item('no', ICONS.cross, 'Approving a draft')}
        </ul>
      </div>
    </section>`;
}

function couponTable(coupons, campaign, pending) {
  const currency = campaign.currency;
  const modes = Object.fromEntries(campaign.runs.map(run => [run.id, run.mode]));
  const author = k => modes[k.run_id] === 'agent' ? 'AI-written program' : 'Example program';
  return `
    <table class="stack">
      <thead><tr>
        <th scope="col">Customer</th>
        <th scope="col" class="col-facts">Order history</th>
        <th scope="col">${pending ? 'Proposed coupon' : 'Coupon'}</th>
        <th scope="col"><span class="visually-hidden">${pending ? 'Decision' : 'Status'}</span></th>
      </tr></thead>
      <tbody>${coupons.map(k => `
        <tr>
          <td><span class="strong">${esc(k.customer_name)}</span><small>${esc(k.email)}</small><small>${esc(k.city)}</small></td>
          <td>
            <dl class="facts">
              <dt>Orders</dt><dd>${k.orders ?? 0}</dd>
              <dt>Usually every</dt><dd>${k.usual_gap ? plural(k.usual_gap, 'day') : '—'}</dd>
              <dt>Last order</dt><dd>${k.last_ago ?? '—'} days ago</dd>
              <dt>Average order</dt><dd>${money(k.average_cents ?? 0, currency)}</dd>
            </dl>
          </td>
          <td>
            <div class="offer"><span class="money">${money(k.amount_cents, currency)}</span>
              <span class="muted">off orders over ${money(k.minimum_spend_cents, currency)}</span>
              ${!pending && k.status !== 'rejected' ? `<code>${esc(k.code)}</code>` : ''}</div>
            <div class="reason"><span class="author">${author(k)}</span> ${esc(k.reason)}</div>
          </td>
          <td>${pending ? `<div class="row-actions">
              <button class="approve small" data-act="approve" data-id="${k.id}">${ICONS.check}Approve</button>
              <button class="reject small" data-act="reject" data-id="${k.id}">${ICONS.cross}Reject</button>
            </div>`
            : `<span class="pill ${esc(k.status)}">${esc(k.status === 'active' ? 'approved' : k.status)}</span>
               ${k.expires_on && k.status !== 'rejected' ? `<small>until ${esc(k.expires_on)}</small>` : ''}`}
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function runHtml(run) {
  const open = ui.openRuns.has(run.id);
  const programs = ui.programs[run.id];
  const agent = run.mode === 'agent';
  return `
    <div class="run">
      <div class="run-row">
        <span class="strong">Run ${run.id}</span>
        <span>${agent ? 'AI-written programs' : 'Example program'}</span>
        <span><span class="pill ${esc(run.status)}">${esc(run.status)}</span></span>
        <span class="muted">${esc(when(run.started_at))}</span>
        <button class="ghost small" data-act="toggle-run" data-id="${run.id}" aria-expanded="${open}">
          ${open ? ICONS.chevronDown : ICONS.chevron}${open ? 'Hide' : 'Details'}
        </button>
      </div>
      ${open ? `<div class="run-detail">
        ${agent ? `<h4>The AI's report</h4><div class="prose-report">${markdown(run.summary || 'No report.')}</div>` : ''}
        ${programs === undefined ? '<p class="muted">Loading programs…</p>'
          : programs.length === 0 ? `<h4>Programs</h4><p class="muted">${esc(run.summary || 'This run compiled no programs.')}</p>`
          : `<h4>${plural(programs.length, 'program')}</h4>${programs.map(programHtml).join('')}`}
      </div>` : ''}
    </div>`;
}

function programHtml(program, index) {
  const [label, tone] = !program.compiled
    ? [program.timedOut ? 'compile timed out' : 'did not compile', 'failed']
    : program.timedOut ? ['timed out', 'failed']
    : program.exitCode === 0 ? ['compiled and ran', 'ran']
    : ['crashed', 'failed'];
  const failed = !program.compiled;
  const result = failed ? program.compileError : program.output;
  return `
    <div class="program">
      <div class="program-head"><span class="strong grow">Program ${index + 1}</span><span class="pill ${tone}">${label}</span></div>
      <pre class="code">${esc(program.code)}</pre>
      ${result ? `<span class="out-label ${failed ? 'error' : ''}">${failed ? 'Compiler' : 'Output'}</span>
        <pre class="out ${failed ? 'error' : ''}">${esc(result)}</pre>` : ''}
    </div>`;
}

function renderCampaignForm(campaign) {
  const c = campaign || { id: 0, name: '', policy: '', budget_cents: 3000, max_offer_cents: 1500, valid_days: 14 };
  page(`
    <div class="crumbs">Marketing · ${c.id ? 'Campaign' : 'New campaign'}</div>
    <div class="page-head"><div>
      <h1>${c.id ? `Edit ${esc(c.name)}` : 'New campaign'}</h1>
      <p>Write the policy the way you would explain it to a colleague.</p>
    </div></div>
    <form id="campaign-form" novalidate>
      <div class="form-grid">
        <section class="card">
          <div class="card-head"><div><h2>Policy</h2><p>The AI reads this. The program it writes does not.</p></div></div>
          <div class="card-body">
            <div class="field"><label for="f-name">Name</label><input id="f-name" name="name" value="${esc(c.name)}" placeholder="Win back late regulars" required></div>
            <div class="field"><label for="f-policy">Policy</label>
              <textarea id="f-policy" name="policy" placeholder="Who should get a coupon, how much, and what goes first when the budget runs out." required>${esc(c.policy)}</textarea></div>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Limits</h2><p>Enforced by the shop, whatever the program asks for.</p></div></div>
          <div class="card-body">
            <div class="field"><label for="f-budget">Budget</label>
              <div class="input-affix"><span>CHF</span><input id="f-budget" name="budget" type="number" min="1" step="1" value="${c.budget_cents / 100}" required></div>
              <small>Drafts, approved and used coupons all count against it.</small></div>
            <div class="field"><label for="f-max">Largest coupon</label>
              <div class="input-affix"><span>CHF</span><input id="f-max" name="max" type="number" min="1" step="1" value="${c.max_offer_cents / 100}" required></div></div>
            <div class="field"><label for="f-days">Valid for</label>
              <div class="input-affix suffix"><span>days</span><input id="f-days" name="days" type="number" min="1" max="365" value="${c.valid_days}" required></div>
              <small>Counted from the day you approve a coupon.</small></div>
          </div>
        </section>
      </div>
      <div class="card section">
        <p class="form-error" id="form-error" hidden></p>
        <div class="form-actions">
          <button type="button" data-act="cancel-edit">Cancel</button>
          <button type="submit" class="primary">${c.id ? 'Save changes' : 'Create campaign'}</button>
        </div>
      </div>
    </form>`);
  const errorBox = $('#form-error');
  $('#campaign-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    try {
      const saved = await post('/api/campaigns', {
        id: c.id,
        name: form.name.value,
        policy: form.policy.value,
        budget_cents: Math.round(Number(form.budget.value) * 100),
        max_offer_cents: Math.round(Number(form.max.value) * 100),
        valid_days: Number(form.days.value)
      });
      ui.editing = false;
      await loadSnapshot();
      toast(c.id ? 'Campaign saved' : 'Campaign created');
      if (location.hash === `#/campaigns/${saved.id}`) route();
      else location.hash = `#/campaigns/${saved.id}`;
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }
  });
}

async function runCampaign(mode) {
  const id = current.id;
  ui.running = { campaign: id, mode };
  ui.lastReport = null;
  await route();
  try {
    const result = await post(`/api/campaigns/${id}/run`, { mode });
    ui.lastReport = { campaign: id, ok: result.ok, report: result.report, mode };
    if (result.run_id) {
      ui.openRuns = new Set([result.run_id]);
      await loadPrograms(result.run_id);
    }
  } catch (error) {
    ui.lastReport = { campaign: id, ok: false, report: error.message };
  }
  ui.running = null;
  await loadSnapshot();
  await route();
}

async function loadPrograms(runId) {
  const data = await api(`/api/runs/${runId}/programs`);
  ui.programs[runId] = data.programs;
}

/* Shop pages --------------------------------------------------------------- */

function shopHead(title, text) {
  return `<div class="crumbs">Shop</div><div class="page-head"><div><h1>${title}</h1><p>${text}</p></div></div>`;
}

async function renderCustomers() {
  const { customers } = await api('/api/customers');
  page(`
    ${shopHead('Customers', 'What customers gave the shop so it could deliver their orders. None of it reaches the AI-generated program.')}
    <section class="card">
      <div class="card-head">
        <div class="toolbar"><input type="search" id="filter" placeholder="Search name, email or city" aria-label="Search customers"></div>
        <span class="muted" id="shown"></span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Customer</th><th>Address</th><th>Phone</th><th class="num">Orders</th><th>Last order</th><th class="num">Spent</th><th>Coupons</th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </section>`);
  const draw = () => {
    const q = $('#filter').value.toLowerCase();
    const shown = customers.filter(c => !q || `${c.name} ${c.email} ${c.city}`.toLowerCase().includes(q));
    $('#shown').textContent = plural(shown.length, 'customer');
    $('#rows').innerHTML = shown.map(c => `<tr>
        <td><span class="strong">${esc(c.name)}</span><small>${esc(c.email)}</small></td>
        <td>${esc(c.street)}<small>${esc(c.postcode)} ${esc(c.city)}</small></td>
        <td class="nowrap">${esc(c.phone)}</td>
        <td class="num">${c.orders}</td>
        <td class="nowrap">${esc(daysAgo(c.last_order))}<small>${esc(c.last_order)}</small></td>
        <td class="num money">${money(c.spent_cents)}</td>
        <td>${c.open_coupons ? `<span class="pill active">${plural(c.open_coupons, 'open')}</span>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">No customer matches.</td></tr>';
  };
  $('#filter').addEventListener('input', draw);
  draw();
}

async function renderOrders() {
  const { orders } = await api('/api/orders');
  page(`
    ${shopHead('Orders', 'Delivery notes are free text customers typed at checkout. You read them. The AI-generated program cannot, so a note cannot give the AI instructions.')}
    <section class="card">
      <div class="card-head">
        <div class="toolbar">
          <input type="search" id="filter" placeholder="Search customer or product" aria-label="Search orders">
          <label class="check"><input type="checkbox" id="notes-only"> With a delivery note</label>
        </div>
        <span class="muted" id="shown"></span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Customer</th><th>Items</th><th class="num">Subtotal</th><th>Delivery note</th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </section>`);
  const draw = () => {
    const q = $('#filter').value.toLowerCase();
    const notesOnly = $('#notes-only').checked;
    const shown = orders
      .filter(o => !notesOnly || o.delivery_note)
      .filter(o => !q || `${o.customer_name} ${o.items}`.toLowerCase().includes(q));
    $('#shown').textContent = shown.length > 200 ? `200 of ${plural(shown.length, 'order')}` : plural(shown.length, 'order');
    $('#rows').innerHTML = shown.slice(0, 200).map(o => `<tr>
        <td class="nowrap">${esc(o.placed_on)}<small>${esc(daysAgo(o.placed_on))}</small></td>
        <td class="nowrap"><span class="strong">${esc(o.customer_name)}</span><small>${esc(o.city)}</small></td>
        <td>${esc(o.items)}</td>
        <td class="num nowrap"><span class="money">${money(o.subtotal_cents)}</span>${o.status !== 'paid' ? `<small><span class="pill ${esc(o.status)}">${esc(o.status)}</span></small>` : ''}</td>
        <td>${!o.delivery_note ? ''
          : suspicious(o.delivery_note)
            ? `<span class="note suspicious">${ICONS.warn}<span>${esc(o.delivery_note)}<span class="note-hint">Addressed to an AI. Delivery notes never reach the program.</span></span></span>`
            : `<span class="note">${esc(o.delivery_note)}</span>`}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">No order matches.</td></tr>';
  };
  $('#filter').addEventListener('input', draw);
  $('#notes-only').addEventListener('change', draw);
  draw();
}

async function renderCoupons() {
  const { coupons } = await api('/api/coupons');
  const states = ['draft', 'active', 'used', 'expired', 'rejected'];
  const label = { all: 'All', draft: 'Drafts', active: 'Active', used: 'Used', expired: 'Expired', rejected: 'Rejected' };
  const count = s => s === 'all' ? coupons.length : coupons.filter(k => k.state === s).length;
  const shown = coupons.filter(k => ui.couponFilter === 'all' || k.state === ui.couponFilter);
  page(`
    ${shopHead('Coupons', 'Every coupon the shop issued, and drafts waiting for a decision. Codes are generated by the shop and never shown to the AI-generated program.')}
    <section class="card">
      <div class="card-head">
        <div class="tabs" role="group" aria-label="Filter by status">
          ${['all', ...states].filter(s => s === 'all' || count(s)).map(s => `
            <button data-act="coupon-filter" data-state="${s}" aria-pressed="${ui.couponFilter === s}">${label[s]} <span class="n">${count(s)}</span></button>`).join('')}
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Code</th><th>Customer</th><th class="num">Amount</th><th class="num">Min. spend</th><th>Status</th><th>Expires</th><th>Source</th></tr></thead>
        <tbody>${shown.map(k => `<tr>
          <td><code>${esc(k.code)}</code></td>
          <td class="strong">${esc(k.customer_name)}</td>
          <td class="num money">${money(k.amount_cents)}</td>
          <td class="num">${money(k.minimum_spend_cents)}</td>
          <td><span class="pill ${esc(k.state)}">${esc(k.state)}</span></td>
          <td class="nowrap">${esc(k.expires_on || '—')}</td>
          <td>${k.campaign_name ? `<span class="strong">${esc(k.campaign_name)}</span><small>campaign</small>` : `${esc(k.reason)}<small>issued by hand</small>`}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty">No coupons.</td></tr>'}</tbody>
      </table></div>
    </section>`);
}

/* Events ------------------------------------------------------------------- */

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-act]');
  if (!target) return;
  const act = target.dataset.act;
  const id = Number(target.dataset.id);
  try {
    if (act === 'run') {
      await runCampaign(target.dataset.mode);
    } else if (act === 'approve' || act === 'reject') {
      target.disabled = true;
      await post(`/api/coupons/${act}`, { id });
      toast(act === 'approve' ? 'Approved. The coupon is active.' : 'Draft rejected.');
      await loadSnapshot();
      await route();
    } else if (act === 'approve-all') {
      target.disabled = true;
      const drafts = current.coupons.filter(k => k.status === 'draft');
      for (const k of drafts) await post('/api/coupons/approve', { id: k.id });
      toast(`Approved ${plural(drafts.length, 'coupon')}.`);
      await loadSnapshot();
      await route();
    } else if (act === 'toggle-run') {
      if (ui.openRuns.has(id)) {
        ui.openRuns.delete(id);
      } else {
        ui.openRuns.add(id);
        if (!ui.programs[id]) {
          await route();
          await loadPrograms(id);
        }
      }
      await route();
    } else if (act === 'edit') {
      ui.editing = true;
      await route();
    } else if (act === 'cancel-edit') {
      if (ui.editing) {
        ui.editing = false;
        await route();
      } else {
        location.hash = `#/campaigns/${state.campaigns[0]?.id ?? 1}`;
      }
    } else if (act === 'dismiss-report') {
      ui.lastReport = null;
      await route();
    } else if (act === 'coupon-filter') {
      ui.couponFilter = target.dataset.state;
      await route();
    }
  } catch (error) {
    toast(error.message);
    await route();
  }
});

window.addEventListener('hashchange', () => { ui.editing = false; route(); });

loadSnapshot().then(route).catch(error => {
  page(`<div class="banner bad"><div class="grow"><strong>The shop is not reachable</strong>${esc(error.message)}</div></div>`);
});
