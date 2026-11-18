import assert from 'node:assert/strict';
import test from 'node:test';
import {gzipSync, gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {default as worker} from '../src/index.js';
import {openApiDocument, operations, resources} from '../src/contracts.js';

function r2Object(bytes, key, customMetadata = {}) {
  return {
    body: new ReadableStream({start(controller) { controller.enqueue(bytes); controller.close(); }}),
    httpEtag: `etag-${key}`,
    etag: `etag-${key}`,
    size: bytes.byteLength,
    customMetadata,
    writeHttpMetadata(headers) { headers.set('content-type', key.endsWith('.gz') ? 'application/gzip' : 'application/json'); },
  };
}

function setup() {
  const jobA = {path:'jobs/2026/11/acme-backend.md',kind:'job',title:'Backend engineer',org:'Acme',role:'Backend engineer',location:'Remote',remote:'remote',languages:['en'],tags:['backend'],posted:'2026-11-16',expires:null,origin:'owner',source_url:'https://example.com/jobs/backend',apply:'https://example.com/jobs/backend',body_markdown:'Build the service.'};
  const jobB = {...jobA,path:'jobs/2026/11/acme-platform.md',title:'Platform engineer',role:'Platform engineer',tags:['platform']};
  const talent = {path:'talents/ada.md',kind:'talent',title:'Ada Lovelace',headline:'Backend engineer',location:'London',remote:'remote',languages:['en'],tags:['backend'],open_to:['full-time'],posted:'2026-11-16',origin:'owner',source_url:'https://github.com/softprobe/openjob/blob/main/talents/ada.md',body_markdown:'Ada builds backend systems.'};
  const plainJobs = `${JSON.stringify(jobA)}\n${JSON.stringify(jobB)}\n`;
  const plainTalent = `${JSON.stringify(talent)}\n`;
  const manifest = {
    schema_version:'1',snapshot_id:'snapshot-one',generated:'2026-11-16T00:00:00Z',source:'https://github.com/softprobe/openjob',
    indexed_notice:'Indexed rows are employer facts.',owner_license:'CC BY 4.0',
    datasets:{
      jobs:{complete:true,count:2,schema_url:'https://openjob.softprobe.ai/api/data/snapshots/snapshot-one/record.schema.json',shards:[{first_id:jobA.path,last_id:jobB.path,count:2,url:'https://openjob.softprobe.ai/api/data/snapshots/snapshot-one/jobs-test.jsonl',bytes:1,sha256:'abc',gzip:{url:'https://openjob.softprobe.ai/api/data/snapshots/snapshot-one/jobs-test.jsonl.gz',bytes:1,sha256:'def'}}]},
      talent:{complete:true,count:1,schema_url:'https://openjob.softprobe.ai/api/data/snapshots/snapshot-one/record.schema.json',shards:[{first_id:talent.path,last_id:talent.path,count:1,url:'https://openjob.softprobe.ai/api/data/snapshots/snapshot-one/talent-test.jsonl',bytes:1,sha256:'ghi',gzip:{url:'https://openjob.softprobe.ai/api/data/snapshots/snapshot-one/talent-test.jsonl.gz',bytes:1,sha256:'jkl'}}]},
    },
  };
  const objects = new Map([
    ['manifest.json', Buffer.from(JSON.stringify(manifest))],
    ['snapshots/snapshot-one/jobs-test.jsonl.gz', gzipSync(Buffer.from(plainJobs))],
    ['snapshots/snapshot-one/talent-test.jsonl.gz', gzipSync(Buffer.from(plainTalent))],
    ['snapshots/snapshot-one/record.schema.json', Buffer.from('{"type":"object"}')],
  ]);
  const metadata = new Map();
  const bucket = {
    get: async key => objects.has(key) ? r2Object(objects.get(key), key, metadata.get(key)) : null,
    list: async ({prefix = ''}) => ({objects: [...objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, bytes]) => ({key, size: bytes.byteLength, etag: `etag-${key}`, customMetadata: metadata.get(key)})), truncated: false}),
    put: async (key, bytes, options = {}) => {
      if (options.onlyIf?.etagDoesNotMatch === '*' && objects.has(key)) return null;
      objects.set(key, Buffer.from(bytes));
      metadata.set(key, options.customMetadata);
      return {etag: `etag-${key}`};
    },
    head: async key => objects.has(key) ? r2Object(objects.get(key), key, metadata.get(key)) : null,
    delete: async key => { objects.delete(key); metadata.delete(key); },
  };
  const env = {
    DATASETS: bucket,
    PROFILE_WRITE_LIMITER: {limit: async () => ({success: true})},
  };
  return {env, manifest, objects, metadata, jobA, jobB, talent, plainJobs};
}

