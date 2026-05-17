// Fault-tolerant AI response parser — r1.md section 5.6.
// Strips ```json fences, slices from first { to last }, then JSON.parse.

/**
 * @param {string} raw - raw model output
 * @returns {object} parsed JSON
 * @throws if the cleaned string is not valid JSON
 */
export function parseAIResponse(raw) {
  if (typeof raw !== 'string') {
    throw new Error('AI response is not a string');
  }
  let clean = raw.trim();

  // Strip a possible markdown code-fence wrapper.
  clean = clean
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```$/, '');

  // Slice to the outermost JSON object.
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first >= 0 && last > first) {
    clean = clean.slice(first, last + 1);
  }

  return JSON.parse(clean);
}

export default parseAIResponse;
