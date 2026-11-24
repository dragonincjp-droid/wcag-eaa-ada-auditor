# Apify Store & n8n Community 公開用コピペ資産シート (`store_listing_copy.md`)

オーナーが **10分以内のコピペ作業のみ** で **Apify Store** および **n8n Community Workflows** への公開を完了できるよう、ASO（ストア内検索最適化）およびGoogle寄生SEO（`apify.com` / `n8n.io` ドメイン評価活用）を織り込んだ英語テキスト一式をまとめました。

---

## 1. Apify Console 公開設定（Publication タブ コピペ用）

Apify Console にて Actor ビルド完了後、**Settings** / **Publication** タブの各欄に以下をそのまま貼り付けてください。

### ① Actor Name（技術スラッグ / URL末尾）
> ※ 英語小文字・ハイフン区切り。URLが `https://apify.com/<YOUR_USERNAME>/wcag-eaa-ada-auditor` となり、Google検索クエリと高一致します。

```text
wcag-eaa-ada-auditor
```

### ② Actor Title（ストア表示タイトル — 先頭30文字に購買キーワード凝縮）
> **解説**: Apify Storeの検索アルゴリズムと一覧カード表示（約55〜65文字）に合わせ、`WCAG 2.2`, `EAA`, `ADA`, `Accessibility`, `Overlay`, `MCP` をすべて網羅しています。

- **推奨メイン案（57文字）**:
```text
WCAG 2.2, EAA & ADA Accessibility Auditor (Overlay + MCP)
```

- **短縮予備案（48文字・文字数制限が厳しい場合）**:
```text
WCAG 2.2 / EAA & ADA Website Auditor + MCP
```

### ③ SEO Description / Summary（ストア検索カード ＆ Google検索スニペット用）
> **解説**: Googleのメタディスクリプション表示枠（先頭155文字）に **「一括WCAG 2.2 AA監査」「EAA声明チェック」「accessiBe/UserWayオーバーレイ検知」「赤枠スクリーンショット＆HTML修正コード生成」** を凝縮し、後半で **Clay / n8n / MCP** と **高ROI（$0.025/URL）** を訴求しています。

- **Standard Description（288文字 — Apify Publication Description欄用）**:
```text
Bulk WCAG 2.2 Level AA checker API, European Accessibility Act (EAA) statement scanner & ADA compliance lead generator. Detects accessiBe/UserWay overlays, captures red-box violation screenshots, and outputs HTML fix diffs + cold email hooks for Clay, n8n & Claude/Cursor MCP ($0.025/URL).
```

- **Short Meta Variant（156文字 — 160文字制限欄がある場合）**:
```text
Bulk WCAG 2.2 AA, EAA & ADA website auditor API. Detects accessiBe/UserWay overlays, generates red-box screenshots, HTML fix diffs & Clay/n8n/MCP lead hooks.
```

### ④ Categories（Apify Store カテゴリ選択）
Apify Console の Categories 選択欄で以下をチェックしてください（最大選択数に応じて上から優先）：
1. **Lead generation** *(最優先：Clay / エージェンシー層が最も巡回する高単価カテゴリ)*
2. **SEO tools** *(Web制作会社・テクニカルSEO監査ニーズを獲得)*
3. **AI** / **MCP servers** *(MCP Directory 自動掲載・Claude/Cursor開発者流入を獲得)*
4. **Developer tools** *(または **Automation**)*

### ⑤ Pay-Per-Event (PPE) 料金テーブル設定（Monetization タブ）
Apify Console -> **Monetization** -> **Pay per event (PPE)** を選択し、コード内の `Actor.charge()` イベント名と完全一致する以下の3件を登録してください。

| Event Name（一字一句完全一致で入力） | Price (USD) | Event Description（英語コピペ用） |
| :--- | :---: | :--- |
| `actor-start` | `0.01` | One-time initialization fee per Actor run. |
| `url-audited` | `0.025` | Full WCAG 2.2 A/AA DOM audit, overlay widget detection, EAA statement check, HTML fix diffs, and cold outreach hook per URL. |
| `visual-evidence-generated` | `0.015` | Optional annotated viewport screenshot PNG with red bounding boxes and numbered violation badges (`includeVisualEvidence: true`). |

> **💡 オーナー向け補足（利益構造 ＆ 自動ユーザー名反映）**:
> - Apify Pay-Per-Event の精算式 `max($0, 総売上 × 80% − 実行コンテナ計算原価)` に基づき、Apify手数料（20%）および実行コンテナ計算原価（Chromium約`$0.0015〜$0.003/URL`）を差し引いた **売上の約70〜76%が純利益** として自動で受取残高に計上されます。原価超過時のマイナス補填義務は一切ないため、**深夜に10万URL実行されてもオーナーの持ち出し赤字リスクは構造的に $0（完全 ¥0）** です。
> - GitHub Actions 自動デプロイ（`.github/workflows/deploy-apify.yml`）実行時に、`APIFY_TOKEN` からご自身のApifyユーザー名が自動取得され、`README.md` と `integrations/*` 内の `<YOUR_USERNAME>` / `YOUR_USERNAME` が自動一括置換された上で `apify push` されます（手作業での置換は不要です）。

---

## 2. n8n Community Workflows 投稿キット（無料・完全放置の外部集客エンジン）

