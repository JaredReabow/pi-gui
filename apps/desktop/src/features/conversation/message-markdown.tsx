import { isValidElement, memo, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon } from "../../ui/icons";
import { useConversationClipboard } from "./conversation-copy";
import {
  remarkWorkspaceFileLines,
  workspaceFileLineFromAnchorProps,
  type WorkspaceFileLine,
} from "./workspace-file-line";

const REMARK_PLUGINS = [remarkGfm];

function markdownComponents(
  onOpenWorkspaceFileLine?: (target: WorkspaceFileLine) => void,
): Components {
  return {
    code: ({ className, children }) => {
      const code = String(children).replace(/\n$/, "");
      return <code className={className}>{code}</code>;
    },
    pre: ({ children }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
    a: ({ href, children, ...props }) => {
      const file = onOpenWorkspaceFileLine ? workspaceFileLineFromAnchorProps(props) : null;
      if (file && onOpenWorkspaceFileLine) {
        return (
          <button
            className="message__file-link"
            data-end-line={file.endLine}
            data-line={file.line}
            data-path={file.path}
            data-testid="workspace-file-link"
            type="button"
            onClick={() => onOpenWorkspaceFileLine(file)}
          >
            {children}
          </button>
        );
      }
      return (
        <a href={href} rel="noreferrer" target="_blank">
          {children}
        </a>
      );
    },
    table: ({ children }) => (
      <div className="message__table-scroll">
        <table>{children}</table>
      </div>
    ),
  };
}

function MarkdownCodeBlock({ children }: { readonly children?: ReactNode }) {
  const clipboard = useConversationClipboard();
  const code = markdownText(children).replace(/\n$/, "");
  const language = markdownCodeLanguage(children);
  const label =
    clipboard.state === "success"
      ? "Copied"
      : clipboard.state === "error"
        ? "Copy failed"
        : "Copy code";
  return (
    <div className="message__code-block" data-language={language || undefined}>
      <button
        aria-label={label}
        className="conversation-copy-button"
        data-copy-state={clipboard.state}
        data-testid="copy-code"
        title="Copy raw code"
        type="button"
        onClick={() => clipboard.copyText(code)}
      >
        {clipboard.state === "success" ? <CheckIcon /> : <CopyIcon />}
        <span className="conversation-copy-button__tooltip" aria-hidden="true">
          {label}
        </span>
      </button>
      <span
        aria-live={clipboard.state === "error" ? "assertive" : "polite"}
        className="conversation-copy-announcement"
        role={clipboard.state === "error" ? "alert" : "status"}
      >
        {clipboard.announcement}
      </span>
      <pre className="message__code-block-pre">{children}</pre>
    </div>
  );
}

function markdownText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(markdownText).join("");
  if (isValidElement(node)) {
    const props = node.props as { readonly children?: ReactNode };
    return markdownText(props.children);
  }
  return "";
}

function markdownCodeLanguage(node: ReactNode): string | undefined {
  const child: ReactNode = Array.isArray(node) ? (node[0] as ReactNode) : node;
  if (!isValidElement(child)) return undefined;
  const className = (child.props as { readonly className?: unknown }).className;
  return typeof className === "string"
    ? /(?:^|\s)language-([^\s]+)/.exec(className)?.[1]
    : undefined;
}

const PLAIN_MARKDOWN_COMPONENTS = markdownComponents();

// Memoized: remark parsing is the dominant render cost on long threads, and the
// timeline re-renders on every streaming tick. `text` is a string, so shallow
// comparison skips the re-parse for every message except the one still growing.
export const MessageMarkdown = memo(function MessageMarkdown({
  text,
  workspacePath,
  onOpenWorkspaceFileLine,
  annotationRoot = false,
}: {
  readonly text: string;
  /** Marks this text as what transcript annotations anchor to. */
  readonly annotationRoot?: boolean;
  readonly workspacePath?: string;
  readonly onOpenWorkspaceFileLine?: (target: WorkspaceFileLine) => void;
}) {
  const components = useMemo(
    () =>
      onOpenWorkspaceFileLine
        ? markdownComponents(onOpenWorkspaceFileLine)
        : PLAIN_MARKDOWN_COMPONENTS,
    [onOpenWorkspaceFileLine],
  );
  const remarkPlugins = useMemo(
    () =>
      onOpenWorkspaceFileLine
        ? [remarkGfm, remarkWorkspaceFileLines(workspacePath ?? null)]
        : REMARK_PLUGINS,
    [onOpenWorkspaceFileLine, workspacePath],
  );
  return (
    <div className="message__content" data-annotation-root={annotationRoot ? "" : undefined}>
      <ReactMarkdown components={components} remarkPlugins={remarkPlugins}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
