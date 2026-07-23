import type { ArticleModelProviderKey } from "@/types"

export const DEFAULT_ARTICLE_MODEL_PROVIDER = "doubao" satisfies ArticleModelProviderKey

export function hasExplicitArticleModelSelection(value: {
  modelProvider?: ArticleModelProviderKey
  modelSelectionSource?: "default" | "user"
} | undefined): boolean {
  if (!value?.modelProvider) return false
  if (value.modelSelectionSource === "user") return true
  if (value.modelSelectionSource === "default") return false
  return value.modelProvider !== "article"
}
