/**
 * Escape user input for use inside PostgREST/SQL ILIKE patterns with % wildcards.
 * Backslash must be first so we do not double-escape.
 */
export function escapeIlikePattern(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function ilikeContainsPattern(trimmedQuery: string): string {
  const escaped = escapeIlikePattern(trimmedQuery);
  return `%${escaped}%`;
}
