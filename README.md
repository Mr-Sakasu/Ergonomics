# Ergonomics / AI Commerce Agent

AI を使った E-commerce assistant の Chrome 拡張と、ユーザー体験評価の分析コードを管理するリポジトリです。公開・共有時に個人情報や参加者データを含めないよう、分析元データやブラウザプロファイルは Git 管理から外す方針にしています。

- GitHub: https://github.com/Mr-Sakasu/Ergonomics
- 種別: Chrome Extension、AI assistant UI、ユーザー評価分析
- 主な対象: 商品検索支援、side panel UI、アンケート分析

## 作成物の説明

JD.com の検索ページ上で商品情報を取得し、Chrome side panel から AI assistant として検索・比較を補助する拡張機能です。加えて、ユーザー評価アンケートを分析し、言語条件や操作体験の違いを比較するための Python スクリプトを含みます。

## 担当した役割

- Chrome Extension Manifest V3 の構成、background script、content script、side panel UI を実装
- 商品検索ページの DOM から商品情報を抽出する scraper を実装
- 評価アンケートの集計、可視化、分析用 Python スクリプトを作成
- `.gitignore` を整備し、参加者データ、ローカルブラウザプロファイル、生成レポートを新規コミットに含めない運用に整理

## 直面した課題と解決方法

- E-commerce サイトの DOM はページ状態で変わりやすいため、content script 側で取得対象を分離し、必要な情報だけを side panel に渡す構成にしました。
- 拡張機能の UI とページ側 script の責務が混ざりやすかったため、background、content、side panel を分け、Manifest V3 の権限を必要範囲に限定しました。
- アンケートやブラウザプロファイルには公開に向かない情報が含まれる可能性があるため、分析コードと raw data を分け、ignore 対象を明示しました。

## 技術情報

- Chrome Extension Manifest V3
- JavaScript
- Chrome `sidePanel` API
- Content scripts / background service worker
- Python analysis scripts
- pandas / matplotlib / document export workflow

## 関連リポジトリ

- Portfolio: https://github.com/Mr-Sakasu/portfolio
- THU Auto Login: https://github.com/Mr-Sakasu/THU-auto-login
