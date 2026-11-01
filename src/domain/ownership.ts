import type { Forge } from "./model";

export function repositoryOwnership(key: string, forges: readonly Forge[]) {
  const [host, login, name] = key.split("/");
  const owner = host !== "local" && login && name ? login : null;
  const forge = forges.find((f) => f.host.toLowerCase() === host.toLowerCase());
  return { owner, mine: !owner || !forge || loginIsMine(owner, forge) };
}
export function loginIsMine(login: string, forge?: Forge) {
  return (
    !forge?.owners?.length ||
    forge.owners.some((o) => o.toLowerCase() === login.toLowerCase())
  );
}
