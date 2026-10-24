declare module 'markdown-it-deflist' {
  import type MarkdownIt from 'markdown-it';
  const deflist: MarkdownIt.PluginSimple;
  export default deflist;
}

declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';
  const taskLists: MarkdownIt.PluginWithOptions<{
    enabled?: boolean;
    label?: boolean;
    labelAfter?: boolean;
  }>;
  export default taskLists;
}
