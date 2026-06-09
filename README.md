# Ergonomics / AI Commerce Agent

人間工学の授業プロジェクトとして作成した、AI を用いた E-commerce 支援プロトタイプです。オンラインショッピング中の検索、比較、入力支援を、Chrome Extension と AI API を組み合わせて実装しています。

## デモ動画

JD.com の商品検索ページ上で、side panel から自然文入力、商品情報取得、多言語クエリ生成を行う流れを確認できます。

<video src="https://portfolio-five-blond-32.vercel.app/videos/projects/jd-global-demo.mp4" controls width="720"></video>

- 動画ファイル: https://portfolio-five-blond-32.vercel.app/videos/projects/jd-global-demo.mp4

## 実装した機能

- 商品検索ページ上で利用できる side panel 型の AI assistant
- JD.com の検索結果から商品名、価格、画像、店舗情報などを取得する商品情報抽出
- ユーザーの自然文入力を検索に適した短いキーワードへ変換するクエリ生成
- 日本語、英語、中国語などの入力に対応する言語判定と表示調整
- 音声入力をテキスト化し、そのまま商品検索に接続する speech-to-text
- 商品画像からカテゴリや特徴を抽出して検索語を作る image-to-query
- アンケート結果を集計し、ユーザー体験を分析する Python スクリプト

## 技術スタック

### Chrome Extension

Chrome Extension Manifest V3 を用いて、検索ページ上で動作する拡張機能を構成しています。`sidePanel` API で assistant UI を表示し、content scripts でページ上の商品情報を取得します。background service worker は拡張機能内のイベント処理や side panel の起動制御を担当します。

### Frontend

side panel UI は JavaScript、HTML、CSS で実装しています。検索ページから取得した商品情報、AI が生成した検索語、音声・画像入力の結果を同じ UI 上で扱えるようにし、ショッピング中の操作を中断せずに補助できる構成にしています。

### API / Backend

Node.js の API handlers とローカル検証用の Express server を使っています。言語判定、検索クエリ生成、画像からの検索語生成、音声認識、商品検索を endpoint ごとに分け、UI 側と外部 API 呼び出しを分離しています。API key はコードに直接書かず、環境変数から読み込む設計です。

### AI / Search

OpenAI API を用いて、自然文からの商品検索キーワード生成、入力言語の判定、画像からの商品特徴抽出、音声入力の文字起こしを行っています。JD.com 向けには中国語の検索語を生成し、一般的な商品検索の fallback として SerpAPI も利用しています。

### Web Scraping

JD.com の検索結果ページから商品情報を取得するために、content scripts と DOM scraping を利用しています。API 側では `cheerio` を使い、商品名、価格、画像 URL、店舗名などを抽出・整形します。

### Data Analysis

アンケート分析には Python を使っています。pandas、NumPy、SciPy で回答データを集計し、matplotlib、seaborn で可視化します。分析コードは再利用できるように分け、raw data や生成レポートはリポジトリに含めない方針です。

## 実装上のポイント

拡張機能側では、閲覧中の検索ページから必要な商品情報だけを取得し、side panel に渡す構成にしています。AI 処理や外部検索は API handler 側に分けることで、UI、ページ解析、外部 API 呼び出しの責務を分離しています。

商品検索では、ユーザーが入力した自然文をそのまま検索に使うのではなく、検索バー向けの短いキーワードへ変換します。特に JD.com では中国語キーワードの精度が重要になるため、表示用の言語と実際の検索用クエリを分けて扱っています。

## 関連リンク

- Repository: https://github.com/Mr-Sakasu/Ergonomics
- Portfolio: https://github.com/Mr-Sakasu/portfolio
