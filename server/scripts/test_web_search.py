"""
测试 Anthropic Web Search API
用于诊断为什么 web_search_tool_result 返回空结果

运行方式: python test_web_search.py
"""
import os
import sys

import anthropic

# 添加 server 目录到 path 以便导入 config
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 尝试从 config 获取 API key，否则从环境变量
try:
    from config import get_settings
    API_KEY = get_settings().anthropic_api_key
except Exception:
    API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")


def test_web_search_with_beta():
    """测试带有 beta header 的 web search"""
    client = anthropic.Anthropic(api_key=API_KEY)

    # 定义 web search 工具
    tools = [
        {
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 5
        }
    ]

    print("=" * 70)
    print("TEST 1: Web Search WITH beta header (web-search-2025-03-05)")
    print("=" * 70)

    try:
        # 使用 extra_headers 添加 beta header
        with client.messages.stream(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            tools=tools,
            messages=[
                {"role": "user", "content": "Use web_search to find information about Kobe Bryant's NBA career statistics. You MUST use the web_search tool."}
            ],
            extra_headers={"anthropic-beta": "web-search-2025-03-05"}
        ) as stream:
            for event in stream:
                event_type = getattr(event, 'type', 'unknown')

                # 打印所有事件类型
                print(f"Event: {event_type}", end="")

                # 详细打印 web_search 相关事件
                if 'web_search' in str(event_type) or 'server_tool' in str(event_type) or 'content_block_start' in str(event_type):
                    print(f"\n--- Event Type: {event_type} ---")
                    print(f"Event: {event}")

                    # 检查 content_block
                    if hasattr(event, 'content_block'):
                        block = event.content_block
                        print(f"Content block type: {getattr(block, 'type', 'N/A')}")
                        print(f"Content block: {block}")

                        # 检查 content
                        if hasattr(block, 'content'):
                            print(f"Block content: {block.content}")
                            print(f"Block content type: {type(block.content)}")
                            if block.content:
                                for i, item in enumerate(block.content):
                                    print(f"  Item {i}: {item}")
                                    print(f"  Item type attr: {getattr(item, 'type', 'N/A')}")
                            else:
                                print("  *** CONTENT IS EMPTY OR NONE ***")
                        else:
                            print("  *** NO CONTENT ATTRIBUTE ***")
                else:
                    print()  # 换行

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()


def test_web_search_without_beta():
    """测试不带 web-search beta header 的 web search (当前代码的行为)"""
    client = anthropic.Anthropic(api_key=API_KEY)

    tools = [
        {
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 5
        }
    ]

    print("\n" + "=" * 70)
    print("TEST 2: Web Search WITHOUT web-search beta header")
    print("        (only web-fetch-2025-09-10 - current behavior)")
    print("=" * 70)

    try:
        # 不添加 web-search beta header，只用 web-fetch
        with client.messages.stream(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            tools=tools,
            messages=[
                {"role": "user", "content": "Search for Kobe Bryant basketball career"}
            ],
            extra_headers={"anthropic-beta": "web-fetch-2025-09-10"}  # 只有 web-fetch
        ) as stream:
            for event in stream:
                event_type = getattr(event, 'type', 'unknown')

                if 'web_search' in str(event_type) or 'server_tool' in str(event_type):
                    print(f"\n--- Event Type: {event_type} ---")
                    print("*** WEB SEARCH/SERVER TOOL EVENT ***")

                    if hasattr(event, 'content_block'):
                        block = event.content_block
                        print(f"Content block type: {getattr(block, 'type', 'N/A')}")
                        print(f"Content block: {block}")
                        if hasattr(block, 'content'):
                            print(f"Block content: {block.content}")
                            if block.content:
                                for i, item in enumerate(block.content):
                                    print(f"  Item {i}: {item}")
                            else:
                                print("  *** CONTENT IS EMPTY OR NONE ***")

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()


def test_web_search_no_header():
    """测试完全不带 beta header 的 web search"""
    client = anthropic.Anthropic(api_key=API_KEY)

    tools = [
        {
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 5
        }
    ]

    print("\n" + "=" * 70)
    print("TEST 3: Web Search with NO beta headers at all")
    print("=" * 70)

    try:
        with client.messages.stream(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            tools=tools,
            messages=[
                {"role": "user", "content": "Search for Kobe Bryant basketball career"}
            ]
        ) as stream:
            for event in stream:
                event_type = getattr(event, 'type', 'unknown')

                if 'web_search' in str(event_type) or 'server_tool' in str(event_type):
                    print(f"\n--- Event Type: {event_type} ---")
                    print("*** WEB SEARCH/SERVER TOOL EVENT ***")

                    if hasattr(event, 'content_block'):
                        block = event.content_block
                        print(f"Content block type: {getattr(block, 'type', 'N/A')}")
                        print(f"Content block: {block}")
                        if hasattr(block, 'content'):
                            print(f"Block content: {block.content}")
                            if block.content:
                                for i, item in enumerate(block.content):
                                    print(f"  Item {i}: {item}")
                            else:
                                print("  *** CONTENT IS EMPTY OR NONE ***")

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    if not API_KEY:
        print("Error: Please set ANTHROPIC_API_KEY environment variable")
        print("Or ensure server/.env file has the key configured")
        sys.exit(1)

    print("Anthropic Web Search API Test")
    print(f"Using API key: {API_KEY[:10]}...{API_KEY[-4:]}")
    print()

    # 测试1: 带 web-search beta header
    test_web_search_with_beta()

    # 测试2: 只有 web-fetch beta header (当前行为)
    test_web_search_without_beta()

    # 测试3: 完全不带 beta header
    test_web_search_no_header()

    print("\n" + "=" * 70)
    print("Tests completed!")
    print("=" * 70)
