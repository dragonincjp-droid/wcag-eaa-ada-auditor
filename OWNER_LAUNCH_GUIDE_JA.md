# 🚀 オーナー専用：初回10分コピペ公開 ＆ 完全放置マニュアル (`OWNER_LAUNCH_GUIDE_JA.md`)

このガイドは、専門的なプログラミング作業を一切行わず、**初期費用 ¥0・合計作業時間 10分** で **`WCAG 2.2 / EAA & ADA Accessibility Legal Risk Auditor`** を世界市場（Apify Store ＋ MCP Directory）へ公開し、以降は **「週1回・3分のレポート確認のみ（99%無人運用）」** で外貨収益を得るためのオーナー専用手順書です。

---

## 💡 はじめに：なぜ「初期費用 ¥0・住所公開不要・赤字リスクゼロ」なのか？

| 不安ポイント | 本事業の仕組み（安全設計） | オーナー負担 |
| :--- | :--- | :---: |
| **サーバー・クラウド維持費** | 固定費は完全無料。実行時のコンテナ計算原価も売上から自動精算（`max($0, 売上×80% − 計算原価)` 保証でマイナス請求なし） | **¥0 / 月（持ち出し赤字リスク ¥0）** |
| **AI（OpenAI等）のAPI破産** | 有料LLMを一切使わず、ブラウザ標準エンジンで決定論的に検査（Zero-LLM設計） | **¥0（破産リスク無）** |
| **決済審査・特商法の自宅住所公開** | **Apify社が販売主体（Merchant of Record）**として決済・領収書・EU税務を100%代行 | **住所公開・契約費 不要** |
| **日々の監視・集計作業** | GitHub Actions（無料枠）が毎週月曜朝9時に売上・異常・撤退基準を自動集計 | **週1回 3分見るだけ** |

---

## ⏱️ 初回公開 4ステップ（合計10分・予算 ¥0）

### Step 1：Apify無料アカウント作成 ＆ GitHub連携（所要 3分）

