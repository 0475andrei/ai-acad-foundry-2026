"""The local agent — the persona runs in *your* process, against any provider.

This is the honest minimum of what an "agent" is when you strip the marketing:
a persona (instructions + rules), optional retrieved context, and a model call.
No platform required — it works with OpenAI, Anthropic, LM Studio or Foundry,
and it is what runs when AGENT_MODE=local.

Compare with foundry_agent.py, where the same persona is hosted by Azure and the
loop runs on Microsoft's side.
"""
from __future__ import annotations

from dataclasses import dataclass

from ..config import settings
from ..llm import get_llm, reasoning_extras
from .persona import Persona


@dataclass
class AgentReply:
    text: str
    mode: str                       # "local" | "foundry"
    persona: str
    system_prompt: str              # exactly what was sent as the system message
    prompt_sent: str                # exactly what was sent as the user message
    provider: str
    model: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


def build_user_prompt(question: str, chunks: list[dict], history: list[dict] | None = None) -> str:
    """Question alone, or question + prior turns + retrieved passages.

    History is folded into the plain-text prompt rather than a provider message
    array on purpose: `prompt_sent` is meant to show exactly what the model saw
    (see AskResponse), and a hidden array would defeat that.
    """
    if not chunks and not history:
        return question
    parts = []
    if history:
        transcript = "\n".join(
            f"{'User' if h['role'] == 'user' else 'Assistant'}: {h['content']}" for h in history
        )
        parts.append(f"CONVERSATION SO FAR:\n{transcript}")
    if chunks:
        context = "\n\n".join(
            f"[{i + 1}] (score {c['score']}) {c['text']}" for i, c in enumerate(chunks)
        )
        parts.append(f"CONTEXT — retrieved passages, most similar first:\n{context}")
    parts.append(f"QUESTION:\n{question}")
    return "\n\n".join(parts)


def run(
    persona: Persona,
    question: str,
    chunks: list[dict] | None = None,
    temperature: float | None = None,
    history: list[dict] | None = None,
) -> AgentReply:
    chunks = chunks or []
    system = persona.system_prompt(grounded=bool(chunks))
    user = build_user_prompt(question, chunks, history)

    # precedence: explicit request value > persona file > .env default
    temp = temperature if temperature is not None else (
        persona.temperature if persona.temperature is not None else settings.llm_temperature
    )
    max_tokens = persona.max_tokens or settings.llm_max_tokens

    # Reasoning models (the gpt-5 family) spend part of the completion budget thinking
    # before they write. A persona can cap that deliberately (andrei-dobrin-agent,
    # lyrical, teller all set "low"); for one that doesn't (default, compliance),
    # reasoning_extras() still defaults gpt-5-family models to "minimal" rather than
    # leaving them free to burn the whole budget on hidden reasoning and return empty.
    llm = get_llm()
    extras = reasoning_extras(llm.model, persona.reasoning_effort)
    result = llm.chat(system=system, user=user, temperature=temp,
                      max_tokens=max_tokens, extras=extras)

    return AgentReply(
        text=result.text,
        mode="local",
        persona=persona.name,
        system_prompt=system,
        prompt_sent=user,
        provider=result.provider,
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
    )
