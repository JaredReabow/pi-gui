import type { ActivityIndicatorStyle } from "../../contracts/sidebar-preferences";

interface ActivityIndicatorProps {
  readonly style: ActivityIndicatorStyle;
  readonly className?: string;
}

/**
 * Animated running state shared by every surface that reports active work.
 *
 * The SVG paths remain inline so the indicator inherits the surrounding text
 * colour and stays crisp at the sidebar's compact size. Motion is disabled by
 * the stylesheet when the operating system requests reduced motion.
 */
export function ActivityIndicator({ style, className }: ActivityIndicatorProps) {
  let shape;

  switch (style) {
    case "moonwalk":
      shape = (
        <>
          <g transform="translate(0 5) scale(.62)">
            <g className="activity-moonwalk-partner">
              <circle cx="8" cy="3" r="2" />
              <path d="M8 6v7" />
              <path className="activity-limbs" d="M8 8L2 5 M8 8l6-3" />
              <path className="activity-legs" d="M8 13l-4 7 M8 13l4 7" />
            </g>
          </g>
          <g transform="translate(10 5) scale(.62)">
            <g className="activity-moonwalk">
              <circle cx="13" cy="4" r="2" />
              <path d="M11 2h5 M13 6l-1 7 M15 4h1" />
              <path className="activity-moonwalk-arm" d="M13 8l3 3 3-1" />
              <path
                className="activity-moonwalk-leg activity-moonwalk-leg--back"
                d="M12 13 L15 17 L17 21 L21 21"
              />
              <path className="activity-moonwalk-leg" d="M12 13 L15 17 L17 21 L21 21" />
            </g>
          </g>
        </>
      );
      break;
    case "stick":
      shape = (
        <>
          <circle cx="12" cy="4" r="2" />
          <path className="activity-limbs" d="M12 7v7 M12 9L5 6 M12 9l7-3" />
          <path className="activity-legs" d="M12 14l-5 7 M12 14l5 7" />
        </>
      );
      break;
    case "wheel":
      shape = <circle className="activity-spin" cx="12" cy="12" r="8" strokeDasharray="36 15" />;
      break;
    case "ball":
      shape = <circle className="activity-ball" cx="12" cy="14" r="4" />;
      break;
    case "wave":
      shape = <path className="activity-wave" d="M-12 12q6-12 12 0t12 0t12 0t12 0" />;
      break;
    case "spiral":
      shape = <path className="activity-spin" d="M12 12c-3-4 5-6 5 0s-11 8-11 0 17-12 17 0" />;
      break;
  }

  return (
    <span
      aria-label="Running"
      className={["activity-indicator", className].filter(Boolean).join(" ")}
      data-activity-style={style}
      data-testid="activity-indicator"
      role="img"
    >
      <svg
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        {shape}
      </svg>
    </span>
  );
}
