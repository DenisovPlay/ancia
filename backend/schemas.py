from __future__ import annotations

from dataclasses import dataclass, field
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
  plugin_permission_grants: list[str] = Field(default_factory=list)
  tool_permission_grants: list[str] = Field(default_factory=list)
  domain_permission_grants: list[str] = Field(default_factory=list)
  request_id: str = ""
  history_override_enabled: bool = False
  context_guard_event: dict[str, Any] = Field(default_factory=dict)
  chat_id: str = "default"
  chat_title: str = ""
  system_prompt: str = ""


class AttachmentRef(BaseModel):
  id: str = Field(default="", max_length=128)
  name: str = Field(default="", max_length=256)
  kind: str = Field(default="file", max_length=32)
  mimeType: str = Field(default="", max_length=160)
  size: int = Field(default=0, ge=0, le=52_428_800)
  textContent: str = Field(default="", max_length=120_000)
  dataUrl: str = Field(default="", max_length=2_000_000)


class ChatRequest(BaseModel):
  message: str = Field(default="", max_length=100_000)
  attachments: list[AttachmentRef] = Field(default_factory=list, max_length=8)
  context: ChatContext = Field(default_factory=ChatContext)
  # Поля для режима продолжения генерации
  continue_from_message_id: str | None = None  # ID assistant-сообщения для продолжения
  continue_mode: bool = False  # Флаг режима продолжения (аппенд к существующему сообщению)
  skip_user_persist: bool = False  # Не сохранять user-сообщение в storage (используется для continue)


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
  generation_actions: dict[str, Any] = Field(default_factory=dict)


class ModelSelectRequest(BaseModel):
  model_id: str = ""
  load: bool = False


class ModelParamsUpdateRequest(BaseModel):
  context_window: int | None = None
  max_tokens: int | None = None
  temperature: float | None = None
  top_p: float | None = None
  top_k: int | None = None


class ContextUsageRequest(BaseModel):
  model_id: str = ""
  draft_text: str = ""
  pending_assistant_text: str = ""
  history: list[HistoryMessage] = Field(default_factory=list)
  attachments: list[AttachmentRef] = Field(default_factory=list)
  history_variants: list[list[HistoryMessage]] = Field(default_factory=list)


class HistorySummarizeMessage(BaseModel):
  role: str = "user"
  text: str = Field(default="", max_length=4000)


class HistorySummarizeRequest(BaseModel):
  messages: list[HistorySummarizeMessage] = Field(default_factory=list, max_length=60)
  max_chars: int = Field(default=800, ge=100, le=2000)


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
  deployment_mode: str = ""
  plugin_permission_grants: set[str] = field(default_factory=set)
  tool_permission_grants: set[str] = field(default_factory=set)
  domain_permission_grants: set[str] = field(default_factory=set)
  tool_permission_policies: dict[str, str] = field(default_factory=dict)
  domain_permission_policies: dict[str, str] = field(default_factory=dict)
  domain_default_policy: str = "deny"
