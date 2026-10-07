import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const TYPES = ['lost', 'found'];
const CATEGORIES = ['Electronics', 'Clothing', 'Keys', 'IDs/Wallets', 'Other'];
const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // Netlify Functions accept request bodies up to ~6 MB
const MAX_ITEMS = 1000;
const MAX_REPORTS_PER_HOUR = 10; // per network address
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/* ---------- Storage ----------
   items store:  "index"      -> array of PUBLIC item records (no contact info, no secrets)
                 "priv/<id>"  -> { contact, tokenHash } for each item
   photos store: "<random>.<ext>" -> image bytes
   rate store:   "<ip-hash>:<hour>" -> number of reports this hour */
const store = (name) => getStore({ name, consistency: 'strong' });

async function mutateIndex(fn) {
  const s = store('items');
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await s.getWithMetadata('index', { type: 'json' });
    const next = fn(cur ? cur.data : []);
    const res = await s.setJSON('index', next, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (res && res.modified) return next;
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 80)); // someone else wrote first: retry
  }
  throw new Error('Index is busy, please retry.');
}
const readIndex = async () => (await store('items').get('index', { type: 'json' })) || [];

/* ---------- Helpers ---------- */
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (status, error, errors) => json({ error, ...(errors ? { errors } : {}) }, status);

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const toPublic = (r) => ({
  id: r.id, type: r.type, title: r.title, description: r.description, category: r.category,
  location: r.location, date: r.date, status: r.status, createdAt: r.createdAt,
  photoUrl: r.photo ? `/api/photos/${r.photo}` : null,
});

// Detect the real image type from the file's bytes (never trust the browser's claimed type).
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

function validate(body) {
  const errors = {};
  const v = {};
  for (const k of ['type', 'title', 'description', 'category', 'location', 'date', 'contact']) v[k] = String(body[k] || '').trim();
  if (!TYPES.includes(v.type)) errors.type = 'Choose lost or found.';
  if (!v.title || v.title.length > 100) errors.title = 'Title is required (max 100 characters).';
  if (!v.description || v.description.length > 1000) errors.description = 'Description is required (max 1000 characters).';
  if (!CATEGORIES.includes(v.category)) errors.category = 'Choose a valid category.';
  if (!v.location || v.location.length > 120) errors.location = 'Location is required (max 120 characters).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || Number.isNaN(Date.parse(v.date))) errors.date = 'Enter a valid date.';
  else if (v.date > new Date(Date.now() + 14 * 3600 * 1000).toISOString().slice(0, 10)) errors.date = 'Date cannot be in the future.';
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.contact);
  const phoneOk = /^[+()\-.\s\d]{7,25}$/.test(v.contact);
  if (!v.contact || v.contact.length > 120 || !(emailOk || phoneOk)) errors.contact = 'Enter a valid email or phone number.';
  return { v, errors };
}

async function overRateLimit(ip) {
  const key = `${sha(ip || 'unknown').slice(0, 24)}:${Math.floor(Date.now() / 3600000)}`;
  const s = store('rate');
  const n = Number(await s.get(key, { type: 'json' })) || 0;
  if (n >= MAX_REPORTS_PER_HOUR) return true;
  await s.setJSON(key, n + 1);
  return false;
}

async function isAuthorized(req, id) {
  const token = req.headers.get('x-edit-token');
  if (token) {
    const priv = await store('items').get(`priv/${id}`, { type: 'json' });
    if (priv && safeEqual(sha(token), priv.tokenHash)) return true;
  }
  const admin = process.env.ADMIN_KEY;
  return Boolean(admin) && safeEqual(req.headers.get('x-admin-key'), admin);
}

/* ---------- Handlers ---------- */
async function listItems(url) {
  const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 100);
  const type = url.searchParams.get('type');
  const category = url.searchParams.get('category');
  const status = url.searchParams.get('status');
  const all = await readIndex();
  const counts = { all: all.length, lost: 0, found: 0 };
  for (const r of all) counts[r.type] += 1;
  const items = all
    .filter((r) => !TYPES.includes(type) || r.type === type)
    .filter((r) => !CATEGORIES.includes(category) || r.category === category)
    .filter((r) => !['open', 'resolved'].includes(status) || r.status === status)
    .filter((r) => !q || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1) || b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 200)
    .map(toPublic);
  return json({ items, counts });
}

async function getItem(id) {
  const rec = (await readIndex()).find((r) => r.id === id);
  if (!rec) return fail(404, 'Item not found.');
  const priv = await store('items').get(`priv/${id}`, { type: 'json' });
  return json({ item: { ...toPublic(rec), contact: priv ? priv.contact : '' } });
}

