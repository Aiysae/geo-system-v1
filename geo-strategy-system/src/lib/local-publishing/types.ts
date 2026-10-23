export type PublishingSource = { kind:"file"|"production"; id:string; version:string; name?:string; clientId?:string; batchId?:string; itemId?:string; variant?:string }
export type PublishingAccount = { id:string; platform:string; label:string; group_name:string; remote_id:string; remote_name:string; state:string; checked_at:number|null; session_saved_at:number|null; successful_check_at:number|null; cooldown_until:number; cooling_down:boolean; health_code:string; error:string }
export type PublishingContentType = "article" | "video" | "imageText" | "audio" | "wechat" | "dynamic"
export type PublishingAsset = { id:string; kind:"image"|"video"|"audio"; name:string; mime_type:string; size:number; width:number|null; height:number|null; created_at:number }
export type PublishingArticle = { id:string; title:string; version:number; updated_at:number; contentType?:PublishingContentType; markdown?:string; metadata?:{ source?:PublishingSource; contentType?:PublishingContentType; digest?:string; tags?:string[]; coverUrl?:string; coverAssetId?:string; assetIds?:string[]; original?:boolean; entries?:Array<{title:string;markdown:string;coverAssetId?:string;digest?:string;author?:string}>; platformOptions?:Record<string,Record<string,unknown>> } }
export type PublishingFeedbackState = "matched" | "unplanned" | "over_quota" | "needs_review" | "denied" | "retry"
export type PublishingTask = { id:string; batch_id:string; account_id:string; article_id:string; title:string; content_type?:PublishingContentType; account_name:string; platform:string; mode:string; state:string; phase:string; attempts:number; audit_attempts:number; next_run:number; remote_id:string|null; message:string; updated_at:number; remote_url?:string|null; client_id?:string|null; team_id?:string|null; published_at?:number|null; feedback_state?:PublishingFeedbackState|null; feedback_message?:string }
export type PublishingSnapshot = {
  accounts:PublishingAccount[]; articles:PublishingArticle[]; assets:PublishingAsset[]; drafts:Array<{id:string;name:string;payload:{accountIds:string[];articleIds:string[];mode:string;scheduledAt:number|null;intervalMinutes?:number;dailyLimit?:number;overrides:Record<string,Record<string,{title?:string;metadata?:{digest?:string;coverAssetId?:string}}>>};updated_at:number}>; tasks:PublishingTask[];
  events:Array<{ sequence:number; task_id:string|null; kind:string; message:string; created_at:number }>;
  platforms:Array<{ id:string; name:string; login:boolean; readiness:string; contentTypes:PublishingContentType[]; draftTypes:PublishingContentType[]; demo?:boolean; custom?:boolean }>;
  loginWindows:Array<{ id:string; message:string }>;
  paused:boolean; runtime:{running:boolean;independent?:boolean;localDatabase:boolean;vendorBackend:boolean;fixture:boolean;active:number};
}
export type LoginSnapshot = {image:string;width:number;height:number;url:string;message:string;checking:boolean;ready:boolean;closed?:boolean}
