# InkScope Visualizer

InkScope の UDP 解析結果を表示する Bun・Hono・React・TypeScript アプリです。Overview、Debug、Raw HEX、3D Map、Replay、OBS、Settings を備えます。初期表示は操作確認用のデモです。LIVE は InkScope が実際に送ったイベントだけを表示します。

## 起動

```sh
bun install --frozen-lockfile
docker compose up -d --wait postgres
cp .env.example .env.local
# .env.local のトークンを秘密のランダム値に変更
bun run build
bun run start
```

<http://localhost:10252/> を開きます。Hono は `127.0.0.1:10252` にバインドします。PostgreSQL は `127.0.0.1:10253` に公開するローカル sidecar です。`.env.local` とデータベースの実データは Git に含まれません。PostgreSQL を使わない場合は `DATABASE_URL` を設定せずに起動でき、Replay API は無効になります。

`bun run dev` はビルド後に Hono を監視起動します。`bun run dev:app` は単独の Vite サーバーで、Hono と同じポートを使うため同時起動しません。

```sh
bun run test
bun run test:e2e
```

Playwright はインストール済み Google Chrome のヘッドレスモードを使用します。既に 10252 番でサーバーを起動している場合はそれを再利用します。

## InkScope と接続

InkScope はキャプチャーを行い、`ws://127.0.0.1:10252/api/ingest` に解析イベントを送ります。両プロセスには同じ `INKSCOPE_VISUALIZER_TOKEN` が必要です。`INKSCOPE_VISUALIZER_URL` または `--visualizer-url` で送信先を指定します。制御 API には別の `INKSCOPE_CONTROL_TOKEN` を両プロセスへ設定します。PCAP 保存とリプレイハブの通信経路はこの表示用送信から独立しています。詳細は [API 契約](api/README.md) を参照してください。

Settings では起動済み InkScope のローカル制御ポートと GameKey を指定します。制御機能は `capture --control-port 10254` で明示的に有効化した場合だけ使用できます。接続先は `127.0.0.1` に限定します。画面から入力した GameKey はブラウザーの開いている間だけメモリに保持し、ブラウザー保存領域、イベント、OBS、PostgreSQL には書き込みません。起動時に `--game-key-file` などで指定した鍵は `*` で隠して読み取り専用にします。接続先の初期値は `127.0.0.1:10254` です。現在の Compose 構成は PostgreSQL sidecar のみで、InkScope のコンテナ起動は含めていません。

LIVE の RTT、PrivateSetting、WAVE などは、InkScope が実際に復号して送ったフィールドだけを表示します。未受信の値は `—` です。Replay は PostgreSQL に保存されたイベントをセッションごとに読み直します。OBS のブラウザーソース URL は <http://localhost:10252/?view=overlay&source=live> です。

## 3D Map

所有する Splatoon 3 11.3.0 RomFS の 15 個の `Cop_*` Scene を [マップデータ](app/public/maps/README.md) に記録しました。固定マーカー、敵関連候補、Layer と潮位の静的対応を切り替えられます。14 種類の地形 GLB はこの端末の `app/public/maps/local/` にだけあり、Git と Vite ビルドから除外します。新しいクローンでは地形の代わりに座標グリッドを表示します。人物の XYZ は現在デモ値で、実プレイヤー位置の復号は未実装です。

公開リポジトリにはゲーム由来のモデル、テクスチャ、元の Scene/Banc を含めません。コミットされる JSON は固定座標と出典の索引です。
