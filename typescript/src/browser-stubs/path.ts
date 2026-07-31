// Browser stub for Node.js 'path' module.

export function join(..._paths: string[]): string {
  return _paths.join("/");
}

export function basename(p: string, _ext?: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  let name = parts[parts.length - 1] || "";
  if (_ext && name.endsWith(_ext)) name = name.slice(0, -_ext.length);
  return name;
}

export function resolve(..._paths: string[]): string {
  return _paths.join("/");
}

export function dirname(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/") || ".";
}

export function extname(p: string): string {
  const parts = p.split(".");
  return parts.length > 1 ? "." + parts[parts.length - 1] : "";
}

export default { join, basename, resolve, dirname, extname };
