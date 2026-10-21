// The Field + Input implementation lives in `field-input.tsx` (single source of
// truth). This module keeps the historical `input` entry point stable, so the
// `src/ui/input.tsx` showcase alias and existing consumers keep working.
export { Input, Field } from "./field-input";
export type { InputProps, FieldProps } from "./field-input";
export { default } from "./field-input";
