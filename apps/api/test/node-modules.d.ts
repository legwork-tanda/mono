// Just enough typing for the test helpers that use Node's built-ins; the app code runs on Workers and never imports these.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): Record<string, unknown>[];
      run(...params: unknown[]): unknown;
    };
  }
}
declare module "node:fs" {
  export function readdirSync(path: string | URL): string[];
  export function readFileSync(path: string | URL, encoding: "utf8"): string;
}