async function createItem(req, context) {
  if (!(req.headers.get('content-type') || '').includes('multipart/form-data')) return fail(400, 'Expected a form submission.');
  let form;
  try { form = await req.formData(); } catch { return fail(400, 'Could not read the upload.'); }

  const body = {};
  for (const [k, val] of form.entries()) if (typeof val === 'string') body[k] = val;
  const { v, errors } = validate(body);

  const file = form.get('photo');
  let photoBytes = null;
  let ext = null;
  if (file && typeof file === 'object' && file.size > 0) {
    if (file.size > MAX_PHOTO_BYTES) errors.photo = 'Photo is too large (max 4 MB).';
    else {
      photoBytes = await file.arrayBuffer();
      ext = sniffImage(Buffer.from(photoBytes));
      if (!ext) errors.photo = 'Photo must be a JPEG, PNG or WebP image.';
    }
  }
  if (Object.keys(errors).length) return fail(400, 'Please fix the highlighted fields.', errors);

  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || '';
  if (await overRateLimit(ip)) return fail(429, 'Too many reports from this network. Please try again later.');

  const id = crypto.randomUUID();
  const editToken = crypto.randomBytes(24).toString('hex');
  let photo = null;
  if (photoBytes) {
    photo = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    await store('photos').set(photo, photoBytes, { metadata: { contentType: MIME[ext] } });
  }
  await store('items').setJSON(`priv/${id}`, { contact: v.contact, tokenHash: sha(editToken) });
  const rec = {
    id, type: v.type, title: v.title, description: v.description, category: v.category,
    location: v.location, date: v.date, status: 'open', photo, createdAt: new Date().toISOString(),
  };
  try {
    await mutateIndex((list) => {
      if (list.length >= MAX_ITEMS) throw new Error('full');
      return [rec, ...list];
    });
  } catch (e) {
    await store('items').delete(`priv/${id}`);
    if (photo) await store('photos').delete(photo);
    return fail(503, e.message === 'full' ? 'The board is full right now. Please try again later.' : 'The service is busy. Please try again.');
  }
  // The edit token is returned once; the reporter's browser keeps it so only they can resolve/delete.
  return json({ item: { ...toPublic(rec), contact: v.contact }, editToken }, 201);
}

async function resolveItem(req, id) {
  const rec = (await readIndex()).find((r) => r.id === id);
  if (!rec) return fail(404, 'Item not found.');
  if (!(await isAuthorized(req, id))) return fail(403, 'Only the person who posted this can resolve it.');
  await mutateIndex((list) => list.map((r) => (r.id === id ? { ...r, status: 'resolved' } : r)));
  return json({ item: toPublic({ ...rec, status: 'resolved' }) });
}

async function deleteItem(req, id) {
  const rec = (await readIndex()).find((r) => r.id === id);
  if (!rec) return fail(404, 'Item not found.');
  if (!(await isAuthorized(req, id))) return fail(403, 'Not allowed.');
  await mutateIndex((list) => list.filter((r) => r.id !== id));
  await store('items').delete(`priv/${id}`);
  if (rec.photo) await store('photos').delete(rec.photo);
  return json({ ok: true });
}

async function getPhoto(name) {
  const m = /^[a-f0-9]{32}\.(jpg|png|webp)$/.exec(name);
  if (!m) return fail(404, 'Not found.');
  const r = await store('photos').getWithMetadata(name, { type: 'arrayBuffer' });
  if (!r) return fail(404, 'Not found.');
  return new Response(r.data, {
    headers: { 'content-type': MIME[m[1]], 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
  });
}

/* ---------- Router ---------- */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async (req, context) => {
  try {
    const url = new URL(req.url);
    const [root, id, action] = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
    const method = req.method;

    if (root === 'photos' && id && method === 'GET') return await getPhoto(id);
    if (root !== 'items') return fail(404, 'Not found.');

    if (!id) {
      if (method === 'GET') return await listItems(url);
      if (method === 'POST') return await createItem(req, context);
      return fail(405, 'Method not allowed.');
    }
    if (!UUID.test(id)) return fail(404, 'Item not found.');
    if (!action) {
      if (method === 'GET') return await getItem(id);
      if (method === 'DELETE') return await deleteItem(req, id);
      return fail(405, 'Method not allowed.');
    }
    if (action === 'resolve' && method === 'POST') return await resolveItem(req, id);
    return fail(404, 'Not found.');
  } catch (e) {
    console.error(e);
    return fail(500, 'Something went wrong on the server.');
  }
};

export const config = { path: ['/api/items', '/api/items/*', '/api/photos/*'] };
