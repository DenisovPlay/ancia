#!/usr/bin/env python3
"""Тест для проверки функции _is_reply_truncated."""

import re

def _is_reply_truncated(reply: str) -> bool:
    """Проверяет структурный обрыв ответа: незакрытые теги, блоки кода, элементы списка."""
    safe_reply = str(reply or "").strip()
    if not safe_reply:
        return False

    last_line = safe_reply.split("\n")[-1].strip()

    # Незакрытый блок кода: нечётное число fence-маркеров (``` в начале строки)
    if len(re.findall(r"(?m)^```", safe_reply)) % 2 != 0:
        return True

    # Незакрытый жирный: нечётное число ** во всём ответе
    if len(re.findall(r"\*\*", safe_reply)) % 2 != 0:
        return True

    # [ без закрытия ] в последней строке
    if re.search(r"\[[^\]]*$", last_line):
        return True

    # Пустые элементы списка
    if re.match(r"^\s*[-*+]\s*$", last_line):
        return True
    if re.match(r"^\s*\d+\.\s*$", last_line):
        return True

    # Незавершённые HTML-теги — проверяем весь ответ
    open_tags = re.findall(r"<([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?>(?!</\1>)", safe_reply)
    closed_tags = re.findall(r"</([a-zA-Z][a-zA-Z0-9]*)>", safe_reply)
    self_closing = {"br", "hr", "img", "input", "meta", "link"}
    open_tags = [t for t in open_tags if t.lower() not in self_closing]
    for tag in set(open_tags):
        if open_tags.count(tag) > closed_tags.count(tag):
            last_open = safe_reply.rfind(f"<{tag}")
            last_close = safe_reply.rfind(f"</{tag}>")
            if last_open > last_close:
                return True

    return False


# Тесты
test_cases = [
    # (ответ, ожидается_обрыв)
    ("**Особенности</li></ul>", True),   # Нечётное число ** → незакрытый жирный
    ("Это полный ответ.", False),          # Полный ответ
    ("Список:\n- пункт 1\n- пункт 2", False),  # Полный список
    ("Список:\n- пункт 1\n-", True),      # Пустой элемент списка
    # Строка без пунктуации — структурно НЕ обрыв; обрыв фиксируется счётчиком токенов
    ("Текст обрывается на середине", False),
    ("Текст с точкой.", False),            # Завершённый
    ("<ul><li>пункт</li></ul>", False),    # Закрытые теги
    ("<ul><li>пункт", True),               # Незакрытые теги
    ("**жирный текст**", False),           # Закрытый жирный (чётное число **)
    ("**жирный текст", True),              # Незакрытый жирный (нечётное число **)
    ("[ссылка](url)", False),              # Закрытая ссылка
    ("[ссылка", True),                     # Незакрытая ссылка
    ("```python\ncode\n```", False),       # Закрытый блок кода (чётное число fence)
    ("```python\ncode", True),             # Незакрытый блок кода (нечётное число fence)
    ("Вот ответ: 1. пункт 1\n2.", True),  # Пустой нумерованный элемент
    ("Вот ответ: 1. пункт 1\n2. пункт 2", False),  # Полный список
    ("Вот полный ответ с **жирным** текстом.", False),  # Жирный внутри (чётное **)
    ("Ответ со [ссылкой](url) внутри.", False),         # Ссылка внутри (закрытая)
    # inline ``` не считается code fence (нет в начале строки)
    ("Используй `command` или `other`", False),  # inline code — не code fence
    ("Текст с in `code` block", False),           # inline backtick — не fence
]

print("Тестирование _is_reply_truncated:\n")
passed = 0
failed = 0

for reply, expected in test_cases:
    result = _is_reply_truncated(reply)
    status = "✓" if result == expected else "✗"
    if result == expected:
        passed += 1
    else:
        failed += 1
    print(f"{status} '{reply[:50]}' -> {result} (ожидалось {expected})")

print(f"\nИтого: {passed} прошло, {failed} провалено")
