/** Stable, provider-safe advice. Raw Google API responses are never stored or shown. */
export function marketErrorHint(code: string | null, ja: boolean): string {
  const messages: Record<string, readonly [string, string]> = {
    credential_denied: ["macOS Keychain or the OS credential store denied access. Check ContentGen's permissions.", "OS の認証情報ストアがアクセスを拒否しました。ContentGen のアクセス権限を確認してください。"],
    credential_unavailable: ["The OS credential store is unavailable. Check local credentials or configure the environment key.", "OS の認証情報ストアを利用できません。認証情報か環境変数のキーを確認してください。"],
    permission: ["Google rejected the API request. Check YouTube Data API v3 enablement and key restrictions.", "Google が API リクエストを拒否しました。YouTube Data API v3 の有効化とキー制限を確認してください。"],
    api_not_enabled: ["Enable YouTube Data API v3 in the Google Cloud project that owns this key.", "このキーの Google Cloud プロジェクトで YouTube Data API v3 を有効にしてください。"],
    api_key_invalid: ["Check or replace the YouTube API key in Studio Settings. The saved Keychain key takes priority over the environment.", "Studio 設定で YouTube API キーを確認してください。キーチェーンのキーが環境変数より優先されます。"],
    api_key_restricted: ["Check API key restrictions: ContentGen calls Google from its Rust server, not the browser.", "API キー制限を確認してください。ContentGen はブラウザではなく Rust サーバーから Google に接続します。"],
    invalid_request: ["Google rejected a search parameter. Review the query, region, and language.", "Google が検索パラメータを拒否しました。検索語・地域・言語を確認してください。"],
    quota_exceeded: ["The Google Cloud project's YouTube API quota is exhausted; check its quota usage.", "Google Cloud の YouTube API 割り当てが不足しています。使用量を確認してください。"],
    rate_limited: ["Google is rate limiting requests. Try again after the collection backoff.", "Google によりリクエストが制限されています。待機時間後に再試行してください。"],
  };
  return messages[code ?? ""]?.[ja ? 1 : 0] ?? "";
}
