import { useId, useMemo, type KeyboardEvent } from "react";
import type { TimelineTranscriptItem } from "../../../contracts/timeline-types";
import { contextualPromptFromViewport } from "./contextual-prompt-model";
import type { TimelineViewport } from "./hooks/use-timeline-viewport";
import "../../styles/contextual-prompt.css";

interface ContextualPromptProps {
  readonly transcript: readonly TimelineTranscriptItem[];
  readonly viewport: Pick<TimelineViewport, "scrollTop" | "visibleRows">;
}

function handleHorizontalScrollKeys(event: KeyboardEvent<HTMLElement>): void {
  const element = event.currentTarget;
  const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
  let next: number | null = null;

  if (event.key === "ArrowLeft")
    next = Math.max(0, element.scrollLeft - Math.max(80, element.clientWidth * 0.8));
  if (event.key === "ArrowRight") {
    next = Math.min(maximum, element.scrollLeft + Math.max(80, element.clientWidth * 0.8));
  }
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = maximum;
  if (next === null) return;

  event.preventDefault();
  element.scrollLeft = next;
}

/** The human prompt that owns the response currently at the timeline viewport top. */
export function ContextualPrompt({ transcript, viewport }: ContextualPromptProps) {
  const prompt = useMemo(
    () => contextualPromptFromViewport(transcript, viewport.visibleRows, viewport.scrollTop),
    [transcript, viewport.scrollTop, viewport.visibleRows],
  );
  const labelId = useId();

  if (!prompt) return null;

  return (
    <div className="timeline-context-rail" data-testid="timeline-context-rail">
      <section
        className="timeline-contextual-prompt"
        data-testid="timeline-pinned-prompt"
        data-prompt-id={prompt.id}
        data-prompt-row-id={prompt.rowId}
        data-prompt-text={prompt.text}
        role="region"
        aria-labelledby={labelId}
        tabIndex={0}
        onKeyDown={handleHorizontalScrollKeys}
      >
        <span className="timeline-contextual-prompt__eyebrow" id={labelId}>
          Turn prompt
        </span>
        <span className="timeline-contextual-prompt__text" data-testid="timeline-prompt-text">
          {prompt.text}
        </span>
      </section>
    </div>
  );
}
