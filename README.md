# JANKeN PoN — iOS Build 2

『JANKeN PoN』は、世界の掛け声で遊ぶじゃんけんゲームです。Build 2 は、
**実機の動画で見つかった指摘（ノッチ被り・文字の小ささ・左右・履歴・かけ声）を直し、
「締切まで選び直せる／かけ声で同時に開く」ルールにした版** です（App Store 提出 / TestFlight 配信まで持っていけます）。

- アプリ名: **JANKeN PoN** / Bundle ID: **`jp.signlink.JankenPon`**
- 課金: **`jp.signlink.JankenPon.pro`**（買い切り・StoreKit 2）
- 版: `MARKETING_VERSION = 1.0.0` / `CURRENT_PROJECT_VERSION = 2`
- 構成: 純粋な ES Modules + 静的アセット（ビルド不要）→ `www/` に写して Capacitor へ

```
npm test        # ルール・通信・Build 1/2 仕様のテスト（181件）
npm run serve   # http://127.0.0.1:4173 で確認（file:// では ES Modules が動きません）
npm run shots   # Chromium で操作テスト + スクショ（downloads/janken-b1-*.png）
node tools/shots-b2.mjs  # Build 2 の見た目・操作（downloads/janken-b2-*.png）
npm run www     # 配布用 www/ を作る
npm run e2e     # 2ブラウザ × 実 Supabase で合言葉の部屋を5回戦（手動の通し確認）
npm run ios:sync # cap sync ios（www → ios/App/App/public）
```

## Build 2 の変更点（2026-11-22）

実機動画（`ScreenRecording_11-22-2026 07-15-36`）の指摘をそのまま直した版。

1. **セーフエリア**: `viewport-fit=cover` ＋ `env(safe-area-inset-top/bottom/left/right)` を
   `--safe-t` などの変数にして全画面が使う。ノッチ（Dynamic Island）とホームインジケータの下に潜らない。
   画面が収まらない端末では、どの画面も縦スクロールで全部に届く（`-webkit-overflow-scrolling: touch`）。
2. **文字サイズ**: 設定に **標準 / 大 / 特大**。`html[data-text-size]` と CSS の `--ts` 倍率で、
   遊び方の説明からランキングまで一斉に拡大する（保存され、即時反映）。
3. **サウンド ON/OFF**: ミュートを「発音しない」だけでなく **マスターゲインを 0 に絞る** ようにして、
   鳴っている途中の音もその場で止まる。ON に戻すときは AudioContext を起こし直す。
iOS は `AVAudioSession` を `.playback` にしたので、**消音スイッチが入っていても鳴る**。
4. **国籍は初回登録後ロック**: 国は「この国で登録する」で確定（または初回プレイ時に確定）し、以後は変更不可。
   **ニックネームだけが設定から変えられる**。保存の入口（`createProfileStore.save`）でもロック済みの国は差し替えない。
5. **自分（YOU）が左・相手が右**: アリーナ・スタンプの吹き出し・ポイントの浮き出しまで左右を揃えた。
6. **週間ランキング**: 指標を **総合 / 月別 / 週間 / 勝率** に。週は月曜はじまり（`weekKey`）で、週が変わると 0 に戻る。
7. **PK戦風の履歴ボード**: プレイ画面に、R1〜R5 の「自分 vs 相手」の手と ○勝 / ×負 / △引分 を常時表示。
8. **かけ声の切替**: 既定は **左側＝自分** の国の言葉。プレイ画面の **⇄** で相手の国のかけ声に
   いつでも切り替えられる（CPU 戦・通信対戦のどちらも）。
9. **締切まで選び直せる**: 手をタップしても確定せず「選択中」のハイライトだけ。カウントが 0 になった時点で、
   最後に選んでいた手が確定する（未選択ならランダム＝タイムアウト）。
