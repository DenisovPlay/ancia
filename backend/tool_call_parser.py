from __future__ import annotations

import ast
import json
import re
from typing import Any, Callable

try:
  from backend.tool_call_normalization import normalize_tool_call_payload
except ModuleNotFoundError:
  from tool_call_normalization import normalize_tool_call_payload  # type: ignore

CHAT_MOOD_DIRECTIVE_PATTERN = re.compile(r"\[\[\s*mood\s*:\s*([a-zA-Z_]+)\s*\]\]", re.IGNORECASE)
TOOL_CALL_BLOCK_PATTERN = re.compile(r"<tool_call>\s*([\s\S]*?)\s*</tool_call>", re.IGNORECASE)
TOOL_CALL_LINE_PREFIX_PATTERN = re.compile(
  r"^\s*(?:(?:>\s*)+|[-*+\u2022]\s+|[\u2013\u2014]\s+|\(\d{1,3}\)\s+|\d{1,3}[.)]\s+)"
)
TOOL_CALL_LABEL_PREFIX_PATTERN = re.compile(
  r"^\s*(?:\[(?:tool(?:_call)?|function|json|action|инструмент)\]|(?:tool(?:_call)?|function|json|action|инструмент))\s*[:=-]?\s*",
  re.IGNORECASE,
)
TOOL_CALLS_TAGGED_PATTERN = re.compile(
  r"^\s*\[TOOL_CALLS?\]\s*([A-Za-z0-9_.:-]+)\s*\[ARGS\]\s*(.+?)\s*$",
  re.IGNORECASE | re.DOTALL,
)
TOOL_CALL_INVISIBLE_PREFIX_PATTERN = re.compile(r"^[\s\u200b\u200c\u200d\ufeff]+")
ROLE_SECTION_LINE_PATTERN = re.compile(
  r"^\s*\[(assistant|tool|function|action|user|system)\]\s*$",
  re.IGNORECASE,
)
ROLE_SECTION_INLINE_PATTERN = re.compile(
  r"^\s*\[(assistant|tool|function|action|user|system)\]\s*(.+)$",
  re.IGNORECASE,
)
TOOL_ROLE_NAMES = {"tool", "function", "action"}
SMART_QUOTES_TRANSLATION = str.maketrans({
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": "\"",
  "\u201d": "\"",
  "\u201e": "\"",
  "\u00ab": "\"",
  "\u00bb": "\"",
})


def extract_reply_mood_directive(text: str, normalize_mood_fn: Callable[[str, str], str]) -> tuple[str, str]:
  raw = str(text or "")
  requested_mood = ""
  for match in CHAT_MOOD_DIRECTIVE_PATTERN.finditer(raw):
    requested_mood = normalize_mood_fn(match.group(1), requested_mood)
  cleaned = CHAT_MOOD_DIRECTIVE_PATTERN.sub("", raw).strip()
  cleaned = re.sub(r"</?tool_call>", "", cleaned, flags=re.IGNORECASE).strip()
  return requested_mood, cleaned


def strip_markdown_fence(value: str) -> str:
  raw = str(value or "").strip()
  if not raw.startswith("```"):
    return raw
  lines = raw.splitlines()
  if not lines:
    return raw
  if lines[-1].strip() == "```":
    lines = lines[1:-1]
  else:
    lines = lines[1:]
  return "\n".join(lines).strip()


def extract_tool_calls_from_json_payload(payload: Any) -> list[tuple[str, dict[str, Any]]]:
  calls: list[tuple[str, dict[str, Any]]] = []
  seen: set[tuple[str, str]] = set()
  queue: list[Any] = [payload]

  def _append(call_items: list[tuple[str, dict[str, Any]]]) -> None:
    for call_name, call_args in call_items:
      signature = (call_name, json.dumps(call_args, ensure_ascii=False, sort_keys=True))
      if signature in seen:
        continue
      seen.add(signature)
      calls.append((call_name, call_args))

  while queue:
    current = queue.pop(0)
    if isinstance(current, list):
      queue.extend(current)
      continue
    if not isinstance(current, dict):
      continue

    normalized = normalize_tool_call_payload(current)
    if normalized is not None:
      _append([normalized])

    function_payload = current.get("function")
    if isinstance(function_payload, dict):
      normalized_function = normalize_tool_call_payload(
        {
          "name": function_payload.get("name"),
          "arguments": function_payload.get("arguments"),
        }
      )
      if normalized_function is not None:
        _append([normalized_function])

    for key in ("tool_calls", "calls", "actions", "tools"):
      nested = current.get(key)
      if isinstance(nested, list):
        queue.extend(nested)

  return calls


