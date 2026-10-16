import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

// --- Client-Only Markdown Renderer ---
function MarkdownRenderer({ content, isItalic = false }: { content: string, isItalic?: boolean }) {
    const [html, setHtml] = useState<string>("");

    useEffect(() => {
        if (!content) return;

        // We are safely in the browser, so window exists!
        const rawHtml = marked.parse(content) as string;
        const purifier = DOMPurify(window);
        setHtml(purifier.sanitize(rawHtml));
    }, [content]);

    // Server renders an empty div. Client hydrates an empty div. 
    // Then the client safely injects the HTML a millisecond later. Zero mismatch!
    return (
        <div
            className={`prose prose-sm max-w-none dark:prose-invert ${isItalic ? "italic" : ""}`}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}

export { MarkdownRenderer }