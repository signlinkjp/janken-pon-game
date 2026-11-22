# JANKeN PoN — App Store 1.0.0 提出用（Build 6）

そのまま App Store Connect に貼り付けられる文面です。文字数は App Store Connect の上限に収めてあります
（名前 30 / サブタイトル 30 / プロモーション用テキスト 170 / キーワード 100 / 説明 4000）。
日付: 2026-11-23。

## 0. 提出するビルドと基本情報

| 項目 | 値 |
| --- | --- |
| アプリ名（App Store 表示名） | **JANKeN PoN** |
| Bundle ID | `jp.signlink.JankenPon` |
| バージョン / ビルド | **1.0.0 (Build 6)** |
| 課金（買い切り） | **`jp.signlink.JankenPon.pro` ¥300**（英語圏の表示は $1.99） |
| サポート URL | `https://github.com/signlinkjp/janken-pon-game` |
| サポートメール | `t.maks.ts@gmail.com`（表示名 `T-maks Games`） |
| プライバシーポリシー URL | `https://github.com/signlinkjp/janken-pon-game/blob/main/docs/privacy.md` |
| カテゴリ | ゲーム › カジュアル（サブ: ファミリー） |
| 年齢制限 | 4+ |
| 価格 | 無料（App 内課金あり） |
| 権利表記 | © 2026 T-maks Games |
| アイコン | `assets/janken-appicon-1024.png`（1024×1024・アルファなし） |
| スクショ | **6.9インチ（1320×2868）** 7枚 — 下の「4. スクリーンショット」 |

審査に出すビルドは **Build 6**（`CURRENT_PROJECT_VERSION = 6`・`MARKETING_VERSION = 1.0.0`）。
Build 6 の中身: プレイ中のサウンド／かけ声ワンタップ ON/OFF（1対1・パーティー共通・設定と同期）＋ビルド番号。

---

## 1. 日本語（プライマリ）

### アプリ名（30字まで）

```
JANKeN PoN
```

### サブタイトル（30字まで）

```
世界19か国のかけ声でじゃんけん
```

### プロモーション用テキスト（170字まで・審査不要で差し替え可）

```
19か国のかけ声で遊ぶ、世界のじゃんけん。グー3pt・チョキ2pt・パー5ptの5回戦で、出す手がそのまま作戦に。国内ランキング、合言葉の部屋、2〜4人パーティー。12言語対応。プレイ中もワンタップでサウンドON/OFF。
```

### キーワード（100字まで・カンマ区切り・スペースなし）

```
じゃんけん,グー,チョキ,パー,かけ声,世界,ランキング,通信対戦,パーティー,多言語,心理戦,じゃんけんぽん
```

### 説明文（4000字まで）

```
世界の掛け声で、勝負。

JANKeN PoN は、19か国のかけ声で遊ぶじゃんけんゲームです。
グーは3pt、チョキは2pt、パーは5pt。勝った手のポイントだけが入るので、5回戦の25ptをめぐって、出す手がそのまま作戦になります。

■ 3つの遊び方
・CPU練習 — 初級・中級・上級、そして最強。ひとりで、好きなときに。
・通信対戦 — 1手5秒固定の真剣勝負。国内のクイックマッチか、合言葉の部屋で友だちと。
・パーティー — 2〜4人で、全員がいっせいに手を出す5回戦。

■ 世界の掛け声
「じゃんけんぽん！」「Rock Paper Scissors Shoot!」「Jo ken pô!」——
19か国語の掛け声を、その国の声で再生します。自分の国と相手の国は、プレイ中にいつでも切り替えられます。
プレイ画面の🔊ボタンで、かけ声と効果音をワンタップでON/OFFできます。設定のサウンドとも同じスイッチです。

■ 勝負の中身
・タップは「選択中」。締切まで何度でも選び直せます。
・「これで決定」を押すと、カウントを待たずに「ぽん！」。通信対戦では、全員が押した瞬間に開きます。
・「ぽん！」の最後の拍で、自分と相手の手が同時に開く。後出しはできません。
・PK戦のように、R1〜R5の勝敗（○×△）がプレイ中から見えます。

■ 記録とランキング
・5回戦・3回戦の部門別に、総合・月別・週間・勝率のランキング。
・相手の手の傾向、勝った手の勝率。数字で自分の癖がわかります。
・国は初回に登録すると変わりません（ニックネームは後から変えられます）。

■ 安心して遊べる
・自由入力のチャットはありません。定型スタンプ6種・4秒あき・ミュート可。
・文字サイズは標準／大／特大。表示は12言語に対応。
・練習データは端末の中だけ。「練習データをリセット」でいつでも消せます。

■ PRO（買い切り ¥300）
強さは売りません。世界への入口と、数字の手応えを売ります。
・世界の通信対戦と世界ランキング
・世界パーティーバトル（2〜4人・5回戦）
・最強CPU「MASTER」（2秒）
・相手の手の率（✊✌️✋%）の詳細
・ゴールド称号フレーム
ポイントや勝率が有利になることはありません。

T-maks Games
```

