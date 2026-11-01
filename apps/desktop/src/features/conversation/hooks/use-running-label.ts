import { useEffect, useState } from "react";
import { conversationDurationRunningLabel } from "../conversation-duration";

export function useRunningLabel(startedAt: string | undefined) {
  const [label, setLabel] = useState(() => conversationDurationRunningLabel(startedAt));

  useEffect(() => {
    setLabel(conversationDurationRunningLabel(startedAt));
    if (!startedAt) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setLabel(conversationDurationRunningLabel(startedAt));
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [startedAt]);

  return label;
}