10. **かけ声で同時に開く**: カウント中は自分も相手も手を伏せたまま。**「ぽん！」の最後の拍で両方の手が同時に開き**、
    その場で勝敗が出る。通信対戦では、確定前の選択を相手に送らない（送るのは締切の1回だけ）。
11. **PRO の価格表示**: フォールバックを **¥300**（英語圏 $1.99）に。実際の表示は StoreKit の価格が優先。
12. **無料と PRO の線引き**: 無料は**同じ国籍のプレイヤー同士の国内対戦**だけで、結果は**国内（国別）ランキング**にのみ入る。
    世界（国籍をまたぐ）対戦と世界ランキングのエントリーは **PRO**。記録は国内（`world`）と世界（`global`）で別々に持ち、混ざらない。
    パーティーはどちらにも加算しない。相手が見つからないときの CPU フォールバックはこれまでどおり。

## ルール（Build 2 もクラシック一本）

| 手 | 勝ったときのポイント |
| --- | --- |
| ✊ グー | 3pt |
| ✌️ チョキ | 2pt |
| ✋ パー | 5pt |
| あいこ | 0pt（テンポ重視でそのまま次のラウンドへ） |

- 1マッチ = **5回戦**（標準）または **3回戦**（スピード部門）。部門ごとにランキングが別。
- 勝った手のポイントだけが入ります。負けは0pt、相手にその手のポイント。
- 5回戦の最大は 25pt（毎回パーで勝つ）、3回戦は 15pt。
- **手を選ぶのは締切まで**: タップは「選択中」だけで、カウントが 0 になるまで何度でも選び直せる。
  0 になった時点の手で確定し、かけ声の「ぽん！」で自分と相手の手が同時に開く（後出ししない）。

プロトタイプにあった **ゾウ・人間・アリ / 井戸つき** の特殊ルールは、Build 1 では
**UI に出しません**（`RULESETS` にコードとして残し、v1.1 以降に温存）。

## 3つの遊び方

| モード | 中身 | 料金 |
| --- | --- | --- |
| **CPU練習** | 初級10秒 / 中級7秒 / 上級4秒（最強2秒は PRO）。端末内だけの記録で、リセットできる | 無料 |
| **通信対戦** | クイックマッチ（国内／世界）または合言葉の部屋。**1手5秒固定**・マッチングは30秒で打ち切り | 国内は無料 / 世界は PRO |
| **パーティー** | **2〜4人・5回戦**。全員がいっせいに手を出し、その場限りのポイント勝負 | PRO |

### パーティーの採点（ランキング対象外）

- 単独勝ちも複数勝ちも、勝った手のポイント（✊3 / ✌️2 / ✋5）をそのまま獲得。
- **全員が同じ手**、または **グー・チョキ・パーが全部出た（3すくみ）** は全員 0pt。
- **この結果は、総合・月間・勝率・国内／世界のどのランキングにも一切加算されません。**
  `PARTY_COUNTS_FOR_RANKING = false` が唯一の正で、テストが担保します。

## 通信（Supabase `games-realtime`）

`work/diamond-code-duel`（CODE DUEL）と同じ Realtime プロジェクト
`https://siivncidktbuyqwsjeqd.supabase.co` の公開（publishable）キーを使います。
テーブルも認証も使わず、チャンネル上の broadcast と presence だけで動きます。

| 用途 | チャンネル |
| --- | --- |
| クイックマッチ（国内） | `janken-quick:JP:5` / `janken-quick:JP:3` |
| クイックマッチ（世界） | `janken-quick:world:5` / `:3` |
| 合言葉の部屋 | `janken-room:<CODE>` |
| パーティー | `janken-party:<CODE>`（2〜4人） |
| 対戦（2人） | `janken-match:<idA>-<idB>`（並び順で決まる名前） |
| ランキングの行 | `janken-rank:<部門>:<国内/世界>` |

