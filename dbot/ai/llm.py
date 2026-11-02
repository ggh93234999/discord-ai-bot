"""呼叫語言模型（含工具迴圈用的單次呼叫）。"""

from dbot.core import models
from dbot.core import runtime
import aiohttp
from dbot.core.config import (LLM_API_KEY, LLM_BASE_URL, LLM_KEEP_ALIVE, LLM_TIMEOUT, MAX_TOKENS, REASONING_EFFORT, REMOTE_REASONING_EFFORT, THINK_RE)
from dbot.ai.tools import (TOOLS)

def flatten_for_remote(messages: list[dict]) -> list[dict]:
    """線上模型不一定吃「內容是文字陣列」的格式：沒有圖的就壓成純文字，有圖的保留（deepseek 看得懂圖）。"""
    out = []
    for m in messages:
        c = m.get("content")
        if isinstance(c, list) and all(p.get("type") == "text" for p in c):
            m = {**m, "content": "\n".join(p.get("text", "") for p in c if p.get("text"))}
        out.append(m)
    return out


async def call_model(messages: list[dict], use_tools: bool | list = False, max_tokens: int | None = None) -> dict:
    model = models.current()
    local = models.is_local(model)
    body = {"model": model, "max_tokens": max_tokens or MAX_TOKENS,
            "messages": messages if local else flatten_for_remote(messages)}
    # 思考模式：qwen 和 deepseek 都靠 reasoning_effort 控制。DeepSeek 不帶參數預設會思考，
    # 思考的 token 也計費（實測約多 3~4 倍），所以線上模型也要送，預設 none。
    effort = REASONING_EFFORT if local else REMOTE_REASONING_EFFORT
    if effort:
        body["reasoning_effort"] = effort
    if local and LLM_KEEP_ALIVE:
        body["keep_alive"] = LLM_KEEP_ALIVE  # 叫 Ollama 別太快把模型卸載（重新載入要一兩分鐘）
    if use_tools:
        body["tools"] = use_tools if isinstance(use_tools, list) else TOOLS
    headers = {"Authorization": f"Bearer {LLM_API_KEY}"} if LLM_API_KEY else {}
    async with runtime.client.http_session.post(
        f"{LLM_BASE_URL}/chat/completions",
        json=body,
        headers=headers,
        timeout=aiohttp.ClientTimeout(total=LLM_TIMEOUT),
    ) as resp:
        data = await resp.json(content_type=None)
        if resp.status != 200:
            raise RuntimeError(f"模型回 HTTP {resp.status}：{str(data)[:300]}")
    models.record(model, data.get("usage"))
    return data["choices"][0]["message"]


def clean_text(text: str | None) -> str:
    return THINK_RE.sub("", text or "").strip()
