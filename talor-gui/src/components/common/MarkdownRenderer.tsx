/**
 * MarkdownRenderer Component
 * Markdown 渲染组件
 *
 * Renders Markdown content with syntax highlighting for code blocks.
 * Uses react-markdown for parsing and shiki for code highlighting.
 *
 * @requirements 3.2 - AI 响应包含代码时使用语法高亮渲染代码块
 * @requirements 3.3 - AI 响应包含 Markdown 时正确渲染 Markdown 格式
 */

import React, { useEffect, useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createHighlighter } from 'shiki';
import type { Highlighter, BundledLanguage } from 'shiki';

/**
 * Props for the MarkdownRenderer component
 * MarkdownRenderer 组件的属性
 */
export interface MarkdownRendererProps {
  /** Markdown content to render / 要渲染的 Markdown 内容 */
  content: string;
  /** Custom class name for the container / 容器的自定义类名 */
  className?: string;
}

/**
 * Supported languages for syntax highlighting
 * 支持语法高亮的语言列表
 */
const SUPPORTED_LANGUAGES: BundledLanguage[] = [
  'javascript',
  'typescript',
  'python',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'rust',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'scala',
  'html',
  'css',
  'scss',
  'json',
  'yaml',
  'xml',
  'markdown',
  'sql',
  'bash',
  'shell',
  'powershell',
  'dockerfile',
  'graphql',
  'jsx',
  'tsx',
];

/**
 * Language alias mapping for common variations
 * 常见语言别名映射
 */
const LANGUAGE_ALIASES: Record<string, BundledLanguage> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  cs: 'csharp',
  'c++': 'cpp',
  'c#': 'csharp',
  sh: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
};

/**
 * Normalize language identifier to a supported language
 * 将语言标识符规范化为支持的语言
 */
function normalizeLanguage(lang: string | undefined): BundledLanguage | null {
  if (!lang) return null;

  const normalized = lang.toLowerCase().trim();

  // Check if it's a direct match
  if (SUPPORTED_LANGUAGES.includes(normalized as BundledLanguage)) {
    return normalized as BundledLanguage;
  }

  // Check aliases
  if (normalized in LANGUAGE_ALIASES) {
    return LANGUAGE_ALIASES[normalized];
  }

  return null;
}

/**
 * Singleton highlighter instance
 * 单例高亮器实例
 */
let highlighterPromise: Promise<Highlighter> | null = null;

/**
 * Get or create the shiki highlighter instance
 * 获取或创建 shiki 高亮器实例
 */
async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: SUPPORTED_LANGUAGES,
    });
  }
  return highlighterPromise;
}

/**
 * Props for the CodeBlock component
 * CodeBlock 组件的属性
 */
interface CodeBlockProps {
  language: string | undefined;
  code: string;
  inline?: boolean;
}

/**
 * CodeBlock component for rendering code with syntax highlighting
 * 用于渲染带语法高亮的代码块组件
 *
 * @requirements 3.2 - 使用语法高亮渲染代码块
 */