- 国内マッチは国コードごとのチャンネルなので、**同じ国の相手とだけ**当たります。
- マッチングは presence の並びで 0-1 / 2-3 と組みます。余った1人は待ち続け、
  30秒で打ち切って「CPU練習へ」を案内します。
- ランキングは、チャンネルに流した「自分の行」を2.5秒集めて、端末にキャッシュ
  （10分）し、ローカルのライバルと混ぜて表示します。**誰も答えなければローカルだけ**で
  安全にフォールバックします（テストもこの経路）。
- ソケットは `WebSocket` ひとつだけ。SDK は積みません。iOS の WKWebView が
  CONNECTING のまま固まる件、ハートビート、復帰時の張り直しも CODE DUEL と同じ手当て済み。

## 安全（悪質ユーザー対策）

- 自由入力のチャットはありません。**定型スタンプ6種**のみ、**4秒あき**、🔔/🔇 でミュート。
- 受信した手は検証します: 定型の3手のみ / ラウンドは 0〜回戦数-1 / 同じ人の同じラウンドは1回だけ
  / 本文サイズ上限。逸脱は捨てます。
- 3回連続で時間切れになるとマッチ終了（記録なし）。結果画面の放置でもタイトルへ戻ります。
- iOS の長押しコピー・選択・コールアウトを抑止（`-webkit-touch-callout: none` ほか）。

## 無料と PRO の線引き

| | 無料 | PRO（`jp.signlink.JankenPon.pro`） |
| --- | --- | --- |
| CPU練習 | 初級・中級・上級（10 / 7 / 4秒） | ＋最強 MASTER（2秒） |
| 通信対戦 | 国内 | ＋世界 |
| ランキング | 国内（5/3回戦 × 総合/月別/勝率） | ＋世界 |
| パーティー | — | 2〜4人・5回戦 |
| 相手の手の率 | — | ✊✌️✋% の詳細 |
| 称号フレーム | 標準 | ゴールド |
| 言語 | 12言語 | 12言語 |

**ポイントは増えません。** 価格は StoreKit の表示価格が優先で、未取得時は
日本語 **¥300** / 米国 **$1.99** を表示します（2026-11-22 の指示で ¥480 から変更）。

ネイティブでは `ios/App/App/AppDelegate.swift` の `StoreKitPlugin`（StoreKit 2）が
`getProducts` / `entitlement` / `purchase` / `restore` を返し、`jankenDidLoad` で
ブリッジに直接登録します（`cap sync` のクラス名解決に頼らない）。Web プレビューでは
PRO シートの体験スイッチで解放内容を確認できます（課金なし）。

## 言語（12）

日本語 / English / 한국어 / 简体中文 / 繁體中文 / Español / Français / Deutsch /
Português / Italiano / हिन्दी / Bahasa Indonesia。
短い UI 文言はすべての言語に用意し、長文（あそびかた・プライバシーポリシー）は
日本語と英語の全文を持ちます（他の言語では英語を表示し、その旨を注記）。
`test/build1.test.js` が「12言語 × 全キー」を検査します。

## 記録の分け方

| 種類 | 保存先 | ランキング | リセット |
| --- | --- | --- | --- |
| 練習データ（CPU戦） | 端末内 | 加算しない | ホーム / 設定（2度押しで確定） |
| 世界記録（通信対戦） | 端末内 ＋ Supabase の行 | 加算する | なし |
| パーティー記録 | 端末内 | **加算しない** | なし |
| 手の率（✊✌️✋） | 端末内 | — | なし（戦績として保持） |

## ファイル構成

