import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";

interface FeatureErrorBoundaryProps {
  children: ReactNode;
  title?: string;
}

interface FeatureErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  resetKey: number;
}

export class FeatureErrorBoundary extends Component<FeatureErrorBoundaryProps, FeatureErrorBoundaryState> {
  state: FeatureErrorBoundaryState = { hasError: false, error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<FeatureErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("Feature boundary caught error:", error, info);
    }
  }

  handleReset = () => {
    this.setState((prev) => ({ hasError: false, error: null, resetKey: prev.resetKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <Surface variant="outline" className="h-full justify-center p-6">
          <div className="flex items-start gap-4">
            <AlertTriangle aria-hidden className="size-6 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-foreground">
                {this.props.title ? `${this.props.title} could not load.` : "This tool could not load."}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {this.state.error?.message ?? "An unexpected error occurred."}
              </p>
              <Button className="mt-4" onClick={this.handleReset} variant="secondary" size="sm">
                Try again
              </Button>
            </div>
          </div>
        </Surface>
      );
    }

    return (
      <div key={this.state.resetKey} className="h-full">
        {this.props.children}
      </div>
    );
  }
}
