"""Request/response models — rich on purpose: the responses ARE the lesson."""
from __future__ import annotations

from typing import Literal, Optional  # noqa: F401  (Literal used by AskRequest)

from pydantic import BaseModel, Field

Strategy = Literal["static", "dynamic", "sentence", "semantic"]


# --- chunking -----------------------------------------------------------------
class ChunkRequest(BaseModel):
    model_config = {"json_schema_extra": {"examples": [{
        "text": "Libra Bank blocks a card after three failed PIN attempts. "
                "A blocked card can be unblocked in the branch after identity verification. "
                "Mortgage early repayment is free of charge in the variable-rate period.",
        "strategy": "dynamic",
        "chunk_size": 120,
        "chunk_overlap": 30,
    }]}}

    text: str = Field(..., description="Raw text to split", min_length=1)
    strategy: Optional[Strategy] = Field(None, description="Defaults to CHUNK_STRATEGY from .env")
    chunk_size: Optional[int] = Field(None, ge=50, description="Target size, characters (≥ 50)")
    chunk_overlap: Optional[int] = Field(None, ge=0, description="Overlap, characters")
    sentences_per_chunk: Optional[int] = Field(None, ge=1, description="'sentence' strategy only")
    semantic_threshold: Optional[float] = Field(None, gt=0, le=1, description="'semantic' strategy only — 0 < t ≤ 1")


class ChunkInfo(BaseModel):
    index: int
    text: str
    chars: int
    approx_tokens: int = Field(description="chars / 4 — a rough but honest estimate")


class ChunkResponse(BaseModel):
    strategy: Strategy
    params_used: dict
    count: int
    chunks: list[ChunkInfo]

class DocumentMetadata(BaseModel):
    """Document-level fields carried from the corpus front matter into every
    chunk's payload, so retrieval can display/filter by them later (Part 5)."""
    title: Optional[str] = None
    product: Optional[str] = None
    audience: Optional[str] = None
    effective: Optional[str] = None
    version: Optional[str] = None

# --- ingestion ----------------------------------------------------------------
class IngestRequest(ChunkRequest):
    model_config = {"json_schema_extra": {"examples": [{
        "text": "Libra Bank blocks a card after three failed PIN attempts. "
                "A blocked card can be unblocked in the branch after identity verification. "
                "Mortgage early repayment is free of charge in the variable-rate period.",
        "strategy": "dynamic",
        "source": "retail-faq",
    }]}}

    source: Optional[str] = Field(None, description="Label stored with every chunk (e.g. 'cards-faq')")
    metadata: Optional[DocumentMetadata] = Field(
        None, description="Document-level metadata (title/product/audience/effective/version) "
                          "stored on every chunk from this document"
    )


class IngestResponse(BaseModel):
    strategy: Strategy
    count: int
    vector_dimension: int
    embedding_preview: list[float] = Field(description="First 8 dimensions of chunk #0 — meaning as numbers")
    embedding_model: dict
    point_ids: list[str]
    chunks: list[ChunkInfo]


# --- retrieval ----------------------------------------------------------------
class SearchRequest(BaseModel):
    model_config = {"json_schema_extra": {"examples": [{
        "query": "my card got frozen, what do I do?",
        "top_k": 3,
    }]}}

    query: str = Field(..., min_length=1)
    top_k: Optional[int] = Field(None, ge=1, le=50)


class SearchHit(BaseModel):
    score: float = Field(description="Cosine similarity — 1.0 is identical direction")
    text: str
    index: Optional[int] = None
    strategy: Optional[str] = None
    source: Optional[str] = None
    id: str
    metadata: Optional[DocumentMetadata] = None


class SearchResponse(BaseModel):
    query: str
    top_k: int
    embedding_model: dict
    query_embedding_preview: list[float]
    hits: list[SearchHit]


