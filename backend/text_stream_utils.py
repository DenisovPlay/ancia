from __future__ import annotations

import re
from typing import Generator


def normalize_for_dedupe(value: str) -> str:
  return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def is_repetition_runaway(text: str) -> bool:
  normalized = normalize_for_dedupe(text)
  if len(normalized) < 180:
    return False

  if re.search(r"(.{24,120}?)(?:\s+\1){2,}", normalized):
    return True

  tokens = [token for token in normalized.split(" ") if token]
  for width in (8, 12, 16):
    if len(tokens) < width * 3:
      continue
    if tokens[-width:] == tokens[-2 * width: -width] == tokens[-3 * width: -2 * width]:
      return True

  sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", normalized) if part.strip()]
  if len(sentences) >= 3:
    last = sentences[-1]
    if len(last) >= 24 and last == sentences[-2] == sentences[-3]:
      return True

  return False


def compact_repetitions(text: str) -> str:
  raw = str(text or "").strip()
  if not raw:
    return ""

  # Инлайн-повторы: «X — это X — это X» → «X»
  raw = re.sub(r"(.{3,80})\s*(?:[—–-]\s+(?:\w+\s+)*\1){2,}", r"\1", raw, flags=re.IGNORECASE)
  # Прямые повторы: «phrase phrase phrase» → «phrase»
  raw = re.sub(r"(.{4,120})(?:\s+\1){2,}", r"\1", raw, flags=re.IGNORECASE)

  paragraphs = [part.strip() for part in re.split(r"\n{2,}", raw) if part.strip()]
  if not paragraphs:
    return raw

  unique_paragraphs: list[str] = []
  seen: set[str] = set()
  for paragraph in paragraphs:
    key = normalize_for_dedupe(paragraph)
    if not key:
      continue
    if key in seen:
      continue
    seen.add(key)

    sentences = re.split(r"(?<=[.!?])\s+", paragraph)
    filtered_sentences: list[str] = []
    prev_key = ""
    for sentence in sentences:
      sentence_text = sentence.strip()
      if not sentence_text:
        continue
      sentence_key = normalize_for_dedupe(sentence_text)
      if sentence_key and sentence_key == prev_key:
        continue
      filtered_sentences.append(sentence_text)
      prev_key = sentence_key

    compact_paragraph = " ".join(filtered_sentences).strip() or paragraph
    unique_paragraphs.append(compact_paragraph)

  return "\n\n".join(unique_paragraphs).strip() or raw


def chunk_text_for_streaming(text: str, max_chunk_size: int = 42) -> Generator[str, None, None]:
  tokens = re.findall(r"\S+\s*|\s+", text)
  if not tokens:
    return
  buffer = ""
  for token in tokens:
    candidate = buffer + token
    if buffer and len(candidate) > max_chunk_size:
      yield buffer
      buffer = token
    else:
      buffer = candidate
  if buffer:
    yield buffer


def resolve_stream_delta(payload_text: str, emitted_text: str) -> str:
  current = str(payload_text or "")
  if not current:
    return ""
  emitted = str(emitted_text or "")
  if not emitted:
    return current

  # Cumulative mode: payload содержит весь текст ответа на текущем шаге.
  if current.startswith(emitted):
    return current[len(emitted):]

  # Уже полученный дубликат/ретрай без новых токенов.
  # Важно: проверяем только хвост. Поиск "вхождения где угодно" ломает
  # поток (выкидывает валидные короткие токены вроде " и " или "на ").
  if emitted.endswith(current):
    return ""

  # Partial overlap mode: payload возвращает кусок с пересечением хвоста.
  max_overlap = min(len(current), len(emitted))
  for overlap in range(max_overlap, 0, -1):
    if emitted.endswith(current[:overlap]):
      return current[overlap:]

  return current
