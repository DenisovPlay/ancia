#!/usr/bin/env python3
from __future__ import annotations

import asyncio
from typing import Any

import httpx


class AppClient:
  def __init__(self, app: Any, *, base_url: str = "http://testserver") -> None:
    self._app = app
    self._base_url = str(base_url or "http://testserver")
    self._test_client = None
    self._fallback_started = False
    self._closed = False

    try:
      from fastapi.testclient import TestClient

      self._test_client = TestClient(app)
    except Exception:
      self._test_client = None

  def __enter__(self) -> "AppClient":
    return self

  def __exit__(self, exc_type, exc, tb) -> None:
    self.close()

  def request(self, method: str, url: str, **kwargs: Any):
    if self._closed:
      raise RuntimeError("Client is already closed.")
    if self._test_client is not None:
      return self._test_client.request(method, url, **kwargs)
    return self._fallback_request(method, url, **kwargs)

  def _fallback_request(self, method: str, url: str, **kwargs: Any):
    async def _runner():
      if not self._fallback_started:
        await self._app.router.startup()
        self._fallback_started = True
      transport = httpx.ASGITransport(app=self._app)
      async with httpx.AsyncClient(
        transport=transport,
        base_url=self._base_url,
        follow_redirects=True,
      ) as client:
        return await client.request(method, url, **kwargs)

    return asyncio.run(_runner())

  def get(self, url: str, **kwargs: Any):
    return self.request("GET", url, **kwargs)

  def post(self, url: str, **kwargs: Any):
    return self.request("POST", url, **kwargs)

  def options(self, url: str, **kwargs: Any):
    return self.request("OPTIONS", url, **kwargs)

  def patch(self, url: str, **kwargs: Any):
    return self.request("PATCH", url, **kwargs)

  def delete(self, url: str, **kwargs: Any):
    return self.request("DELETE", url, **kwargs)

  def close(self) -> None:
    if self._closed:
      return
    if self._test_client is not None:
      close_fn = getattr(self._test_client, "close", None)
      if callable(close_fn):
        close_fn()
      self._closed = True
      return

    if self._fallback_started:
      asyncio.run(self._app.router.shutdown())
      self._fallback_started = False
    self._closed = True


def create_app_client(app: Any, *, base_url: str = "http://testserver") -> AppClient:
  return AppClient(app, base_url=base_url)
