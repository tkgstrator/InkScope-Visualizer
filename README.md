# InkScope Visualizer

InkScope の UDP 解析結果を表示する Bun・Hono・React・TypeScript アプリです。Overview、Debug、Raw HEX、3D Map、Replay、OBS、Settings を備えます。ローカルの記録サンプルが設定されていれば初期表示に使います。LIVE は InkScope が実際に送ったイベントだけを表示します。

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

Replay HUD は `thunder_api` の Splatoon 2 / Splatoon 1 フォントをローカルで利用できます。隣の `thunder_api/docs/mock-diff/assets/fonts/` にキャッシュがある場合は `bun tools/sync-hud-fonts.ts` を実行します。別の場所ならフォントディレクトリを引数で指定します。フォントは `app/public/local-fonts/` に置かれ、Git と配布ビルドには含まれず、起動中のローカル Hono から配信します。キャッシュがない環境では M PLUS 1 Code に切り替わります。

金イクラのアイコンは `bun tools/sync-hud-egg-icon.ts` で `thunder_api/docs/mock-diff/assets/img/ui/` のローカルキャッシュからコピーできます。別の場所なら同ディレクトリを引数で指定します。コピー先の `app/public/local-game-assets/` は Git と配布ビルドから除外され、ローカル Hono が許可したアイコンだけを配信します。

所有する Splatoon 3 11.3.0 RomFS の HUD 素材は `Layout/Coop_MainTV_00.Nin_NX_NVN.blarc.zs`、`Layout/TGPlayerIcon_00.Nin_NX_NVN.blarc.zs`、`Layout/Timer_00.Nin_NX_NVN.blarc.zs` にあります。Zstd と SARC を展開すると各アーカイブに `__Combined.bntx` が入っています。ローカルの `wimgt` で以下のように PNG に変換し、同じ出力ディレクトリから必要な8枚だけを取り込みます。

```sh
wimgt DECODE /path/to/Coop_MainTV_00/__Combined.bntx --dest /tmp/inkscope-hud-decoded/Coop_MainTV_00.png
wimgt DECODE /path/to/TGPlayerIcon_00/__Combined.bntx --dest /tmp/inkscope-hud-decoded/TGPlayerIcon_00.png
wimgt DECODE /path/to/Timer_00/__Combined.bntx --dest /tmp/inkscope-hud-decoded/Timer_00.png
bun tools/sync-romfs-hud-assets.ts /tmp/inkscope-hud-decoded
```

使用する画像は金イクラ `img001`、上段テープの装飾 `img008`、下段テープの装飾 `img006`、共通の左端 `img005`、上段の右端 `img009`、下段の右端 `img007`、イカの主表示 `img014`、タイマー台座 `img000` です。テープの端は画面全幅へ引き伸ばさず、帯の両端に置きます。PNG は `app/public/local-game-assets/` にのみ置かれ、Git と配布ビルドには入りません。

## 記録サンプル

InkScope の `inspect` で PCAP を Visualizer に送ると、PostgreSQL にセッションが保存されます。そのセッションの一部分を初期表示にするには、Git 管理外の `.env.local` に次の二つを追加します。

```dotenv
INKSCOPE_SAMPLE_SESSION_ID=<保存済みセッションの UUID>
INKSCOPE_SAMPLE_AFTER_RECORD=<表示開始直前のレコード番号>
```

RECORDED の初期表示は指定した位置から最大 1,200 パケットを読みます。Debug と Raw はその範囲を 80 パケットずつ移動できます。Replay は同じセッションの指定位置から保存済みイベントを全件読み込み、記録時刻に合わせて連続再生します。プログレスバーは記録時間を表し、Restart は指定した開始位置に戻ります。保存済みデータだけを表示し、LIVE の WebSocket とは別です。設定がなければ合成 DEMO に切り替わります。`?source=demo` と `?source=live` で表示モードを直接指定できます。サンプルの読み込み失敗やレコード欠損は RECORDED のエラー・空状態として表示します。PCAP、鍵、実パケットの JSON はリポジトリに追加しません。

```sh
bun run test
bun run test:e2e
```

Playwright はインストール済み Google Chrome のヘッドレスモードを使用します。既に 10252 番でサーバーを起動している場合はそれを再利用します。

## InkScope と接続

InkScope はキャプチャーを行い、`ws://127.0.0.1:10252/api/ingest` に解析イベントを送ります。両プロセスには同じ `INKSCOPE_VISUALIZER_TOKEN` が必要です。`INKSCOPE_VISUALIZER_URL` または `--visualizer-url` で送信先を指定します。制御 API には別の `INKSCOPE_CONTROL_TOKEN` を両プロセスへ設定します。PCAP 保存とリプレイハブの通信経路はこの表示用送信から独立しています。詳細は [API 契約](api/README.md) を参照してください。

Settings では起動済み InkScope のローカル制御ポートと GameKey を指定します。制御機能は `capture --control-port 10254` で明示的に有効化した場合だけ使用できます。接続先は `127.0.0.1` に限定します。画面から入力した GameKey はブラウザーの開いている間だけメモリに保持し、ブラウザー保存領域、イベント、OBS、PostgreSQL には書き込みません。起動時に `--game-key-file` などで指定した鍵は `*` で隠して読み取り専用にします。接続先の初期値は `127.0.0.1:10254` です。現在の Compose 構成は PostgreSQL sidecar のみで、InkScope のコンテナ起動は含めていません。

LIVE と RECORDED の RTT、PrivateSetting、WAVE などは、InkScope が実際に復号して送ったフィールドだけを表示します。未受信の値は `—` です。Replay は PostgreSQL に保存されたイベントをセッションごとに読み直します。OBS のブラウザーソース URL は <http://localhost:10252/?view=overlay&source=live> です。

## 3D Map

所有する Splatoon 3 11.3.0 RomFS の 15 個の `Cop_*` Scene を [マップデータ](app/public/maps/README.md) に記録しました。固定マーカー、敵関連候補、Layer と潮位の静的対応を切り替えられます。14 種類の地形 GLB はこの端末の `app/public/maps/local/` にだけあり、Git と Vite ビルドから除外します。新しいクローンでは地形の代わりに座標グリッドを表示します。人物の XYZ は現在デモ値で、実プレイヤー位置の復号は未実装です。

公開リポジトリにはゲーム由来のモデル、テクスチャ、元の Scene/Banc を含めません。コミットされる JSON は固定座標と出典の索引です。
