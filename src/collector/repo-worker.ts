import { observeCommands } from "./git";
import { collectRepo } from "./analyze";
if (import.meta.main) {
  observeCommands((event) => console.error(JSON.stringify(event)));
  const [common, path, fetch, threads] = JSON.parse(process.argv[2]);
  console.log(JSON.stringify(collectRepo(common, path, fetch, threads)));
}
