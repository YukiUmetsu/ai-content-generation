import { Info, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import { translate } from "@/i18n/messages";
import type { ApiError } from "@/lib/api/client";
import type { Locale } from "@/features/registry";

interface ApiErrorNoticeProps {
  error: ApiError;
  locale: Locale;
  onRetry: () => void;
  /** Override the default localized error heading. */
  title?: string;
  /** Override the message rendered under the heading. */
  message?: string;
  /** Hide the server hint when the screen already explains the failure. */
  hideHint?: boolean;
}

/**
 * Shared failure surface for the local API panels. Keeps one consistent
 * code/status/retry treatment instead of three near-identical local copies.
 */
export function ApiErrorNotice({
  error,
  locale,
  onRetry,
  title,
  message,
  hideHint = false,
}: ApiErrorNoticeProps) {
  return (
    <Surface variant="outline" className="border-danger/40 bg-danger/5">
      <div className="flex items-start gap-3">
        <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
        <div className="grid flex-1 gap-2">
          <p className="font-medium text-foreground">{title ?? translate(locale, "errorTitle")}</p>
          <p className="text-foreground">{message ?? error.message}</p>
          {!hideHint && error.hint && (
            <p className="break-words text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{translate(locale, "errorServerDetail")}: </span>
              {error.hint}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>
              {translate(locale, "errorCode")}: <code className="text-foreground">{error.code}</code>
            </span>
            {error.status != null && (
              <span>
                {translate(locale, "httpStatus")}: <span className="text-foreground">{error.status}</span>
              </span>
            )}
          </div>
          <div className="mt-1">
            <Button variant="secondary" onClick={onRetry} icon={<RotateCcw aria-hidden className="size-4" />}>
              {translate(locale, "retry")}
            </Button>
          </div>
        </div>
      </div>
    </Surface>
  );
}
