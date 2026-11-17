const fields = ['location', 'remote', 'language', 'tag', 'employment_type', 'open_to', 'origin'];
const profilePrefix = 'submissions/talent/';
const apiOrigin = 'https://openjob.softprobe.ai';
const profileDays = 180;

export class InputError extends Error {}
export class RateLimitError extends Error {}
export class ConflictError extends Error {}

function objectKey(path) {
  if (typeof path !== 'string') throw new InputError('Invalid dataset path');
  // Public downloads live under /api on the site hostname, while R2 keys are
  // rooted at data/. Keep the public URL prefix out of the stored object key.
  path = path.replace(/^\/api(?=\/data\/)/, '');
  if (!path.startsWith('/data/')) throw new InputError('Invalid dataset path');
  let key;
  try { key = decodeURIComponent(path.slice('/data/'.length)); }
  catch { throw new InputError('Invalid dataset path'); }
  if (!key || key.startsWith('/') || key.includes('\\') || key.includes('\0') || key.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new InputError('Invalid dataset path');
  }
  return key;
}

async function loadAsset(env, path, includeBody = true) {
  const key = objectKey(path);
  const compressed = key.endsWith('.jsonl');
  const object = await env.DATASETS.get(compressed ? `${key}.gz` : key);
  if (!object) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  // R2 metadata describes the stored gzip bytes, not the decompressed .jsonl
  // representation. A .jsonl.gz download is also a gzip file, not an
  // HTTP-compressed response.
  headers.delete('content-encoding');
  if (compressed) {
    headers.delete('content-length');
    headers.delete('etag');
  } else {
    headers.set('etag', object.httpEtag);
  }
  const body = includeBody
    ? (compressed ? object.body.pipeThrough(new DecompressionStream('gzip')) : object.body)
    : null;
  return {key, object, headers, body};
}

async function asset(env, path) {
  const result = await loadAsset(env, path);
  if (!result) throw new Error('Dataset asset unavailable');
  return new Response(result.body, {headers: result.headers});
}

export async function serveDataAsset(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', {status: 405});
  try {
    const result = await loadAsset(env, new URL(request.url).pathname, request.method !== 'HEAD');
    if (!result) return new Response('Not found', {status: 404});
    const {key, object, headers, body} = result;
    if (key.startsWith(profilePrefix) && isExpired(object.customMetadata?.expires)) {
      await object.body?.cancel();
      return new Response('Not found', {status: 404});
    }
    headers.set('cache-control', key === 'manifest.json' ? 'public, max-age=30' : key.startsWith(profilePrefix) ? 'no-store' : 'public, max-age=31536000, immutable');
    headers.set('content-type', key.endsWith('.jsonl.gz') ? 'application/gzip' : key.endsWith('.jsonl') ? 'application/x-ndjson' : 'application/json');
    if (request.method === 'HEAD') await object.body?.cancel();
    return new Response(body, {headers});
  } catch (error) {
    if (error instanceof InputError) return new Response(error.message, {status: 400});
    return new Response('Dataset unavailable; try again later', {status: 503});
  }
}

export async function manifest(env) {
  const base = await (await asset(env, '/data/manifest.json')).json();
  const profiles = await liveProfileShards(env);
  const owner_license = 'CC BY 4.0 applies to repository posts and API-submitted profiles published with explicit consent. Indexed employer rows are not licensed.';
  if (!profiles.length) return {...base, owner_license};

  const profileRows = profiles.map(({key, object, shard}) => `${key}:${object.etag}:${shard.first_id}`).join('\n');
  const snapshot_id = await sha256Hex(new TextEncoder().encode(`${base.snapshot_id}\n${profileRows}`));
  const latestProfile = profiles.map(({object}) => object.customMetadata.created_at).sort().at(-1);
  const generated = latestProfile && latestProfile > base.generated ? latestProfile : base.generated;
  const talent = base.datasets.talent;
  return {
    ...base,
    snapshot_id,
    generated,
    owner_license,
    datasets: {
      ...base.datasets,
      talent: {
        ...talent,
        count: talent.count + profiles.length,
        shards: [...talent.shards, ...profiles.map(({shard}) => shard)].sort((left, right) => left.first_id.localeCompare(right.first_id)),
      },
    },
  };
}

