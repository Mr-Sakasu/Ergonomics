#!/bin/bash

echo "=== OpenAI API 接続テスト (curl) ==="
echo ""

# .envファイルを探す（カレントディレクトリと親ディレクトリ）
if [ -f .env ]; then
    source .env
    echo "✓ .envファイルを読み込みました (.env)"
elif [ -f ../.env ]; then
    source ../.env
    echo "✓ .envファイルを読み込みました (../.env)"
fi

# APIキーの確認
if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ エラー: OPENAI_API_KEYが設定されていません"
    echo ""
    echo "以下のいずれかの方法で設定してください："
    echo "1. .envファイルを作成: echo 'OPENAI_API_KEY=sk-...' > .env"
    echo "2. 環境変数として設定: export OPENAI_API_KEY='sk-...'"
    echo "3. スクリプト実行時に指定: OPENAI_API_KEY='sk-...' $0"
    exit 1
fi

echo "✓ APIキーが見つかりました"
echo ""

# ネットワーク診断
echo "🔍 ネットワーク診断:"
echo -n "  Google DNS (8.8.8.8): "
if ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1; then
    echo "✓ 到達可能"
else
    echo "❌ 到達不可"
fi

echo -n "  api.openai.com (DNS解決): "
if nslookup api.openai.com >/dev/null 2>&1; then
    echo "✓ 解決成功"
else
    echo "❌ 解決失敗"
fi

echo ""
echo "🔄 OpenAI APIに接続中..."

# APIリクエスト
response=$(curl -s -w "\n%{http_code}" --max-time 30 \
  https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 10
  }')

http_code=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    echo "✅ 接続成功！ (HTTP $http_code)"
    echo "📩 レスポンス:"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
else
    echo "❌ 接続失敗 (HTTP $http_code)"
    echo "📩 レスポンス:"
    echo "$body"
fi