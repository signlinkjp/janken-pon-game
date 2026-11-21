# 通信のライブ確認（Supabase `games-realtime`）

Build 1 の通信は、テスト（フェイクの WebSocket）だけでなく、**実際の
`games-realtime` プロジェクト** に接続して確かめました。日時は 2026-11-22（Asia/Tokyo）。

- 接続先: `wss://siivncidktbuyqwsjeqd.supabase.co/realtime/v1/websocket`（publishable キー）
- `phx_join` の返事: `{"status":"ok","response":{"postgres_changes":[]}}` → **参加できる**
- 2人対戦（`janken-quick:ZZ:5` の使い捨てチャンネル）
  - A・B が presence で組になり、**同じ `janken-match:<idA>-<idB>` に参加**
  - A: パー / B: グー → 両方で同じ判定（A WIN +5pt、B LOSE、相手 +5pt）
  - A は B のニックネームを受け取った
- 3人パーティー（`janken-party:SMK…` の使い捨てチャンネル）
  - 3人全員の roster が揃い、クライアントIDが先頭の人がホスト
  - パー・パー・グー → **3人とも同じ結果**（パー2人が5pt、グー0pt、勝者2人）

使い捨てのチャンネル名（国コード `ZZ`、ランダムな合言葉）で行ったので、
実際のプレイヤーのランキングや部屋には触れていません。終了時に `phx_leave` で退出しています。

再現用のスクリプトは残していません（`tmp/` は確認後に削除）。同じ確認は
`src/online.js` の `RealtimeClient` / `OnlineSession` を2〜3個作り、
`quickMatch` / `openParty` を呼ぶだけで行えます。
