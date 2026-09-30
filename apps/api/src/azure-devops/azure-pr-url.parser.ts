export function parseAzurePrUrl(input: string) {
  if (/%25|%2e|%2f|%5c/i.test(input)) throw new Error('Encoded path traversal is not supported');
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.hostname !== 'dev.azure.com' || url.port || url.username || url.password || url.search || url.hash) throw new Error('Use a canonical HTTPS Azure DevOps PR URL');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length !== 6 || parts[2] !== '_git' || parts[4] !== 'pullrequest') throw new Error('Invalid Azure DevOps PR URL');
  // eslint-disable-next-line no-control-regex -- Reject control characters at the URL trust boundary.
  for (const part of [parts[0]!, parts[1]!, parts[3]!]) if (!part || /[\\/:\x00-\x1f]/.test(part) || part === '.' || part === '..') throw new Error('Invalid Azure identifier');
  const id = Number(parts[5]); if (!/^[1-9]\d*$/.test(parts[5]!) || !Number.isSafeInteger(id)) throw new Error('Invalid PR number');
  return { organization: parts[0]!, project: parts[1]!, repository: parts[3]!, pullRequestId: id };
}
export function repositoryUrl(pr: { organization: string; project: string; repository: string }) {
  return `https://dev.azure.com/${encodeURIComponent(pr.organization)}/${encodeURIComponent(pr.project)}/_git/${encodeURIComponent(pr.repository)}`;
}
