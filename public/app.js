const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  building: '<path d="M4 21V5l9-2v18M13 8h7v13M2 21h20M8 7v1m0 3v1m0 3v1m9-4v1m0 3v1"/>', globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  flag: '<path d="M5 21V3m0 1h13l-2 4 2 4H5"/>', exclude: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  settings: '<path d="m10 3-.5 3-2 .9-2.5-1L3 9l2.4 2v2L3 15l2 3.1 2.5-1 2 .9.5 3h4l.5-3 2-.9 2.5 1L21 15l-2.4-2v-2L21 9l-2-3.1-2.5 1-2-.9L14 3z"/><circle cx="12" cy="12" r="3"/>',
  sliders: '<path d="M3 7h7m4 0h7M3 17h11m4 0h3M10 4v6m4-6v6m0 4v6m4-6v6"/>', pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>', bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>', upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>', scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M6 12h12"/>', plus: '<path d="M12 5v14M5 12h14"/>', shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.search}</svg>`; }
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
hydrateIcons();
const labels = { new: 'Nog niet gescand', queued: 'In wachtrij', running: 'Wordt gescand', found: 'Gevonden', review: 'Regio controleren', no_website: 'Geen website', no_email: 'Geen adres', blocked: 'Geblokkeerd', error: 'Controle nodig', stale: 'Opnieuw scannen', excluded: 'Uitgesloten', interrupted: 'Onderbroken' };
let token = '', regions = [], settings, summary, view = 'companies', page = 1, list = { rows: [], total: 0, pages: 0 }, selected = new Set(), busy = false, lastJob = null, upload = null, requestVersion = 0, filterDirty = false;
const sectorNames = new Map([['41', 'Bouw van gebouwen'], ['42', 'Weg- en waterbouw'], ['43', 'Gespecialiseerde bouw']]);
const fmt = n => Number(n).toLocaleString('nl-BE');
const date = value => value ? new Date(value).toLocaleString('nl-BE', { dateStyle: 'medium', timeStyle: 'short' }) : 'Nog niet gecontroleerd';
function toast(message, error = false) { const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, 6500); }
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json', 'X-Vindbaar-Token': token } : {}), ...options.headers } });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Verzoek mislukt.'); return data;
}
function safeAction(fn) { return async event => { try { await fn(event); } catch (error) { toast(error.message, true); } }; }
function badge(status) { return `<span class="badge ${escape(status)}">${escape(labels[status] || status)}</span>`; }
function regionName(id) { return regions.find(r => r.id === id)?.name || 'Onbekend'; }
function inputSettings() { return { ...settings, regions: $$('#region-options input:checked').map(el => el.value), sectors: [...settings.sectors], includeUnknown: $('#include-unknown').checked }; }
function renderFilters() {
  filterDirty = false;
  $('#region-options').innerHTML = regions.map(r => `<label><input type="checkbox" value="${escape(r.id)}" ${settings.regions.includes(r.id) ? 'checked' : ''}>${escape(r.name)}</label>`).join('');
  $('#include-unknown').checked = settings.includeUnknown;
  updateRegionLabel(); renderChips();
}
function updateRegionLabel() { const chosen = $$('#region-options input:checked'); $('#region-label').textContent = chosen.length === 1 ? regionName(chosen[0].value) : `${chosen.length} regio’s geselecteerd`; }
function renderChips() { $('#sector-chips').innerHTML = settings.sectors.map(code => `<span class="chip" title="${escape(sectorNames.get(code) || code)}">${escape(code)} · ${escape((sectorNames.get(code) || 'Sectorcode').slice(0, 32))}<button data-remove-sector="${escape(code)}" aria-label="Verwijder sector ${escape(code)}">×</button></span>`).join(''); }
function renderSummary(s) {
  summary = s;
  $('#stat-companies').textContent = fmt(s.companies); $('#stat-scanned').textContent = fmt(s.scanned); $('#stat-emails').textContent = fmt(s.emails); $('#result-count').textContent = fmt(s.emails);
  $('#source-status').textContent = `Bron: KBO Open Data · ${s.catalog ? `snapshot ${s.catalog.date}${s.catalog.demo ? ' · DEMO' : ''}` : 'nog niet geïmporteerd'}`;
  const job = s.jobs.find(j => ['running', 'uploading'].includes(j.status));
  busy = Boolean(job);
  $('#job-card').hidden = !job;
  if (job) {
    lastJob = job.id; $('#job-title').textContent = job.type === 'import' ? 'Bedrijfsbron importeren' : 'Bedrijfswebsites doorzoeken'; $('#job-message').textContent = job.message;
    $('#cancel-job').disabled = job.status === 'uploading'; $('#cancel-job').dataset.id = job.id;
    if (job.total > 0) { $('#job-progress').max = job.total; $('#job-progress').value = job.progress; } else $('#job-progress').removeAttribute('value');
  }
  $('#apply-filters').disabled = busy; $('#save-settings').disabled = busy; $('#upload-file').disabled = busy || !upload;
  $('#auto-scan').disabled = busy || !s.catalog;
  $('#export-link').href = `/api/export?q=${encodeURIComponent($('#company-search').value)}`;
  updateSelection();
}
async function loadCompanies() {
  const version = ++requestVersion;
  const data = await api(`/api/companies?view=${view}&page=${page}&q=${encodeURIComponent($('#company-search').value)}`);
  if (version !== requestVersion) return;
  list = data; page = data.page;
  selected = new Set([...selected].filter(id => data.rows.some(r => r.id === id && r.website && !r.excluded)));
  $('#match-count').textContent = fmt(data.total);
  $('#empty-state').hidden = Boolean(summary.catalog);
  $('#table-wrap').hidden = !summary.catalog || !data.rows.length;
  $('#no-results').hidden = !summary.catalog || data.rows.length > 0;
  $('#pagination-label').textContent = !summary.catalog ? 'Nog geen bron geïmporteerd' : data.total ? `${fmt((page - 1) * 100 + 1)}–${fmt((page - 1) * 100 + data.rows.length)} van ${fmt(data.total)} bedrijven · pagina ${page} / ${data.pages}` : '0 bedrijven';
  $('#previous-page').disabled = page <= 1; $('#next-page').disabled = page >= data.pages;
  $('#company-rows').innerHTML = data.rows.map(c => {
    const loc = c.matchedLocations[0] || c.locations.find(l => !l.region) || c.locations[0];
    return `<tr><td class="checkbox-cell"><input type="checkbox" data-select="${escape(c.id)}" aria-label="Selecteer ${escape(c.name)}" ${selected.has(c.id) ? 'checked' : ''} ${!c.website || c.excluded ? 'disabled' : ''}></td><td><a href="#" data-detail="${escape(c.id)}" class="company-name">${escape(c.name)}</a><div class="company-number">KBO ${escape(c.id.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1.$2.$3'))}</div></td><td>${escape(loc?.city || 'Onbekend')}<div class="cell-secondary">${escape(c.regionOverride ? regionName(c.regionOverride) : loc?.region ? regionName(loc.region) : 'Regio controleren')}${c.matchedLocations.length > 1 ? ` +${c.matchedLocations.length - 1}` : ''}</div></td><td class="activity-cell"><div title="${escape(c.activities.map(a => a.description).join(', '))}">${escape(c.activities[0]?.description || '—')}</div><div class="cell-secondary">${escape(c.activities[0]?.code || '')}${c.activities.length > 1 ? ` +${c.activities.length - 1}` : ''}</div></td><td class="email-cell">${c.emails.length ? `${escape(c.emails[0].email)}${c.emails.length > 1 ? `<div class="cell-secondary">+${c.emails.length - 1} adres(sen)</div>` : ''}` : '<span class="muted">—</span>'}</td><td>${badge(c.status)}</td><td><button class="icon-button" data-detail="${escape(c.id)}" aria-label="Details van ${escape(c.name)}">↗</button></td></tr>`;
  }).join('');
  updateSelection();
}
function updateSelection() {
  $('#selection-count').textContent = `${selected.size} geselecteerd`;
  $('#start-scan').disabled = busy || filterDirty || !selected.size;
  $('#table-caption').textContent = filterDirty ? 'Je filters zijn aangepast. Klik eerst op Filters toepassen.' : 'Selecteer maximaal 100 bedrijven per scan. Export bevat alleen bevestigde regio’s en bronvondsten.';
  const selectable = list.rows.filter(c => c.website && !c.excluded);
  $('#select-all').checked = selectable.length > 0 && selectable.every(c => selected.has(c.id));
  $('#select-all').indeterminate = selected.size > 0 && !$('#select-all').checked;
}
async function openDetail(id) {
  const c = await api(`/api/companies/${encodeURIComponent(id)}`);
  $('#detail-content').innerHTML = `<div class="dialog-header"><div><div class="eyebrow">BEDRIJFSCONTACT</div><h2>${escape(c.name)}</h2><div class="company-number">Ondernemingsnummer ${escape(c.id)}</div></div><button class="icon-button" data-close aria-label="Sluiten">×</button></div>${badge(c.status)}<section class="detail-section"><h3>Vestigingen en hoofdactiviteiten</h3><div class="location-list">${c.locations.map(l => `${escape(l.postcode)} ${escape(l.city || 'Onbekende gemeente')} · ${escape(regionName(l.region))}`).join('<br>')}</div><p class="muted small">${escape(c.activities.map(a => `${a.code} · ${a.description}`).join(' / '))}</p></section><section class="detail-section"><h3>Bedrijfswebsite</h3><input class="form-input" id="detail-website" aria-label="Bedrijfswebsite" placeholder="https://www.bedrijfsnaam.be" value="${escape(c.website || '')}"><p class="small muted">${c.website ? `<a class="external-link" href="${escape(c.website)}" target="_blank" rel="noopener noreferrer">Website openen ↗</a>` : 'Geen website in KBO. Vul hier de eigen bedrijfswebsite in.'}</p>${c.locations.some(l => !l.region) ? `<label class="form-label" for="detail-region">Regio van onbekende vestiging bevestigen</label><select id="detail-region"><option value="">Nog niet bevestigd</option>${regions.map(r => `<option value="${escape(r.id)}" ${c.regionOverride === r.id ? 'selected' : ''}>${escape(r.name)}</option>`).join('')}</select><p class="small muted">Controleer het vestigingsadres op de bedrijfswebsite voordat je een regio kiest.</p>` : ''}<button class="button secondary" id="save-company" ${busy ? 'disabled' : ''}>Wijzigingen opslaan</button></section><section class="detail-section"><h3>Gevonden rolmailboxen</h3>${c.emails.length ? c.emails.map(e => `<div class="detail-email"><strong>${escape(e.email)}</strong><a href="${escape(e.source_url)}" target="_blank" rel="noopener noreferrer">${escape(e.source_url)} ↗</a><small>Gevonden op ${escape(date(e.checked_at))}</small></div>`).join('') : '<p class="muted small">Nog geen passende e-mailadressen gevonden.</p>'}<p class="muted small">${escape(c.detail)}${c.checked_at ? `<br>${escape(date(c.checked_at))} · ${c.pages} HTML-pagina’s gelezen` : ''}</p>${c.confirmed ? '<div class="note"><p>Bronpagina en regio zijn bekend. Dit adres kan mee in de export; de afleverbaarheid is niet getest.</p></div>' : ''}</section><div class="detail-actions"><button class="button secondary" id="exclude-company" ${busy ? 'disabled' : ''}>${c.excluded ? 'Opnieuw opnemen' : 'Bedrijf uitsluiten'}</button><button class="button primary" id="rescan-company" ${busy || !c.website || c.excluded ? 'disabled' : ''}>Website opnieuw scannen</button></div>`;
  $('#save-company').onclick = safeAction(async () => {
    const change = {};
    if ($('#detail-website').value.trim() !== (c.website || '')) change.website = $('#detail-website').value.trim();
    if ($('#detail-region')) change.region = $('#detail-region').value || null;
    await api(`/api/companies/${id}`, { method: 'POST', body: JSON.stringify(change) }); await loadCompanies(); await openDetail(id); toast('Bedrijfsgegevens opgeslagen.');
  });
  $('#exclude-company').onclick = safeAction(async () => { await api(`/api/companies/${id}`, { method: 'POST', body: JSON.stringify({ excluded: !c.excluded }) }); $('#detail-dialog').close(); await refresh(); toast(c.excluded ? 'Bedrijf opnieuw opgenomen.' : 'Bedrijf uitgesloten van selectie en export.'); });
  $('#rescan-company').onclick = safeAction(async () => { await startScan([id]); $('#detail-dialog').close(); });
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
}
async function startScan(ids) { if (filterDirty) throw new Error('Pas eerst je gewijzigde filters toe.'); await api('/api/scans', { method: 'POST', body: JSON.stringify({ ids }) }); selected.clear(); await refresh(); toast('De scan is gestart. Laat het terminalvenster van de app open staan.'); }
async function refresh() { renderSummary(await api('/api/status')); await loadCompanies(); }
document.addEventListener('click', safeAction(async event => {
  const open = event.target.closest('[data-open]');
  if (open) { if (open.dataset.open === 'settings') $('#role-input').value = settings.roles.join(', '); $(`#${open.dataset.open}-dialog`).showModal(); }
  const close = event.target.closest('[data-close]'); if (close) close.closest('dialog').close();
  const detail = event.target.closest('[data-detail]'); if (detail) { event.preventDefault(); await openDetail(detail.dataset.detail); }
  const nav = event.target.closest('[data-view]');
  if (nav) {
    view = nav.dataset.view; page = 1; selected.clear();
    $$('.nav-item[data-view]').forEach(n => n.classList.toggle('active', n === nav));
    const titles = { companies: ['Vind je volgende zakelijke contact.', 'Bedrijven', 'Kies je regio en doelgroep. Ontdek rolmailboxen op bedrijfswebsites.'], results: ['Je gevonden bedrijfscontacten.', 'Scanresultaten', 'Bekijk elke vondst met bronpagina, regio en controledatum.'], review: ['Een kleine controle maakt het verschil.', 'Ter controle', 'Vul ontbrekende websites aan en bevestig onbekende vestigingsregio’s.'], excluded: ['Uitgesloten bedrijven.', 'Uitgesloten', 'Deze bedrijven worden niet gescand of geëxporteerd. Je kunt ze opnieuw opnemen.'] };
    $('#page-title').textContent = titles[view][0]; $('#table-title').innerHTML = `${escape(titles[view][1])} <span id="match-count" class="count-pill">0</span>`; $('#page-description').textContent = titles[view][2]; await loadCompanies();
  }
  const remove = event.target.closest('[data-remove-sector]'); if (remove) { settings.sectors = settings.sectors.filter(s => s !== remove.dataset.removeSector); filterDirty = true; renderChips(); updateSelection(); }
  const option = event.target.closest('[data-sector]'); if (option) { if (!settings.sectors.includes(option.dataset.sector)) settings.sectors.push(option.dataset.sector); filterDirty = true; sectorNames.set(option.dataset.sector, option.dataset.label); $('#sector-results').hidden = true; $('#sector-search').value = ''; renderChips(); updateSelection(); }
  if (!event.target.closest('.sector-field')) $('#sector-results').hidden = true;
  if (!event.target.closest('#region-picker')) $('#region-picker').open = false;
}));
$('#region-options').addEventListener('change', () => { filterDirty = true; updateRegionLabel(); updateSelection(); });
$('#include-unknown').onchange = () => { filterDirty = true; updateSelection(); };
$('#export-link').onclick = event => { if (filterDirty) { event.preventDefault(); toast('Pas eerst je gewijzigde filters toe.', true); } };
$('#sector-search').addEventListener('input', () => { clearTimeout(window.sectorTimer); window.sectorTimer = setTimeout(safeAction(async () => {
  const q = $('#sector-search').value;
  if (!q) { $('#sector-results').hidden = true; return; }
  const rows = await api(`/api/sectors?q=${encodeURIComponent(q)}`);
  if ($('#sector-search').value !== q) return;
  $('#sector-results').innerHTML = rows.length ? rows.map(r => `<button class="sector-option" data-sector="${escape(r.code)}" data-label="${escape(r.description)}"><b>${escape(r.code)}</b><span>${escape(r.description)}</span></button>`).join('') : '<div class="sector-empty">Geen sector gevonden. Probeer een algemenere term of een NACE-code. Na import zijn alle sectoromschrijvingen beschikbaar.</div>';
  $('#sector-results').hidden = false;
}), 200); });
$('#construction-preset').onclick = () => { settings.sectors = ['41', '42', '43']; filterDirty = true; renderChips(); updateSelection(); };
$('#apply-filters').onclick = safeAction(async () => { settings = await api('/api/settings', { method: 'POST', body: JSON.stringify(inputSettings()) }); filterDirty = false; page = 1; selected.clear(); $('#region-picker').open = false; await loadCompanies(); toast('Zoekfilters opgeslagen.'); });
$('#save-settings').onclick = safeAction(async () => { const roles = $('#role-input').value.toLowerCase().split(/[,\n;]/).map(r => r.trim().replace(/@$/, '')).filter(Boolean); const saved = await api('/api/settings', { method: 'POST', body: JSON.stringify({ ...inputSettings(), roles }) }); settings = saved; filterDirty = false; $('#settings-dialog').close(); await refresh(); toast('Rolmailboxen opgeslagen.'); });
$('#company-search').addEventListener('input', () => { clearTimeout(window.searchTimer); window.searchTimer = setTimeout(safeAction(async () => { page = 1; selected.clear(); await loadCompanies(); $('#export-link').href = `/api/export?q=${encodeURIComponent($('#company-search').value)}`; }), 250); });
$('#company-rows').addEventListener('change', event => { const id = event.target.dataset.select; if (id) { event.target.checked ? selected.add(id) : selected.delete(id); updateSelection(); } });
$('#select-all').onchange = event => { selected = event.target.checked ? new Set(list.rows.filter(c => c.website && !c.excluded).map(c => c.id)) : new Set(); $$('#company-rows input[data-select]').forEach(el => { el.checked = selected.has(el.dataset.select); }); updateSelection(); };
$('#start-scan').onclick = safeAction(() => startScan([...selected]));
$('#auto-scan').onclick = safeAction(async () => {
  $('#auto-scan').disabled = true;
  try {
    settings = await api('/api/settings', { method: 'POST', body: JSON.stringify(inputSettings()) });
    filterDirty = false; page = 1; selected.clear(); $('#region-picker').open = false;
    const job = await api('/api/scans', { method: 'POST', body: JSON.stringify({ automatic: true, q: $('#company-search').value }) });
    await refresh(); toast(`Automatisch gestart: ${job.count} bedrijfswebsite(s) worden doorzocht.`);
  } finally { await refresh(); }
});
$('#previous-page').onclick = safeAction(async () => { page--; selected.clear(); await loadCompanies(); });
$('#next-page').onclick = safeAction(async () => { page++; selected.clear(); await loadCompanies(); });
$('#cancel-job').onclick = safeAction(async () => { await api(`/api/jobs/${$('#cancel-job').dataset.id}/cancel`, { method: 'POST', body: '{}' }); $('#cancel-job').disabled = true; });
function chooseFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.zip')) { toast('Kies een Full.zip-bestand.', true); return; }
  upload = file; $('#file-label').textContent = `${file.name} · ${fmt(Math.ceil(file.size / 1024 ** 2))} MB`; $('#upload-file').disabled = busy;
}
$('#zip-file').onchange = event => chooseFile(event.target.files[0]);
$('#drop-zone').ondragover = event => { event.preventDefault(); $('#drop-zone').classList.add('dragging'); };
$('#drop-zone').ondragleave = () => $('#drop-zone').classList.remove('dragging');
$('#drop-zone').ondrop = event => { event.preventDefault(); $('#drop-zone').classList.remove('dragging'); chooseFile(event.dataTransfer.files[0]); };
$('#upload-file').onclick = safeAction(async () => {
  if (!upload || busy) return;
  $('#upload-file').disabled = true; $('#upload-message').textContent = 'Bestand naar de lokale app overbrengen…';
  try {
    const response = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/zip', 'X-Vindbaar-Token': token }, body: upload });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    $('#import-dialog').close(); upload = null; $('#file-label').textContent = 'Kies je Full.zip-bestand'; $('#zip-file').value = ''; $('#upload-message').textContent = ''; await refresh();
  } finally { $('#upload-file').disabled = busy || !upload; }
});
try {
  const initial = await api('/api/bootstrap'); token = initial.token; regions = initial.regions; settings = initial.settings;
  $('#demo-label').hidden = !initial.demo; $('#demo-notice').hidden = !initial.demo;
  renderFilters(); renderSummary(initial.summary); await loadCompanies();
  const codes = await api('/api/sectors'); for (const code of codes) sectorNames.set(code.code, code.description); renderChips();
  async function poll() {
    try {
      const wasBusy = busy, priorCatalog = summary.catalog?.id;
      const next = await api('/api/status'); renderSummary(next);
      if (wasBusy || busy || priorCatalog !== next.catalog?.id) await loadCompanies();
      if (wasBusy && !busy && lastJob) {
        const completed = next.jobs.find(j => j.id === lastJob);
        if (completed) toast(completed.message, completed.status === 'failed');
        if (priorCatalog !== next.catalog?.id) { const codes = await api('/api/sectors'); for (const c of codes) sectorNames.set(c.code, c.description); renderChips(); }
      }
    } catch (error) { if (!poll.failed) toast('Verbinding met de lokale app verbroken. Controleer of deze nog draait.', true); poll.failed = true; }
    setTimeout(poll, busy ? 1200 : 5000);
  }
  setTimeout(poll, 1500);
} catch (error) { toast(error.message, true); }
