import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SupportDevelopmentDismissal,
  SupportDevelopmentOption,
  SupportDevelopmentOptionId,
  SupportDevelopmentState,
} from "../../../contracts/ipc";
import { useTranslation } from "../../i18n";
import "../../styles/support-development.css";

type OpenStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "opened" }
  | { readonly kind: "error"; readonly optionId: SupportDevelopmentOptionId };

export function SupportDevelopmentPanel() {
  const { t } = useTranslation();
  const [state, setState] = useState<SupportDevelopmentState | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [manualExpanded, setManualExpanded] = useState(false);
  const [pendingOptionId, setPendingOptionId] = useState<SupportDevelopmentOptionId | undefined>(
    undefined,
  );
  const [pendingDismissal, setPendingDismissal] = useState<SupportDevelopmentDismissal | undefined>(
    undefined,
  );
  const [openStatus, setOpenStatus] = useState<OpenStatus>({ kind: "idle" });
  const [dismissError, setDismissError] = useState(false);
  const pendingOption = useRef<SupportDevelopmentOptionId | undefined>(undefined);
  const loadGeneration = useRef(0);

  const loadState = useCallback(() => {
    const generation = ++loadGeneration.current;
    setState(undefined);
    setLoadError(false);
    const api = window.piApp;
    if (!api?.getSupportDevelopment) {
      setLoadError(true);
      return;
    }
    void api.getSupportDevelopment().then(
      (nextState) => {
        if (loadGeneration.current === generation) setState(nextState);
      },
      () => {
        if (loadGeneration.current === generation) setLoadError(true);
      },
    );
  }, []);

  useEffect(() => {
    loadState();
    return () => {
      loadGeneration.current += 1;
    };
  }, [loadState]);

  const openOption = useCallback(async (optionId: SupportDevelopmentOptionId) => {
    if (pendingOption.current) return;
    const api = window.piApp;
    if (!api?.openSupportDevelopment) {
      setOpenStatus({ kind: "error", optionId });
      return;
    }
    pendingOption.current = optionId;
    setPendingOptionId(optionId);
    setOpenStatus({ kind: "idle" });
    try {
      await api.openSupportDevelopment(optionId);
      setOpenStatus({ kind: "opened" });
    } catch {
      setOpenStatus({ kind: "error", optionId });
    } finally {
      pendingOption.current = undefined;
      setPendingOptionId(undefined);
    }
  }, []);

  const dismiss = async (choice: SupportDevelopmentDismissal) => {
    if (pendingDismissal || pendingOption.current) return;
    const api = window.piApp;
    if (!api?.dismissSupportDevelopment) {
      setDismissError(true);
      return;
    }
    setPendingDismissal(choice);
    setDismissError(false);
    try {
      const nextState = await api.dismissSupportDevelopment(choice);
      setState(nextState);
      setManualExpanded(false);
    } catch {
      // The service updates its state only after a durable write succeeds.
      setDismissError(true);
    } finally {
      setPendingDismissal(undefined);
    }
  };

  const monthly = state?.options.filter((option) => option.cadence === "monthly") ?? [];
  const oneOff = state?.options.filter((option) => option.cadence === "one-off") ?? [];
  const hidden = Boolean(state?.currentPromptDismissed || state?.dontAskAgain);
  const expanded = Boolean(state && (!hidden || manualExpanded));
  const panelState = loadError
    ? "error"
    : state === undefined
      ? "loading"
      : hidden
        ? "hidden"
        : "open";

  return (
    <section
      aria-busy={state === undefined && !loadError}
      aria-labelledby="support-development-title"
      className="support-development"
      data-state={panelState}
      data-testid="support-development-panel"
    >
      <div className="support-development__header">
        <h3 className="settings-section__title" id="support-development-title">
          {t("settings.support.title")}
        </h3>
        <p className="settings-section__description">{t("settings.support.description")}</p>
      </div>

      {panelState === "loading" ? (
        <p aria-live="polite" className="support-development__notice">
          {t("settings.support.loading")}
        </p>
      ) : null}

      {panelState === "error" ? (
        <div className="support-development__error" role="alert">
          <span>{t("settings.support.loadError")}</span>
          <button className="support-development__text-button" type="button" onClick={loadState}>
            {t("settings.support.retryLoad")}
          </button>
        </div>
      ) : null}

      {state && !expanded ? (
        <div className="support-development__hidden">
          <p>
            {state.dontAskAgain
              ? t("settings.support.hiddenPersistent")
              : t("settings.support.hidden")}
          </p>
          <button
            className="support-development__text-button"
            type="button"
            onClick={() => setManualExpanded(true)}
          >
            {t("settings.support.showOptions")}
          </button>
        </div>
      ) : null}

      {state && expanded ? (
        <>
          <p className="support-development__boundary">
            {t("settings.support.checkoutDescription")}
          </p>

          <div
            className="support-development__group"
            role="group"
            aria-label={t("settings.support.monthly")}
          >
            <div className="support-development__group-label">{t("settings.support.monthly")}</div>
            <div className="support-development__offers support-development__offers--monthly">
              {monthly.map((option) => (
                <SupportOfferButton
                  key={option.id}
                  option={option}
                  pending={pendingOptionId === option.id}
                  disabled={pendingOptionId !== undefined}
                  onOpen={openOption}
                />
              ))}
            </div>
          </div>

          <div
            className="support-development__group"
            role="group"
            aria-label={t("settings.support.oneOff")}
          >
            <div className="support-development__group-label">{t("settings.support.oneOff")}</div>
            <div className="support-development__offers support-development__offers--one-off">
              {oneOff.map((option) => (
                <SupportOfferButton
                  key={option.id}
                  option={option}
                  pending={pendingOptionId === option.id}
                  disabled={pendingOptionId !== undefined}
                  onOpen={openOption}
                />
              ))}
            </div>
          </div>

          <div aria-live="polite" className="support-development__status">
            {openStatus.kind === "opened" ? <span>{t("settings.support.opened")}</span> : null}
            {openStatus.kind === "error" ? (
              <div className="support-development__error" role="alert">
                <span>{t("settings.support.openError")}</span>
                <button
                  className="support-development__text-button"
                  disabled={pendingOptionId !== undefined}
                  type="button"
                  onClick={() => {
                    openOption(openStatus.optionId).catch(() => undefined);
                  }}
                >
                  {t("settings.support.retry")}
                </button>
              </div>
            ) : null}
          </div>

          <div className="support-development__footer">
            <div className="support-development__dismiss-actions">
              <button
                className="support-development__text-button"
                disabled={pendingDismissal !== undefined || pendingOptionId !== undefined}
                type="button"
                onClick={() => {
                  dismiss("not-now").catch(() => undefined);
                }}
              >
                {pendingDismissal === "not-now"
                  ? t("settings.support.loading")
                  : t("settings.support.notNow")}
              </button>
              <button
                className="support-development__text-button"
                disabled={pendingDismissal !== undefined || pendingOptionId !== undefined}
                type="button"
                onClick={() => {
                  dismiss("dont-ask-again").catch(() => undefined);
                }}
              >
                {pendingDismissal === "dont-ask-again"
                  ? t("settings.support.loading")
                  : t("settings.support.dontAskAgain")}
              </button>
            </div>
            {dismissError ? (
              <p className="support-development__error" role="alert">
                {t("settings.support.dismissError")}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function SupportOfferButton({
  option,
  pending,
  disabled,
  onOpen,
}: {
  readonly option: SupportDevelopmentOption;
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly onOpen: (optionId: SupportDevelopmentOptionId) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <button
      aria-label={t("settings.support.open", {
        offer: option.label,
        provider: option.providerLabel,
      })}
      className="support-development__offer"
      data-pending={pending}
      data-option-id={option.id}
      disabled={disabled}
      type="button"
      onClick={() => {
        onOpen(option.id).catch(() => undefined);
      }}
    >
      <span className="support-development__offer-copy">
        <span className="support-development__offer-label">{option.label}</span>
        <span className="support-development__offer-provider">
          {option.amount
            ? `${option.providerLabel} (${option.amount.currency})`
            : option.providerLabel}
        </span>
        {option.recipient ? (
          <span className="support-development__offer-recipient">
            {t("settings.support.paypalRecipient", { recipient: option.recipient })}
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="support-development__offer-action">
        {pending ? t("settings.support.opening") : null}
      </span>
    </button>
  );
}
