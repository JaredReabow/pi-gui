import { lstat, realpath } from "node:fs/promises";
import { dirname, basename, resolve, relative, isAbsolute, sep, join } from "node:path";

const PROTECTED = new Set([
  ".git",
  ".pi",
  ".agents",
  ".codex",
  ".aws",
  ".ssh",
  ".gnupg",
  ".vscode",
]);
const SENSITIVE_FILE =
  /^(?:\.env(?:\..*)?|\.npmrc|auth\.json|credentials(?:\..*)?|AGENTS(?:\.override)?\.md|CLAUDE\.md)$/i;
export async function autonomyPath(
  cwd: string,
  input: unknown,
  protectedPaths: readonly string[] = [],
): Promise<{ scoped: boolean; path: string; reason: string }> {
  if (
    typeof input !== "string" ||
    !input ||
    input.startsWith("@") ||
    input.startsWith("~") ||
    /^[a-z][a-z0-9+.-]*:/i.test(input) ||
    input.includes("%") ||
    /[\x00-\x1f\u00a0\u2000-\u200a\u202f\u205f\u3000]/.test(input)
  )
    return { scoped: false, path: String(input), reason: "Ambiguous or unsupported path syntax" };
  const root = await realpath(cwd);
  const requested = resolve(root, input);
  const tail: string[] = [];
  let ancestor = requested;
  let canonical: string;
  for (;;) {
    try {
      canonical = join(await realpath(ancestor), ...tail);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || ancestor === dirname(ancestor))
        return { scoped: false, path: requested, reason: "Cannot establish canonical path" };
      tail.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
  const inside = (path: string) => {
    const r = relative(root, path);
    return r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r);
  };
  if (!inside(canonical))
    return {
      scoped: false,
      path: canonical,
      reason: "Path is outside the project (including symlink targets)",
    };
  if (/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/.test(canonical))
    return {
      scoped: false,
      path: canonical,
      reason: "SDK-normalized Unicode path requires explicit approval",
    };
  for (const excluded of protectedPaths) {
    const authority = await realpath(excluded);
    const r = relative(authority, canonical);
    if (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r))
      return {
        scoped: false,
        path: canonical,
        reason: "Application authority and credentials require explicit approval",
      };
  }
  for (const path of [requested, canonical]) {
    if (
      path.split(sep).some((part) => PROTECTED.has(part.toLowerCase()) || SENSITIVE_FILE.test(part))
    )
      return {
        scoped: false,
        path: canonical,
        reason: "Protected configuration, agent instructions or credentials",
      };
  }
  const lexicalRoot = resolve(cwd);
  const boundary = inside(requested) ? root : lexicalRoot;
  const lexicalRelative = relative(boundary, requested);
  if (
    lexicalRelative === ".." ||
    lexicalRelative.startsWith(`..${sep}`) ||
    isAbsolute(lexicalRelative)
  )
    return { scoped: false, path: canonical, reason: "Non-project alias requires approval" };
  let current = requested;
  while (current !== boundary) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1))
        return {
          scoped: false,
          path: canonical,
          reason: "Symlink/hardlink requires explicit approval",
        };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        return { scoped: false, path: requested, reason: "Cannot inspect path" };
    }
    current = dirname(current);
  }
  return { scoped: true, path: canonical, reason: "Inside the project" };
}
