/**
 * Extract the first text block from a message payload.
 *
 * Not every adapter can route through this. codex's getRecentMessages also
 * handles `input_text` blocks and excludes `<environment_context>`; claude's
 * detail pass interleaves text extraction with `tool_use` parsing. Those two
 * call sites stay local by design.
 */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    const type = (block as { type?: string }).type;
    const text = (block as { text?: string }).text;
    if ((type === 'text' || type === 'output_text') && text) return text.trim();
  }
  return '';
}
