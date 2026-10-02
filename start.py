#!/usr/bin/env python3
"""填写 AI 配置并启动文色。仅依赖 Python 3 标准库。"""
import functools
import getpass
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import webbrowser


ROOT = Path(__file__).resolve().parent
AI_FILE = ROOT / "assets" / "engine" / "ai.js"
CONFIG = re.compile(r"\bconst\s+config\s*=\s*\{(?P<body>[\s\S]*?)\};")


def field_pattern(name):
    return re.compile(r'(?m)^(\s*' + re.escape(name) + r'\s*:\s*)("(?:\\.|[^"\\])*")')


def read_config(source):
    match = CONFIG.search(source)
    if not match:
        raise ValueError("ai.js 中找不到 config 配置，请使用完整项目文件。")
    values = {}
    for name in ("endpoint", "apiKey", "model"):
        field = field_pattern(name).search(match.group("body"))
        if not field:
            raise ValueError("ai.js 配置格式无法识别：" + name)
        values[name] = json.loads(field.group(2))
    return values


def write_config(path, source, values):
    # 用 JSON 编码输入，避免引号、反斜杠等破坏 JS 或成为代码。
    match = CONFIG.search(source)
    body = match.group("body")
    for name, value in values.items():
        body, count = field_pattern(name).subn(
            lambda field: field.group(1) + json.dumps(value, ensure_ascii=True), body
        )
        if count != 1:
            raise ValueError("ai.js 配置字段缺失或重复：" + name)
    updated = source[:match.start("body")] + body + source[match.end("body"):]
    # 写入成功后才替换原文件，中途退出不会留下半份配置。
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=path.parent, delete=False) as file:
            temporary = Path(file.name)
            file.write(updated)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def ask_config(current):
    print("文色 · 自动配置与启动\n")
    print("默认配置使用 GLM，可换用其他兼容 Chat Completions 格式的模型服务。")
    print("Endpoint 请填写所选服务的完整聊天接口 URL。")
    while True:
        endpoint = input("Endpoint [回车使用 " + current["endpoint"] + "]: ").strip() or current["endpoint"]
        try:
            parsed = urlsplit(endpoint)
            valid = (parsed.scheme in ("http", "https") and bool(parsed.hostname)
                     and not parsed.fragment and not any(c.isspace() for c in endpoint))
            parsed.port  # 同时检查端口格式。
        except ValueError:
            valid = False
        if valid:
            break
        print("请输入以 http:// 或 https:// 开头的完整接口地址。")
    previous = current["apiKey"].strip()
    has_key = bool(previous) and not re.match(r"^(YOUR_API_KEY|你的|请填写)", previous, re.I)
    while True:
        prompt = "API Key [回车保留已配置的 Key，输入不回显]: " if has_key else "API Key [输入不回显]: "
        key = getpass.getpass(prompt).strip()
        if not key and has_key:
            key = previous
        if key:
            break
        print("API Key 不能为空。")
    while True:
        model = input("Model [回车使用 " + current["model"] + "]: ").strip() or current["model"]
        if model:
            break
        print("Model 不能为空。")
    return {"endpoint": endpoint, "apiKey": key, "model": model}


class LocalHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # 配置修改后立即生效，无需手动强制刷新旧的 ai.js。
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def create_server(root):
    handler = functools.partial(LocalHandler, directory=str(root))
    for port in range(8000, 8100):
        try:
            return ThreadingHTTPServer(("127.0.0.1", port), handler)
        except OSError as error:
            # Windows 和 Linux 的“端口占用”错误码。
            if error.errno not in (48, 98, 10048) and getattr(error, "winerror", None) != 10048:
                raise
    raise OSError("8000–8099 端口均被占用，请关闭旧服务后重试。")


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    source = AI_FILE.read_text(encoding="utf-8")
    values = ask_config(read_config(source))
    write_config(AI_FILE, source, values)
    print("\n配置已写入 assets/engine/ai.js。")
    with create_server(ROOT) as server:
        url = "http://127.0.0.1:" + str(server.server_port) + "/"
        print("服务已启动：" + url)
        print("请保留本窗口；按 Ctrl+C 或关闭窗口停止服务。\n")
        try:
            webbrowser.open(url)
        except webbrowser.Error:
            print("浏览器未自动打开，请复制上面的地址。")
        server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n已停止。")
    except EOFError:
        print("\n输入已结束，请在命令行或双击 start.bat 启动。")
        sys.exit(1)
    except (OSError, ValueError) as error:
        print("\n启动失败：" + str(error), file=sys.stderr)
        sys.exit(1)
