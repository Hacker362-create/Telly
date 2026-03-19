# bot/signaling_client.py
# WebSocket signaling client that connects the Telly Brain bot to the
# signaling server as a virtual call participant.
#
# The bot authenticates with a server-issued service token, listens for
# call:incoming events directed at its userId, joins those calls, and hands
# off audio frames to TellyBrain for transcription → LLM → TTS.

import base64
import asyncio
import json
import logging
import os
from typing import Optional

import aiohttp

logger = logging.getLogger(__name__)

SIGNALING_URL = os.getenv("SIGNALING_URL", "http://localhost:3000")
BOT_USER_ID = os.getenv("BOT_USER_ID", "telly-bot-1")
BOT_TOKEN = os.getenv("BOT_TOKEN", "")  # Service JWT issued for the bot


class SignalingClient:
    """
    Connects to the Telly Socket.io signaling server using long-polling
    over HTTP (aiohttp). The bot participates in calls by:
      1. Connecting with its service token.
      2. Receiving call:incoming events and auto-accepting them.
      3. Forwarding audio bytes to TellyBrain and sending back TTS responses.
    """

    # Socket.io handshake and polling endpoints
    _EIO_ENDPOINT = "/socket.io/?EIO=4&transport=polling"

    def __init__(self, brain: "TellyBrain") -> None:  # type: ignore[name-defined]
        self._brain = brain
        self._session: Optional[aiohttp.ClientSession] = None
        self._sid: Optional[str] = None
        self._running = False
        self._active_call_id: Optional[str] = None

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Open an aiohttp session and connect to the signaling server."""
        self._session = aiohttp.ClientSession(base_url=SIGNALING_URL)
        self._running = True
        await self._handshake()
        logger.info("[SignalingClient] Connected as %s (sid=%s)", BOT_USER_ID, self._sid)
        await self._poll_loop()

    async def stop(self) -> None:
        self._running = False
        if self._session:
            await self._session.close()
            self._session = None

    # ── Socket.io transport ────────────────────────────────────────────────────

    async def _handshake(self) -> None:
        """Perform the Socket.io EIO=4 handshake and authenticate the bot."""
        if not self._session:
            raise RuntimeError("Session not initialised")

        # Step 1: GET handshake → receive sid
        async with self._session.get(self._EIO_ENDPOINT) as resp:
            text = await resp.text()
            # EIO packet format: "0{json}" for the open packet
            payload = json.loads(text.lstrip("0"))
            self._sid = payload["sid"]

        # Step 2: POST auth packet with JWT and userId
        auth_packet = json.dumps(
            {
                "userId": BOT_USER_ID,
                "token": BOT_TOKEN,
            }
        )
        # Socket.io connect packet: "40" prefix + namespace "/" + auth
        sio_packet = f'40{{"auth":{auth_packet}}}'
        await self._post_packet(sio_packet)

    async def _poll_loop(self) -> None:
        """Long-poll the server for incoming events."""
        while self._running:
            try:
                events = await self._poll()
                for event in events:
                    await self._handle_event(event)
            except aiohttp.ClientError as exc:
                logger.warning("[SignalingClient] Poll error: %s — retrying in 2 s", exc)
                await asyncio.sleep(2)

    async def _poll(self) -> list[dict]:
        """GET one polling response; returns a list of parsed Socket.io events."""
        if not self._session or not self._sid:
            return []
        url = f"{self._EIO_ENDPOINT}&sid={self._sid}"
        async with self._session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            text = await resp.text()
        return _parse_sio_events(text)

    async def _post_packet(self, packet: str) -> None:
        if not self._session or not self._sid:
            return
        url = f"{self._EIO_ENDPOINT}&sid={self._sid}"
        await self._session.post(url, data=packet, headers={"Content-Type": "text/plain"})

    async def _emit(self, event: str, data: dict) -> None:
        """Emit a Socket.io event to the server."""
        sio_payload = json.dumps([event, data])
        await self._post_packet(f"42{sio_payload}")

    # ── Event handling ─────────────────────────────────────────────────────────

    async def _handle_event(self, event: dict) -> None:
        name = event.get("event")
        data = event.get("data", {})

        if name == "call:incoming":
            await self._on_incoming_call(data)
        elif name == "call:audio":
            await self._on_audio_frame(data)
        elif name == "call:ended":
            await self._on_call_ended(data)

    async def _on_incoming_call(self, data: dict) -> None:
        """Auto-accept every call directed at the bot."""
        call_id: str = data.get("callId", "")
        caller_id: str = data.get("callerId", "")
        logger.info("[SignalingClient] Incoming call %s from %s — accepting", call_id, caller_id)
        self._active_call_id = call_id
        await self._brain.on_call_joined(call_id, caller_id)
        await self._emit("call:accept", {"callId": call_id, "answer": {}})

    async def _on_audio_frame(self, data: dict) -> None:
        """Feed an audio frame to TellyBrain and send back the TTS response."""
        call_id: str = data.get("callId", "")
        audio_b64: str = data.get("audio", "")
        if not audio_b64 or call_id != self._active_call_id:
            return

        audio_bytes = base64.b64decode(audio_b64)
        response_audio = await self._brain.on_audio_received(call_id, audio_bytes)
        if response_audio:
            await self._emit(
                "call:audio:bot",
                {
                    "callId": call_id,
                    "audio": base64.b64encode(response_audio).decode(),
                },
            )

    async def _on_call_ended(self, data: dict) -> None:
        call_id: str = data.get("callId", "")
        logger.info("[SignalingClient] Call %s ended", call_id)
        await self._brain.on_call_ended(call_id)
        self._active_call_id = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _parse_sio_events(raw: str) -> list[dict]:
    """
    Parse Socket.io EIO=4 polling response into a list of event dicts.
    Each Socket.io message event starts with "42" (EIO message + SIO event).
    """
    events: list[dict] = []
    # Multiple packets can be separated by the record separator \x1e
    for chunk in raw.split("\x1e"):
        chunk = chunk.strip()
        if not chunk.startswith("42"):
            continue
        try:
            payload = json.loads(chunk[2:])  # strip "42" prefix
            if isinstance(payload, list) and len(payload) >= 2:
                events.append({"event": payload[0], "data": payload[1]})
        except json.JSONDecodeError:
            continue
    return events


# ── Entry point ────────────────────────────────────────────────────────────────

async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    from bot.brain import TellyBrain

    async with TellyBrain() as brain:
        client = SignalingClient(brain)
        try:
            await client.start()
        except KeyboardInterrupt:
            await client.stop()


if __name__ == "__main__":
    asyncio.run(main())