Apify公開後、[n8n Creator Hub / Workflows](https://creators.n8n.io/)（登録無料）にて `/home/antigravity/wcag-eaa-ada-auditor/integrations/n8n-eaa-lead-enrichment-workflow.json` をアップロードし、以下の英語タイトル＆説明文を貼り付けるだけで、世界中のリード獲得エージェンシーがワークフローを複製するたびに裏側で当Actorが従量課金されます。

### ① n8n Workflow Title（英語コピペ用）
```text
Automate EAA & ADA Website Accessibility Lead Gen with Apify (WCAG 2.2 + Overlay Detector)
```

### ② Suggested Categories / Tags
- **Categories**: `Sales`, `Lead Generation`, `Marketing`, `SEO`
- **Tags**: `apify`, `accessibility`, `wcag`, `lead-generation`, `cold-outreach`

### ③ n8n Workflow Description（Markdown コピペ用）
```markdown
### Who is this template for?
Web development studios, Shopify/WordPress agencies, SEO consultants, and B2B lead generation teams looking to identify high-intent **WCAG 2.2**, **European Accessibility Act (EAA)**, and **US ADA** remediation prospects automatically — without paying $500–$2,000/month for enterprise compliance SaaS.

### What problem does this workflow solve?
Manually checking hundreds of prospect websites in Chrome DevTools takes days. Meanwhile, companies running 1-line JavaScript accessibility overlays (`accessiBe`, `UserWay`, `AudioEye`) or missing mandatory EU Accessibility Statements are actively searching for real code-level remediation.

This workflow audits a batch of prospect URLs in real headless Chromium (`@axe-core/playwright`), filters out clean websites, and generates a **ready-to-send cold outreach payload** complete with:
- **0–100 Legal Risk Score & Tier** (`CRITICAL` / `HIGH`)
- **Overlay Widget Detection** (`accessiBe`, `UserWay`, `AudioEye`, `EqualWeb`, etc.)
- **EAA Accessibility Statement Detection** (multilingual footer/legal link check)
- **Annotated Red-Box Screenshot URL** highlighting broken UI elements visually
- **Copy-Paste HTML/ARIA Fix Snippet** (`beforeHtml` -> `suggestedFixHtml`)
- **Tailored 1-Sentence Cold Email Hook** (`salesPitchHook`)

### How it works
1. **Manual or Weekly Schedule Trigger**: Starts on demand or every Monday at 8:00 AM.
2. **Set Prospect URLs**: Defines target domains (easily swap this node with **Google Sheets**, **Airtable**, **HubSpot**, **Apollo**, or a **Clay Webhook**).
3. **Apify: Run WCAG/EAA/ADA Auditor**: Calls the `wcag-eaa-ada-auditor` Actor (`run-sync-get-dataset-items`) to perform full browser WCAG 2.2 AA analysis.
4. **Filter High Risk or Overlay Detected**: Keeps only high-converting prospects where `legalRiskScore >= 60`, `riskTier` is `CRITICAL`/`HIGH`, or `overlayDetection.overlayDetected` is `true`.
5. **Format Cold Outreach Payload**: Automatically selects the best outreach angle (`OVERLAY_REPLACEMENT`, `EAA_MISSING_STATEMENT`, or `ADA_WCAG_REMEDIATION`) and builds a personalized email draft ready to push to **Instantly**, **Smartlead**, **Lemlist**, **HubSpot**, or **Slack**.

### Setup instructions (2 minutes)
1. Create a free [Apify account](https://apify.com/) (includes **$5.00/month in free credits** — enough to test ~124–199 URLs every month at $0).
2. Copy your API token from **Apify Console -> Settings -> Integrations** and set two environment variables in n8n:
   - `APIFY_API_TOKEN`: Your Apify API token
   - `APIFY_ACTOR_ID`: `<YOUR_USERNAME>~wcag-eaa-ada-auditor` *(use the `~` tilde separator)*
3. Connect your preferred CRM or email sequencer after the **Format Cold Outreach Payload** node!

> **Note:** Automated WCAG 2.2 scanning provides technical engineering diagnostics (~40–57% rule coverage) and does not constitute legal advice.
```

---

## 3. 公開後の週次3分チェック指標 ＆ 撤退/継続ゲート（オーナー運用ガイド）

SNS張り付きや手動営業は一切不要です。週に1回（3分）、Apify Console の **Analytics / Monetization** 画面で以下の数字のみ確認してください。

| チェック項目 | 健全ベンチマーク | 未達時のワンアクション（手作業最小） |
| :--- | :--- | :--- |
| **1. Store Views → Trial Runs（試用率）** | 2週目までに **累計 15ユーザー以上の試用実行** (`audit_devil_critic.md` Gate 1) | 試用15人未満の場合、機能追加はせず **Actor Title 先頭30文字** を検索トレンド語（例：`Bulk WCAG 2.2 Checker API & Overlay Detector`）へ1回だけ微調整 |
| **2. Run Success Rate（正常完了率）** | **98%以上維持**（Apify Store検索順位の最重要シグナル） | タイムアウト多発時はデフォルト `maxConcurrency` の案内値を `3` → `2` に維持 |
| **3. Free Credit → Paid PPE 転換（課金発生）** | **公開28日以内に有料PPE収益発生** (`audit_devil_critic.md` Gate 2) | Clay / n8n バッチユーザーが1社でも定着すれば毎週自動で1,000〜5,000 URL分の従量課金が積み上がる。万一28日時点で課金0件なら追加工数をかけず静的放置（維持費¥0）して次案へピボット |
