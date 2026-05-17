// Streaming JSON object extractor. Feed it arbitrary text chunks; it yields
// complete top-level {...} objects as their closing brace arrives. Brace- and
// string/escape-aware, so it tolerates NDJSON, pretty-printed, or output split
// mid-token across chunks. Malformed objects are skipped, not thrown.

export function makeJsonExtractor() {
  let buf = '';
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  return function push(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      buf += ch;
      const idx = buf.length - 1;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
      } else if (ch === '{') {
        if (depth === 0) start = idx;
        depth++;
      } else if (ch === '}') {
        if (depth > 0) depth--;
        if (depth === 0 && start >= 0) {
          const slice = buf.slice(start, idx + 1);
          try {
            out.push(JSON.parse(slice));
          } catch {
            /* skip malformed object */
          }
          buf = '';
          start = -1;
        }
      }
    }
    return out;
  };
}

export default makeJsonExtractor;
