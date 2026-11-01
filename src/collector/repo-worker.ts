import { collectRepo } from "./analyze";
if (import.meta.main) {
  const [common, path, fetch, threads] = JSON.parse(process.argv[2]);
  console.log(JSON.stringify(collectRepo(common, path, fetch, threads)));
}