### 審査メモ（App Review Information › Notes）

```
JANKeN PoN は、19か国語の掛け声で遊ぶじゃんけんゲームです。ログイン・アカウント登録はありません。起動してすぐ遊べます。

【デモ手順】
1. 起動するとタイトル画面。ニックネームは任意（空欄なら PLAYER）。国は最初の対戦時に「日本」で登録され、以後ロックされます（国籍を偽らないための仕様です）。
2. 「5回戦をはじめる」→ 手（グー／チョキ／パー）をタップ → 「これで決定」。カウント0で「ぽん！」と同時に手が開き、勝敗が付きます。
3. サウンドのかけ声は、プレイ画面右上の 🔊 ON / 🔇 OFF ボタンでワンタップ切り替え（1対1・パーティー共通、設定 › サウンドと同じ値）。設定の行からも切り替えできます。
4. 下部タブ: ランキング（国内）／戦績／PRO／設定。設定には文字サイズ（標準・大・特大）、言語（12言語）、プライバシーポリシーがあります。

【通信対戦の確認】
・通信対戦は Supabase Realtime（wss://siivncidktbuyqwsjeqd.supabase.co・公開キー・認証なし）のチャンネルで、2人対戦とパーティー（2〜4人）を行います。
・レビュー端末1台でも、CPU練習とパーティーの画面はすべて確認できます。クイックマッチは相手が見つからない場合30秒で打ち切り、「CPU練習へ」を案内するので、そこで止まりません。
・合言葉の部屋は、同じ合言葉を入れた2台以上で対戦します。1台のときは待機画面のまま退出できます。

【App 内課金のテスト（PRO / jp.signlink.JankenPon.pro / 買い切り ¥300）】
1. 下部タブの「PRO」を開く → 「PROを購入」。
2. サンドボックスの Apple ID で購入すると、世界の通信対戦・世界ランキング・世界パーティー・最強CPU・相手の手の率・ゴールド称号フレームが解放されます。
3. 「購入を復元」で復元できます。課金は買い切りで、ポイントや勝率は一切変わりません。
※ Web プレビューにある「PROを体験する」スイッチと「プレビュー版のため課金は発生しません」の注記は開発用で、iOS ビルドでは表示されません（StoreKit の購入画面になります）。

【その他】
・広告 SDK・解析 SDK・トラッキングはありません。自由入力のチャットもありません（定型スタンプ6種のみ）。
・オンラインで表示されるのは、ニックネーム・国・ポイント・勝率・手の率だけです。
・プライバシーポリシー: https://github.com/signlinkjp/janken-pon-game/blob/main/docs/privacy.md
・サポート: t.maks.ts@gmail.com
```

---

## 2. English (U.S.)

### Name (30)

```
JANKeN PoN
```

### Subtitle (30)

```
Rock paper scissors, 19 chants
```

### Promotional text (170)

```
Rock paper scissors in 19 chants. Rock 3, scissors 2, paper 5 — five rounds, every hand a plan. Domestic ranking, code rooms, 2–4 player party, 12 languages.
```

### Keywords (100)

```
rock,paper,scissors,rps,janken,chant,world,ranking,online,party,multilingual,game
```

### Description (4000)

```
World chants. Real matches.

JANKeN PoN is rock paper scissors played with the chants of 19 countries.
Rock scores 3, scissors 2, paper 5. Only a winning hand scores, so across five rounds (25 points) the hand you choose becomes your plan.

■ Three ways to play
· CPU practice — easy, normal, hard and master. On your own, any time.
· Online — a firm five seconds per hand. A domestic quick match, or a room with a code for friends.
· Party — 2 to 4 players, all revealing at once, five rounds.

■ Chants from around the world
"Jan ken pon!", "Rock paper scissors shoot!", "Jo ken pô!" —
each chant is played in that country's own voice. Swap between your country and your opponent's at any time during a match.
The speaker button on the play screen turns the chants and effects on or off with one tap — the same switch as Sound in Settings.

■ How a match works
· A tap only selects a hand. Change it as often as you like until time runs out.
· "Lock in" skips the countdown and calls "pon!" at once online too, the moment everyone has locked in.
· Both hands open on the last beat of "pon!" — no late plays.
· Like a penalty shootout, the result of each round (○ win / × loss / △ draw) is visible while you play.

■ Records and rankings
· Divisions for five and three rounds, with overall, monthly, weekly and win-rate rankings.
· Your opponent's hand tendencies and your winning-hand rates show your habits in numbers.
· Your country is registered once and stays (the nickname can change).

■ Safe by design
· No free-text chat. Six fixed stamps, four seconds apart, mutable.
· Text size: standard, large, extra large. The interface speaks 12 languages.
· Practice data stays on your device, and "Reset practice data" clears it at any time.

■ PRO (one-time purchase, US$1.99)
We don't sell strength — we sell a way into the world, and numbers with more depth.
· Worldwide online play and world rankings
· World party battle (2–4 players, five rounds)
· Master CPU (two seconds)
· Detailed opponent hand rates (✊✌️✋%)
· Gold title frame
No purchase ever changes your points or win rate.

T-maks Games
```