1. **Apify無料アカウントを作成（30秒）**
   - [Apify公式サイト (https://apify.com/)](https://apify.com/) を開き、**「Sign up for free」** から Google または GitHub アカウントで登録します（クレジットカード登録不要・毎月$5の無料テスト枠が自動付与されます）。
   - 画面右上のアイコン ＞ **Settings ＞ Account** に表示されるあなたの **Username**（例：`taro-studio`）をメモしておきます。

2. **Apify APIトークンをコピー（30秒）**
   - Apify管理画面（Console）の左メニュー **Settings ＞ Integrations** を開きます。
   - **Personal API tokens** 欄にあるデフォルトトークンの **「Copy」** アイコンをクリックします。

3. **GitHubリポジトリにトークンを1つ登録して自動デプロイ起動（2分）**
   - このフォルダ（`wcag-eaa-ada-auditor`）をあなたのGitHubリポジトリ（Private / Public どちらでもOK）へアップロード（Push）します。
   - GitHubリポジトリの **Settings ＞ Secrets and variables ＞ Actions ＞ New repository secret** をクリックし、以下を登録します：
     - **Name**: `APIFY_TOKEN`
     - **Secret**: 先ほどコピーしたApifyトークンを貼り付け ＞ **Add secret**
   - *(任意：SlackやDiscordでも週次レポートを受け取りたい場合のみ、同様に `WEBHOOK_URL` という名前でWebhook URLを追加してください)*
   - GitHub上部の **Actions** タブ ＞ 左側 **「Deploy WCAG/EAA/ADA Auditor to Apify」** ＞ 右側 **「Run workflow」** を押します。
   - 数分待つと、**自動テスト → あなたのApifyユーザー名の自動反映（`README.md`・`integrations/*` 内の `<YOUR_USERNAME>` 一括自動置換） → Apifyへのアップロード → 本番スモークテスト（上限`$0.10`安全ガード付き）** まで全自動で完了し、緑色のチェック（✅）が点灯します！（手作業でのファイル書き換えは一切不要です）

> [!TIP]
> **さらに簡単な代替ルート**: GitHub Secretsを使わず、Apify Console の **Actors ＞ Create new ＞ Link Git Repository** から自分のGitHubリポジトリを直接選ぶだけでも連携可能ですが、`<YOUR_USERNAME>` の自動置換や自動テスト＋スモークテストまで全自動化する上記の `APIFY_TOKEN` 登録方式を強くおすすめします。

---

### Step 2：従量課金（Pay-per-event）のコピペ設定 ＆ 公開ボタン押下（所要 3分）

1. [Apify Console ＞ Actors](https://console.apify.com/actors) を開くと、Step 1で自動作成された **`wcag-eaa-ada-auditor`** が表示されているのでクリックします。
2. 上部タブの **Monetization** を開き、課金モデルで **「Pay per event (PPE)」** を選択します。
3. **Add event** を押し、以下の **3つのイベント名・単価・説明文を一字一句そのままコピペ** して保存します（プログラム内の課金コードと完全連動しています）：

| Event Name（コピペ用・完全一致） | Price (USD) | Description（英語コピペ用） |
| :--- | :---: | :--- |
| `actor-start` | `0.01` | `One-time initialization fee per Actor run.` |
| `url-audited` | `0.025` | `Full WCAG 2.2 A/AA DOM audit, overlay widget detection, EAA statement check, HTML fix diffs, and cold outreach hook per URL.` |
| `visual-evidence-generated` | `0.015` | `Optional annotated viewport screenshot PNG with red bounding boxes and numbered violation badges (includeVisualEvidence: true).` |

4. 続いて隣の **Publication** タブを開き、`marketing/store_listing_copy.md` の「1. Apify Console 公開設定」に記載されている以下をコピペします：
   - **Title**: `WCAG 2.2, EAA & ADA Accessibility Auditor (Overlay + MCP)`
   - **Description**: `Bulk WCAG 2.2 Level AA checker API, European Accessibility Act (EAA) statement scanner & ADA compliance lead generator. Detects accessiBe/UserWay overlays, captures red-box violation screenshots, and outputs HTML fix diffs + cold email hooks for Clay, n8n & Claude/Cursor MCP ($0.025/URL).`
   - **Categories**: `Lead generation` / `SEO tools` / `AI`（または `MCP servers`）にチェック
5. 画面右下の **「Publish to Store」** ボタンを押せば **世界公開完了** です！（AppleやGoogleのような数週間の審査待ちはなく、即座に Apify Store 検索と MCP Directory に掲載されます）

---

### Step 3：n8n無料テンプレート投稿で「完全放置の自動集客フック」を設置（任意・所要 4分）

Apify内の自然検索だけでも集客されますが、この4分作業を1回だけやっておくと、**世界中のWeb制作会社・マーケ代理店が営業自動化テンプレをコピーして動かすたびに、裏側であなたのActorが自動実行されて従量課金が入る仕組み**が完成します。

1. [n8n Creator Hub (https://creators.n8n.io/)](https://creators.n8n.io/) に無料登録し、**Submit a workflow** を開きます。
2. 同梱ファイル `integrations/n8n-eaa-lead-enrichment-workflow.json` を開いて `YOUR_USERNAME` の箇所（1箇所のみ）をあなたのApifyユーザー名に書き換え、アップロード（または貼り付け）します（※Apify Store上のドキュメントや同梱ファイルはStep 1のCIデプロイ時に自動置換済みです）。
3. タイトル・カテゴリ・英語説明文は、`marketing/store_listing_copy.md` の **「2. n8n Community Workflows 投稿キット」** を上からそのままコピペして **Submit** を押せば完了です！

---

### Step 4：売上が発生してから行う受取口座の登録（初回は 0分・後回しでOK！）

> [!IMPORTANT]
> **最初は銀行口座やバーチャルオフィスの登録を一切やる必要はありません！**
> - **理由①（特商法・住所非公開）**: 日本国内で個人サイトからStripe直販する場合は特定商取引法に基づく住所・電話番号対策（バーチャルオフィス月660円等）が必要ですが、Apify Storeでは **Apify社が販売・請求・決済の当事者（Merchant of Record）** となり、あなたはApify社から開発者レベニューシェア（Apify手数料20%＋実行コンテナ計算原価を差し引いた **売上の約70〜76%の純利益**）を受け取る形になるため、個人の自宅住所や電話番号が一般公開されることは一切ありません。また、精算式 `max($0, 総売上 × 80% − コンテナ計算原価)` により、万一原価が超過してもマイナス補填義務は発生せず、**オーナーの持ち出し赤字リスクは完全 ¥0** です。
> - **理由②（売上積立）**: 発生した売上はApifyアカウント内に米ドル残高として安全に貯まります。**最初の売上が発生したのを週次レポートで確認してから**、受取口座を登録すれば十分です。

#### 💰 初収益が出た後の口座登録手順（1回5分のみ）
1. Apify Console 左メニュー **Monetization ＞ Payouts（または Billing / Payout details）** を開きます。
2. 本人確認と受取方法を設定します（以下の順におすすめです）：
   - **第1推奨：Wise（ワイズ）マルチカレンシー口座（登録・維持費 ¥0）**
     米ドル（USD）口座番号を無料で発行でき、日本の銀行口座へ両替・出金する際の為替手数料が一般的な銀行海外送金より圧倒的に安く済みます。
   - **第2推奨：PayPal または 日本の銀行口座（SWIFT国際送金）**
     すでにPayPalビジネス/個人アカウントや外貨受取対応のネット銀行（ソニー銀行・住信SBIネット銀行等）をお持ちならそのまま登録可能です。
3. 一度登録すれば、以降は毎月Apifyの最低支払基準額を超えた確定収益（Apify手数料20%＋コンテナ計算原価控除後の **売上の約70〜76%の純利益**）が自動で振り込まれます。

---

## 🛋️ 公開後のルーティン：週1回・3分の「オーナーレポート」確認方法

あなたが毎週やることは **月曜日の朝（または好きなタイミング）に3分間レポートを見て、Yes / No を判断するだけ** です。

### 1. レポートの確認場所
- **毎週月曜 朝9:00（日本時間）** に、GitHub Actions が自動で `Weekly 3-Minute Owner Digest & Kill-Gate Monitor` を実行します（維持費 ¥0）。
- GitHubリポジトリの **Actions** タブ ＞ 最新の **Weekly 3-Minute Owner Digest** をクリックすると、画面中央（Summary欄）に日本語の **『📊 週次3分オーナーレポート』** が表示されます。
- *(GitHub Secrets に `WEBHOOK_URL` を設定している場合は、Slack や Discord に毎週自動でサマリーが届きます)*

### 2. レポートで見るべき2箇所（3分以内）
1. **一番上の「総合判定バッジ」**:
   - `🟢 正常稼働（完全放置継続OK）` → **そのまま画面を閉じてOK（作業0秒）！**
   - `🟡 Gate 1 到達（Day 14で試用15人未満）` → 機能追加はせず、タイトル・訴求文だけ1回改善する合図。
   - `🔴 Gate 2 到達（Day 28で課金0件）` → ダラダラ時間をかけず、このツールは維持費¥0の「静的放置」に切り替えて次の事業案へ進む合図。
   - `🚨 異常検知アラート（エラー率10%超）` → AIチームに自動点検させる合図。
2. **「3. 今週オーナーが Yes / No で答えるだけの承認事項」**:
   - アクションが必要な週だけ、Yes / No のチェック項目が表示されます。

---

## 🛡️ AIカスタマーサポート（CS）＆ 安全装置（キルスイッチ）運用ルール

オーナーが英語で個別サポート返信を書いたり、深夜に障害対応したりする必要はありません。

### 1. 問い合わせ（Issues / メッセージ）が来た時の自動仕分け基準
- **パターンA：決済・請求書・返金に関する問い合わせ**
  - Apify社が決済代行しているためオーナー側での返金作業は不要です。以下の1文をコピペ返信するだけで完了します：
  - > `Thanks for reaching out! Since Apify handles all billing, invoices, and platform credits directly, please contact Apify Support via Console -> Help & Support so they can assist with your account billing right away.`
- **パターンB：技術的な質問・「特定サイトでエラーが出る」等の報告**
  - 自分で調べず、届いた英文をそのまま下の「AIチーム呼び出しコマンド」に貼り付けてください。AIチームが再現テスト・修正・英語回答文の作成まで一括代行します。
- **パターンC：オーナー判断が必要な例外（エスカレーション基準）**
  - 特定企業からの法的な削除要請・商標クレーム等の重大連絡が来た場合のみ、念のため Apify Console ＞ Publication ＞ **Unpublish** を押して一時非公開にし、AIチームへ相談してください。

### 2. 緊急停止スイッチ（キルスイッチ）
- **自動コスト上限ガード**: 本番死活テスト（`scripts/smoke_test_live.mjs`）には `maxTotalChargeUsd: 0.10`（上限約15円）と150秒自動強制停止（Abort）が組み込まれています。
- **手動ワンクリック停止**: 万が一バグ多発でストア公開を一時止めたい時は、Apify Console ＞ Actors ＞ `wcag-eaa-ada-auditor` ＞ **Publication ＞ Unpublish** を1クリックするだけで新規実行を即時停止できます（なお、公開したままでもオーナー側にサーバー代が請求されることはありません）。

---

## 🤖 何かあった時の「AIチーム1行呼び出しコマンド集」（コピペ用）

判断に迷った時やレポートでアラートが出た時は、このワークスペースでAI（Antigravity）に以下の文をそのままコピペして送ってください。

- **① 週次レポートで `🟡 Gate 1（試用15人未満）` が出た時**
  ```text
  wcag-eaa-ada-auditor が Gate 1 勧告になりました。機能追加は一切行わず、Apify Storeの検索クリック率と試用率を高める新しいタイトル・説明文・README冒頭改善案を作成して反映してください。
  ```

- **② 週次レポートで `🚨 エラー率10%超` が出た時**
  ```text
  wcag-eaa-ada-auditor の週次レポートでエラー率が10%を超えました。エラー原因を調査し、タイムアウトや例外処理を強化してテスト通過後に自動デプロイしてください。
  ```

- **③ 海外ユーザーから英語で質問や要望が届いた時**
  ```text
  Apifyのユーザーから以下の英語メッセージが届きました。コードの修正が必要か判定し、必要なら修正した上で、そのまま返信できる丁寧な英語回答文を作ってください：[ここに相手の英文を貼り付け]
  ```

- **④ 週次レポートで `🔴 Gate 2（Day 28 課金0件）` が出た時**
  ```text
  wcag-eaa-ada-auditor が Day 28 で課金0件（Gate 2）になったため、維持費¥0のまま静的放置に移行します。docs/proposals_market_hunter.md の次点案（案① ハラスメント盾メーカー または 案③ 仕訳CSV変換くん）のMVP立ち上げを開始してください。
  ```
