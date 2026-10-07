'use strict';
const CATEGORIES = ['Electronics', 'Clothing', 'Keys', 'IDs/Wallets', 'Other'];
const ICONS = { Electronics: '💻', Clothing: '👕', Keys: '🔑', 'IDs/Wallets': '🪪', Other: '📦' };
const TOKEN_KEY = 'lf_edit_tokens';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

const state = { items: [], counts: { all: 0, lost: 0, found: 0 }, tab: 'all', cat: 'All', q: '', loading: true, error: '' };

/* Edit tokens: proof that this browser posted an item (lets the reporter resolve/delete it). */
const tokens = (() => { try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}'); } catch { return {}; } })();
const saveToken = (id, t) => { tokens[id] = t; try { localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens)); } catch {} };
const dropToken = (id) => { delete tokens[id]; try { localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens)); } catch {} };

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Request failed'); e.fields = data.errors; throw e; }
  return data;
}

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3000);
}

/* ---------- Load + render ---------- */
let reqId = 0;
async function load() {
  const my = ++reqId;
  const p = new URLSearchParams();
  if (state.tab !== 'all') p.set('type', state.tab);
  if (state.cat !== 'All') p.set('category', state.cat);
  if (state.q.trim()) p.set('q', state.q.trim());
  state.loading = true; state.error = ''; renderStatus();
  try {
    const data = await api('/api/items?' + p);
    if (my !== reqId) return; // a newer request superseded this one
    state.items = data.items; state.counts = data.counts;
  } catch (e) { if (my !== reqId) return; state.error = 'Could not load items. Check your connection and try again.'; }
  state.loading = false;
  render();
}

function renderStatus() { $('#status').textContent = state.loading ? 'Loading…' : state.error; }

function renderFilters() {
  const tabs = [['all', 'All Items'], ['lost', 'Lost Items'], ['found', 'Found Items']];
  $('#tabs').innerHTML = tabs.map(([k, l]) =>
    `<button class="tab" role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${l}<small>${state.counts[k] ?? 0}</small></button>`).join('');
  $('#pills').innerHTML = ['All', ...CATEGORIES].map((c) =>
    `<button class="pill" data-cat="${esc(c)}" aria-pressed="${state.cat === c}">${esc(c)}</button>`).join('');
}

function cardHTML(i) {
  const resolved = i.status === 'resolved';
  const thumb = i.photoUrl ? `<img src="${esc(i.photoUrl)}" alt="Photo of ${esc(i.title)}" loading="lazy">` : `<span aria-hidden="true">${ICONS[i.category] || '📦'}</span>`;
  return `<article class="card ${i.type} ${resolved ? 'resolved' : ''}">
    <div class="bar-top"></div>
    <div class="thumb">${thumb}</div>
    <div class="card-body">
      <div class="row"><span class="badge ${i.type}">${i.type === 'lost' ? 'LOST' : 'FOUND'}</span>${resolved ? '<span class="badge res">✓ Resolved</span>' : ''}</div>
      <h3>${esc(i.title)}</h3>
      <span class="chip">${esc(i.category)}</span>
      <p class="desc">${esc(i.description)}</p>
      <div class="meta"><span>📍 ${esc(i.location)}</span><span>📅 ${fmtDate(i.date)}</span></div>
      <button class="btn" data-open="${esc(i.id)}">View Details</button>
    </div>
  </article>`;
}

function render() {
  renderFilters(); renderStatus();
  const grid = $('#grid');
  if (state.error) { grid.innerHTML = ''; return; }
  if (!state.items.length) {
    const filtered = state.q || state.tab !== 'all' || state.cat !== 'All';
    grid.innerHTML = `<div class="empty"><div class="big" aria-hidden="true">🔍</div>
      <h2>${filtered ? 'No items found' : 'Nothing reported yet'}</h2>
      <p>${filtered ? 'Nothing matches your current search or filters. Try different keywords, or report the item yourself.' : 'Be the first to report a lost or found item on campus.'}</p>
      <div class="btns">${filtered ? '<button class="btn" id="clear">Clear filters</button>' : ''}<button class="btn primary" data-report>Report an Item</button></div></div>`;
    return;
  }
  grid.innerHTML = state.items.map(cardHTML).join('');
}

/* ---------- Details ---------- */
const detailDlg = $('#detail-dialog');
async function openDetails(id) {
  try {
    const { item } = await api('/api/items/' + encodeURIComponent(id));
    const mine = !!tokens[item.id];
    const contact = item.contact.includes('@') ? `<a href="mailto:${esc(item.contact)}">${esc(item.contact)}</a>` : esc(item.contact);
    $('#detail-body').innerHTML = `
      <div class="sheet-head"><div class="row"><span class="badge ${item.type}">${item.type === 'lost' ? 'LOST' : 'FOUND'}</span>${item.status === 'resolved' ? '<span class="badge res">✓ Resolved</span>' : ''}</div>
        <button class="icon-btn" data-close aria-label="Close">✕</button></div>
      ${item.photoUrl ? `<img class="detail-photo" src="${esc(item.photoUrl)}" alt="Photo of ${esc(item.title)}">` : ''}
      <div class="sheet-body detail-body">
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.description)}</p>
        <div class="detail-info">
          <div><b>Category</b>${esc(item.category)}</div>
          <div><b>Location</b>${esc(item.location)}</div>
          <div><b>${item.type === 'lost' ? 'Date lost' : 'Date found'}</b>${fmtDate(item.date)}</div>
          <div><b>Contact</b>${contact}</div>
        </div>
        ${!mine && item.status === 'open' ? '<p class="note">Only the person who posted this item can mark it as resolved.</p>' : ''}
      </div>
      <div class="sheet-foot">
        <button class="btn" data-close>Close</button>
        ${mine && item.status === 'open' ? `<button class="btn good" data-resolve="${esc(item.id)}">✓ Mark as Resolved</button>` : ''}
        ${mine ? `<button class="btn danger" data-delete="${esc(item.id)}">Delete</button>` : ''}
      </div>`;
    detailDlg.showModal();
  } catch (e) { toast(e.message); }
}

