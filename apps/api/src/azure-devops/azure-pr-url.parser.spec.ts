import { parseAzurePrUrl } from './azure-pr-url.parser.js';
describe('Canonical Azure PR URLs', () => {
  it.each(['https://dev.azure.com/junk/../org/project/_git/repo/pullrequest/12', 'https://dev.azure.com//org/project/_git/repo/pullrequest/12','https://dev.azure.com/org/project/_git/repo/pullrequest/12/', `https://dev.azure.com/${'a'.repeat(201)}/project/_git/repo/pullrequest/12`])('rejects normalized or noncanonical input %s', url => expect(() => parseAzurePrUrl(url)).toThrow());
});
