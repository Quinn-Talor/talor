/**
 * MarkdownRenderer Component Tests
 * Markdown 渲染组件测试
 *
 * Tests for the MarkdownRenderer component including:
 * - Basic Markdown rendering (headings, lists, links, etc.)
 * - Code block rendering with syntax highlighting
 * - XSS protection
 * - Inline code rendering
 *
 * @requirements 3.2 - AI 响应包含代码时使用语法高亮渲染代码块
 * @requirements 3.3 - AI 响应包含 Markdown 时正确渲染 Markdown 格式
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MarkdownRenderer, sanitizeContent } from './MarkdownRenderer';

// Mock shiki to avoid async loading issues in tests
vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn((code: string, options: { lang: string }) => {
      return `<pre class="shiki github-light"><code>${code}</code></pre><pre class="shiki github-dark"><code>${code}</code></pre>`;
    }),
  }),
}));

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render plain text content', () => {
      render(<MarkdownRenderer content="Hello, World!" />);

      expect(screen.getByText('Hello, World!')).toBeInTheDocument();
    });

    it('should render with custom className', () => {
      render(<MarkdownRenderer content="Test" className="custom-class" />);

      const container = screen.getByTestId('markdown-renderer');
      expect(container).toHaveClass('custom-class');
    });

    it('should have data-testid attribute', () => {
      render(<MarkdownRenderer content="Test" />);

      expect(screen.getByTestId('markdown-renderer')).toBeInTheDocument();
    });
  });

  describe('Headings', () => {
    it('should render h1 heading', () => {
      render(<MarkdownRenderer content="# Heading 1" />);

      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveTextContent('Heading 1');
    });

    it('should render h2 heading', () => {
      render(<MarkdownRenderer content="## Heading 2" />);

      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveTextContent('Heading 2');
    });

    it('should render h3 heading', () => {
      render(<MarkdownRenderer content="### Heading 3" />);

      const heading = screen.getByRole('heading', { level: 3 });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveTextContent('Heading 3');
    });

    it('should render multiple heading levels', () => {
      render(
        <MarkdownRenderer
          content={`# H1
## H2
### H3
#### H4
##### H5
###### H6`}
        />
      );

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('H1');
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('H2');
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('H3');
      expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('H4');
      expect(screen.getByRole('heading', { level: 5 })).toHaveTextContent('H5');
      expect(screen.getByRole('heading', { level: 6 })).toHaveTextContent('H6');
    });
  });

  describe('Lists', () => {
    it('should render unordered list', () => {
      render(
        <MarkdownRenderer
          content={`- Item 1
- Item 2
- Item 3`}
        />
      );

      const list = screen.getByRole('list');
      expect(list.tagName).toBe('UL');

      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(3);
      expect(items[0]).toHaveTextContent('Item 1');
      expect(items[1]).toHaveTextContent('Item 2');
      expect(items[2]).toHaveTextContent('Item 3');
    });

    it('should render ordered list', () => {
      render(
        <MarkdownRenderer
          content={`1. First
2. Second
3. Third`}
        />
      );

      const list = screen.getByRole('list');
      expect(list.tagName).toBe('OL');

      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(3);
      expect(items[0]).toHaveTextContent('First');
    });

    it('should render nested lists', () => {
      render(
        <MarkdownRenderer
          content={`- Parent
  - Child 1
  - Child 2`}
        />
      );

      const lists = screen.getAllByRole('list');
      expect(lists.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Links', () => {
    it('should render links with href', () => {
      render(<MarkdownRenderer content="[Click here](https://example.com)" />);

      const link = screen.getByRole('link', { name: 'Click here' });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', 'https://example.com');
    });

    it('should open links in new tab', () => {
      render(<MarkdownRenderer content="[Link](https://example.com)" />);

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  describe('Text Formatting', () => {
    it('should render bold text', () => {
      render(<MarkdownRenderer content="This is **bold** text" />);

      const strong = screen.getByText('bold');
      expect(strong.tagName).toBe('STRONG');
    });

    it('should render italic text', () => {
      render(<MarkdownRenderer content="This is *italic* text" />);

      const em = screen.getByText('italic');
      expect(em.tagName).toBe('EM');
    });

    it('should render strikethrough text', () => {
      render(<MarkdownRenderer content="This is ~~deleted~~ text" />);

      const del = screen.getByText('deleted');
      expect(del.tagName).toBe('DEL');
    });
  });

  describe('Blockquotes', () => {
    it('should render blockquote', () => {
      render(<MarkdownRenderer content="> This is a quote" />);

      const blockquote = screen.getByText('This is a quote').closest('blockquote');
      expect(blockquote).toBeInTheDocument();
    });
  });

  describe('Horizontal Rule', () => {
    it('should render horizontal rule', () => {
      render(<MarkdownRenderer content={`Above

---

Below`} />);

      const hr = document.querySelector('hr');
      expect(hr).toBeInTheDocument();
    });
  });

  describe('Tables', () => {
    it('should render table', () => {
      render(
        <MarkdownRenderer
          content={`| Header 1 | Header 2 |
| -------- | -------- |
| Cell 1   | Cell 2   |`}
        />
      );

      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();

      const headers = screen.getAllByRole('columnheader');
      expect(headers).toHaveLength(2);
      expect(headers[0]).toHaveTextContent('Header 1');

      const cells = screen.getAllByRole('cell');
      expect(cells).toHaveLength(2);
      expect(cells[0]).toHaveTextContent('Cell 1');
    });
  });

  describe('Inline Code', () => {
    it('should render inline code', () => {
      render(<MarkdownRenderer content="Use `const` for constants" />);

      const code = screen.getByText('const');
      expect(code.tagName).toBe('CODE');
    });

    it('should style inline code differently from block code', () => {
      render(<MarkdownRenderer content="Inline `code` here" />);

      const code = screen.getByText('code');
      expect(code).toHaveClass('rounded');
    });
  });

  describe('Code Blocks', () => {
    it('should render code block', async () => {
      render(
        <MarkdownRenderer
          content={`\`\`\`javascript
const x = 1;
\`\`\``}
        />
      );

      // Wait for async highlighting
      await waitFor(() => {
        expect(screen.getByText('const x = 1;')).toBeInTheDocument();
      });
    });

    it('should display language label for code blocks', async () => {
      render(
        <MarkdownRenderer
          content={`\`\`\`python
print("hello")
\`\`\``}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('python')).toBeInTheDocument();
      });
    });

    it('should render code block without language', async () => {
      render(
        <MarkdownRenderer
          content={`\`\`\`
plain code
\`\`\``}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('plain code')).toBeInTheDocument();
      });
    });
  });

  describe('Images', () => {
    it('should render images', () => {
      render(<MarkdownRenderer content="![Alt text](https://example.com/image.png)" />);

      const img = screen.getByRole('img');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'https://example.com/image.png');
      expect(img).toHaveAttribute('alt', 'Alt text');
    });

    it('should have lazy loading on images', () => {
      render(<MarkdownRenderer content="![Test](https://example.com/test.png)" />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('loading', 'lazy');
    });
  });
});

describe('sanitizeContent', () => {
  describe('XSS Protection', () => {
    it('should remove script tags', () => {
      const malicious = '<script>alert("xss")</script>Hello';
      const sanitized = sanitizeContent(malicious);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('</script>');
      expect(sanitized).not.toContain('alert');
      expect(sanitized).toContain('Hello');
    });

    it('should remove script tags with attributes', () => {
      const malicious = '<script type="text/javascript">alert("xss")</script>';
      const sanitized = sanitizeContent(malicious);

      expect(sanitized).not.toContain('<script');
      expect(sanitized).not.toContain('alert');
    });

    it('should remove multiline script tags', () => {
      const malicious = `<script>
        var x = 1;
        alert(x);
      </script>`;
      const sanitized = sanitizeContent(malicious);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('alert');
    });

    it('should remove onclick handlers', () => {
      const malicious = '<div onclick="alert(1)">Click me</div>';
      const sanitized = sanitizeContent(malicious);

      expect(sanitized).not.toContain('onclick');
      expect(sanitized).not.toContain('alert');
    });

    it('should remove onmouseover handlers', () => {
      const malicious = '<img onmouseover="alert(1)" src="x">';
      const sanitized = sanitizeContent(malicious);

      expect(sanitized).not.toContain('onmouseover');
    });

    it('should remove onerror handlers', () => {
      const malicious = '<img onerror="alert(1)" src="invalid">';
      const sanitized = sanitizeContent(malicious);

      expect(sanitized).not.toContain('onerror');
    });

    it('should remove javascript: URLs', () => {
      const malicious = '<a href="javascript:alert(1)">Click</a>';
      const sanitized = sanitizeContent(malicious);

      expect(sanitized).not.toContain('javascript:');
    });

    it('should handle case-insensitive script tags', () => {
      const malicious = '<SCRIPT>alert(1)</SCRIPT>';
      const sanitized = sanitizeContent(malicious);

      expect(sanitized).not.toContain('SCRIPT');
      expect(sanitized).not.toContain('alert');
    });

    it('should preserve safe content', () => {
      const safe = '# Hello World\n\nThis is **safe** content.';
      const sanitized = sanitizeContent(safe);

      expect(sanitized).toBe(safe);
    });

    it('should handle empty content', () => {
      expect(sanitizeContent('')).toBe('');
    });

    it('should handle content with only whitespace', () => {
      expect(sanitizeContent('   ')).toBe('   ');
    });
  });
});

describe('MarkdownRenderer XSS Protection Integration', () => {
  it('should not render script tags in content', () => {
    render(<MarkdownRenderer content='<script>alert("xss")</script>Safe text' />);

    // The script should not be in the document
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText('Safe text')).toBeInTheDocument();
  });

  it('should not execute javascript: URLs', () => {
    render(<MarkdownRenderer content='[Click](javascript:alert(1))' />);

    // The link should not have javascript: protocol
    const links = screen.queryAllByRole('link');
    links.forEach((link) => {
      const href = link.getAttribute('href');
      expect(href).not.toContain('javascript:');
    });
  });
});
