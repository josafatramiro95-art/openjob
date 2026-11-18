import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { createTalent, deleteTalent, getDataset, get, InputError, list, manifest } from './data.js';

const recordSchema = z.record(z.string(), z.unknown()).meta({
  id: 'DatasetRecord',
  description: 'A complete OpenJob dataset record. See the record schema URL returned by get_dataset for the current field contract.',
  externalDocs: {url: 'https://openjob.softprobe.ai/api/data/manifest.json'},
});

const shardSchema = z.object({
  first_id: z.string(),
  last_id: z.string(),
  count: z.number().int().nonnegative(),
  url: z.string().url(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  gzip: z.object({url: z.string().url(), bytes: z.number().int().nonnegative(), sha256: z.string()}),
});

const datasetOutput = z.object({
  schema_version: z.string(),
  snapshot_id: z.string(),
  generated: z.string(),
  indexed_notice: z.string(),
  owner_license: z.string(),
  kind: z.enum(['jobs', 'talent']),
  complete: z.boolean().describe('True when this describes every available record in the snapshot.'),
  count: z.number().int().nonnegative(),
  schema_url: z.string().url().describe('JSON Schema for exported records.'),
  shards: z.array(shardSchema),
});

const listOutput = z.object({
  snapshot_id: z.string(),
  items: z.array(recordSchema),
  next_cursor: z.string().nullable(),
});

const detailOutput = z.object({snapshot_id: z.string(), record: recordSchema});
const errorOutput = z.object({error: z.string()});
const textErrorOutput = z.string().describe('Human-readable request error.');

const filterSchema = z.object({
  text: z.string().optional().describe('Literal case-insensitive substring filter; this is not relevance search or ranking.'),
  location: z.string().optional(),
  remote: z.string().optional(),
  language: z.string().optional(),
  tag: z.string().optional(),
  employment_type: z.string().optional(),
  open_to: z.string().optional(),
  origin: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().describe('Results per page. Defaults to 25; maximum 100.'),
  cursor: z.string().optional().describe('Continue a listing for the same snapshot and filters.'),
});

const jobIdInput = z.object({id: z.string().min(1).describe('Job repository path or permalink.')});
const talentIdInput = z.object({id: z.string().min(1).describe('Talent repository path, API profile path, OpenJob permalink, or GitHub login.')});
const datasetInput = z.object({kind: z.enum(['jobs', 'talent'])});
const languages = z.array(z.enum(['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru'])).min(1).max(4).refine(values => new Set(values).size === values.length);
const tags = z.array(z.string().min(1).max(24).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).max(8).refine(values => new Set(values).size === values.length);
const openTo = z.array(z.enum(['full-time', 'part-time', 'contract', 'internship'])).min(1).max(4).refine(values => new Set(values).size === values.length);
const httpsUrl = z.string().url().max(300).refine(value => value.startsWith('https://'), 'Must use HTTPS');
const publicText = (value) => !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)
  && !/(?:^|\D)\+?\d[\d ()./-]{7,}\d(?:\D|$)/.test(value);
const publicProfileMarkdown = (value) => !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)
  && !/(?:^|\D)\+?\d(?:[\s()./-]*\d){8,}(?:\D|$)/.test(value);
const hasMarkdownSectionContent = (value, name) => {
  const section = value.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'im'));
  return Boolean(section?.[1].trim());
};

