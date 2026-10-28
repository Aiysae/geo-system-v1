const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

/**
 * JSON for a Postgres jsonb parameter. Text cut to a length with slice() can end
 * halfway through an emoji; JSON.stringify writes the stray half as \ud83d, and
 * Postgres rejects the whole value ("Unicode low surrogate must follow a high
 * surrogate"), so the stray halves are dropped first.
 */
export function postgresJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (
    typeof item === "string" ? item.replace(LONE_SURROGATE, "") : item
  ))
}