def extract_tool_calls_from_json_text(raw_text: str) -> list[tuple[str, dict[str, Any]]]:
  payload_text = strip_markdown_fence(raw_text)
  if not payload_text:
    return []
  for candidate in build_json_parse_candidates(payload_text):
    parsed = parse_json_like(candidate)
    if parsed is None:
      continue
    calls = extract_tool_calls_from_json_payload(parsed)
    if calls:
      return calls
  return []


def build_json_parse_candidates(payload_text: str) -> list[str]:
  text = str(payload_text or "").strip()
  if not text:
    return []

  candidates: list[str] = [text]
  balanced_prefix = extract_balanced_json_prefix(text)
  if balanced_prefix and balanced_prefix not in candidates:
    candidates.insert(0, balanced_prefix)

  translated = text.translate(SMART_QUOTES_TRANSLATION).strip()
  if translated and translated not in candidates:
    candidates.append(translated)
    translated_prefix = extract_balanced_json_prefix(translated)
    if translated_prefix and translated_prefix not in candidates:
      candidates.insert(1, translated_prefix)

  return candidates


def parse_json_like(payload_text: str) -> Any | None:
  text = str(payload_text or "").strip()
  if not text:
    return None
  try:
    return json.loads(text)
  except json.JSONDecodeError:
    pass

  try:
    parsed_literal = ast.literal_eval(text)
  except (SyntaxError, ValueError):
    return None
  return parsed_literal if isinstance(parsed_literal, (dict, list)) else None


def extract_balanced_json_prefix(payload_text: str) -> str:
  text = str(payload_text or "").strip()
  if not text or text[0] not in "{[":
    return ""

  stack: list[str] = []
  in_string = False
  escaped = False
  quote_char = ""

  for index, char in enumerate(text):
    if in_string:
      if escaped:
        escaped = False
      elif char == "\\":
        escaped = True
      elif char == quote_char:
        in_string = False
        quote_char = ""
      continue

    if char in ("\"", "'"):
      in_string = True
      quote_char = char
      continue

    if char == "{":
      stack.append("}")
      continue
    if char == "[":
      stack.append("]")
      continue
    if char in ("}", "]"):
      if not stack or char != stack[-1]:
        return ""
      stack.pop()
      if not stack:
        return text[:index + 1]

  return ""


def normalize_tool_call_candidate(raw_text: str) -> str:
  candidate = strip_markdown_fence(raw_text).strip()
  if not candidate:
    return ""

  candidate = TOOL_CALL_INVISIBLE_PREFIX_PATTERN.sub("", candidate)
  if not candidate:
    return ""

  while len(candidate) >= 2 and candidate.startswith("`") and candidate.endswith("`"):
    candidate = candidate[1:-1].strip()
    if not candidate:
      return ""

  previous = None
  while candidate and candidate != previous:
    previous = candidate
    candidate = TOOL_CALL_LINE_PREFIX_PATTERN.sub("", candidate).strip()
  candidate = TOOL_CALL_LABEL_PREFIX_PATTERN.sub("", candidate).strip()

  while len(candidate) >= 2 and candidate.startswith("`") and candidate.endswith("`"):
    candidate = candidate[1:-1].strip()
    if not candidate:
      return ""

  tagged_match = TOOL_CALLS_TAGGED_PATTERN.match(candidate)
  if tagged_match:
    tagged_name = str(tagged_match.group(1) or "").strip()
    tagged_args = str(tagged_match.group(2) or "").strip()
    if not tagged_name or not tagged_args:
      return ""
    for args_candidate in build_json_parse_candidates(tagged_args):
      parsed_args = parse_json_like(args_candidate)
      if isinstance(parsed_args, dict):
        return json.dumps(
          {
            "name": tagged_name,
            "arguments": parsed_args,
          },
          ensure_ascii=False,
        )
    return ""

  return candidate