const createTalentInput = z.object({
  name: z.string().trim().min(1).max(80).refine(publicText, 'Do not include an email address or phone number.').describe('Public display name; never include email or phone.'),
  headline: z.string().trim().min(4).max(140).refine(publicText, 'Do not include an email address or phone number.').describe('Public professional headline; never include email or phone.'),
  location: z.string().trim().min(1).max(80).refine(publicText, 'Do not include an email address or phone number.').describe('Public location; never include email or phone.'),
  remote: z.enum(['remote', 'onsite', 'hybrid', 'unspecified']).describe('Preferred work arrangement.'),
  languages,
  tags: tags.refine(values => values.every(publicText), 'Tags must not include an email address or phone number.').describe('Skill tags; never include email or phone.'),
  open_to: openTo,
  body_markdown: z.string().trim().min(40).max(8000)
    .refine(value => hasMarkdownSectionContent(value, 'About') && hasMarkdownSectionContent(value, 'Experience'), 'Include factual content under ## About and ## Experience Markdown sections.')
    .refine(publicProfileMarkdown, 'Do not include an email address or phone number.')
    .describe('Public résumé evidence as Markdown. Include ## About and ## Experience sections, and ## Education when supplied and wanted. Put a concise factual summary first, then flat bullets for experience. Omit missing details; never invent facts, email, or phone.'),
  website: httpsUrl.refine(publicText, 'Do not include an email address or phone number.').describe('Optional public HTTPS website; never include email or phone.').optional(),
  linkedin: z.string().max(300).regex(/^https:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9%-]+\/?$/).refine(publicText, 'Do not include an email address or phone number.').describe('Optional LinkedIn profile URL; never include email or phone.').optional(),
  consent_to_publish: z.literal(true).describe('Set true only after the person approves the exact fields as a public, downloadable profile under CC BY 4.0 and understands that deletion cannot recall copies already downloaded. Do not include the original resume, an email, or a phone number.'),
}).strict();

const deleteTalentInput = z.object({
  id: z.string().regex(/^api-talent\/[0-9a-f-]{36}$/i).describe('The API profile path returned by create_talent.'),
  delete_token: z.string().min(40).max(100).describe('Private token returned once by create_talent. Never include it in a public profile.'),
}).strict();

const readAnnotations = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
const writeAnnotations = {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true};
const deleteAnnotations = {readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true};

/**
 * The shared contract for the public HTTP API and remote MCP server.
 * Keep each tool's schema, description, HTTP route, and data handler together.
 */
export const operations = [
  {
    name: 'get_dataset', operationId: 'get_dataset', method: 'get', path: '/api/v1/datasets', tags: ['Datasets'],
    summary: 'Get dataset download information',
    description: 'Get complete public dataset download URLs, record schema, checksums, and freshness. Use your own matching code; OpenJob does not rank records.',
    input: datasetInput, output: datasetOutput, annotations: readAnnotations,
    run: (env, {kind}) => getDataset(env, kind),
  },
  {
    name: 'list_jobs', operationId: 'list_jobs', method: 'get', path: '/api/v1/jobs', tags: ['Jobs'],
    summary: 'List public jobs',
    description: 'List public job facts in identifier order with optional literal filters. No personalized ranking.',
    input: filterSchema, output: listOutput, annotations: readAnnotations,
    run: (env, args) => list(env, 'jobs', args),
  },
  {
    name: 'get_job', operationId: 'get_job', method: 'get', path: '/api/v1/job', tags: ['Jobs'],
    summary: 'Get one job',
    description: 'Get a job by repository path or permalink, including the employer source and stored application method.',
    input: jobIdInput, output: detailOutput, annotations: readAnnotations,
    run: (env, {id}) => get(env, 'jobs', id),
  },
  {
    name: 'list_talent', operationId: 'list_talent', method: 'get', path: '/api/v1/talent', tags: ['Talent'],
    summary: 'List published talent profiles',
    description: 'List published talent profiles in identifier order with optional literal filters. Includes profiles submitted through the anonymous API and remote MCP. No personalized ranking.',
    input: filterSchema, output: listOutput, annotations: readAnnotations,
    run: (env, args) => list(env, 'talent', args),
  },
  {
    name: 'get_talent', operationId: 'get_talent', method: 'get', path: '/api/v1/profile', tags: ['Talent'],
    summary: 'Get one talent profile',
    description: 'Get a public talent profile by repository path, API profile path, permalink, or GitHub login.',
    input: talentIdInput, output: detailOutput, annotations: readAnnotations,
    run: (env, {id}) => get(env, 'talent', id),
  },
  {
    name: 'create_talent', operationId: 'create_talent', method: 'post', path: '/api/v1/talent', tags: ['Talent'],
    summary: 'Publish a public talent profile',
    description: 'Create a public, downloadable talent profile without a GitHub account, API key, or OpenJob installation. Agents should extract structured fields and Markdown résumé evidence from a PDF, Word resume, or LinkedIn profile. Use body_markdown with ## About and ## Experience sections, plus ## Education when supplied and wanted. Ask only for missing required values, show the exact profile, and set consent_to_publish only after approval. Do not upload or store the source document, invent facts, or include email or phone. The record is licensed under CC BY 4.0 and expires after 180 days. Returns a private delete token once.',
    input: createTalentInput, output: z.object({record: recordSchema, delete_token: z.string()}), annotations: writeAnnotations,
    successStatus: 201,
    run: (env, args) => createTalent(env, args),
  },
  {
    name: 'delete_talent', operationId: 'delete_talent', method: 'post', path: '/api/v1/talent/delete', tags: ['Talent'],
    summary: 'Delete an API-submitted talent profile',
    description: 'Remove an API-submitted public profile from OpenJob with its private delete token. The private token is shown once on creation. This does not recall copies already downloaded.',
    input: deleteTalentInput, output: z.object({deleted: z.literal(true), id: z.string()}), annotations: deleteAnnotations,
    run: (env, args) => deleteTalent(env, args),
  },
];

