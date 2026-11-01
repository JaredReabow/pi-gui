import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { ProjectAccentColor } from "../../../contracts/project-identity";

interface ProjectAccentBridgeGeometry {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

interface ProjectAccentBridgeProps {
  readonly active: boolean;
  readonly color: ProjectAccentColor;
}

type ProjectAccentBridgeStyle = CSSProperties & {
  readonly "--workspace-accent": ProjectAccentColor;
  readonly "--project-header-fill": ProjectAccentColor;
};

/**
 * Draws the active project header into the sidebar's perimeter gutter.
 *
 * The bridge is measured from the real row and portalled to the document so
 * sidebar scrolling and ancestor overflow cannot clip it. Rows stay ordinary
 * rounded controls; only the active project header owns this window join.
 */
export function ProjectAccentBridge({ active, color }: ProjectAccentBridgeProps) {
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const [geometry, setGeometry] = useState<ProjectAccentBridgeGeometry | null>(null);

  useLayoutEffect(() => {
    const row = markerRef.current?.parentElement;
    const sidebar = row?.closest(".sidebar");
    const scroller = row?.closest(".sidebar__section");
    if (!active || !row || !sidebar || !scroller) {
      setGeometry(null);
      return;
    }

    let frame = 0;
    const measure = () => {
      const rowRect = row.getBoundingClientRect();
      const clipRect = scroller.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      const visibleWithinSidebar =
        rowRect.top >= clipRect.top &&
        rowRect.bottom <= clipRect.bottom &&
        sidebarRect.width > 0 &&
        window.innerWidth > 760;
      const next = visibleWithinSidebar
        ? {
            top: rowRect.top - sidebarRect.top,
            left: 0,
            width: rowRect.right - sidebarRect.left,
            height: rowRect.height,
          }
        : null;
      setGeometry((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(row);
    resizeObserver.observe(sidebar);
    resizeObserver.observe(scroller);
    // Expanding an earlier project moves later rows without resizing them.
    const mutations = new MutationObserver(schedule);
    mutations.observe(scroller, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [active, color]);

  const sidebar = markerRef.current?.parentElement?.closest(".sidebar");

  return (
    <Fragment>
      <span ref={markerRef} aria-hidden="true" style={{ display: "none" }} />
      {active && geometry && sidebar
        ? createPortal(
            <span
              aria-hidden="true"
              className="project-accent-bridge"
              data-workspace-accent={color}
              data-testid="project-accent-bridge"
              style={
                {
                  ...geometry,
                  "--workspace-accent": color,
                  "--project-header-fill": color,
                } as ProjectAccentBridgeStyle
              }
            />,
            sidebar,
          )
        : null}
    </Fragment>
  );
}