async function http(env, path, method='GET', init={}) {
  return worker.fetch(new Request(`https://openjob.softprobe.ai${path}`, {method, ...init}), env, {});
}

test('one registry drives OpenAPI, HTTP, and all seven remote MCP tools', async () => {
  const {env, manifest, objects, jobA, talent} = setup();
  const expected = ['get_dataset','list_jobs','get_job','list_talent','get_talent','create_talent','delete_talent'];
  assert.deepEqual(operations.map(operation => operation.name), expected);
  assert.equal(openApiDocument.openapi, '3.1.0');
  for (const operation of operations) {
    const apiOperation = openApiDocument.paths[operation.path]?.[operation.method];
    assert.ok(apiOperation, `${operation.name} is described`);
    assert.equal(apiOperation.operationId, operation.name);
    assert.equal(apiOperation.description, operation.description);
    assert.ok(apiOperation.responses[String(operation.successStatus || 200)]);
    assert.ok(apiOperation.responses['400']);
    assert.ok(apiOperation.responses['405']);
    assert.ok(apiOperation.responses['503']);
  }
  assert.ok(openApiDocument.paths[resources.manifest.path]?.get);
  assert.ok(openApiDocument.paths[resources.health.path]?.get);
  assert.ok(openApiDocument.paths[resources.shards.path]?.get);
  assert.ok(openApiDocument.paths[resources.profilePage.path]?.get);
  const limit = openApiDocument.paths['/api/v1/jobs'].get.parameters.find(parameter => parameter.name === 'limit');
  assert.equal(limit.in, 'query');
  assert.equal(limit.schema.minimum, 1);
  assert.equal(limit.schema.maximum, 100);
  assert.ok(openApiDocument.paths['/api/v1/talent'].post.requestBody);
  const createSchema = openApiDocument.paths['/api/v1/talent'].post.requestBody.content['application/json'].schema;
  assert.equal(createSchema.type, 'object');
  assert.equal(createSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(createSchema.properties).sort(), Object.keys(operations.find(item => item.name === 'create_talent').input.shape).sort());
  assert.deepEqual(createSchema.required, ['name','headline','location','remote','languages','tags','open_to','body_markdown','consent_to_publish']);
  assert.equal('github' in createSchema.properties, false);
  assert.equal('email' in createSchema.properties, false);
  assert.equal(openApiDocument.paths['/api/v1/talent'].post.responses['201'].content['application/json'].schema.type, 'object');
  assert.ok(openApiDocument.paths['/api/v1/talent/delete'].post);
  assert.deepEqual(await (await http(env, '/api/openapi.json')).json(), openApiDocument);
  assert.equal((await http(env, '/api/openapi.json')).headers.get('content-type'), 'application/vnd.oai.openapi+json;version=3.1.0');

  const authorizationHeaders = [];
  const localFetch = async (input, init) => {
    const request = new Request(input, init);
    authorizationHeaders.push(request.headers.get('authorization'));
    return worker.fetch(request, env, {});
  };
  const clientTransport = new StreamableHTTPClientTransport(
    new URL('https://openjob.softprobe.ai/api/mcp'),
    {fetch: localFetch},
  );
  const client = new Client({name:'openjob-contract-test', version:'1.0.0'});
  await client.connect(clientTransport);
  try {
    const listedTools = await client.listTools();
    assert.deepEqual(listedTools.tools.map(tool => tool.name), expected);
    for (const tool of listedTools.tools) {
      const operation = operations.find(item => item.name === tool.name);
      assert.equal(tool.description, operation.description);
      assert.equal(tool.annotations.readOnlyHint, operation.annotations.readOnlyHint);
      assert.equal(tool.annotations.destructiveHint, operation.annotations.destructiveHint);
      assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), Object.keys(operation.input.shape).sort());
      if (tool.name === 'create_talent') {
        assert.equal(tool.inputSchema.additionalProperties, false);
        assert.deepEqual(tool.inputSchema.required, createSchema.required);
        assert.equal('github' in tool.inputSchema.properties, false);
      }
    }

    const cases = [
      {name:'get_dataset', args:{kind:'jobs'}, path:'/api/v1/datasets?kind=jobs'},
      {name:'list_jobs', args:{limit:1}, path:'/api/v1/jobs?limit=1'},
      {name:'get_job', args:{id:jobA.path}, path:`/api/v1/job?id=${encodeURIComponent(jobA.path)}`},
      {name:'list_talent', args:{text:'backend'}, path:'/api/v1/talent?text=backend'},
      {name:'get_talent', args:{id:'ada'}, path:'/api/v1/profile?id=ada'},
    ];
    for (const item of cases) {
      const mcpResult = await client.callTool({name:item.name, arguments:item.args});
      assert.ok(!mcpResult.isError, `${item.name}: ${JSON.stringify(mcpResult)}`);
      const response = await http(env, item.path);
      assert.equal(response.status, 200, item.name);
      assert.deepEqual(mcpResult.structuredContent, await response.json(), item.name);
    }
    const profile = await client.callTool({name:'get_talent', arguments:{id:'ada'}});
    assert.equal(profile.structuredContent.record.path, talent.path);

    const invalidInput = await client.callTool({name:'list_jobs', arguments:{limit:0}});
    assert.ok(invalidInput.isError);
    const firstPage = await client.callTool({name:'list_jobs', arguments:{limit:1}});
    assert.ok(firstPage.structuredContent.next_cursor);
    manifest.snapshot_id = 'snapshot-two';
    objects.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
    const staleCursor = await client.callTool({name:'list_jobs',arguments:{limit:1,cursor:firstPage.structuredContent.next_cursor}});
    assert.ok(staleCursor.isError);
  } finally { await client.close(); }
  assert.ok(authorizationHeaders.length > 0);
  assert.ok(authorizationHeaders.every(value => value === null), 'MCP works without an authorization header');
});

