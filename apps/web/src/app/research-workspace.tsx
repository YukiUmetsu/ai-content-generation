import { Tabs } from "@/components/ui/tabs";
import { EvidencePanel } from "@/app/evidence-panel";
import { PackagingPanel } from "@/app/packaging-panel";
import { translate } from "@/i18n/messages";
import type { Locale } from "@/features/registry";

interface ResearchWorkspaceProps {
  locale: Locale;
}

export function ResearchWorkspace({ locale }: ResearchWorkspaceProps) {
  return (
    <section
      id="workspace"
      aria-label={translate(locale, "navEvidence")}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <Tabs
        defaultActiveIndex={0}
        label={translate(locale, "navEvidence")}
        className="flex min-h-0 flex-1 flex-col px-4 pb-4"
      >
        <Tabs.List className="mt-3 shrink-0" aria-label={translate(locale, "navLabel")}>
          <Tabs.Tab value={0} className="h-11">
            {translate(locale, "navEvidence")}
          </Tabs.Tab>
          <Tabs.Tab value={1} className="h-11">
            {translate(locale, "navPackaging")}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value={0} keepMounted className="mt-3 flex min-h-0 flex-1 flex-col overflow-auto">
          <EvidencePanel locale={locale} />
        </Tabs.Panel>

        <Tabs.Panel value={1} keepMounted className="mt-3 flex min-h-0 flex-1 flex-col overflow-auto">
          <PackagingPanel locale={locale} />
        </Tabs.Panel>
      </Tabs>
    </section>
  );
}
