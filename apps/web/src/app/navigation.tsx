import type { ReactNode } from "react";
import {
  BarChart3,
  FileText,
  Folder,
  Image,
  ListChecks,
  Package,
  PenTool,
  Workflow,
  Search,
  Settings,
  PawPrint,
} from "lucide-react";
import type { Locale } from "@/features/registry";

export type SectionId =
  | "production"
  | "projects"
  | "research"
  | "create"
  | "content"
  | "assets"
  | "characters"
  | "products"
  | "jobs-qa"
  | "insights"
  | "settings";

export const SECTIONS: { id: SectionId; label: Record<Locale, string>; icon: ReactNode }[] = [
  { id: "production", label: { en: "Production", ja: "動画制作" }, icon: <Workflow aria-hidden className="size-5" /> },
  { id: "projects", label: { en: "Projects", ja: "プロジェクト" }, icon: <Folder aria-hidden className="size-5" /> },
  { id: "research", label: { en: "Research", ja: "調査" }, icon: <Search aria-hidden className="size-5" /> },
  { id: "create", label: { en: "Create", ja: "作成" }, icon: <PenTool aria-hidden className="size-5" /> },
  { id: "content", label: { en: "Content", ja: "コンテンツ" }, icon: <FileText aria-hidden className="size-5" /> },
  { id: "assets", label: { en: "Assets", ja: "アセット" }, icon: <Image aria-hidden className="size-5" /> },
  { id: "characters", label: { en: "Character Studio", ja: "キャラクター制作" }, icon: <PawPrint aria-hidden className="size-5" /> },
  { id: "products", label: { en: "Products", ja: "プロダクト" }, icon: <Package aria-hidden className="size-5" /> },
  {
    id: "jobs-qa",
    label: { en: "Jobs & QA", ja: "ジョブとQA" },
    icon: <ListChecks aria-hidden className="size-5" />,
  },
  { id: "insights", label: { en: "Insights", ja: "分析" }, icon: <BarChart3 aria-hidden className="size-5" /> },
  { id: "settings", label: { en: "Settings", ja: "設定" }, icon: <Settings aria-hidden className="size-5" /> },
];

export function sectionLabel(id: SectionId, locale: Locale): string {
  return SECTIONS.find((s) => s.id === id)?.label[locale] ?? id;
}
