#!/usr/bin/env python3
"""
План улучшения кнопки "Продолжить".

Текущая проблема:
- Кнопка создаёт новое user-сообщение с текстом "Продолжи предыдущий ответ..."
- Это засоряет историю и дублирует контекст

Решение:
1. Фронтенд отправляет continue_from_message_id вместо нового сообщения
2. Бэкенд аппендит ответ к существующему assistant-сообщению
3. История остаётся чистой
"""

# Этап 1: Добавить поле в схему ChatRequest
# backend/schemas.py

CHAT_REQUEST_ADDITION = '''
class ChatRequest(BaseModel):
    # ... существующие поля ...
    continue_from_message_id: str | None = None  # ID assistant-сообщения для продолжения
    continue_mode: bool = False  # Флаг режима продолжения
'''

# Этап 2: Изменить обработку на бэкенде
# backend/routes.py

BACKEND_CONTINUE_LOGIC = '''
@router.post("/chat/stream")
async def chat_stream(payload: ChatRequest, request: Request, ...):
    continue_from = getattr(payload, "continue_from_message_id", None)
    continue_mode = getattr(payload, "continue_mode", False)
    
    if continue_mode and continue_from:
        # Находим существующее сообщение
        existing = storage.get_message(continue_from, owner_user_id=owner_user_id)
        if not existing or existing["role"] != "assistant":
            raise HTTPException(400, "Invalid continue_from_message_id")
        
        # Запоминаем существующий текст
        existing_text = existing["text"]
        
        # Генерируем продолжение (модель видит историю + существующий ответ)
        result = await generate_with_continue(...)
        
        # Аппендим к существующему
        new_text = existing_text + result.reply
        storage.update_message(continue_from, text=new_text, ...)
'''

# Этап 3: Изменить фронтенд
# src/chats/composerGeneration.js

FRONTEND_CONTINUE_LOGIC = '''
async function handleContinueAction(chatId, assistantMessageId, sourceUserText) {
  const backendPayload = {
    chat_id: chatId,
    message: sourceUserText,
    continue_from_message_id: assistantMessageId,
    continue_mode: true,
  };

  // Не создаём новое user-сообщение!
  // Продолжаем стримить в существующее assistant-сообщение
  await streamChatResponse({
    payload: backendPayload,
    assistantMessageId,
    isContinuation: true,
  });
}
'''

print("План готов. См. scripts/CONTINUE_BUTTON_IMPROVEMENTS.md")