const datasetEntrySchema = z.object({complete: z.boolean(), count: z.number().int().nonnegative(), schema_url: z.string().url(), shards: z.array(shardSchema)});
const manifestSchema = z.object({
  schema_version: z.string(), snapshot_id: z.string(), generated: z.string(), source: z.string().url(),
  indexed_notice: z.string(), owner_license: z.string(),
  datasets: z.object({jobs: datasetEntrySchema, talent: datasetEntrySchema}),
});
const healthSchema = z.object({snapshot_id: z.string(), generated: z.string()});

export const resources = {
  health: {path: '/api/health', operationId: 'get_health', output: healthSchema},
  manifest: {path: '/api/data/manifest.json', operationId: 'get_manifest', output: manifestSchema},
  profilePage: {path: '/p/api-talent/{id}/', operationId: 'get_api_talent_page'},
  shards: {path: '/api/data/snapshots/{snapshot}/{filename}', operationId: 'get_dataset_shard'},
};

export function parseInput(operation, value) {
  const parsed = operation.input.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues.map(issue => {
      const field = issue.path.length ? `${issue.path.join('.')}: ` : '';
      return `${field}${issue.message}`;
    }).join('; ');
    throw new InputError(detail);
  }
  return parsed.data;
}

const registry = new OpenAPIRegistry();
for (const operation of operations) {
  const request = operation.method === 'get'
    ? {query: operation.input}
    : {body: {required: true, content: {'application/json': {schema: operation.input}}}};
  const successStatus = operation.successStatus || 200;
  registry.registerPath({
    method: /** @type {'get' | 'post'} */ (operation.method),
    path: operation.path,
    operationId: operation.operationId,
    tags: operation.tags,
    summary: operation.summary,
    description: operation.description,
    request,
    responses: {
      [successStatus]: {description: operation.summary, content: {'application/json': {schema: operation.output}}},
      400: {description: 'The request is invalid, the cursor is stale, or the requested record was not found.', content: {'application/json': {schema: errorOutput}}},
      404: {description: 'The requested record was not found.', content: {'application/json': {schema: errorOutput}}},
      405: {description: 'The HTTP method is not supported for this operation.', content: {'text/plain': {schema: textErrorOutput}}},
      409: {description: 'A profile write conflicts with an existing record.', content: {'application/json': {schema: errorOutput}}},
      413: {description: 'The request body is too large.', content: {'application/json': {schema: errorOutput}}},
      429: {description: 'The profile write rate limit was exceeded.', content: {'application/json': {schema: errorOutput}}},
      415: {description: 'The request body must use application/json.', content: {'application/json': {schema: errorOutput}}},
      503: {description: 'The public dataset is temporarily unavailable.', content: {'application/json': {schema: errorOutput}}},
    },
  });
}

