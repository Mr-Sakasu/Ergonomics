# /// script
# dependencies = ["openai", "python-dotenv"]
# ///

import os
from openai import OpenAI
from dotenv import load_dotenv

# .envファイルから環境変数を読み込む
load_dotenv()

def test_openai_api():
    """OpenAI APIキーが正しく設定されているかテストする"""
    
    # 環境変数からAPIキーを取得
    api_key = os.getenv('OPENAI_API_KEY')
    
    # APIキーの存在確認
    if not api_key:
        print("❌ エラー: OPENAI_API_KEYが設定されていません")
        return False
    
    print(f"✓ APIキーが見つかりました (先頭: {api_key[:7]}...)")
    
    try:
        # OpenAIクライアントを初期化（タイムアウトを60秒に設定）
        client = OpenAI(
            api_key=api_key,
            timeout=10.0
        )
        
        # 簡単なAPIリクエストを送信
        print("\n🔄 APIに接続中...")
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "user", "content": "Hello! Please respond with 'API connection successful!'"}
            ],
            max_tokens=50
        )
        
        # レスポンスを表示
        message = response.choices[0].message.content
        print(f"✅ 接続成功！")
        print(f"📩 レスポンス: {message}")
        return True
        
    except Exception as e:
        print(f"❌ エラーが発生しました: {str(e)}")
        print(f"📝 エラータイプ: {type(e).__name__}")
        
        # 詳細なエラー情報を表示
        if hasattr(e, '__cause__') and e.__cause__:
            print(f"🔍 原因: {e.__cause__}")
        
        return False

if __name__ == "__main__":
    print("=== OpenAI API接続テスト ===\n")
    test_openai_api()