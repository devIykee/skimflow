"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders imported/creator markdown as styled HTML.
 *
 * Imported content is stored as markdown (Turndown output), so rendering it as
 * raw text showed literal `**bold**`, `## headings`, `[links](…)`, and
 * `![](img)`. This renders it properly — crucially, images render INLINE in
 * position instead of appearing as bare links. Used for every unlocked/free
 * block in the reader.
 */
export default function RichText({ source }: { source: string }) {
  return (
    <div className="rich-text font-body-lg text-body-lg leading-relaxed text-on-surface">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }) =>
            typeof src === "string" && src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={alt ?? ""}
                loading="lazy"
                className="my-4 h-auto max-w-full rounded-lg border border-outline-variant"
              />
            ) : null,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
          h1: ({ children }) => <h1 className="mb-3 mt-5 font-headline-sm text-headline-sm">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-5 font-headline-sm text-headline-sm">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-4 font-label-lg text-label-lg">{children}</h3>,
          p: ({ children }) => <p className="mb-4">{children}</p>,
          ul: ({ children }) => <ul className="mb-4 list-disc pl-6">{children}</ul>,
          ol: ({ children }) => <ol className="mb-4 list-decimal pl-6">{children}</ol>,
          li: ({ children }) => <li className="mb-1">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-4 border-l-4 border-outline-variant pl-4 italic text-on-surface-variant">
              {children}
            </blockquote>
          ),
          code: ({ children, className }) =>
            className?.includes("language-") ? (
              <code className={`${className} font-data-mono text-[13px]`}>{children}</code>
            ) : (
              <code className="rounded bg-surface-container px-1 py-0.5 font-data-mono text-[13px]">{children}</code>
            ),
          pre: ({ children }) => (
            <pre className="my-4 overflow-x-auto rounded-lg bg-[#0b0c10] p-4 font-data-mono text-[12px] text-[#e4e2dd]">
              {children}
            </pre>
          ),
          hr: () => <hr className="my-6 border-outline-variant" />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
