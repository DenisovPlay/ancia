from __future__ import annotations

from typing import Any

try:
  from backend.engine_support import build_chat_mood_prompt
  from backend.schemas import ChatRequest
  from backend.tool_prompt_builder import apply_enabled_tools_prompt
except ModuleNotFoundError:
  from engine_support import build_chat_mood_prompt  # type: ignore
  from schemas import ChatRequest  # type: ignore
  from tool_prompt_builder import apply_enabled_tools_prompt  # type: ignore


def build_system_prompt(
  base_prompt: str,
  request: ChatRequest,
  *,
  active_tools: set[str] | None = None,
  tool_definitions: dict[str, dict[str, Any]] | None = None,
) -> str:
  safe_active_tools = active_tools or set()
  prompt_with_tools = apply_enabled_tools_prompt(
    base_prompt,
    safe_active_tools,
    tool_definitions=tool_definitions or {},
  )
  blocks = [prompt_with_tools] if prompt_with_tools else []
  blocks.append(build_chat_mood_prompt())

  user = request.context.user
  if user.name.strip() or user.context.strip():
    blocks.append(
      "Профиль пользователя: "
      + ", ".join(
        part
        for part in [
          f"имя={user.name.strip()}" if user.name.strip() else "",
          f"контекст={user.context.strip()}" if user.context.strip() else "",
          f"язык={user.language.strip() or 'ru'}",
          f"часовой_пояс={user.timezone.strip() or 'UTC'}",
        ]
        if part
      )
    )

  if request.context.system_prompt.strip():
    blocks.append("Дополнительный системный промпт: " + request.context.system_prompt.strip())

  return "\n\n".join(block for block in blocks if block)