export async function serveManifest(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', {status: 405});
  try {
    const current = await manifest(env);
    const headers = {'cache-control': 'public, max-age=30', 'content-type': 'application/json; charset=utf-8'};
    if (request.method === 'HEAD') return new Response(null, {headers});
    return Response.json(current, {headers});
  } catch {
    return new Response('Dataset unavailable; try again later', {status: 503});
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function renderInlineMarkdown(value) {
  const formatText = text => escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
  const links = /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;
  let result = '';
  let cursor = 0;
  let match;
  while ((match = links.exec(value))) {
    result += formatText(value.slice(cursor, match.index));
    result += `<a href="${escapeHtml(match[2])}" rel="nofollow noopener">${escapeHtml(match[1])}</a>`;
    cursor = links.lastIndex;
  }
  return result + formatText(value.slice(cursor));
}

function renderProfileMarkdown(markdown) {
  const output = [];
  const paragraph = [];
  let list = [];
  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph.length = 0;
  };
  const flushList = () => {
    if (list.length) output.push(`<ul>${list.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const line of String(markdown).split(/\r?\n/)) {
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
    } else if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return output.join('');
}

function profileExcerpt(markdown) {
  const about = String(markdown).match(/^## About\s*\n([\s\S]*?)(?=\n## |$)/im)?.[1] || markdown;
  return about.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*#>]+\s*/gm, '').replace(/[\*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export async function serveProfilePage(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', {status: 405});
  const match = new URL(request.url).pathname.match(/^\/p\/api-talent\/([0-9a-f-]{36})\/?$/i);
  if (!match) return new Response('Not found', {status: 404});
  try {
    const {record} = await get(env, 'talent', `api-talent/${match[1]}`);
    const title = escapeHtml(record.title);
    const headline = escapeHtml(record.headline);
    const location = escapeHtml(record.location);
    const availability = record.open_to.map(escapeHtml).join(', ');
    const languages = record.languages.map(escapeHtml).join(', ');
    const tags = record.tags.map(tag => `<li>${escapeHtml(tag)}</li>`).join('');
    const body = renderProfileMarkdown(record.body_markdown || '');
    const contact = [
      record.website && `<a href="${escapeHtml(record.website)}" rel="nofollow noopener">Website</a>`,
      record.linkedin && `<a href="${escapeHtml(record.linkedin)}" rel="nofollow noopener">LinkedIn</a>`,
    ].filter(Boolean).join(' · ');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — OpenJob</title><meta name="description" content="${escapeHtml(record.excerpt || headline)}"><link rel="canonical" href="${escapeHtml(record.permalink)}"><style>body{font:17px/1.6 system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 24px;color:#201f1d;background:#f8f6f0}h1{font-size:2rem;line-height:1.15}a{color:#9b2c23}.meta{color:#625d55}.profile-body{margin-top:32px}.profile-body h2{margin-top:32px}.profile-body ul{padding-left:24px}.profile-body li{margin:6px 0}.profile-body code{background:#ece8dc;padding:2px 5px;border-radius:3px}.skills{display:flex;gap:8px;flex-wrap:wrap;padding:0;list-style:none}.skills li{background:#ece8dc;padding:3px 10px;border-radius:999px}footer{margin-top:48px;border-top:1px solid #d7d0c4;padding-top:16px;color:#625d55;font-size:.9rem}</style></head><body><main><p class="meta"><a href="https://openjob.softprobe.ai">OpenJob</a> / Talent profile</p><h1>${title}</h1><p><strong>${headline}</strong></p><p class="meta">${location} · ${escapeHtml(record.remote)} · Open to ${availability}</p><p class="meta">Languages: ${languages}</p><div class="profile-body">${body}</div>${tags ? `<h2>Skills</h2><ul class="skills">${tags}</ul>` : ''}${contact ? `<h2>Links</h2><p>${contact}</p>` : ''}<footer>Public profile · Expires ${escapeHtml(record.expires)} · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></footer></main></body></html>`;
    const headers = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    };
    return new Response(request.method === 'HEAD' ? null : html, {headers});
  } catch (error) {
    if (error instanceof InputError) return new Response('Not found', {status: 404});
    return new Response('Profile temporarily unavailable', {status: 503});
  }
}

async function liveProfileShards(env) {
  const profiles = [];
  let cursor;
  do {
    const page = await env.DATASETS.list({prefix: profilePrefix, limit: 1000, include: ['customMetadata'], cursor});
    for (const object of page.objects) {
      const meta = object.customMetadata || {};
      if (!object.key.endsWith('.jsonl.gz') || !meta.path || isExpired(meta.expires)) continue;
      const jsonlKey = object.key.slice(0, -3);
      const gzipUrl = `${apiOrigin}/api/data/${object.key}`;
      const shard = {
        first_id: meta.path,
        last_id: meta.path,
        count: 1,
        url: `${apiOrigin}/api/data/${jsonlKey}`,
        bytes: Number(meta.bytes),
        sha256: meta.sha256,
        gzip: {url: gzipUrl, bytes: object.size, sha256: meta.gzip_sha256},
      };
      profiles.push({key: object.key, object, shard});
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return profiles;
}

function isExpired(value) {
  return typeof value === 'string' && value < new Date().toISOString().slice(0, 10);
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function isoDateAfter(date, days) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function profileRecord(input, id, posted, expires) {
  const path = `api-talent/${id}`;
  const permalink = `${apiOrigin}/p/${path}/`;
  const about = profileExcerpt(input.body_markdown);
  const excerpt = about ? `${about} Open to ${input.open_to.join(', ')}.` : `${input.headline}. Open to ${input.open_to.join(', ')}.`;
  return {
    kind: 'talent', path, owner: null, title: input.name, headline: input.headline, org: '', role: input.headline,
    location: input.location, remote: input.remote, languages: input.languages, tags: input.tags,
    posted, expires, federated: false, url: input.linkedin || input.website || permalink, source_url: permalink,
    profile_url: null, website: input.website || null, linkedin: input.linkedin || null, apply: null,
    apply_email: null, logo: null, careers: null, open_to: input.open_to, compensation: '', employment_type: null,
    salary: null, locations: null, excerpt, org_website: null, company_permalink: null, permalink,
    origin: 'api', body_markdown: input.body_markdown,
  };
}

async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function equalHex(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function createTalent(env, input) {
  const rate = await env.PROFILE_WRITE_LIMITER.limit({key: env.CLIENT_IP || 'unknown'});
  if (!rate.success) throw new RateLimitError('Profile write limit reached; try again later');

  const id = crypto.randomUUID().toLowerCase();
  const posted = new Date().toISOString().slice(0, 10);
  const expires = isoDateAfter(posted, profileDays);
  const record = profileRecord(input, id, posted, expires);
  const plain = new TextEncoder().encode(`${JSON.stringify(record)}\n`);
  const compressed = await gzip(plain);
  const token = randomToken();
  const digest = value => sha256Hex(value);
  const [plainHash, gzipHash, tokenHash] = await Promise.all([digest(plain), digest(compressed), digest(new TextEncoder().encode(token))]);
  const key = `${profilePrefix}${id}.jsonl.gz`;
  const stored = await env.DATASETS.put(key, compressed, {
    httpMetadata: {contentType: 'application/gzip'},
    customMetadata: {
      path: record.path,
      expires,
      created_at: new Date().toISOString(),
      bytes: String(plain.byteLength),
      sha256: plainHash,
      gzip_sha256: gzipHash,
      delete_token_hash: tokenHash,
    },
    onlyIf: {etagDoesNotMatch: '*'},
  });
  if (!stored) throw new ConflictError('Could not create profile record; retry once');
  return {record, delete_token: token};
}

export async function deleteTalent(env, {id, delete_token}) {
  const profileId = id.slice('api-talent/'.length);
  const key = `${profilePrefix}${profileId}.jsonl.gz`;
  const object = await env.DATASETS.head(key);
  if (!object) return {deleted: true, id};
  const expected = object.customMetadata?.delete_token_hash;
  const supplied = await sha256Hex(new TextEncoder().encode(delete_token));
  if (!equalHex(expected, supplied)) throw new InputError('Profile not found or delete token is invalid');
  await env.DATASETS.delete(key);
  return {deleted: true, id};
}

export async function purgeExpiredTalent(env) {
  let cursor;
  let removed = 0;
  do {
    const page = await env.DATASETS.list({prefix: profilePrefix, limit: 1000, include: ['customMetadata'], cursor});
    const expired = page.objects.filter(object => object.key.endsWith('.jsonl.gz') && isExpired(object.customMetadata?.expires));
    for (const object of expired) {
      await env.DATASETS.delete(object.key);
      removed++;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return removed;
}

function dataset(m, kind) {
  if (!['jobs', 'talent'].includes(kind)) throw new InputError('kind must be jobs or talent');
  return m.datasets[kind];
}

export async function getDataset(env, kind) {
  const m = await manifest(env);
  return {schema_version: m.schema_version, snapshot_id: m.snapshot_id, generated: m.generated,
    indexed_notice: m.indexed_notice, owner_license: m.owner_license, kind, ...dataset(m, kind)};
}

async function* records(env, shard) {
  const path = new URL(shard.url).pathname;
  const response = await asset(env, path);
  if (!response.body) throw new Error('Dataset shard is empty');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      pending += value;
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (line) yield JSON.parse(line);
      }
    }
    if (pending) yield JSON.parse(pending);
  } finally { await reader.cancel(); }
}

function match(record, options) {
  const q = (options.text || '').toLowerCase();
  const haystack = ['title', 'headline', 'org', 'location', 'department', 'tags', 'excerpt', 'body_markdown']
    .flatMap(key => record[key] || []).join(' ').toLowerCase();
  if (q && !haystack.includes(q)) return false;
  for (const key of fields) {
    const value = options[key];
    if (!value) continue;
    if (key === 'location') { if (!(record.location || '').toLowerCase().includes(value.toLowerCase())) return false; }
    else if (key === 'language') { if (!(record.languages || []).includes(value)) return false; }
    else if (key === 'tag') { if (!(record.tags || []).includes(value)) return false; }
    else if (Array.isArray(record[key])) { if (!record[key].includes(value)) return false; }
    else if ((record[key] || '') !== value) return false;
  }
  return true;
}

function filters(options) {
  return Object.fromEntries(['text', ...fields].filter(k => options[k]).map(k => [k, options[k]]));
}
function encode(value) { return btoa(unescape(encodeURIComponent(JSON.stringify(value)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function decode(value) {
  try { return JSON.parse(decodeURIComponent(escape(atob(value.replaceAll('-', '+').replaceAll('_', '/'))))); }
  catch { throw new InputError('Invalid cursor; restart the listing'); }
}
export async function list(env, kind, options = {}) {
  const m = await manifest(env), ds = dataset(m, kind);
  const limit = Number(options.limit ?? 25);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new InputError('limit must be between 1 and 100');
  const rules = filters(options);
  let after = '';
  if (options.cursor) {
    const cursor = decode(options.cursor);
    if (cursor.snapshot !== m.snapshot_id) throw new InputError('Snapshot changed; restart listing without a cursor');
    if (cursor.kind !== kind || JSON.stringify(cursor.filters) !== JSON.stringify(rules) || typeof cursor.after !== 'string') throw new InputError('Cursor does not match filters; restart listing');
    after = cursor.after;
  }
  const items = [];
  for (const shard of ds.shards) {
    if (after && shard.last_id <= after) continue;
    for await (const record of records(env, shard)) {
      if (record.path <= after || !match(record, rules)) continue;
      if (items.length === limit) {
        return {snapshot_id: m.snapshot_id, items, next_cursor: encode({snapshot: m.snapshot_id, kind, filters: rules, after: items.at(-1).path})};
      }
      const {body_markdown, ...summary} = record;
      items.push(summary);
    }
  }
  return {snapshot_id: m.snapshot_id, items, next_cursor: null};
}

export async function get(env, kind, id) {
  if (!id || typeof id !== 'string') throw new InputError('id is required');
  if (/^https:\/\//i.test(id)) {
    try {
      const url = new URL(id);
      if (url.hostname !== 'openjob.softprobe.ai') throw new InputError('Record URL must be on openjob.softprobe.ai');
      const apiProfilePage = url.pathname.match(/^\/p\/api-talent\/([0-9a-f-]{36})\/?$/i);
      if (url.searchParams.has('id')) id = url.searchParams.get('id');
      else if (apiProfilePage) id = `api-talent/${apiProfilePage[1]}`;
      else if (url.pathname.includes('/p/')) id = url.pathname.split('/p/')[1].split(/[?#]/)[0].replace(/\/$/, '') + '.md';
      else throw new InputError('Record URL is not an OpenJob permalink');
    } catch (error) {
      if (error instanceof InputError) throw error;
      throw new InputError('Record URL is invalid');
    }
  }
  if (id.includes('/p/')) id = id.split('/p/')[1].split(/[?#]/)[0].replace(/\/$/, '') + '.md';
  const login = kind === 'talent' && !id.includes('/');
  if (login) id = `talents/${id}.md`;
  const m = await manifest(env), ds = dataset(m, kind);
  const shards = login ? ds.shards : ds.shards.filter(s => s.first_id <= id && s.last_id >= id);
  for (const shard of shards) for await (const record of records(env, shard)) {
    if (login ? record.path.toLowerCase() === id.toLowerCase() : record.path === id) return {snapshot_id: m.snapshot_id, record};
  }
  throw new InputError('Record not found');
}
