import { posix } from "node:path";

/** Resolve a registry source path while preserving its namespace and relative-import structure. */
export function targetForRegistryFile(sourcePath, componentRoot = "src/components") {
  const normalized = sourcePath.replaceAll("\\", "/");
  if (!normalized.startsWith("registry/")) {
    throw new Error(\`Registry source must begin with "registry/": \${sourcePath}\`);
  }
  const relativePath = normalized.slice("registry/".length);
  const parts = relativePath.split("/");
  const root = componentRoot.replaceAll("\\", "/");
  if (
    !relativePath ||
    root.startsWith("/") ||
    parts.some((part) => !part || part === "." || part === "..") ||
    root.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(\`Unsafe registry target path: \${sourcePath}\`);
  }
  return posix.join(root, ...parts);
}

/** Deduplicate repeated dependency references, but reject different sources targeting one file. */
export function dedupeVendorFiles(files) {
  const byTarget = new Map();
  for (const file of files) {
    const existing = byTarget.get(file.target);
    if (existing && existing.source !== file.source) {
      throw new Error(
        \`Kumiki registry target collision at \${file.target}: \${existing.source} vs \${file.source}\`,
      );
    }
    if (!existing) byTarget.set(file.target, file);
  }
  return [...byTarget.values()];
}