# --- generation ---------------------------------------------------------------
class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AskRequest(BaseModel):
    model_config = {"json_schema_extra": {"examples": [{
        "question": "What fee does Libra Bank charge for early mortgage repayment?",
        "use_rag": True,
        "top_k": 3,
        "agent": "lyrical",
    }]}}

    question: str = Field(..., min_length=1)
    history: list[ChatTurn] = Field(
        default_factory=list,
        description="Prior turns in this conversation, oldest first — user and assistant "
                    "only, no system messages. The backend is stateless, so the frontend "
                    "resends this on every call; only the most recent 20 turns are used.",
    )
    use_rag: bool = Field(True, description="false = plain LLM; true = retrieve then augment")
    top_k: Optional[int] = Field(None, ge=1, le=50)
    temperature: Optional[float] = Field(None, ge=0, le=2)
    agent: Optional[str] = Field(
        None,
        description="Persona name from app/agents/personas/ — try 'default', 'lyrical', "
                    "'compliance', 'teller'. Falls back to AGENT_PERSONA in .env.",
    )
    agent_mode: Optional[Literal["local", "foundry"]] = Field(
        None, description="local = the loop runs here; foundry = the hosted Agent Service"
    )


class AgentInfo(BaseModel):
    name: str
    display_name: str
    description: str
    mode: str = Field(description="Where this run executed: local or foundry")
    temperature: Optional[float] = None
    style_rules: list[str] = Field(default_factory=list)


class HostedAgent(BaseModel):
    agent_id: str
    name: str
    model: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[int] = None
    instructions_preview: Optional[str] = None


class PersonaSummary(BaseModel):
    name: str
    display_name: str
    description: str
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    style_rules: list[str] = Field(default_factory=list)
    require_citations: bool = True
    refuse_when_unsupported: bool = True
    reasoning_effort: Optional[str] = None
    tools: list[str] = Field(default_factory=list)
    runs_on: Literal["local", "both", "foundry", "unknown"] = Field(
        "local",
        description="local = JSON file only · both = also hosted in Foundry · "
                    "foundry = hosted only, no local file · unknown = cannot ask Foundry",
    )
    hosted: Optional[HostedAgent] = None


class FoundryAvailability(BaseModel):
    available: bool
    reason: Optional[str] = Field(
        None, description="Why the Agent Service could not be queried, when it could not"
    )


class AgentListResponse(BaseModel):
    active_mode: str
    default_persona: str
    personas_dir: str
    count: int
    personas: list[PersonaSummary]
    foundry: FoundryAvailability
    hosted_only: list[PersonaSummary] = Field(
        default_factory=list,
        description="Agents that exist in Foundry with no local persona file — "
                    "created in the portal, or from a file since deleted",
    )


class AzureDeployment(BaseModel):
    name: str
    model: Optional[str] = None
    version: Optional[str] = None
    sku: Optional[str] = None
    capacity: Optional[int] = None
    state: Optional[str] = None


class AzureDeployments(BaseModel):
    available: bool
    reason: Optional[str] = None
    items: list[AzureDeployment] = Field(default_factory=list)


class AzureStatus(BaseModel):
    configured: bool
    auth: str = Field(description="identity (Entra) or key")
    auth_note: Optional[str] = None
    resource: Optional[str] = None
    resource_group: Optional[str] = None
    project: Optional[str] = None
    location: Optional[str] = None
    subscription_id: Optional[str] = None
    inference_endpoint: Optional[str] = None
    project_endpoint: Optional[str] = None
    openai_endpoint: Optional[str] = None
    chat_deployment: Optional[str] = None
    embedding_deployment: Optional[str] = None
    foundry_url: Optional[str] = None
    portal_url: Optional[str] = None
    deployments: AzureDeployments


class Usage(BaseModel):
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None


class AskResponse(BaseModel):
    answer: str
    augmented: bool
    provider: str
    model: str
    agent: Optional[AgentInfo] = Field(None, description="Which persona shaped this answer")
    system_prompt: str = Field(description="The system message actually sent")
    prompt_sent: str = Field(description="The exact user prompt sent to the model — compare with/without RAG")
    retrieved: list[SearchHit] = Field(default_factory=list)
    usage: Optional[Usage] = None


