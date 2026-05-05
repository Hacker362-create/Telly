# bot/tests/test_signaling_client.py
# Unit tests for the Telly Bot SignalingClient.
# Uses mocked aiohttp sessions so no real HTTP calls are made.

import asyncio
import base64
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call

from bot.signaling_client import SignalingClient, _parse_sio_events


# ── _parse_sio_events helper ───────────────────────────────────────────────────

class TestParseSioEvents:
    def test_parses_single_message_event(self):
        payload = json.dumps(["call:incoming", {"callId": "c1", "callerId": "u1"}])
        raw = f"42{payload}"
        events = _parse_sio_events(raw)
        assert len(events) == 1
        assert events[0]["event"] == "call:incoming"
        assert events[0]["data"]["callId"] == "c1"

    def test_ignores_non_message_packets(self):
        events = _parse_sio_events("2")   # heartbeat
        assert events == []

    def test_handles_multiple_packets_separated_by_record_separator(self):
        p1 = f'42{json.dumps(["call:incoming", {"callId": "c1", "callerId": "u1"}])}'
        p2 = f'42{json.dumps(["call:ended", {"callId": "c1"}])}'
        raw = f"{p1}\x1e{p2}"
        events = _parse_sio_events(raw)
        assert len(events) == 2

    def test_skips_malformed_json(self):
        raw = "42{not valid json}"
        events = _parse_sio_events(raw)
        assert events == []


# ── SignalingClient ────────────────────────────────────────────────────────────

class FakeBrain:
    """Minimal async brain stub."""
    def __init__(self):
        self.joined: list[tuple[str, str]] = []
        self.ended: list[str] = []
        self.audio_calls: list[tuple[str, bytes]] = []
        self.audio_response = b"tts_audio"

    async def on_call_joined(self, call_id: str, user_id: str) -> None:
        self.joined.append((call_id, user_id))

    async def on_call_ended(self, call_id: str) -> None:
        self.ended.append(call_id)

    async def on_audio_received(self, call_id: str, audio: bytes) -> bytes | None:
        self.audio_calls.append((call_id, audio))
        return self.audio_response


def make_client() -> tuple[SignalingClient, FakeBrain]:
    brain = FakeBrain()
    client = SignalingClient(brain)  # type: ignore[arg-type]
    return client, brain


@pytest.fixture
def client_and_brain():
    return make_client()


# ── _handle_event ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_handle_incoming_call_accepts_and_notifies_brain(client_and_brain):
    client, brain = client_and_brain
    client._emit = AsyncMock()

    await client._handle_event({"event": "call:incoming", "data": {"callId": "c1", "callerId": "u2"}})

    assert client._active_call_id == "c1"
    assert ("c1", "u2") in brain.joined
    client._emit.assert_awaited_once_with("call:accept", {"callId": "c1", "answer": {}})


@pytest.mark.asyncio
async def test_handle_call_ended_clears_active_call(client_and_brain):
    client, brain = client_and_brain
    client._active_call_id = "c1"
    brain._active_calls = {"c1": MagicMock()}

    await client._handle_event({"event": "call:ended", "data": {"callId": "c1"}})

    assert client._active_call_id is None
    assert "c1" in brain.ended


@pytest.mark.asyncio
async def test_handle_audio_frame_sends_bot_response(client_and_brain):
    client, brain = client_and_brain
    client._active_call_id = "c1"
    client._emit = AsyncMock()

    raw_audio = b"raw_pcm_bytes"
    encoded = base64.b64encode(raw_audio).decode()

    await client._handle_event({"event": "call:audio", "data": {"callId": "c1", "audio": encoded}})

    assert ("c1", raw_audio) in brain.audio_calls
    emitted_args = client._emit.call_args
    assert emitted_args[0][0] == "call:audio:bot"
    assert emitted_args[0][1]["callId"] == "c1"
    # The response audio should be re-encoded in base64
    assert base64.b64decode(emitted_args[0][1]["audio"]) == brain.audio_response


@pytest.mark.asyncio
async def test_audio_frame_ignored_for_wrong_call(client_and_brain):
    client, brain = client_and_brain
    client._active_call_id = "other-call"
    client._emit = AsyncMock()

    encoded = base64.b64encode(b"audio").decode()
    await client._handle_event({"event": "call:audio", "data": {"callId": "c1", "audio": encoded}})

    assert brain.audio_calls == []
    client._emit.assert_not_awaited()


@pytest.mark.asyncio
async def test_audio_frame_ignored_when_no_active_call(client_and_brain):
    client, brain = client_and_brain
    client._active_call_id = None
    client._emit = AsyncMock()

    encoded = base64.b64encode(b"audio").decode()
    await client._handle_event({"event": "call:audio", "data": {"callId": "c1", "audio": encoded}})

    assert brain.audio_calls == []
    client._emit.assert_not_awaited()


@pytest.mark.asyncio
async def test_brain_returns_none_no_emit(client_and_brain):
    """If TellyBrain returns None (silence / no speech), no audio is emitted."""
    client, brain = client_and_brain
    brain.audio_response = None  # type: ignore[assignment]
    client._active_call_id = "c1"
    client._emit = AsyncMock()

    encoded = base64.b64encode(b"audio").decode()
    await client._handle_event({"event": "call:audio", "data": {"callId": "c1", "audio": encoded}})

    client._emit.assert_not_awaited()


@pytest.mark.asyncio
async def test_stop_closes_session(client_and_brain):
    client, _ = client_and_brain
    mock_session = AsyncMock()
    client._session = mock_session
    client._running = True

    await client.stop()

    assert client._running is False
    mock_session.close.assert_awaited_once()
    assert client._session is None
