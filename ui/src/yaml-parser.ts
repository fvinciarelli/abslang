// Client-side YAML parser for ABS files
import * as yaml from 'js-yaml';

export function parseYaml(raw: string): any[] {
  const docs = raw.split(/^---$/m).map((d) => d.trim()).filter(Boolean);
  return docs.map((doc) => yaml.load(doc));
}

export function expandFragments(doc: any): any {
  const fragments = doc.fragments ?? {};

  function expand(behaviors: any[]): any[] {
    const result: any[] = [];
    for (const entry of behaviors) {
      if (entry.include) {
        const frag = fragments[entry.include];
        if (frag) result.push(...frag);
      } else {
        result.push(entry);
      }
    }
    return result;
  }

  return {
    session: doc.session,
    description: doc.description,
    abs_version: doc.abs_version,
    behaviors: expand(doc.behaviors ?? []),
    evaluations: doc.evaluations,
  };
}
