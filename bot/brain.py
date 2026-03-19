# bot/brain.py
# Telly Brain – Python AI assistant that participates in calls as a virtual agent.
# Supports Swahili/Sheng via Deepgram transcription, GPT-4o reasoning,
# and Azure Neural TTS for Kenyan English/Swahili voice synthesis.

import asyncio
import os
import json
import logging
from dataclasses import dataclass, field
from typing import Optional

import aiohttp

logger = logging.getLogger(__name__)

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
AZURE_TTS_KEY = os.getenv("AZURE_TTS_KEY", "")
AZURE_TTS_REGION = os.getenv("AZURE_TTS_REGION", "southafricanorth")
SIGNALING_URL = os.getenv("SIGNALING_URL", "http://localhost:3000")

SYSTEM_PROMPT = """You are Telly Brain, an AI assistant embedded in the Telly VoIP platform.
You speak Kenyan English and Swahili/Sheng naturally.
You help users with reminders, information retrieval, and general assistance.
Keep responses short and conversational – you are speaking, not writing.
Example: "Sawa, nitakukumbusha mkutano wako saa tatu asubuhi."
"""


@dataclass
class CallContext:
    """Maintains per-call context for the AI assistant."""
    call_id: str
    user_id: str
    conversation_history: list = field(default_factory=list)
    is_active: bool = True


class TellyBrain:
    """AI assistant that joins Mediasoup calls as a virtual participant."""

    def __init__(self) -> None:
        self._session: Optional[aiohttp.ClientSession] = None
        self._active_calls: dict[str, CallContext] = {}

    async def __aenter__(self) -> "TellyBrain":
        self._session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, *args: object) -> None:
        if self._session:
            await self._session.close()

    async def on_call_joined(self, call_id: str, user_id: str) -> None:
        """Called when the bot joins a call. Sends a greeting."""
        ctx = CallContext(call_id=call_id, user_id=user_id)
        self._active_calls[call_id] = ctx
        greeting = await self._synthesize_speech(
            "Habari! Mimi ni Telly Brain. Naweza kukusaidia na nini leo?"
        )
        logger.info("[TellyBrain] Joined call %s, greeting sent (%d bytes)", call_id, len(greeting))

    async def on_audio_received(self, call_id: str, audio_bytes: bytes) -> Optional[bytes]:
        """Transcribes user audio, generates a response, and synthesizes speech."""
        ctx = self._active_calls.get(call_id)
        if not ctx or not ctx.is_active:
            return None

        transcript = await self._transcribe(audio_bytes)
        if not transcript:
            return None

        logger.info("[TellyBrain] Transcribed: %s", transcript)
        response_text = await self._generate_response(ctx, transcript)
        logger.info("[TellyBrain] Response: %s", response_text)
        return await self._synthesize_speech(response_text)

    async def on_call_ended(self, call_id: str) -> None:
        """Clean up call context when the call ends."""
        ctx = self._active_calls.pop(call_id, None)
        if ctx:
            ctx.is_active = False
            logger.info("[TellyBrain] Call %s ended after %d turns", call_id, len(ctx.conversation_history))

    async def _transcribe(self, audio_bytes: bytes) -> Optional[str]:
        """Transcribe audio using Deepgram (supports Swahili)."""
        if not self._session or not DEEPGRAM_API_KEY:
            return None
        try:
            async with self._session.post(
                "https://api.deepgram.com/v1/listen?language=sw&model=nova-2",
                headers={
                    "Authorization": f"Token {DEEPGRAM_API_KEY}",
                    "Content-Type": "audio/opus",
                },
                data=audio_bytes,
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
                return data["results"]["channels"][0]["alternatives"][0]["transcript"]
        except Exception as exc:
            logger.warning("[TellyBrain] Transcription failed: %s", exc)
            return None

    async def _generate_response(self, ctx: CallContext, user_message: str) -> str:
        """Generate a response using OpenAI GPT-4o."""
        ctx.conversation_history.append({"role": "user", "content": user_message})

        if not self._session or not OPENAI_API_KEY:
            return "Samahani, siwezi kukusaidia sasa hivi."

        try:
            messages = [{"role": "system", "content": SYSTEM_PROMPT}] + ctx.conversation_history[-10:]
            async with self._session.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={"model": "gpt-4o", "messages": messages, "max_tokens": 150},
                timeout=aiohttp.ClientTimeout(total=8),
            ) as resp:
                data = await resp.json()
                reply = data["choices"][0]["message"]["content"]
                ctx.conversation_history.append({"role": "assistant", "content": reply})
                return reply
        except Exception as exc:
            logger.warning("[TellyBrain] LLM call failed: %s", exc)
            return "Samahani, kuna tatizo la muda. Jaribu tena."

    async def _synthesize_speech(self, text: str) -> bytes:
        """Convert text to speech using Azure Neural TTS (Kenyan English/Swahili voice)."""
        if not self._session or not AZURE_TTS_KEY:
            return b""
        try:
            ssml = (
                "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='sw-KE'>"
                f"<voice name='sw-KE-ZuriNeural'>{text}</voice>"
                "</speak>"
            )
            async with self._session.post(
                f"https://{AZURE_TTS_REGION}.tts.speech.microsoft.com/cognitiveservices/v1",
                headers={
                    "Ocp-Apim-Subscription-Key": AZURE_TTS_KEY,
                    "Content-Type": "application/ssml+xml",
                    "X-Microsoft-OutputFormat": "opus-16khz-16bit-mono-cbr",
                },
                data=ssml.encode(),
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status != 200:
                    return b""
                return await resp.read()
        except Exception as exc:
            logger.warning("[TellyBrain] TTS failed: %s", exc)
            return b""


async def main() -> None:
    """Entry point for the Telly Brain bot service."""
    logging.basicConfig(level=logging.INFO)
    logger.info("[TellyBrain] Starting Telly Brain service...")

    async with TellyBrain() as brain:
        # Example: simulate a call interaction
        await brain.on_call_joined("test-call-1", "user-1")
        test_audio = b"\x00" * 100  # placeholder audio
        await brain.on_audio_received("test-call-1", test_audio)
        await brain.on_call_ended("test-call-1")
        logger.info("[TellyBrain] Service ready and listening.")

        # In production: connect to Mediasoup via PlainRtpTransport
        # and process audio frames in real-time.
        await asyncio.sleep(0)


if __name__ == "__main__":
    asyncio.run(main())
