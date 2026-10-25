/*
 * One markdown file per version. Frontmatter mirrors the version so a file reads on its own;
 * SQLite stays authoritative. Values are written as JSON scalars, which are valid YAML.
 */

export interface FrontmatterFields {
  id: string;
  kind: string;
  layer: string;
  title: string;
  altitude: number;
  status: string | null;
  version: number;
  version_id: string;
  created: string;
  updated: string;
}

const ORDER: (keyof FrontmatterFields)[] = [
  'id',
  'kind',
  'layer',
  'title',
  'altitude',
  'status',
  'version',
  'version_id',
  'created',
  'updated',
];

export function renderMarkdown(fields: FrontmatterFields, body: string): string {
  const lines = ORDER.map((key) => `${key}: ${JSON.stringify(fields[key])}`);
  const trimmed = body.replace(/\s+$/, '');
  return `---\n${lines.join('\n')}\n---\n${trimmed.length > 0 ? `\n${trimmed}\n` : ''}`;
}

/** The body of a file written by `renderMarkdown` (everything after the frontmatter). */
export function bodyOf(content: string): string {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---\n', 4);
  if (end < 0) return content;
  return content
    .slice(end + 5)
    .replace(/^\n/, '')
    .replace(/\n$/, '');
}

/** Where version `n` of an object lives (immutable), and where its current copy lives. */
export function versionPath(layer: string, id: string, n: number): string {
  return `${layer}/.versions/${id}/${n}.md`;
}
export function currentPath(layer: string, id: string): string {
  return `${layer}/${id}.md`;
}
