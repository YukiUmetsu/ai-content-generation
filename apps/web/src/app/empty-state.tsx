import { Surface } from "@/components/ui/surface-card";

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Surface variant="ghost" className="h-full items-center justify-center p-6 text-center">
      <div className="max-w-sm">
        <p className="font-serif text-subheading text-foreground text-pretty">{title}</p>
        <p className="mt-2 text-body-sm text-muted-foreground text-pretty">{description}</p>
      </div>
    </Surface>
  );
}