async function manage(id, action) {
  if (action === 'delete' && !confirm('Delete this report permanently?')) return;
  try {
    await api(`/api/items/${encodeURIComponent(id)}` + (action === 'resolve' ? '/resolve' : ''), {
      method: action === 'resolve' ? 'POST' : 'DELETE', headers: { 'x-edit-token': tokens[id] || '' },
    });
    if (action === 'delete') dropToken(id);
    detailDlg.close(); toast(action === 'resolve' ? 'Marked as resolved' : 'Report deleted'); load();
  } catch (e) { toast(e.message); }
}

/* ---------- Report form ---------- */
const reportDlg = $('#report-dialog');
const form = $('#report-form');
const photoInput = $('#photo-input');
let photoFile = null;

$('#category-select').innerHTML = CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

function resetForm() {
  form.reset(); photoFile = null;
  $('#date-input').value = todayISO(); $('#date-input').max = todayISO();
  $('#preview').hidden = true; $('#drop-text').hidden = false;
  clearErrors();
}
function clearErrors() {
  $('#form-error').hidden = true;
  form.querySelectorAll('[data-err]').forEach((el) => (el.textContent = ''));
  form.querySelectorAll('.bad').forEach((el) => el.classList.remove('bad'));
}
function showErrors(fields, general) {
  clearErrors();
  for (const [k, msg] of Object.entries(fields || {})) {
    const el = form.querySelector(`[data-err="${k}"]`);
    if (el) { el.textContent = msg; el.closest('.field')?.classList.add('bad'); }
  }
  if (general) { const box = $('#form-error'); box.textContent = general; box.hidden = false; }
}

// Re-encode every photo as a max-1600px JPEG before upload: keeps it far under the 4 MB limit and strips EXIF/location data.
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

photoInput.addEventListener('change', async () => {
  const f = photoInput.files[0];
  const errEl = form.querySelector('[data-err="photo"]');
  errEl.textContent = '';
  if (!f) return;
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { errEl.textContent = 'Photo must be a JPEG, PNG or WebP image.'; photoInput.value = ''; return; }
  photoFile = await shrink(f);
  if (photoFile.size > 4 * 1024 * 1024) { errEl.textContent = 'Photo is too large (max 4 MB).'; photoFile = null; photoInput.value = ''; return; }
  const prev = $('#preview');
  if (prev.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
  prev.src = URL.createObjectURL(photoFile); prev.hidden = false; $('#drop-text').hidden = true;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const required = ['title', 'description', 'location', 'date', 'contact'];
  const missing = {};
  required.forEach((k) => { if (!String(fd.get(k) || '').trim()) missing[k] = 'This field is required.'; });
  if (Object.keys(missing).length) return showErrors(missing, 'Please fill in the required fields.');
  if (photoFile) fd.set('photo', photoFile, photoFile.name);
  const btn = $('#submit-btn'); btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const { item, editToken } = await api('/api/items', { method: 'POST', body: fd });
    saveToken(item.id, editToken);
    reportDlg.close(); toast('Report submitted'); load();
  } catch (err) { showErrors(err.fields, err.message); }
  finally { btn.disabled = false; btn.textContent = 'Submit report'; }
});

function openReport() { resetForm(); reportDlg.showModal(); }

/* ---------- Events ---------- */
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('#open-report, [data-report]')) return openReport();
  const tab = t.closest('[data-tab]'); if (tab) { state.tab = tab.dataset.tab; return load(); }
  const cat = t.closest('[data-cat]'); if (cat) { state.cat = cat.dataset.cat; return load(); }
  const open = t.closest('[data-open]'); if (open) return openDetails(open.dataset.open);
  const res = t.closest('[data-resolve]'); if (res) return manage(res.dataset.resolve, 'resolve');
  const del = t.closest('[data-delete]'); if (del) return manage(del.dataset.delete, 'delete');
  if (t.closest('#clear')) { state.tab = 'all'; state.cat = 'All'; state.q = ''; $('#search').value = ''; return load(); }
  if (t.closest('[data-close]')) return t.closest('dialog').close();
  if (t.tagName === 'DIALOG') t.close(); // click on backdrop
});

let debounce;
$('#search').addEventListener('input', (e) => { state.q = e.target.value; clearTimeout(debounce); debounce = setTimeout(load, 250); });

load();
