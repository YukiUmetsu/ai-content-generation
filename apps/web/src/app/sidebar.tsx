import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Sidebar } from "@/components/ui/sidebar";
import type { Locale } from "@/features/registry";
import { StudioControls } from "./studio-controls";
import { SECTIONS, type SectionId } from "./navigation";

interface StudioSidebarProps {
  activeSection: SectionId;
  onSelectSection: (section: SectionId) => void;
  locale: Locale;
  onOpenShortcuts: () => void;
}

export function StudioSidebar({ activeSection, onSelectSection, locale, onOpenShortcuts }: StudioSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Sidebar
      aria-label="Main navigation"
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      className={collapsed ? "cg-sidebar--collapsed" : "cg-sidebar--expanded"}
    >
      <Sidebar.Header className="items-end px-0 pb-1">
        <Sidebar.Toggle
          collapseLabel={locale === "ja" ? "サイドバーを折りたたむ" : "Collapse sidebar"}
          expandLabel={locale === "ja" ? "サイドバーを展開" : "Expand sidebar"}
        />
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

      <Sidebar.Footer>
        <li className="w-full">
          <StudioControls collapsed={collapsed} onOpenShortcuts={onOpenShortcuts} />
        </li>
      </Sidebar.Footer>
    </Sidebar>
  );
}

interface MobileNavDrawerProps extends StudioSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileNavDrawer({ open, onOpenChange, activeSection, onSelectSection, locale, onOpenShortcuts }: MobileNavDrawerProps) {
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
        onOpenShortcuts={onOpenShortcuts}
      />
    </Dialog>
  );
}
