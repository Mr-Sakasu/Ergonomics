# Ergonomics / AI Commerce Agent

人間工学の授業プロジェクトとして作成した、AI を用いた E-commerce 支援プロトタイプです。
Chrome Extension の side panel、軽量な API ハンドラ、アンケート分析用スクリプトを含みます。

## 概要

オンラインショッピング中に AI assistant がどのように商品検索や比較を支援できるかを検証するためのプロジェクトです。主に JD.com の商品検索ページを対象に、以下の機能を実装しています。

- Chrome Extension の side panel UI
- 検索ページ上の商品情報を取得する content script
- 言語判定、検索クエリ生成、音声入力、画像からの検索語生成、商品検索を行う API ハンドラ
- アンケート結果を集計・可視化する Python スクリプト

## ディレクトリ構成

```text
api/                         Serverless API ハンドラ
ai-commerce-agent/extension/ Chrome Extension 本体
ai-commerce-agent/server/    ローカル開発用 Express server
ai-commerce-agent/analysis/  分析用スクリプト
room/                        部屋レイアウト補助ファイル
```

アンケートの raw data、生成レポート、ブラウザプロファイル、ローカル環境ファイル、依存パッケージのディレクトリは公開用のソースツリーから除外しています。

## 環境変数

実際の API key はコミットしません。`.env.example` または `ai-commerce-agent/server/.env.example` をコピーし、ローカルで値を設定してください。

```bash
OPENAI_API_KEY=
OPENAI_API_BASE=https://api.openai.com
OPENAI_MODEL=gpt-4.1-mini
OPENAI_VISION_MODEL=gpt-4o-mini
SERPAPI_KEY=
JD_APP_KEY=
JD_APP_SECRET=
PORT=3000
```

コードは secret を環境変数から読み込みます。必要な key がない場合、endpoint によって限定的な fallback または mock 動作になります。

## ローカル開発

ルートの依存関係をインストールします。

```bash
npm install
```

ローカル server を起動する場合は以下を実行します。

```bash
cd ai-commerce-agent/server
npm install
cp .env.example .env
npm start
```

Chrome Extension は、Chrome の拡張機能開発者モードから `ai-commerce-agent/extension/` を読み込んで使用します。

## 分析

`ai-commerce-agent/analysis/` には再利用可能な Python スクリプトと依存関係の情報のみを置きます。参加者ごとの raw data や生成レポートは Git に含めません。

分析用の依存関係は以下でインストールできます。

```bash
pip install -r ai-commerce-agent/analysis/requirements.txt
```

アンケートファイルを使う場合は、ローカル作業用として `ai-commerce-agent/analysis/` に配置してください。これらのファイルは `.gitignore` で除外されています。

## 公開時の注意

このリポジトリを public にする前に、現在のファイルだけでなく Git 履歴にも以下が残っていないことを確認してください。

- `.env` ファイルや API key
- `.pw-*` などのブラウザプロファイル
- `node_modules/` ディレクトリ
- アンケート raw data、出力レポート、参加者単位の記録
- ローカル proxy/debug 用スクリプト

現在の `.gitignore` はこれらが新しく追加されることを防ぎます。ただし、過去にコミットされた sensitive file は、リポジトリを public に変更する前に Git 履歴から削除する必要があります。

## 関連リンク

- Repository: https://github.com/Mr-Sakasu/Ergonomics
- Portfolio: https://github.com/Mr-Sakasu/portfolio