const CodeBlock: React.FC<CodeBlockProps> = ({ language, code, inline }) => {
  const [highlightedCode, setHighlightedCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const normalizedLang = useMemo(() => normalizeLanguage(language), [language]);

  useEffect(() => {
    let mounted = true;

    async function highlight() {
      if (inline || !normalizedLang) {
        setIsLoading(false);
        return;
      }

      try {
        const highlighter = await getHighlighter();
        if (!mounted) return;

        const html = highlighter.codeToHtml(code, {
          lang: normalizedLang,
          themes: {
            light: 'github-light',
            dark: 'github-dark',
          },
        });

        setHighlightedCode(html);
      } catch (error) {
        console.error('Failed to highlight code:', error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    highlight();

    return () => {
      mounted = false;
    };
  }, [code, normalizedLang, inline]);

  // Inline code rendering
  if (inline) {
    return (
      <code
        className="
          px-1.5 py-0.5
          rounded
          bg-gray-100 dark:bg-gray-800
          text-sm font-mono
          text-pink-600 dark:text-pink-400
        "
      >
        {code}
      </code>
    );
  }

  // Block code rendering
  return (
    <div className="relative my-4 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
      {/* Language label */}
      {language && (
        <div
          className="
            px-4 py-2
            bg-gray-100 dark:bg-gray-800
            border-b border-gray-200 dark:border-gray-700
            text-xs font-mono text-gray-500 dark:text-gray-400
          "
        >
          {language}
        </div>
      )}

      {/* Code content */}
      <div className="overflow-x-auto">
        {isLoading ? (
          <pre
            className="
              p-4 m-0
              bg-gray-50 dark:bg-gray-900
              text-sm font-mono
              text-gray-800 dark:text-gray-200
            "
          >
            <code>{code}</code>
          </pre>
        ) : highlightedCode ? (
          <div
            className="
              [&>pre]:p-4 [&>pre]:m-0 [&>pre]:bg-transparent
              [&>pre]:text-sm [&>pre]:font-mono
              bg-gray-50 dark:bg-gray-900
              [&_.shiki]:bg-transparent
              [&_.shiki.github-light]:block [&_.shiki.github-dark]:hidden
              dark:[&_.shiki.github-light]:hidden dark:[&_.shiki.github-dark]:block
            "
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        ) : (
          <pre
            className="
              p-4 m-0
              bg-gray-50 dark:bg-gray-900
              text-sm font-mono
              text-gray-800 dark:text-gray-200
            "
          >
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
};

/**
 * Sanitize content to prevent XSS attacks
 * 清理内容以防止 XSS 攻击
 *
 * Removes script tags and other potentially dangerous content
 */
export function sanitizeContent(content: string): string {
  // Remove script tags and their content
  let sanitized = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove on* event handlers
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');

  // Remove javascript: URLs
  sanitized = sanitized.replace(/javascript:/gi, '');

  return sanitized;
}

/**
 * MarkdownRenderer component
 * Markdown 渲染组件
 *
 * Renders Markdown content with proper formatting and syntax highlighting.
 *
 * @param props - Component props / 组件属性
 * @returns Rendered Markdown content / 渲染后的 Markdown 内容
 *
 * @requirements 3.2 - AI 响应包含代码时使用语法高亮渲染代码块
 * @requirements 3.3 - AI 响应包含 Markdown 时正确渲染 Markdown 格式
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = '',
}) => {
  // Sanitize content to prevent XSS
  const sanitizedContent = useMemo(() => sanitizeContent(content), [content]);

  /**
   * Custom components for react-markdown
   * react-markdown 的自定义组件
   */
  const components: Components = useMemo(
    () => ({
      // Code blocks and inline code
      code: ({ className: codeClassName, children }) => {
        const match = /language-(\w+)/.exec(codeClassName || '');
        const language = match ? match[1] : undefined;
        const code = String(children).replace(/\n$/, '');
        const isInline = !codeClassName && !code.includes('\n');

        return <CodeBlock language={language} code={code} inline={isInline} />;
      },

      // Headings
      h1: ({ children }) => (
        <h1 className="text-2xl font-bold mt-6 mb-4 text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700 pb-2">
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className="text-xl font-bold mt-5 mb-3 text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700 pb-2">
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className="text-lg font-bold mt-4 mb-2 text-gray-900 dark:text-gray-100">
          {children}
        </h3>
      ),
      h4: ({ children }) => (
        <h4 className="text-base font-bold mt-3 mb-2 text-gray-900 dark:text-gray-100">
          {children}
        </h4>
      ),
      h5: ({ children }) => (
        <h5 className="text-sm font-bold mt-2 mb-1 text-gray-900 dark:text-gray-100">
          {children}
        </h5>
      ),
      h6: ({ children }) => (
        <h6 className="text-sm font-semibold mt-2 mb-1 text-gray-600 dark:text-gray-400">
          {children}
        </h6>
      ),

      // Paragraphs
      p: ({ children }) => (
        <p className="my-3 leading-7 text-gray-800 dark:text-gray-200">{children}</p>
      ),

      // Links
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          {children}
        </a>
      ),

      // Lists
      ul: ({ children }) => (
        <ul className="my-3 ml-6 list-disc space-y-1 text-gray-800 dark:text-gray-200">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="my-3 ml-6 list-decimal space-y-1 text-gray-800 dark:text-gray-200">
          {children}
        </ol>
      ),
      li: ({ children }) => <li className="leading-7">{children}</li>,

      // Blockquotes
      blockquote: ({ children }) => (
        <blockquote
          className="
            my-4 pl-4
            border-l-4 border-gray-300 dark:border-gray-600
            text-gray-600 dark:text-gray-400
            italic
          "
        >
          {children}
        </blockquote>
      ),

      // Horizontal rule
      hr: () => <hr className="my-6 border-gray-200 dark:border-gray-700" />,

      // Tables
      table: ({ children }) => (
        <div className="my-4 overflow-x-auto">
          <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">
            {children}
          </table>
        </div>
      ),
      thead: ({ children }) => (
        <thead className="bg-gray-100 dark:bg-gray-800">{children}</thead>
      ),
      tbody: ({ children }) => <tbody>{children}</tbody>,
      tr: ({ children }) => (
        <tr className="border-b border-gray-200 dark:border-gray-700">{children}</tr>
      ),
      th: ({ children }) => (
        <th className="px-4 py-2 text-left font-semibold text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700">
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td className="px-4 py-2 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700">
          {children}
        </td>
      ),

      // Images
      img: ({ src, alt }) => (
        <img
          src={src}
          alt={alt || ''}
          className="max-w-full h-auto my-4 rounded-lg"
          loading="lazy"
        />
      ),

      // Strong and emphasis
      strong: ({ children }) => (
        <strong className="font-bold text-gray-900 dark:text-gray-100">{children}</strong>
      ),
      em: ({ children }) => <em className="italic">{children}</em>,

      // Strikethrough
      del: ({ children }) => <del className="line-through text-gray-500">{children}</del>,

      // Pre (for code blocks without language)
      pre: ({ children }) => <>{children}</>,
    }),
    []
  );

  return (
    <div
      className={`
        markdown-content
        prose prose-sm dark:prose-invert
        max-w-none
        ${className}
      `}
      data-testid="markdown-renderer"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {sanitizedContent}
      </ReactMarkdown>
    </div>
  );
};

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default MarkdownRenderer;
