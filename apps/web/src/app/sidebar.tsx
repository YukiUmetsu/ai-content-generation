import { Dialog } from "@/components/ui/dialog";
import { Sidebar } from "@/components/ui/sidebar";
import type { Locale } from "@/features/registry";
import { SECTIONS, type SectionId } from "./navigation";

interface StudioSidebarProps {
  activeSection: SectionId;
  onSelectSection: (section: SectionId) => void;
  locale: Locale;
}

export function StudioSidebar({ activeSection, onSelectSection, locale }: StudioSidebarProps) {
  return (
    <Sidebar aria-label="Main navigation">
      <Sidebar.Header className="px-2 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3 overflow-hidden">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-control bg-foreground font-serif text-lg font-medium text-inverse-foreground">
              C
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">ContentGen</span>
              <span className="truncate text-caption text-muted-foreground">
                {locale === "ja" ? "無題のプロジェクト" : "Untitled project"}
              </span>
            </div>
          </div>
          <Sidebar.Toggle
            collapseLabel={locale === "ja" ? "サイドバーを折りたたむ" : "Collapse sidebar"}
            expandLabel={locale === "ja" ? "サイドバーを展開" : "Expand sidebar"}
          />
        </div>
      </Sidebar.Header>

      <Sidebar.Nav>
        {SECTIONS.map((section) => (
          <Sidebar.Item
            key={section.id}
            href="#"
            active={activeSection === section.id}
            icon={section.icon}
            onClick={(event) => {
              event.preventDefault();
              onSelectSection(section.id);
            }}
          >
            {section.label[locale]}
          </Sidebar.Item>
        ))}
      </Sidebar.Nav>
    </Sidebar>
  );
}

interface MobileNavDrawerProps extends StudioSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileNavDrawer({ open, onOpenChange, activeSection, onSelectSection, locale }: MobileNavDrawerProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      className="absolute inset-y-0 left-0 m-0 h-full max-w-64 rounded-none border-y-0 border-l-0 p-0 shadow"
    >
      <StudioSidebar
        activeSection={activeSection}
        onSelectSection={(section) => {
          onSelectSection(section);
          onOpenChange(false);
        }}
        locale={locale}
      />
    </Dialog>
  );
}

