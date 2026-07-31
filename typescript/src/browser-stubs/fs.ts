// Browser stub for Node.js 'fs' module.
// The browser runner never calls readFileSync/existsSync — it uses
// parseYaml(rawString) instead of parseYamlFile(path).

export function readFileSync(_path: string, _encoding?: string): string {
  throw new Error("readFileSync is not available in browser. Use parseYaml(rawString) instead.");
}

export function existsSync(_path: string): boolean {
  return false;
}

export function writeFileSync(_path: string, _data: string): void {
  throw new Error("writeFileSync is not available in browser.");
}

export function mkdirSync(_path: string, _options?: any): void {}

export function unlinkSync(_path: string): void {}