test('HTTP validation, stale cursors, health, and complete dataset downloads are anonymous', async () => {
  const {env, manifest, objects, plainJobs} = setup();
  const invalidLimit = await http(env, '/api/v1/jobs?limit=0');
  assert.equal(invalidLimit.status, 400);
  assert.match((await invalidLimit.json()).error, /limit/);
  assert.equal((await http(env, '/api/v1/job')).status, 400);
  assert.equal((await http(env, '/api/v1/job?id=jobs%2Fmissing.md')).status, 400);
  assert.equal((await http(env, '/api/v1/datasets?kind=other')).status, 400);

  const first = await (await http(env, '/api/v1/jobs?limit=1')).json();
  assert.ok(first.next_cursor);
  const stale = await http(env, `/api/v1/jobs?limit=1&cursor=${encodeURIComponent(first.next_cursor)}`);
  assert.equal(stale.status, 200);
  const changed = JSON.parse(objects.get('manifest.json').toString());
  changed.snapshot_id = 'snapshot-two';
  objects.set('manifest.json', Buffer.from(JSON.stringify(changed)));
  const staleAfterSnapshotChange = await http(env, `/api/v1/jobs?limit=1&cursor=${encodeURIComponent(first.next_cursor)}`);
  assert.equal(staleAfterSnapshotChange.status, 400);
  assert.match((await staleAfterSnapshotChange.json()).error, /Snapshot changed/);

  objects.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
  const manifestResponse = await http(env, '/api/data/manifest.json');
  assert.equal(manifestResponse.status, 200);
  const completeManifest = await manifestResponse.json();
  assert.deepEqual(completeManifest, {...manifest, owner_license: 'CC BY 4.0 applies to repository posts and API-submitted profiles published with explicit consent. Indexed employer rows are not licensed.'});
  const shardUrl = new URL(manifest.datasets.jobs.shards[0].url);
  const shardResponse = await worker.fetch(new Request(shardUrl), env, {});
  assert.equal(shardResponse.status, 200);
  assert.equal(await shardResponse.text(), plainJobs);
  const gzipUrl = new URL(manifest.datasets.jobs.shards[0].gzip.url);
  const gzipResponse = await worker.fetch(new Request(gzipUrl), env, {});
  assert.equal(gzipResponse.status, 200);
  assert.equal(Buffer.from(await gzipResponse.arrayBuffer()).toString('base64'), objects.get('snapshots/snapshot-one/jobs-test.jsonl.gz').toString('base64'));
  const schemaResponse = await worker.fetch(new Request(manifest.datasets.jobs.schema_url), env, {});
  assert.equal(schemaResponse.status, 200);
  assert.deepEqual(await schemaResponse.json(), {type:'object'});

  const healthResponse = await http(env, '/api/health');
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), {snapshot_id:manifest.snapshot_id,generated:manifest.generated});
});