def extract_tool_calls_from_candidate_text(raw_text: str) -> list[tuple[str, dict[str, Any]]]:
  candidate = normalize_tool_call_candidate(raw_text)
  if not candidate:
    return []

  if candidate[0] not in "{[":
    first_object = candidate.find("{")
    first_array = candidate.find("[")
    first_indices = [idx for idx in (first_object, first_array) if idx >= 0]
    if not first_indices:
      return []
    candidate = candidate[min(first_indices):].strip()
    if not candidate:
      return []

  return extract_tool_calls_from_json_text(candidate)


def extract_tool_calls_from_mixed_text(raw_text: str) -> list[tuple[str, dict[str, Any]]]:
  direct_calls = extract_tool_calls_from_json_text(raw_text)
  if direct_calls:
    return direct_calls

  calls: list[tuple[str, dict[str, Any]]] = []
  seen: set[tuple[str, str]] = set()
  for line in str(raw_text or "").splitlines():
    for call_name, call_args in extract_tool_calls_from_candidate_text(line):
      signature = (call_name, json.dumps(call_args, ensure_ascii=False, sort_keys=True))
      if signature in seen:
        continue
      seen.add(signature)
      calls.append((call_name, call_args))
  return calls


def extract_tool_calls_from_reply(
  text: str,
  *,
  compact_repetitions_fn: Callable[[str], str],
) -> tuple[str, list[tuple[str, dict[str, Any]]]]:
  raw = str(text or "")
  calls: list[tuple[str, dict[str, Any]]] = []
  seen_calls: set[tuple[str, str]] = set()

  def _append_calls(found_calls: list[tuple[str, dict[str, Any]]]) -> None:
    for call_name, call_args in found_calls:
      signature = (call_name, json.dumps(call_args, ensure_ascii=False, sort_keys=True))
      if signature in seen_calls:
        continue
      seen_calls.add(signature)
      calls.append((call_name, call_args))

  def _replace(match: re.Match[str]) -> str:
    found_calls = extract_tool_calls_from_mixed_text(match.group(1))
    _append_calls(found_calls)
    return ""

  cleaned_text = TOOL_CALL_BLOCK_PATTERN.sub(_replace, raw)

  code_block_pattern = re.compile(r"```(?:json|tool_call)?\s*([\s\S]*?)```", flags=re.IGNORECASE)

  def _replace_code_block(match: re.Match[str]) -> str:
    block_inner = str(match.group(1) or "")
    found_calls = extract_tool_calls_from_mixed_text(block_inner)
    if found_calls:
      _append_calls(found_calls)
      return ""
    return match.group(0)

  cleaned_text = code_block_pattern.sub(_replace_code_block, cleaned_text)

  lines = cleaned_text.splitlines()
  kept_by_roles: list[str] = []
  index = 0
  while index < len(lines):
    line = lines[index]
    marker_line = ROLE_SECTION_LINE_PATTERN.match(line)
    marker_inline = ROLE_SECTION_INLINE_PATTERN.match(line)

    if marker_line:
      role = str(marker_line.group(1) or "").strip().lower()
      index += 1
      block_lines: list[str] = []
      while index < len(lines):
        if ROLE_SECTION_LINE_PATTERN.match(lines[index]) or ROLE_SECTION_INLINE_PATTERN.match(lines[index]):
          break
        block_lines.append(lines[index])
        index += 1
      block_text = "\n".join(block_lines).strip()
      if role in TOOL_ROLE_NAMES:
        _append_calls(extract_tool_calls_from_mixed_text(block_text))
        continue
      if role == "assistant" and block_text:
        kept_by_roles.append(block_text)
      continue

    if marker_inline:
      role = str(marker_inline.group(1) or "").strip().lower()
      inline_content = str(marker_inline.group(2) or "").strip()
      if role in TOOL_ROLE_NAMES:
        _append_calls(extract_tool_calls_from_mixed_text(inline_content))
      elif role == "assistant" and inline_content:
        kept_by_roles.append(inline_content)
      index += 1
      continue

    kept_by_roles.append(line)
    index += 1
  cleaned_text = "\n".join(kept_by_roles)

  kept_lines: list[str] = []
  for line in cleaned_text.splitlines():
    stripped_line = line.strip()
    if ROLE_SECTION_LINE_PATTERN.match(stripped_line):
      continue
    inline_marker = ROLE_SECTION_INLINE_PATTERN.match(stripped_line)
    if inline_marker:
      role = str(inline_marker.group(1) or "").strip().lower()
      inline_content = str(inline_marker.group(2) or "").strip()
      if role in TOOL_ROLE_NAMES:
        _append_calls(extract_tool_calls_from_mixed_text(inline_content))
        continue
      if role == "assistant":
        if inline_content:
          kept_lines.append(inline_content)
        continue
      continue
    found_calls = extract_tool_calls_from_candidate_text(stripped_line)
    if found_calls:
      _append_calls(found_calls)
      continue
    kept_lines.append(line)
  cleaned_text = "\n".join(kept_lines)

  trimmed_text = cleaned_text.strip()
  found_calls = extract_tool_calls_from_candidate_text(trimmed_text)
  if found_calls:
    _append_calls(found_calls)
    cleaned_text = ""

  cleaned_text = compact_repetitions_fn(cleaned_text).strip()
  return cleaned_text, calls


