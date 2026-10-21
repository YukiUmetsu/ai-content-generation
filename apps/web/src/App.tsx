import { PreferencesProvider } from "@/app/providers";
import { Shell } from "@/app/shell";

export function App() {
  return (
    <PreferencesProvider>
      <Shell />
    </PreferencesProvider>
  );
}