test('anonymous talent writes share one HTTP and remote MCP contract and appear in complete downloads', async () => {
  const {env, manifest, objects} = setup();
  const profile = {
    name: 'Morgan <script>alert(1)</script>',
    headline: 'Backend engineer focused on distributed systems',
    location: 'Toronto',
    remote: 'remote',
    languages: ['en'],
    tags: ['backend', 'distributed-systems'],
    open_to: ['full-time'],
    body_markdown: '## About\n\nMorgan is a backend engineer.\n\n## Experience\n\n- Built distributed systems.',
    website: 'https://morgan.example',
    consent_to_publish: true,
  };
  const created = await http(env, '/api/v1/talent', 'POST', {
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(profile),
  });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  const createdBody = await created.json();
  assert.equal(createdBody.record.origin, 'api');
  assert.equal(createdBody.record.owner, null);
  assert.equal(createdBody.record.kind, 'talent');
  assert.ok(createdBody.record.permalink);
  assert.equal('share_text' in createdBody.record, false);
  assert.equal('shares' in createdBody.record, false);
  assert.match(createdBody.delete_token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(JSON.stringify(createdBody.record).includes(createdBody.delete_token), false);
  const publicPage = await worker.fetch(new Request(createdBody.record.permalink), env, {});
  assert.equal(publicPage.status, 200);
  assert.match(publicPage.headers.get('content-type'), /^text\/html/);
  assert.equal(publicPage.headers.get('cache-control'), 'no-store');
  const publicHtml = await publicPage.text();
  assert.equal(publicHtml.includes('<script>'), false);
  assert.ok(publicHtml.includes('&lt;script&gt;'));

  const listed = await (await http(env, '/api/v1/talent?text=distributed-systems')).json();
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].path, createdBody.record.path);
  const {body_markdown: _unused, ...summary} = createdBody.record;
  assert.deepEqual(listed.items[0], summary);
  const detail = await (await http(env, `/api/v1/profile?id=${encodeURIComponent(createdBody.record.permalink)}`)).json();
  assert.equal(detail.record.path, createdBody.record.path);
  const liveManifest = await (await http(env, '/api/data/manifest.json')).json();
  assert.equal(liveManifest.datasets.talent.count, manifest.datasets.talent.count + 1);
  const addedShard = liveManifest.datasets.talent.shards.find(shard => shard.first_id === createdBody.record.path);
  assert.ok(addedShard);
  const downloadedShard = await http(env, new URL(addedShard.url).pathname);
  const plainShard = Buffer.from(await downloadedShard.arrayBuffer());
  const downloadedRecord = JSON.parse(plainShard.toString().trim());
  assert.deepEqual(downloadedRecord, createdBody.record);
  assert.deepEqual(detail.record, downloadedRecord);
  assert.equal(addedShard.bytes, plainShard.byteLength);
  assert.equal(addedShard.sha256, createHash('sha256').update(plainShard).digest('hex'));
  const gzipShard = await http(env, new URL(addedShard.gzip.url).pathname);
  const compressedShard = Buffer.from(await gzipShard.arrayBuffer());
  assert.deepEqual(gunzipSync(compressedShard), plainShard);
  assert.equal(addedShard.gzip.bytes, compressedShard.byteLength);
  assert.equal(addedShard.gzip.sha256, createHash('sha256').update(compressedShard).digest('hex'));

  const deniedConsent = await http(env, '/api/v1/talent', 'POST', {
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({...profile, consent_to_publish: false}),
  });
  assert.equal(deniedConsent.status, 400);
  const deniedGithub = await http(env, '/api/v1/talent', 'POST', {
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({...profile, github: 'morganlee'}),
  });
  assert.equal(deniedGithub.status, 400);
  for (const privateName of ['Morgan morgan@example.com', 'Morgan Lee +1 (415) 555-0100']) {
    const deniedPrivateInfo = await http(env, '/api/v1/talent', 'POST', {
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({...profile, name: privateName}),
    });
    assert.equal(deniedPrivateInfo.status, 400);
  }
  assert.equal((await http(env, '/api/v1/talent', 'POST', {body: JSON.stringify(profile)})).status, 415);
  assert.equal((await http(env, '/api/v1/talent', 'POST', {
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({large: 'x'.repeat(17 * 1024)}),
  })).status, 413);
  assert.equal((await http(env, '/api/v1/jobs', 'POST')).status, 405);

  const client = new Client({name:'openjob-write-contract-test', version:'1.0.0'});
  await client.connect(new StreamableHTTPClientTransport(
    new URL('https://openjob.softprobe.ai/api/mcp'),
    {fetch: async (input, init) => worker.fetch(new Request(input, init), env, {})},
  ));
  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some(tool => tool.name === 'create_talent' && tool.annotations.readOnlyHint === false));
    assert.ok(tools.tools.some(tool => tool.name === 'delete_talent' && tool.annotations.destructiveHint === true));
    const mcpCreated = await client.callTool({name:'create_talent', arguments: profile});
    assert.ok(!mcpCreated.isError, JSON.stringify(mcpCreated));
    const mcpProfile = mcpCreated.structuredContent;
    assert.equal(mcpProfile.record.origin, 'api');
    const invalidMcpProfile = await client.callTool({name:'create_talent', arguments:{...profile, github:'morganlee'}});
    assert.ok(invalidMcpProfile.isError);
    const httpDetail = await (await http(env, `/api/v1/profile?id=${encodeURIComponent(mcpProfile.record.path)}`)).json();
    assert.deepEqual(httpDetail.record, mcpProfile.record);
    const mcpDeleted = await client.callTool({name:'delete_talent', arguments:{id:mcpProfile.record.path, delete_token:mcpProfile.delete_token}});
    assert.ok(!mcpDeleted.isError, JSON.stringify(mcpDeleted));
    assert.equal(mcpDeleted.structuredContent.deleted, true);
    assert.equal((await http(env, `/api/v1/profile?id=${encodeURIComponent(mcpProfile.record.path)}`)).status, 400);
  } finally { await client.close(); }

  const deleted = await http(env, '/api/v1/talent/delete', 'POST', {
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({id: createdBody.record.path, delete_token: createdBody.delete_token}),
  });
  assert.deepEqual(await deleted.json(), {deleted:true, id:createdBody.record.path});
  assert.equal((await http(env, '/api/v1/talent?text=distributed-systems')).status, 200);
  assert.deepEqual(JSON.parse(objects.get('manifest.json').toString()), manifest, 'repository snapshot is unchanged by API writes');

  env.PROFILE_WRITE_LIMITER = {limit: async () => ({success: false})};
  const limited = await http(env, '/api/v1/talent', 'POST', {
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(profile),
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
});