registry.registerPath({
  method: 'get', path: resources.health.path, operationId: resources.health.operationId,
  tags: ['Service status'], summary: 'Get dataset health and snapshot',
  responses: {
    200: {description: 'Current dataset snapshot.', content: {'application/json': {schema: resources.health.output}}},
    405: {description: 'Only GET is supported.', content: {'text/plain': {schema: textErrorOutput}}},
    503: {description: 'The public dataset is temporarily unavailable.', content: {'application/json': {schema: errorOutput}}},
  },
});
registry.registerPath({
  method: 'get', path: resources.manifest.path, operationId: resources.manifest.operationId,
  tags: ['Datasets'], summary: 'Download the complete dataset manifest',
  description: 'The manifest lists complete job and talent datasets, schema URLs, shard URLs, byte sizes, and checksums.',
  responses: {
    200: {description: 'Complete dataset manifest.', content: {'application/json': {schema: resources.manifest.output}}},
    404: {description: 'The dataset manifest was not found.', content: {'text/plain': {schema: textErrorOutput}}},
    405: {description: 'Only GET and HEAD are supported.', content: {'text/plain': {schema: textErrorOutput}}},
    503: {description: 'The public dataset is temporarily unavailable.', content: {'text/plain': {schema: textErrorOutput}}},
  },
});
registry.registerPath({
  method: 'get', path: resources.shards.path, operationId: resources.shards.operationId,
  tags: ['Datasets'], summary: 'Download a dataset shard',
  description: 'Use shard URLs from the manifest. JSON Lines shards are UTF-8; gzip variants are available at the advertised .gz URL.',
  request: {params: z.object({snapshot: z.string().regex(/^[0-9a-f]{64}$/), filename: z.string().min(1)})},
  responses: {
    200: {description: 'A UTF-8 JSON Lines shard or its gzip-compressed form.', content: {
      'application/x-ndjson': {schema: z.string()},
      'application/gzip': {schema: {type: 'string', format: 'binary'}},
    }},
    400: {description: 'The dataset path is invalid.', content: {'text/plain': {schema: textErrorOutput}}},
    404: {description: 'The advertised shard was not found.', content: {'text/plain': {schema: textErrorOutput}}},
    405: {description: 'Only GET and HEAD are supported.', content: {'text/plain': {schema: textErrorOutput}}},
    503: {description: 'The public dataset is temporarily unavailable.', content: {'text/plain': {schema: textErrorOutput}}},
  },
});
registry.registerPath({
  method: 'get', path: resources.profilePage.path, operationId: resources.profilePage.operationId,
  tags: ['Talent'], summary: 'Open a public API-submitted talent profile',
  description: 'HTML permalink for a public talent profile created through the anonymous API or remote MCP. The structured record is also available from GET /api/v1/profile?id=… and dataset downloads.',
  request: {params: z.object({id: z.string().regex(/^[0-9a-f-]{36}$/i)})},
  responses: {
    200: {description: 'Public talent profile page.', content: {'text/html': {schema: z.string()}}},
    404: {description: 'The profile does not exist or has expired.', content: {'text/plain': {schema: textErrorOutput}}},
    405: {description: 'Only GET and HEAD are supported.', content: {'text/plain': {schema: textErrorOutput}}},
  },
});

export const openApiDocument = new OpenApiGeneratorV31(registry.definitions).generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'OpenJob public data API',
    version: '1.0.0',
    description: 'A public job database for AI agents. Let your existing agent find you your next job. Public job and talent data plus anonymous talent-profile submission. OpenJob returns facts and source links; clients choose their own matching method.',
  },
  servers: [{url: 'https://openjob.softprobe.ai'}],
  externalDocs: {description: 'OpenJob agent guide and API discovery', url: 'https://openjob.softprobe.ai/llms.txt'},
});

export async function getHealth(env) {
  const current = await manifest(env);
  return {snapshot_id: current.snapshot_id, generated: current.generated};
}
