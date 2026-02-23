import matter from 'gray-matter';

import type { FrontmatterInfo } from '../../messaging/protocol';

export interface FrontmatterParseResult {
  content: string;
  frontmatter?: FrontmatterInfo;
}

export function parseFrontmatter(input: string): FrontmatterParseResult {
  const parsed = matter(input);
  const rawMatter = typeof parsed.matter === 'string' ? parsed.matter : '';
  const hasFrontmatter = rawMatter.trim().length > 0;
  if (!hasFrontmatter) {
    return { content: input };
  }

  return {
    content: parsed.content,
    frontmatter: {
      raw: rawMatter,
      data: (parsed.data ?? {}) as Record<string, unknown>
    }
  };
}