test('expired API profiles leave public manifests and are removed by the daily Worker task', async () => {
  const {env, metadata, objects} = setup();
  const profile = {
    name: 'Jordan Kim', headline: 'Marketing strategist for early-stage teams', location: 'Seoul',
    remote: 'hybrid', languages: ['en'], tags: ['marketing'], open_to: ['contract'],
    body_markdown: '## About\n\nJordan is a marketing strategist.\n\n## Experience\n\n- Grew early-stage product teams.',
    consent_to_publish: true,
  };
  const response = await http(env, '/api/v1/talent', 'POST', {
    headers: {'content-type': 'application/json'}, body: JSON.stringify(profile),
  });
  const {record} = await response.json();
  const key = `submissions/talent/${record.path.slice('api-talent/'.length)}.jsonl.gz`;
  metadata.get(key).expires = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const currentManifest = await (await http(env, '/api/data/manifest.json')).json();
  assert.equal(currentManifest.datasets.talent.count, 1);
  assert.equal(objects.has(key), true);
  const shardUrl = `https://openjob.softprobe.ai/api/data/${key}`;
  assert.equal((await worker.fetch(new Request(shardUrl), env, {})).status, 404);
  await worker.scheduled({cron:'17 3 * * *'}, env, {});
  assert.equal(objects.has(key), false);
});

test('API catalog is an RFC 9727 Linkset, and the landing page links to it', async () => {
  const {env} = setup();
  const head = await http(env, '/.well-known/api-catalog', 'HEAD');
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type'), /^application\/linkset\+json/);
  assert.match(head.headers.get('link'), /rel="api-catalog"/);
  const response = await http(env, '/.well-known/api-catalog');
  assert.equal(response.headers.get('content-type'), head.headers.get('content-type'));
  const catalog = await response.json();
  const links = catalog.linkset[0];
  assert.equal(links['service-desc'][0].href, 'https://openjob.softprobe.ai/api/openapi.json');
  assert.ok(links.item.some(link => link.href === 'https://openjob.softprobe.ai/api/mcp'));
  assert.ok(links['service-doc'].some(link => link.href === 'https://openjob.softprobe.ai/llms.txt'));
  assert.ok(links.status.some(link => link.href === 'https://openjob.softprobe.ai/api/health'));
  const landing = await (await import('node:fs/promises')).readFile(new URL('../../site/index.html', import.meta.url), 'utf8');
  assert.match(landing, /rel="api-catalog" href="https:\/\/openjob\.softprobe\.ai\/.well-known\/api-catalog"/);
});
