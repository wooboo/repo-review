import { parseSearchWith, stringifySearchWith } from "@tanstack/react-router";

/** Arrays in the query string are comma-separated (`?verdict=delete,check`), everything else as the router does by default. */
export const stringifySearch = stringifySearchWith((v: unknown) => (Array.isArray(v) ? v.join(",") : JSON.stringify(v)), JSON.parse);
export const parseSearch = parseSearchWith(JSON.parse);
