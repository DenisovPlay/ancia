#!/usr/bin/env python3
"""Fix routes.py syntax error."""

with open('backend/routes.py.bak', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Строки для замены (1-based: 1129-1137, 0-based: 1128-1136)
# Заменяем на новый код
new_lines = lines[:1128]  # До строки 1129

# Новый код
new_code = [
    '    # ** в начале или конце строки без закрытия\n',
    '    if re.search(r"^\\*\\*[^*]+$", last_line):  # **текст без закрытия\n',
    '      return True\n',
    '    if re.search(r"[^*]\\*\\*$", last_line):  # текст** без закрытия\n',
    '      return True\n',
    '    # ``` в конце без закрытия\n',
    '    if re.search(r"```$", last_line) and not re.search(r"```.*```", safe_reply):\n',
    '      return True\n',
    '    # [ без закрытия ]\n',
    '    if re.search(r"\\[[^\\]]*$", last_line):\n',
    '      return True\n',
    '    # Пустые элементы списка\n',
    '    if re.match(r"^\\s*[-*+]\\s*$", last_line):\n',
    '      return True\n',
    '    if re.match(r"^\\s*\\d+\\.\\s*$", last_line):\n',
    '      return True\n',
    '\n',
]

new_lines.extend(new_code)
new_lines.extend(lines[1140:])  # После строки 1140 (строка 1141+)

with open('backend/routes.py', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print('Fixed!')
