const REGEX_SPECIAL = /[.+?^${}()|[\]\\]/g;

/** Convert a glob (with only `*` as wildcard) into an anchored RegExp. */
export function globToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(REGEX_SPECIAL, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
}

/** True if `id` matches the glob `pattern`. */
export function matches(id: string, pattern: string): boolean {
    return globToRegex(pattern).test(id);
}

/** True if `id` matches at least one of the glob patterns. */
export function anyMatches(id: string, patterns: string[]): boolean {
    return patterns.some(p => matches(id, p));
}
