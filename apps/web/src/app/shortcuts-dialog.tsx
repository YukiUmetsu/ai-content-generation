import { Fragment, useState } from "react";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { usePreferences } from "./use-preferences";
import type { Locale } from "@/features/registry";

interface ShortcutsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the visible label; the accessible name stays "Shortcuts". */
  iconOnly?: boolean;
  className?: string;
  /** Render the dialog without its trigger button (for layouts that supply their own). */
  showTrigger?: boolean;
}

function shortcutRows(locale: Locale) {
  const t = {
    en: {
      open: "Open keyboard shortcuts",
      focus: "Focus tool filter",
      switch: "Switch studio tool",
      close: "Close dialog or panel",
      keys: (k: string) => k,
    },
    ja: {
      open: "キーボードショートカットを開く",
      focus: "ツール検索にフォーカス",
      switch: "スタジオツールを切り替え",
      close: "ダイアログやパネルを閉じる",
      keys: (k: string) => k,
    },
  }[locale];

  return [
    { keys: ["?"], action: t.open },
    { keys: ["Ctrl / Cmd", "K"], action: t.focus },
    { keys: ["1 – 5"], action: t.switch },
    { keys: ["Esc"], action: t.close },
  ];
}

export function ShortcutsDialog({
  open: controlledOpen,
  onOpenChange,
  iconOnly = false,
  className,
  showTrigger = true,
}: ShortcutsDialogProps) {
  const { locale } = usePreferences();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const label = locale === "ja" ? "ショートカット" : "Shortcuts";

  return (
    <>
      {showTrigger && (
        <Button
          variant="outline"
          size={iconOnly ? "icon" : "sm"}
          className={className}
          aria-label={label}
          title={label}
          icon={<Keyboard aria-hidden className="size-4" />}
          onClick={() => setOpen(true)}
        >
          {!iconOnly && label}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={locale === "ja" ? "キーボードショートカット" : "Keyboard shortcuts"}
        size="sm"
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
          {shortcutRows(locale).map((row, index) => (
            <Fragment key={index}>
              <dt className="font-mono text-muted-foreground">{row.keys.join(" + ")}</dt>
              <dd className="text-foreground">{row.action}</dd>
            </Fragment>
          ))}
        </dl>
      </Dialog>
    </>
  );
}
