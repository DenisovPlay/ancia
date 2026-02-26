#!/usr/bin/env python3
"""Тест для проверки функции _is_reply_truncated."""

import re

def _is_reply_truncated(reply: str) -> bool:
    """Проверяет, обрывается ли ответ на середине (незавершённые теги, слова, списки)."""
    safe_reply = str(reply or "").strip()
    if not safe_reply:
        return False

    last_line = safe_reply.split("\n")[-1].strip()

    # Обрыв на середине Markdown-элемента (проверяем только последнюю строку)
    # ** в начале или конце строки без закрытия
    if re.search(r"^\*\*[^*]+$", last_line):  # **текст без закрытия
        return True
    if re.search(r"[^*]\*\*$", last_line):  # текст** без закрытия
        return True
    # ``` в конце без закрытия
    if re.search(r"```$", last_line) and not re.search(r"```.*```", safe_reply):
        return True
    # [ без закрытия ]
    if re.search(r"\[[^\]]*$", last_line):
        return True
    # Пустые элементы списка
    if re.match(r"^\s*[-*+]\s*$", last_line):
        return True
    if re.match(r"^\s*\d+\.\s*$", last_line):
        return True

    # Проверяем последнюю строку на незавершённость
    if last_line and len(last_line) > 3:
        # Если последняя строка не заканчивается на знак препинания или закрывающий элемент
        if not re.search(r"[.!?;:)}\]>]\s*$", last_line):
            # И не является полным элементом списка
            if not re.match(r"^[-*+]\s+.+[.!?]\s*$", last_line):
                if not re.match(r"^\d+\.\s+.+[.!?]\s*$", last_line):
                    # Проверяем, не обрывается ли на середине слова
                    last_word_match = re.search(r"(\w+)[^\w]*$", last_line)
                    if last_word_match:
                        last_word = last_word_match.group(1)
                        # Если последнее "слово" >4 символов и не похоже на завершённое
                        if len(last_word) > 4 and last_word.lower() not in {"the", "and", "для", "что", "как", "это", "так", "текст", "text"}:
                            return True

    # Незавершённые HTML-теги — проверяем весь ответ
    # Ищем открытые теги, которые не закрыты
    open_tags = re.findall(r"<([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?>(?!</\1>)", safe_reply)
    closed_tags = re.findall(r"</([a-zA-Z][a-zA-Z0-9]*)>", safe_reply)
    # Self-closing теги не учитываем
    self_closing = {"br", "hr", "img", "input", "meta", "link"}
    open_tags = [t for t in open_tags if t.lower() not in self_closing]
    # Проверяем баланс
    for tag in set(open_tags):
        if open_tags.count(tag) > closed_tags.count(tag):
            # Есть незакрытый тег — проверяем, не в конце ли он
            last_open = safe_reply.rfind(f"<{tag}")
            last_close = safe_reply.rfind(f"</{tag}>")
            if last_open > last_close:
                # Тег открыт, но не закрыт в конце
                return True

    return False


# Тесты
test_cases = [
    # (ответ, ожидается_обрыв)
    ("**Особености</li></ul>", True),  # Обрыв на ** и </li>
    ("Это полный ответ.", False),  # Полный ответ
    ("Список:\n- пункт 1\n- пункт 2", False),  # Полный список
    ("Список:\n- пункт 1\n-", True),  # Обрыв списка
    ("Текст обрывается на середине", True),  # Обрыв на слове
    ("Текст с точкой.", False),  # Завершённый
    ("<ul><li>пункт</li></ul>", False),  # Закрытые теги
    ("<ul><li>пункт", True),  # Незакрытые теги
    ("**жирный текст**", False),  # Закрытый жирный
    ("**жирный текст", True),  # Незакрытый жирный
    ("[ссылка](url)", False),  # Закрытая ссылка
    ("[ссылка", True),  # Незакрытая ссылка
    ("```python\ncode\n```", False),  # Закрытый код
    ("```python\ncode", True),  # Незакрытый код
    ("Вот ответ: 1. пункт 1\n2.", True),  # Обрыв нумерованного списка
    ("Вот ответ: 1. пункт 1\n2. пункт 2", False),  # Полный список
    ("Вот полный ответ с **жирным** текстом.", False),  # Жирный внутри
    ("Ответ со [ссылкой](url) внутри.", False),  # Ссылка внутри
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
    print(f"{status} '{reply[:50]}...' -> {result} (ожидалось {expected})")

print(f"\nИтого: {passed} прошло, {failed} провалено")
