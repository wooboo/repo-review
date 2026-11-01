export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export const json = (value: unknown): Json =>
  JSON.parse(JSON.stringify(value)) as Json;
