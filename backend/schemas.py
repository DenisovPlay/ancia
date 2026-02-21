from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field


class UserContext(BaseModel):
  name: str = ""
  context: str = ""
  language: str = "ru"
  timezone: str = "UTC"


class UiContext(BaseModel):
  density: str = "comfortable"
  animations: bool = True
  modelId: str = ""
  contextWindow: int | None = None
  maxTokens: int | None = None
  temperature: float | None = None
  topP: float | None = None
  topK: int | None = None


class HistoryMessage(BaseModel):
  role: str = "user"
  text: str = ""
  timestamp: str | None = None


class ChatContext(BaseModel):
  mood: str = "neutral"
  user: UserContext = Field(default_factory=UserContext)
  ui: UiContext = Field(default_factory=UiContext)
  history: list[HistoryMessage] = Field(default_factory=list)
  chat_id: str = "default"
  chat_title: str = ""
  system_prompt: str = ""


class AttachmentRef(BaseModel):
  id: str = ""
  name: str = ""
  kind: str = "file"
  mimeType: str = ""
  size: int = 0
  textContent: str = ""
  dataUrl: str = ""


class ChatRequest(BaseModel):
  message: str = ""
  attachments: list[AttachmentRef] = Field(default_factory=list)
  context: ChatContext = Field(default_factory=ChatContext)


class ToolEvent(BaseModel):
  name: str
  status: str
  output: dict[str, Any] = Field(default_factory=dict)


class ChatResponse(BaseModel):
  chat_id: str
  reply: str
  mood: str
  model: str
  tool_events: list[ToolEvent] = Field(default_factory=list)
  usage: dict[str, int] = Field(default_factory=dict)


class ModelSelectRequest(BaseModel):
  model_id: str = ""
  load: bool = False


class ModelParamsUpdateRequest(BaseModel):
  context_window: int | None = None
  max_tokens: int | None = None
  temperature: float | None = None
  top_p: float | None = None
  top_k: int | None = None


class ChatCreateRequest(BaseModel):
  id: str = ""
  title: str = ""
  mood: str = ""


class ChatUpdateRequest(BaseModel):
  title: str | None = None
  mood: str | None = None


class ChatDuplicateRequest(BaseModel):
  id: str = ""
  title: str | None = None


class MessageUpdateRequest(BaseModel):
  text: str = Field(min_length=1)


@dataclass
class ModelTier:
  key: str
  label: str
  max_context: int
  temperature: float


MODEL_TIERS: dict[str, ModelTier] = {
  "compact": ModelTier(
    key="compact",
    label="Компактный",
    max_context=3072,
    temperature=0.25,
  ),
  "balanced": ModelTier(
    key="balanced",
    label="Сбалансированный",
    max_context=4096,
    temperature=0.2,
  ),
  "performance": ModelTier(
    key="performance",
    label="Производительный",
    max_context=8192,
    temperature=0.15,
  ),
}


MODEL_TIER_ALIASES: dict[str, str] = {
  "compact": "compact",
  "balanced": "balanced",
  "performance": "performance",
  "standard": "balanced",
  "max": "performance",
}


@dataclass
class RuntimeChatContext:
  chat_id: str
  mood: str
  user_name: str
  timezone: str
