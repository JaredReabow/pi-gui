import type {
  ChildModelSelection,
  EffectiveChildModelSettings,
} from "../../contracts/child-selection";
import {
  childSelection_decode,
  childSelection_isThinkingLevel,
} from "../../contracts/child-selection";
import type { CreateSessionOptions } from "@pi-gui/session-driver";

/**
 * Applies an optional child selection to the runtime owner's existing create options.
 *
 * Prompt-only calls return the owner's options unchanged. Explicit calls must name an
 * available, enabled model and may only request thinking when that model supports it.
 * No model or thinking level is substituted when validation fails.
 */
export function childModelSelection_createOptions(
  effective: EffectiveChildModelSettings,
  selection: ChildModelSelection,
  baseOptions: CreateSessionOptions | undefined,
): CreateSessionOptions {
  const requested = childSelection_decode(selection);
  const model = effective.models.find(
    (candidate) =>
      candidate.provider === requested.provider && candidate.modelId === requested.modelId,
  );
  if (!model) {
    throw new Error(`Unknown child model: ${requested.provider}/${requested.modelId}`);
  }
  if (!model.available) {
    throw new Error(`Child model is unavailable: ${requested.provider}/${requested.modelId}`);
  }
  if (model.scope === "off") {
    throw new Error(`Child model is disabled: ${requested.provider}/${requested.modelId}`);
  }

  const initialThinkingLevel = requested.thinkingLevel ?? baseOptions?.initialThinkingLevel;
  if (initialThinkingLevel !== undefined) {
    if (!childSelection_isThinkingLevel(initialThinkingLevel)) {
      throw new Error(`Unsupported child thinking level: ${initialThinkingLevel}`);
    }
    if (!model.reasoning && initialThinkingLevel !== "off") {
      throw new Error(
        `Child model ${requested.provider}/${requested.modelId} does not support thinking level ${initialThinkingLevel}.`,
      );
    }
  }

  return {
    ...baseOptions,
    initialModel: {
      provider: requested.provider,
      modelId: requested.modelId,
    },
    ...(initialThinkingLevel === undefined ? {} : { initialThinkingLevel }),
  };
}
