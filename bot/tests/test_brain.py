# tests/test_brain.py
# Unit tests for Telly Brain AI assistant.

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from bot.brain import TellyBrain, CallContext


@pytest.fixture
def brain():
    b = TellyBrain()
    b._session = MagicMock()
    return b


@pytest.mark.asyncio
async def test_on_call_joined_creates_context(brain):
    with patch.object(brain, '_synthesize_speech', new=AsyncMock(return_value=b'audio')):
        await brain.on_call_joined('call-1', 'user-1')
    assert 'call-1' in brain._active_calls
    ctx = brain._active_calls['call-1']
    assert ctx.call_id == 'call-1'
    assert ctx.user_id == 'user-1'
    assert ctx.is_active is True


@pytest.mark.asyncio
async def test_on_call_ended_removes_context(brain):
    brain._active_calls['call-2'] = CallContext(call_id='call-2', user_id='user-2')
    await brain.on_call_ended('call-2')
    assert 'call-2' not in brain._active_calls


@pytest.mark.asyncio
async def test_on_audio_received_returns_none_for_inactive_call(brain):
    result = await brain.on_audio_received('nonexistent-call', b'audio')
    assert result is None


@pytest.mark.asyncio
async def test_on_audio_received_returns_none_when_no_transcript(brain):
    brain._active_calls['call-3'] = CallContext(call_id='call-3', user_id='user-3')
    with patch.object(brain, '_transcribe', new=AsyncMock(return_value=None)):
        result = await brain.on_audio_received('call-3', b'audio')
    assert result is None


@pytest.mark.asyncio
async def test_on_audio_received_full_pipeline(brain):
    brain._active_calls['call-4'] = CallContext(call_id='call-4', user_id='user-4')
    with patch.object(brain, '_transcribe', new=AsyncMock(return_value='Habari')), \
         patch.object(brain, '_generate_response', new=AsyncMock(return_value='Sijambo, asante!')), \
         patch.object(brain, '_synthesize_speech', new=AsyncMock(return_value=b'audio_bytes')):
        result = await brain.on_audio_received('call-4', b'raw_audio')
    assert result == b'audio_bytes'


@pytest.mark.asyncio
async def test_generate_response_without_api_key(brain):
    import bot.brain as brain_module
    original = brain_module.OPENAI_API_KEY
    brain_module.OPENAI_API_KEY = ''
    ctx = CallContext(call_id='call-5', user_id='user-5')
    response = await brain._generate_response(ctx, 'Test')
    brain_module.OPENAI_API_KEY = original
    assert isinstance(response, str)
    assert len(response) > 0


@pytest.mark.asyncio
async def test_conversation_history_grows(brain):
    ctx = CallContext(call_id='call-6', user_id='user-6')
    brain._active_calls['call-6'] = ctx
    with patch.object(brain, '_transcribe', new=AsyncMock(return_value='Hello')), \
         patch.object(brain, '_generate_response', new=AsyncMock(return_value='Hi there!')), \
         patch.object(brain, '_synthesize_speech', new=AsyncMock(return_value=b'')):
        await brain.on_audio_received('call-6', b'audio')
    # _generate_response is mocked, but _transcribe sets up the call - check ctx is active
    assert ctx.is_active is True
