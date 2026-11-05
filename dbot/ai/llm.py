"""呼叫語言模型（含工具迴圈用的單次呼叫）。"""

from dbot.core import models
from dbot.core import runtime
import aiohttp
from dbot.core.config import (LLM_API_KEY, LLM_BASE_URL, LLM_KEEP_ALIVE, LLM_TIMEOUT, MAX_TOKENS, PC_REASONING_EFFORT, REASONING_EFFORT, REMOTE_REASONING_EFFORT, THINK_RE)
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


NO_REASONING_PARAM: set[str] = set()      # 不接受 reasoning_effort 的模型（被拒絕過就記下來）


async def call_model(messages: list[dict], use_tools: bool | list = False, max_tokens: int | None = None) -> dict:
    model = models.current()
    local = models.is_local(model)
    body = {"model": model, "max_tokens": max_tokens or MAX_TOKENS,
            "messages": messages if local else flatten_for_remote(messages)}
    # 思考模式：qwen 和 deepseek 都靠 reasoning_effort 控制。DeepSeek 不帶參數預設會思考，
    # 思考的 token 也計費（實測約多 3~4 倍），所以線上模型也要送，預設 none。
    effort = REASONING_EFFORT if local else REMOTE_REASONING_EFFORT
    # 配電腦要比對規格、算相容與預算，需要想一下：工具清單裡有 pc_build（= 這輪是配電腦對話）就開思考
    if isinstance(use_tools, list) and any((t.get("function") or {}).get("name") == "pc_build" for t in use_tools) and PC_REASONING_EFFORT:
        effort = PC_REASONING_EFFORT
        if effort != "none":
            body["max_tokens"] = max(body["max_tokens"], 4000)       # 思考也佔 token，配單說明又長，不然會被截斷
    if effort and model not in NO_REASONING_PARAM:
        body["reasoning_effort"] = effort
    if local and LLM_KEEP_ALIVE:
        body["keep_alive"] = LLM_KEEP_ALIVE  # 叫 Ollama 別太快把模型卸載（重新載入要一兩分鐘）
    if use_tools:
        body["tools"] = use_tools if isinstance(use_tools, list) else TOOLS
    headers = {"Authorization": f"Bearer {LLM_API_KEY}"} if LLM_API_KEY else {}
    for attempt in range(2):
        async with runtime.client.http_session.post(
            f"{LLM_BASE_URL}/chat/completions",
            json=body,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=LLM_TIMEOUT),
        ) as resp:
            data = await resp.json(content_type=None)
            if resp.status == 200:
                break
            # 有些模型（例如永遠在思考的 GLM）不接受「關閉思考」的參數：記下來，這個模型之後不再送，並馬上重試一次
            if attempt == 0 and resp.status == 400 and "reasoning_effort" in body and "reasoning" in str(data).lower():
                NO_REASONING_PARAM.add(model)
                body.pop("reasoning_effort", None)
                continue
            raise RuntimeError(f"模型回 HTTP {resp.status}：{str(data)[:300]}")
    models.record(model, data.get("usage"))
    return data["choices"][0]["message"]


def clean_text(text: str | None) -> str:
    return THINK_RE.sub("", text or "").strip()
