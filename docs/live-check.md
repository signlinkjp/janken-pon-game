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

## アプリの画面からの通し確認（2ブラウザ）

`tools/online-e2e.mjs` は、同じ Chromium に2ページ開き、**アプリの画面から**
合言葉の部屋（使い捨てのコード）へ入って5回戦を最後まで遊びます。実際の
`games-realtime` に接続し、両方の判定と国内ランキングへの記録が一致することを確かめました。

```
npm run e2e        # 7チェック（5秒の対戦画面・WIN/LOSEの一致・国内記録・JSエラーなし）
```

結果（2026-11-22）: **7 checks pass**（A: WIN 25pt / B: LOSE 0pt、両方の国内記録が1試合）。

使い捨てのチャンネル名（国コード `ZZ`、ランダムな合言葉）で行ったので、
実際のプレイヤーのランキングや部屋には触れていません。終了時に `phx_leave` で退出しています。
