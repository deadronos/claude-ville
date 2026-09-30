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