def sanitize_stream_preview(
  text: str,
  *,
  final: bool,
) -> str:
  cleaned = str(text or "")
  cleaned = CHAT_MOOD_DIRECTIVE_PATTERN.sub("", cleaned)
  cleaned = TOOL_CALL_BLOCK_PATTERN.sub("", cleaned)

  lowered = cleaned.lower()
  tool_block_start = lowered.find("<tool_call>")
  if tool_block_start >= 0:
    cleaned = cleaned[:tool_block_start]

  mood_block_start = lowered.find("[[mood:")
  if mood_block_start >= 0 and "]]" not in lowered[mood_block_start:]:
    cleaned = cleaned[:mood_block_start]

  lines = cleaned.splitlines(keepends=True)
  trailing = ""
  if lines and not cleaned.endswith(("\n", "\r")):
    trailing = lines.pop()

  filtered_lines: list[str] = []
  drop_tool_section = False
  for line in lines:
    stripped_line = line.strip()
    marker_line = ROLE_SECTION_LINE_PATTERN.match(stripped_line)
    marker_inline = ROLE_SECTION_INLINE_PATTERN.match(stripped_line)

    if drop_tool_section:
      if marker_line or marker_inline:
        drop_tool_section = False
      else:
        continue

    if marker_line:
      role = str(marker_line.group(1) or "").strip().lower()
      if role in TOOL_ROLE_NAMES:
        drop_tool_section = True
        continue
      if role in {"assistant", "user", "system"}:
        continue

    if marker_inline:
      role = str(marker_inline.group(1) or "").strip().lower()
      inline_content = str(marker_inline.group(2) or "").strip()
      if role in TOOL_ROLE_NAMES:
        continue
      if role == "assistant":
        if inline_content:
          filtered_lines.append(inline_content + ("\n" if line.endswith("\n") else ""))
        continue
      continue

    found_calls = extract_tool_calls_from_candidate_text(stripped_line)
    if found_calls:
      continue
    filtered_lines.append(line)

  if trailing:
    stripped_trailing = trailing.strip()
    trailing_calls = extract_tool_calls_from_candidate_text(stripped_trailing)
    if trailing_calls:
      trailing = ""
    elif not final:
      trailing_lower = stripped_trailing.lower()
      normalized_trailing = normalize_tool_call_candidate(stripped_trailing).lower()
      looks_like_control_prefix = (
        "<tool_call" in trailing_lower
        or trailing_lower.startswith("[tool")
        or trailing_lower.startswith("[function")
        or trailing_lower.startswith("[action")
        or trailing_lower.startswith("[assistant")
        or trailing_lower.startswith("{")
        or trailing_lower.startswith("[[mood:")
        or normalized_trailing.startswith("{")
        or normalized_trailing.startswith("[")
      )
      if looks_like_control_prefix:
        trailing = ""

  return "".join(filtered_lines) + trailing
