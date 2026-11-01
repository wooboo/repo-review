/** Read-model ids (docs/API.md): branches are `${repo}#${name}`, pull requests `${repo}!${number}`. */
export const pullRequestId = (repo: string, number: number) => `${repo}!${number}`;
export function parsePullRequestId(id: string): { repo: string; number: number } | null {
  const i = id.lastIndexOf("!");
  const number = Number(id.slice(i + 1));
  return i > 0 && Number.isInteger(number) && number > 0 ? { repo: id.slice(0, i), number } : null;
}
export const branchId = (repo: string, name: string) => `${repo}#${name}`;
export function parseBranchId(id: string): { repo: string; name: string } | null {
  const i = id.indexOf("#");
  return i > 0 ? { repo: id.slice(0, i), name: id.slice(i + 1) } : null;
}