```
index.html              画面（ホーム / 1対1 / パーティー / 結果 / シート11種）
styles.css              ライトテーマ（430x932 基準、小さい端末は @media で圧縮）
src/core.js             ルール・ポイント・回戦・CPU・パーティー採点・通信検証（DOM 非依存）
src/countries.js        19か国の旗・掛け声・色
src/ranking.js          ライバル・部門/指標/範囲・通信の行のマージ
src/storage.js          プロフィール保存（練習 / パーティー / 世界記録）・sanitize
src/audio.js            Web Audio シンセ
src/i18n.js             12言語のUI文言と長文
src/pro.js              StoreKit 2 の橋渡しと無料/PROの線引き
src/online.js           Supabase Realtime（2人対戦・パーティー・ランキング）
src/main.js             UI コントローラ
test/core.test.js       ルール・進行・ランキング・保存（63テスト）
test/online.test.js     通信プロトコル（22テスト・フェイクWSで往復）
test/build1.test.js     Build 1 仕様（50テスト）
test/build2.test.js     Build 2 仕様（セーフエリア・文字サイズ・音・国籍ロック・左右・週間・PKボード・かけ声・選び直し・同時オープン・無料/PRO）
tools/online-e2e.mjs    2ブラウザ × 実 games-realtime の通し確認（手動）
tools/serve.mjs         静的サーバー
tools/shots.mjs         Chromium 操作テスト + スクショ（Build 1）
tools/shots-b2.mjs      Chromium 操作テスト + スクショ（Build 2・セーフエリア想定）
tools/make-www.mjs      配布用 www/ の生成
capacitor.config.json   appId / appName / webDir
ios/                    Capacitor iOS プロジェクト（Bundle ID・アイコン・StoreKit・AVAudioSession）
docs/ios-testflight-build2.yml  TestFlight ワークフロー（いま使う版・ビルド番号は pbxproj から自動）
docs/ios-testflight-build1.yml  Build 1 の履歴（そのまま残す）
docs/privacy.md         プライバシーポリシー全文（日英）
docs/live-check.md      実 games-realtime での確認記録（2人対戦・3人パーティー・画面通し）
```

## TestFlight までの手順（トモアキさん向け）

1. GitHub の `signlinkjp/janken-pon-game` にこのリポジトリを push 済み。
2. `docs/ios-testflight-build2.yml` の中身をコピーして、GitHub の
   `.github/workflows/ios-testflight-build2.yml` に貼る（DOROKEI と同じ手順。
   GitHub連携の権限ではワークフローだけは直接 push できないため）。
   **1行目は `# JANKeN PoN iOS TestFlight Build 2` のコメントのまま。**
3. Actions →「JANKeN PoN iOS TestFlight」→ Run workflow。
   `confirm_bundle_id` に `jp.signlink.JankenPon`、`upload_to_testflight` は true。
4. Secrets は既存リポジトリと同じ: `APPLE_TEAM_ID` / `APPSTORE_CONNECT_KEY_ID` /
   `APPSTORE_CONNECT_ISSUER_ID` / `APPSTORE_CONNECT_PRIVATE_KEY`。
5. App Store Connect に **`jp.signlink.JankenPon`** のアプリと、
   非消耗型 IAP **`jp.signlink.JankenPon.pro`**（提出準備完了・価格 **¥300**）が必要。

preflight は、pbxproj の `CURRENT_PROJECT_VERSION` を読んで、2箇所（Debug/Release）が
揃っていること・正の整数であることを確かめてから進みます。**ワークフロー側にはビルド番号を
書きません**（Build 3 以降は pbxproj の番号を上げるだけ。`MARKETING_VERSION` も同じ場所から読みます）。

## 次の一歩（Build 2 の外）

- App Store 用スクショ（6.9 / 6.5 インチ）とプライバシーマニフェスト（`PrivacyInfo.xcprivacy`）
- 世界ランキングのサーバー側集計（現在はチャンネル上の行の受け渡し＋ローカル）
- 特殊ルール（ゾウ・人間・アリ / 井戸つき）の v1.1 復帰
- 観戦モード、フレンド、月間・週間の切り替わり通知
- 好みに合わせて: 選んだ手を「これで決定」で早く閉じるボタン（いまは締切まで待つ）