# --- tools / services ---------------------------------------------------------
class ScrapeRequest(BaseModel):
    model_config = {"json_schema_extra": {"examples": [{
        "url": "https://learn.microsoft.com/azure/ai-foundry/what-is-azure-ai-foundry",
    }]}}

    url: str = Field(..., description="Page to fetch and strip to text")
    max_chars: Optional[int] = Field(None, ge=200, le=200000)


class ScrapeResponse(BaseModel):
    url: str
    status_code: int
    title: Optional[str] = None
    text: str
    chars: int
    approx_tokens: int
    warnings: list[str] = Field(description="Everything the naive approach could not handle")
    stats: dict


class WebSearchRequest(BaseModel):
    model_config = {"json_schema_extra": {"examples": [{
        "query": "Azure AI Foundry agent service pricing",
        "max_results": 5,
    }]}}

    query: str = Field(..., min_length=1)
    max_results: Optional[int] = Field(None, ge=1, le=15)


class WebSearchHit(BaseModel):
    rank: int
    title: str
    url: str
    snippet: str


class WebSearchResponse(BaseModel):
    query: str
    provider: str = Field(description="Which engine answered, and whether it is managed")
    count: int
    results: list[WebSearchHit]
    note: Optional[str] = None


class AzureSearchSyncRequest(ChunkRequest):
    """Same request shape as /ingest — only the destination differs."""

    model_config = {"json_schema_extra": {"examples": [{
        "text": "Libra Bank blocks a card after three failed PIN attempts. "
                "Mortgage early repayment is free in the variable-rate period; "
                "the fixed-rate period costs one percent.",
        "strategy": "dynamic",
        "source": "retail-faq",
    }]}}

    source: str = Field("adhoc", description="Stored on every document, and filterable")
    allowed_groups: list[str] = Field(
        default_factory=lambda: ["all-staff"],
        description="Who may retrieve these documents — the field security trimming filters on",
    )


class AzureSearchQueryRequest(BaseModel):
    model_config = {"json_schema_extra": {"examples": [{
        "query": "my card got frozen",
        "mode": "hybrid",
        "top": 3,
    }]}}

    query: str = Field(..., min_length=1)
    mode: Literal["keyword", "vector", "hybrid"] = Field(
        "hybrid", description="keyword = BM25 only · vector = embeddings only · hybrid = both, fused"
    )
    top: Optional[int] = Field(None, ge=1, le=20)
    filter: Optional[str] = Field(None, description="OData filter, e.g. source eq 'retail-faq'")
    semantic: bool = Field(False, description="Add the semantic reranker (paid tiers only)")


class SpeakRequest(BaseModel):
    model_config = {"json_schema_extra": {"examples": [{
        "text": "Your card was blocked after three failed PIN attempts.",
    }]}}

    text: str = Field(..., min_length=1, max_length=3000)
    voice: Optional[str] = Field(None, description="Neural voice name; defaults to AZURE_SPEECH_VOICE")


class TranscribeResponse(BaseModel):
    status: Optional[str] = None
    text: str
    confidence: Optional[float] = None
    duration_seconds: Optional[float] = None
    language: Optional[str] = None


class SuggestRequest(BaseModel):
    model_config = {"json_schema_extra": {"examples": [{
        "draft": "wat fee mortgage early repay",
    }]}}

    draft: str = Field(..., min_length=1, max_length=2000, description="The composer's current, possibly rough, text")


class SuggestResponse(BaseModel):
    suggestion: Optional[str] = Field(None, description="A cleaned-up rewrite, or null if the draft needs none")
    provider: str
    model: str


# --- ops ----------------------------------------------------------------------
class CollectionInfo(BaseModel):
    exists: bool
    name: str
    points_count: int
    vector_dimension: Optional[int] = None
    distance: Optional[str] = None


class Health(BaseModel):
    status: str
    qdrant: str
    qdrant_url: str
    llm: dict
    embeddings: dict
    agents: dict = Field(default_factory=dict)
    speech: dict = Field(default_factory=dict)
    search: dict = Field(default_factory=dict)
    agents: dict = Field(default_factory=dict)
    speech: dict = Field(default_factory=dict)
