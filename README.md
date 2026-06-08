# Ergonomics / AI Commerce Agent

人間工学の授業プロジェクトとして作成した、AI を用いた E-commerce 支援プロトタイプです。オンラインショッピング中の検索、比較、入力支援を、Chrome Extension と AI API を組み合わせて実装しています。

## 実装した機能

- 商品検索ページ上で使える side panel 型の AI assistant
- JD.com の検索結果から商品名、価格、画像、店舗情報などを取得するスクレイピング
- ユーザーの自然文入力を、検索に適した短いキーワードへ変換するクエリ生成
- 日本語・英語・中国語などの入力に対応する言語判定と表示調整
- 音声入力をテキスト化する speech-to-text
- 商品画像から検索キーワードを作る image-to-query
- アンケート結果を集計し、利用体験を分析する Python スクリプト

## 技術スタック

- Chrome Extension Manifest V3、`sidePanel` API、content scripts
- JavaScript / HTML / CSS による拡張機能 UI
- Node.js の API handlers とローカル検証用 Express server
- OpenAI API による言語判定、検索クエリ生成、画像理解、音声認識
- JD.com の DOM scraping と `cheerio` による商品情報抽出
- SerpAPI による汎用の商品検索 fallback
- Python、pandas、NumPy、SciPy、matplotlib、seaborn によるアンケート分析

## 実装上のポイント

拡張機能側では、閲覧中の検索ページから必要な商品情報だけを取得し、side panel に渡す構成にしています。AI 処理や外部検索は API handler 側に分けることで、UI、ページ解析、外部 API 呼び出しの責務を分離しています。

API key や参加者データは公開リポジトリに含めない方針です。実際の secret は環境変数で扱い、アンケート raw data、生成レポート、ブラウザプロファイル、`node_modules/` は Git 管理から除外しています。

## 公開時の注意

現在のファイルツリーからは公開に向かないファイルを除外しています。ただし、過去の Git 履歴には sensitive file が残っている可能性があるため、リポジトリを public に変更する前には履歴の purge が必要です。

## 関連リンク

- Repository: https://github.com/Mr-Sakasu/Ergonomics
- Portfolio: https://github.com/Mr-Sakasu/portfolio