### Review notes (English, optional — the Japanese notes above are enough)

```
JANKeN PoN is rock paper scissors with chants in 19 languages. There is no login or account.

DEMO: launch → "Start 5 rounds" → tap a hand → "Lock in". The hand opens with "pon!" on the countdown's last beat.
SOUND: the speaker button (🔊 ON / 🔇 OFF) at the top right of the play screen toggles chants and effects; it is the same value as Settings › Sound.
ONLINE: two-player matches and parties use Supabase Realtime (wss://siivncidktbuyqwsjeqd.supabase.co, public key, no auth). A quick match ends after 30 seconds if nobody is found and offers CPU practice, so a single review device is never stuck.
IAP: PRO tab → "Buy PRO" (jp.signlink.JankenPon.pro, non-consumable, ¥300 / US$1.99). Restore is available. The "Try PRO" switch and preview note in the web preview are development-only and do not appear in the iOS build.
No ads, analytics or tracking SDKs. No free-text chat — six fixed stamps only.
Privacy: https://github.com/signlinkjp/janken-pon-game/blob/main/docs/privacy.md — Support: t.maks.ts@gmail.com
```

---

## 3. App のプライバシー（App Privacy の回答）

コードを確認したうえでの回答（2026-11-23・Build 6）。

- **トラッキング**: なし（`NSUserTrackingUsageDescription` も広告 SDK もない）。
- **収集するデータ**: ユーザーコンテンツ ›「その他のユーザーコンテンツ」— ニックネーム・国・対戦記録（ポイント・勝敗・手の率）。
  - 用途: App の機能（スコア・ランキング・対戦の表示）。
  - 本人との関連付け: **関連付けられる**（ニックネームと国をランキングに表示するため）。
  - トラッキング目的: いいえ。
- **端末内だけのもの**: 設定（サウンド・文字サイズ・言語・スタンプ通知）、CPU練習の記録。サーバーへは送らない。
- **位置情報・連絡先・写真・広告 ID・購入履歴**: 取得しない（課金は StoreKit が処理し、アプリは購入結果だけを受け取る）。
- **保存先**: ランキングの行は Supabase（`games-realtime`・当方管理）のチャンネル上で交換。アカウントは持たない。

---

## 4. スクリーンショット（6.9インチ・1320×2868）

`node tools/shots-b6.mjs` で撮影（Chromium 440×956 @3x）。すべて実画面・pageerror ゼロ。
並び順の推奨（1枚目が一番伝わるもの）:

| # | ファイル | 中身 |
| --- | --- | --- |
| 1 | `downloads/janken-b6-play.png` | プレイ中（かけ声の瞬間・右上に 🔊 ON） |
| 2 | `downloads/janken-b6-title.png` | タイトル（モード・回戦数・CPUの強さ） |
| 3 | `downloads/janken-b6-result.png` | 結果（5回戦/3回戦の WIN・LOSE が色分け） |
| 4 | `downloads/janken-b6-ranking.png` | 国内ランキング（YOU の行・手の率） |
| 5 | `downloads/janken-b6-party.png` | パーティー（4人・サウンドのボタン入り） |
| 6 | `downloads/janken-b6-pro.png` | PRO（¥300・5つの解放内容） |
| 7 | `downloads/janken-b6-settings.png` | 設定（サウンド・文字サイズ・言語・版表示 1.0.0 (Build 6)） |

補助（QA・提出用ではない）:
- `downloads/janken-b6-play-muted.png` — サウンド OFF の見た目（🔇 OFF）
- `downloads/janken-b6-xlarge.png` / `janken-b6-xlarge-375.png` — 特大文字のヘッダー（393 / 375 幅・はみ出しなし）

※ スクショはステータスバーなしで描画しています（Web 画面を端末サイズで描いたもの）。
実機で撮り直す場合は、iPhone 16 Pro Max のスクリーンショット（1320×2868）がそのまま同じ枠に入ります。
6.5インチ等が必要になった場合は、同じ手順で `deviceScaleFactor` を変えて書き出せます。

---

## 5. 提出前チェック（App Store Connect で埋めるもの）

- [ ] バージョン 1.0.0・ビルド 6 を選択（TestFlight で Build 6 が処理済みであること）
- [ ] アプリ名 / サブタイトル / プロモーション用テキスト / キーワード / 説明（日本語・英語）
- [ ] スクリーンショット 6.9インチ 7枚
- [ ] サポート URL・プライバシーポリシー URL（上の2つ）
- [ ] App 内課金 `jp.signlink.JankenPon.pro` を **このバージョンに添付**（審査で購入画面を確認）
- [ ] App のプライバシー（上の「3.」のとおり）
- [ ] 年齢制限 4+（暴力・ギャンブル・UGC なし）
- [ ] 審査メモ（日本語の「審査メモ」をそのまま）
- [ ] 輸出コンプライアンス（暗号化は HTTPS/WSS のみ＝「はい／免除」）
- [ ] 連絡先 `t.maks.ts@gmail.com`（表示名 T-maks Games）
