"""RAG Teaching API — every response exposes the pipeline's intermediate steps.

Demo order:  /health -> /chunk -> /ingest -> /collection -> /search -> /ask
Swagger UI:  /docs        ReDoc: /redoc
"""
from __future__ import annotations

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import chunking, contracts, feedback_store, finance, guardrails, pii, retrieval_lang
from .agents import foundry_agent, local_agent
from .agents.persona import PersonaNotFound, available_names, load_persona, list_personas, PERSONA_DIR
from .config import settings
from .embeddings import get_embedder
from .llm import get_llm, reasoning_extras
from .ratelimit import RateLimiter, rate_limit_dependency
from .schemas import (
    AgentInfo, AgentListResponse, AskRequest, AskResponse, AzureDeployment, AzureDeployments,
    AzureStatus, ChunkInfo, ChunkRequest, ChunkResponse, CollectionInfo, ContractExtractResponse,
    FeedbackEntry, FeedbackListResponse, FeedbackRequest, FoundryAvailability, GuardrailReport,
    Health, HostedAgent, IngestRequest, IngestResponse, LoanPayoffRequest, LoanPayoffResponse,
    LoanPaymentRequest, LoanPaymentResponse, PersonaSummary, PiiReport, SavingsGrowthRequest,
    SavingsGrowthResponse, ScrapeRequest, ScrapeResponse, SearchHit, SearchRequest,
    SearchResponse, SpeakRequest, SuggestRequest, SuggestResponse, TranscribeResponse, Usage,
    WebSearchHit, WebSearchRequest, WebSearchResponse, AzureSearchQueryRequest,
    AzureSearchSyncRequest,
)
from .services import aisearch, speech, web
from .vectorstore import DimensionMismatch, VectorStore

app = FastAPI(
    title="RAG Teaching API",
    description=(
        "A backend built to *show* Retrieval-Augmented Generation, step by step: "
        "chunk text (four strategies), embed and store in Qdrant, retrieve with "
        "similarity scores, and answer with or without augmentation — the exact "
        "final prompt is always returned. Libra Bank Academy · AI Engineering on Azure."
    ),
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

store = VectorStore()

# Three tiers, not one: /ask is the most expensive call and gets the tightest sustained
# rate; /tools/suggest fires automatically while typing (debounced, but automatic) and
# needs headroom so ordinary use never trips it; everything else that spends money
# (speech, transcription, scraping, embeddings) shares a middle tier.
_ask_limiter = RateLimiter(settings.rate_limit_ask_burst, settings.rate_limit_ask_per_minute / 60)
_suggest_limiter = RateLimiter(settings.rate_limit_suggest_burst, settings.rate_limit_suggest_per_minute / 60)
_tools_limiter = RateLimiter(settings.rate_limit_tools_burst, settings.rate_limit_tools_per_minute / 60)


# --- helpers ------------------------------------------------------------------
def _chunk_params(req: ChunkRequest) -> dict:
    return {
        "strategy": (req.strategy or settings.chunk_strategy).lower(),
        "size": req.chunk_size or settings.chunk_size,
        "overlap": req.chunk_overlap if req.chunk_overlap is not None else settings.chunk_overlap,
        "per_chunk": req.sentences_per_chunk or settings.sentences_per_chunk,
        "threshold": req.semantic_threshold or settings.semantic_threshold,
    }


def _do_chunk(req: ChunkRequest) -> tuple[list[str], dict]:
    p = _chunk_params(req)
    embed_fn = None
    if p["strategy"] == "semantic":
        embed_fn = _embedder().embed
    try:
        pieces = chunking.chunk(
            req.text, p["strategy"], size=p["size"], overlap=p["overlap"],
            per_chunk=p["per_chunk"], threshold=p["threshold"], embed_fn=embed_fn,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return pieces, p


def _chunk_infos(pieces: list[str]) -> list[ChunkInfo]:
    return [
        ChunkInfo(index=i, text=t, chars=len(t), approx_tokens=max(1, round(len(t) / 4)))
        for i, t in enumerate(pieces)
    ]


def _embedder():
    try:
        return get_embedder()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Embedding provider not usable: {e}")


def _embed(texts: list[str]) -> list[list[float]]:
    try:
        return _embedder().embed(texts)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Embedding call failed ({settings.embedding_provider}): {e}",
        )


def _require_qdrant() -> None:
    if not store.ping():
        raise HTTPException(
            status_code=503,
            detail=f"Qdrant is not reachable at {settings.qdrant_url} — "
                   f"start it with: docker compose up qdrant -d",
        )


# --- ops ----------------------------------------------------------------------
@app.get("/health", response_model=Health, tags=["ops"])
def health() -> Health:
    return Health(
        status="ok",
        qdrant="ok" if store.ping() else "unreachable",
        qdrant_url=settings.qdrant_url,
        llm={"provider": settings.llm_provider,
             "model": {"lmstudio": settings.lmstudio_model, "openai": settings.openai_model,
                       "anthropic": settings.anthropic_model,
                       "azure": settings.azure_ai_chat_deployment}.get(settings.llm_provider, "?")},
        embeddings={"provider": settings.embedding_provider,
                    "model": {"lmstudio": settings.lmstudio_embedding_model,
                              "openai": settings.openai_embedding_model,
                              "azure": settings.azure_ai_embedding_deployment}.get(
                                  settings.embedding_provider, "?")},
        agents={"mode": settings.agent_mode,
                "default_persona": settings.agent_persona,
                "available": available_names(),
                "foundry_agent_id": settings.foundry_agent_id or None},
        speech=speech.describe(),
        search=aisearch.describe(),
    )


@app.get("/config", tags=["ops"])
def config() -> dict:
    def mask(v: str) -> str:
        return (v[:6] + "…" + v[-4:]) if len(v) > 12 else ("set" if v else "not set")

    return {
        "chunking": {"strategy": settings.chunk_strategy, "chunk_size": settings.chunk_size,
                     "chunk_overlap": settings.chunk_overlap,
                     "sentences_per_chunk": settings.sentences_per_chunk,
                     "semantic_threshold": settings.semantic_threshold},
        "retrieval": {"top_k": settings.top_k, "collection": settings.qdrant_collection,
                      "qdrant_url": settings.qdrant_url},
        "generation": {"provider": settings.llm_provider,
                       "temperature": settings.llm_temperature,
                       "max_tokens": settings.llm_max_tokens},
        "providers": {
            "lmstudio": {"base_url": settings.lmstudio_base_url, "model": settings.lmstudio_model,
                         "embedding_model": settings.lmstudio_embedding_model},
            "openai": {"api_key": mask(settings.openai_api_key), "model": settings.openai_model,
                       "embedding_model": settings.openai_embedding_model},
            "anthropic": {"api_key": mask(settings.anthropic_api_key),
                          "model": settings.anthropic_model},
            "azure": {"endpoint": settings.azure_ai_endpoint or "not set",
                      "auth": settings.azure_ai_auth,
                      "api_key": mask(settings.azure_ai_api_key),
                      "chat_deployment": settings.azure_ai_chat_deployment,
                      "embedding_deployment": settings.azure_ai_embedding_deployment},
        },
    }


@app.get("/azure", response_model=AzureStatus, tags=["ops"])
def azure_status() -> AzureStatus:
    """The Azure environment this app is pointed at, plus its live deployments.

    Deployment data comes from the control plane (Azure Resource Manager), which
    needs an Entra token — so under key authentication the list is unavailable and
    says so, rather than appearing empty.
    """
    resource = settings.azure_foundry_resource
    project = settings.azure_foundry_project
    identity = settings.azure_ai_auth.lower() == "identity"

    foundry_url = portal_url = None
    if resource:
        foundry_url = "https://ai.azure.com/"
        if settings.azure_resource_group and project:
            portal_url = (
                "https://portal.azure.com/#@/resource/subscriptions//resourceGroups/"
                f"{settings.azure_resource_group}/providers/Microsoft.CognitiveServices/"
                f"accounts/{resource}/overview"
            )

    deployments = AzureDeployments(
        available=False,
        reason=None if identity else (
            "Listing deployments reads the Azure control plane, which requires Microsoft "
            "Entra authentication. This app is running with AZURE_AI_AUTH=key (the Docker "
            "default). Run it locally after `az login` to see them."
        ),
    )
    subscription_id = None

    if identity and resource and settings.azure_resource_group:
        try:
            import httpx
            from azure.identity import DefaultAzureCredential

            token = DefaultAzureCredential().get_token("https://management.azure.com/.default")
            headers = {"Authorization": f"Bearer {token.token}"}
            subs = httpx.get("https://management.azure.com/subscriptions",
                             params={"api-version": "2022-12-01"},
                             headers=headers, timeout=20).json().get("value", [])
            if subs:
                subscription_id = subs[0]["subscriptionId"]
                url = (f"https://management.azure.com/subscriptions/{subscription_id}"
                       f"/resourceGroups/{settings.azure_resource_group}"
                       f"/providers/Microsoft.CognitiveServices/accounts/{resource}/deployments")
                data = httpx.get(url, params={"api-version": "2023-05-01"},
                                 headers=headers, timeout=20).json()
                items = []
                for d in data.get("value", []):
                    props, sku = d.get("properties", {}), d.get("sku", {})
                    items.append(AzureDeployment(
                        name=d.get("name"), model=(props.get("model") or {}).get("name"),
                        version=(props.get("model") or {}).get("version"),
                        sku=sku.get("name"), capacity=sku.get("capacity"),
                        state=props.get("provisioningState"),
                    ))
                deployments = AzureDeployments(available=True, items=items)
        except Exception as e:                    # noqa: BLE001 - report, never crash the panel
            deployments = AzureDeployments(available=False, reason=f"{type(e).__name__}: {e}")

    return AzureStatus(
        configured=bool(settings.azure_ai_endpoint),
        auth=settings.azure_ai_auth,
        auth_note=None if identity else
        "Key authentication: the Agent Service and the control plane are unavailable. "
        "This is expected inside Docker, where there is no `az login` to borrow.",
        resource=resource or None,
        resource_group=settings.azure_resource_group or None,
        project=project or None,
        location=settings.azure_location or None,
        subscription_id=subscription_id,
        inference_endpoint=settings.azure_ai_endpoint or None,
        project_endpoint=settings.azure_ai_project_endpoint or None,
        openai_endpoint=settings.azure_openai_endpoint or None,
        chat_deployment=settings.azure_ai_chat_deployment,
        embedding_deployment=settings.azure_ai_embedding_deployment,
        foundry_url=foundry_url,
        portal_url=portal_url,
        deployments=deployments,
    )


# --- chunking (no storage) ----------------------------------------------------
@app.post("/chunk", response_model=ChunkResponse, tags=["1 · chunking"])
def chunk_only(req: ChunkRequest) -> ChunkResponse:
    """Split text and LOOK at the result — nothing is stored. Try the same text
    with all four strategies and compare the boundaries."""
    pieces, p = _do_chunk(req)
    return ChunkResponse(strategy=p["strategy"], params_used=p, count=len(pieces),
                         chunks=_chunk_infos(pieces))


# --- ingestion ----------------------------------------------------------------
@app.post("/ingest", response_model=IngestResponse, tags=["2 · ingestion"],
         dependencies=[Depends(rate_limit_dependency(_tools_limiter))])
def ingest(req: IngestRequest) -> IngestResponse:
    """Chunk -> embed -> store in Qdrant. The response shows the chunks, the
    vector dimension, and a peek at the first embedding."""
    _require_qdrant()
    pieces, p = _do_chunk(req)
    if not pieces:
        raise HTTPException(status_code=422, detail="No chunks produced — is the text empty?")
    vectors = _embed(pieces)
    dim = len(vectors[0])
    try:
        store.ensure_collection(dim)
    except DimensionMismatch as e:
        raise HTTPException(status_code=409, detail=str(e))
    ids = store.upsert(
        pieces, vectors, p["strategy"], req.source,
        metadata=req.metadata.model_dump(exclude_none=True) if req.metadata else None,
    )
    return IngestResponse(
        strategy=p["strategy"], count=len(pieces), vector_dimension=dim,
        embedding_preview=[round(x, 5) for x in vectors[0][:8]],
        embedding_model=_embedder().describe(), point_ids=ids, chunks=_chunk_infos(pieces),
    )


@app.get("/collection", response_model=CollectionInfo, tags=["2 · ingestion"])
def collection_info() -> CollectionInfo:
    _require_qdrant()
    return CollectionInfo(**store.info())


@app.delete("/collection", tags=["2 · ingestion"])
def collection_reset() -> dict:
    """Wipe everything — the clean slate between demos."""
    _require_qdrant()
    return {"deleted": store.reset(), "collection": settings.qdrant_collection}


# --- retrieval ----------------------------------------------------------------
@app.post("/search", response_model=SearchResponse, tags=["3 · retrieval"],
         dependencies=[Depends(rate_limit_dependency(_tools_limiter))])
def search(req: SearchRequest) -> SearchResponse:
    """Embed the query, return the nearest chunks with their cosine similarity
    scores — retrieval with the curtain open."""
    _require_qdrant()
    if not store.info()["exists"]:
        raise HTTPException(status_code=404, detail="Collection is empty — POST /ingest first.")
    top_k = req.top_k or settings.top_k
    qvec = _embed([req.query])[0]
    hits = store.search(qvec, top_k)
    return SearchResponse(
        query=req.query, top_k=top_k, embedding_model=_embedder().describe(),
        query_embedding_preview=[round(x, 5) for x in qvec[:8]],
        hits=[SearchHit(**h) for h in hits],
    )


# --- generation ---------------------------------------------------------------
@app.post("/ask", response_model=AskResponse, tags=["4 · generation"],
         dependencies=[Depends(rate_limit_dependency(_ask_limiter))])
def ask(req: AskRequest) -> AskResponse:
    """The finale: an **agent** answers, with or without retrieval.

    Three dials to demonstrate, one at a time:
      * `use_rag`      — false = the model alone; true = retrieve, then augment.
      * `agent`        — which persona shapes the answer (edit its JSON and re-ask!).
      * `agent_mode`   — `local` runs the loop here; `foundry` calls the hosted agent.

    `system_prompt` and `prompt_sent` always show exactly what went to the model.
    """
    retrieved: list[SearchHit] = []

    # ---- redact personal data before it goes anywhere else — embedding, ------
    # guardrail scanning, the model itself. Everything below uses `question`,
    # never `req.question`, so a card/CNP/IBAN/email/phone never leaves this
    # function intact. See app/pii.py.
    question, pii_flags = pii.scan_and_redact(req.question)

    # ---- which persona, and does it need to be local? ------------------------
    persona_name = req.agent or settings.agent_persona
    mode_requested = (req.agent_mode or settings.agent_mode).lower()
    persona = None
    hosted_only = None
    try:
        persona = load_persona(persona_name)
    except PersonaNotFound as e:
        # In foundry mode the instructions may live in Azure rather than on disk —
        # an agent created in the portal has no local file, and should still work.
        if mode_requested != "foundry":
            raise HTTPException(status_code=404, detail=str(e))
        try:
            hosted_only = foundry_agent.find_hosted(persona_name)
        except foundry_agent.FoundryUnavailable as fe:
            raise HTTPException(status_code=503, detail=str(fe))
        if not hosted_only:
            raise HTTPException(status_code=404, detail=str(e))

    # ---- retrieval (now feeding the agent, and translated for non-English) -
    retrieval_query = None
    if req.use_rag:
        _require_qdrant()
        if not store.info()["exists"]:
            raise HTTPException(status_code=404,
                                detail="use_rag=true but the collection is empty — POST /ingest first, "
                                       "or set use_rag=false for a plain LLM answer.")
        top_k = req.top_k or settings.top_k
        search_query = retrieval_lang.translate_for_retrieval(question)
        if search_query != question:
            retrieval_query = search_query
        qvec = _embed([search_query])[0]
        retrieved = [SearchHit(**h) for h in store.search(qvec, top_k)]

    chunks = [h.model_dump() for h in retrieved]
    # Flagged, never dropped — same "show the pipeline" rule as everything else this
    # endpoint returns. The real barrier is the standing rule in the system prompt
    # (persona.py); this is the visible early-warning layer on top of it.
    guardrail_report = GuardrailReport(
        question_flags=guardrails.scan(question),
        context_flags=guardrails.scan_passages(chunks),
    )
    mode = mode_requested
    # Cap what we fold into the prompt — a long-running demo chat shouldn't grow
    # the token bill (or the prompt shown in `prompt_sent`) without bound. Every
    # turn resends the full text of every turn kept here, uncompressed, so the
    # cap is deliberately tighter than "as much as fits" — 10 is still plenty to
    # demonstrate multi-turn continuity in class.
    history = [h.model_dump() for h in req.history[-10:]]
    for h in history:
        h["content"], _ = pii.scan_and_redact(h.get("content", ""))

    # ---- run the agent ------------------------------------------------------
    try:
        if hosted_only is not None:
            reply = foundry_agent.run_hosted(hosted_only, question, chunks, history=history)
        elif mode == "foundry":
            reply = foundry_agent.run(persona, question, chunks, history=history)
        else:
            reply = local_agent.run(persona, question, chunks,
                                    temperature=req.temperature, history=history)
    except foundry_agent.FoundryUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502,
                            detail=f"Agent run failed (mode={mode}, provider={settings.llm_provider}): {e}")

    info = AgentInfo(
        name=persona.name, display_name=persona.display_name,
        description=persona.description, mode=reply.mode,
        temperature=persona.temperature, style_rules=persona.style_rules,
    ) if persona is not None else AgentInfo(
        name=hosted_only["name"], display_name=hosted_only["name"],
        description=hosted_only.get("description") or "Hosted in Foundry — no local persona file.",
        mode=reply.mode,
    )

    return AskResponse(
        answer=reply.text,
        augmented=req.use_rag,
        provider=reply.provider,
        model=reply.model,
        agent=info,
        system_prompt=reply.system_prompt,
        prompt_sent=reply.prompt_sent,
        retrieved=retrieved,
        retrieval_query=retrieval_query,
        guardrails=guardrail_report,
        pii=PiiReport(redacted=pii_flags),
        usage=Usage(prompt_tokens=reply.prompt_tokens, completion_tokens=reply.completion_tokens),
    )


# --- feedback -------------------------------------------------------------------
@app.post("/feedback", response_model=FeedbackEntry, tags=["4 · generation"],
         dependencies=[Depends(rate_limit_dependency(_tools_limiter))])
def submit_feedback(req: FeedbackRequest) -> FeedbackEntry:
    """One thumbs up/down per answer — a place for "was this any good?" to go,
    and GET /feedback below is how it gets read back (the Status admin view
    shows the most recent entries)."""
    entry = feedback_store.record(
        rating=req.rating, question=req.question, answer=req.answer,
        agent=req.agent, mode=req.mode, augmented=req.augmented, model=req.model,
    )
    return FeedbackEntry(**entry)


@app.get("/feedback", response_model=FeedbackListResponse, tags=["4 · generation"])
def list_feedback(limit: int = Query(50, ge=1, le=200)) -> FeedbackListResponse:
    """Most recent feedback first."""
    items = feedback_store.recent(limit=limit)
    return FeedbackListResponse(count=len(items), items=[FeedbackEntry(**e) for e in items])


# --- agents -------------------------------------------------------------------
@app.get("/agents", response_model=AgentListResponse, tags=["5 · agents"])
def agents_list() -> AgentListResponse:
    """Every agent, and **where each one can run**.

    * `local`   — a JSON file exists here; runs in this process with any provider
    * `both`    — the file exists *and* a hosted agent of the same name is in Foundry
    * `foundry` — hosted only: it exists in Foundry with no local file (made in the portal)
    * `unknown` — we could not ask Foundry (key auth cannot query the Agent Service)

    The last state is deliberate: under `AZURE_AI_AUTH=key` the answer is genuinely
    unknown, and reporting "not deployed" would be a guess.
    """
    personas = list_personas()
    availability = foundry_agent.availability()

    hosted_by_name: dict[str, dict] = {}
    if availability["available"]:
        try:
            hosted_by_name = {a["name"]: a for a in foundry_agent.list_hosted()}
        except Exception as e:                    # noqa: BLE001 - degrade, never guess
            availability = {"available": False, "reason": f"{type(e).__name__}: {e}"}

    summaries: list[PersonaSummary] = []
    for p in personas:
        hosted = hosted_by_name.get(p.name)
        runs_on = "unknown" if not availability["available"] else ("both" if hosted else "local")
        summaries.append(PersonaSummary(**p.summary(), runs_on=runs_on,
                                        hosted=HostedAgent(**hosted) if hosted else None))

    local_names = {p.name for p in personas}
    hosted_only = [
        PersonaSummary(
            name=a["name"], display_name=a["name"],
            description=a.get("description") or "Created in Foundry — no local persona file.",
            runs_on="foundry", hosted=HostedAgent(**a),
        )
        for name, a in hosted_by_name.items() if name not in local_names
    ]

    return AgentListResponse(
        active_mode=settings.agent_mode,
        default_persona=settings.agent_persona,
        personas_dir=str(PERSONA_DIR),
        count=len(summaries),
        personas=summaries,
        foundry=FoundryAvailability(**availability),
        hosted_only=hosted_only,
    )


@app.get("/agents/hosted", tags=["5 · agents"])
def agents_hosted() -> dict:
    """What actually exists in the Foundry Agent Service right now — whatever
    created it: our scripts, the SDK, or somebody clicking in the portal."""
    availability = foundry_agent.availability()
    if not availability["available"]:
        raise HTTPException(status_code=503, detail=availability["reason"])
    try:
        return {"count": len(items := foundry_agent.list_hosted()), "agents": items}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not list hosted agents: {e}")


@app.delete("/agents/hosted/{agent_id}", tags=["5 · agents"])
def agent_hosted_delete(agent_id: str) -> dict:
    """Remove an agent from Foundry. The local JSON file is untouched — the
    persona keeps working in local mode."""
    try:
        foundry_agent.delete_hosted(agent_id)
    except foundry_agent.FoundryUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not delete agent: {e}")
    return {"deleted": True, "agent_id": agent_id}


@app.get("/agents/{name}", tags=["5 · agents"])
def agent_detail(name: str) -> dict:
    """One persona, including **the exact system prompt** its JSON produces —
    grounded and ungrounded. The clearest way to see JSON become behaviour."""
    try:
        persona = load_persona(name)
    except PersonaNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        **persona.summary(),
        "system_prompt_plain": persona.system_prompt(grounded=False),
        "system_prompt_grounded": persona.system_prompt(grounded=True),
        "file": str(PERSONA_DIR / f"{name}.json"),
    }


@app.post("/agents/{name}/deploy", tags=["5 · agents"])
def agent_deploy(name: str) -> dict:
    """Publish this persona to the Azure AI Foundry **Agent Service**.

    The same thing `python scripts/deploy_agent.py <name>` does — exposed here so
    it can be demonstrated from Swagger. Requires AZURE_AI_PROJECT_ENDPOINT and
    an Entra identity with the Azure AI User role on the project.
    """
    try:
        persona = load_persona(name)
    except PersonaNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    try:
        result = foundry_agent.deploy(persona)
    except foundry_agent.FoundryUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Deployment to Foundry failed: {e}")
    result["next_step"] = (
        f"Put FOUNDRY_AGENT_ID={result['agent_id']} in .env, then call /ask with "
        f'"agent_mode": "foundry".'
    )
    return result


# --- tools / specialist services ----------------------------------------------
_SUGGEST_SYSTEM = (
    "You clean up rough chat drafts before they are sent to a banking assistant. Rewrite the "
    "draft as a single, clear, well-formed question or request — same language, same intent, "
    "no new facts or questions invented. Reply with the rewrite alone, no quotes, no preamble. "
    "If the draft is already clear, or too short or ambiguous to safely rewrite, "
    "reply with exactly: NONE"
)


@app.post("/tools/suggest", response_model=SuggestResponse, tags=["6 · tools"],
         dependencies=[Depends(rate_limit_dependency(_suggest_limiter))])
def suggest(req: SuggestRequest) -> SuggestResponse:
    """The "did you mean" popup above the composer: one small, fast model call that
    turns a rough draft into a clean question, or says NONE when there is nothing
    worth changing. Same provider/model as /ask — whatever LLM_PROVIDER points at."""
    draft = req.draft.strip()
    llm = get_llm()
    if len(draft) < 8:
        return SuggestResponse(suggestion=None, provider=llm.provider, model=llm.model)
    # Reasoning models (the gpt-5 family — e.g. gpt-5-mini) spend part of max_tokens
    # thinking before they write a word of visible output. Without a cap on that, a
    # short rewrite like this one can burn the whole budget on hidden reasoning and
    # come back with an empty answer — silently, since that just looks like "no
    # suggestion needed". reasoning_extras() (llm.py) is what keeps output tokens
    # available — same helper local_agent.py uses for /ask.
    #
    # Pinned to "low", not the library default ("minimal"): measured directly against
    # this route, "minimal" too often judges a genuine Romanian typo ("credti",
    # "doban da") as fine and replies NONE — not a token-budget failure, a judgment
    # one. "low" catches all of them correctly and still finishes in well under 300
    # tokens, nowhere near the "medium" blow-the-budget failure mode either.
    extras = reasoning_extras(llm.model, override="low")
    try:
        result = llm.chat(system=_SUGGEST_SYSTEM, user=draft, temperature=0.2,
                          max_tokens=300, extras=extras)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Suggestion failed: {e}")
    text = result.text.strip().strip('"')
    same = text.strip().lower().rstrip(".?!") == draft.lower().rstrip(".?!")
    suggestion = None if not text or text.upper() == "NONE" or same else text
    return SuggestResponse(suggestion=suggestion, provider=result.provider, model=result.model)


@app.post("/tools/web-fetch", response_model=ScrapeResponse, tags=["6 · tools"],
         dependencies=[Depends(rate_limit_dependency(_tools_limiter))])
def web_fetch(req: ScrapeRequest) -> ScrapeResponse:
    """Fetch a page and strip it to text — **the do-it-yourself lane**.

    Read the `warnings` array: it lists everything this naive approach could not
    handle (JavaScript rendering, bot walls, consent banners, non-HTML formats).
    That list is the argument for a managed grounding tool.
    """
    try:
        result = web.scrape(req.url, max_chars=req.max_chars or 20000)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Fetch failed: {e}")
    return ScrapeResponse(**result.__dict__)


@app.post("/tools/speak", tags=["6 · tools"],
          responses={200: {"content": {"audio/wav": {}}, "description": "WAV audio"}},
          dependencies=[Depends(rate_limit_dependency(_tools_limiter))])
def speak(req: SpeakRequest):
    """Text → speech (Azure AI Speech). Returns a WAV file you can play or download."""
    try:
        audio = speech.synthesize(req.text, req.voice)
    except speech.SpeechUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Speech synthesis failed: {e}")
    return Response(content=audio, media_type="audio/wav",
                    headers={"Content-Disposition": 'inline; filename="libra-assist.wav"'})


@app.post("/tools/web-search", response_model=WebSearchResponse, tags=["6 · tools"],
         dependencies=[Depends(rate_limit_dependency(_tools_limiter))])
def web_search(req: WebSearchRequest) -> WebSearchResponse:
    """Search the open web — **without an API key**.

    The managed option is *Grounding with Bing Search*, a Foundry agent tool. It
    needs a subscription eligible for the Bing SKU, which trials and many others
    are not (`SkuNotEligible`). So this keyless engine exists to make the
    capability reachable for everyone — at the cost of being screen scraping,
    with every fragility that implies.
    """
    try:
        hits, provider = web.search(req.query,
                                    max_results=req.max_results or settings.web_search_results)
    except web.WebSearchBlocked as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Web search failed: {e}")
    # Zero hits from the keyless engine is not "nothing matched" — it is the engine
    # declining to answer a scraper. Saying so is the difference between a lesson and
    # a mystery, and it is the case a classroom will hit first, all searching at once.
    keyless = "keyless" in provider
    if not hits and keyless:
        note = ("The engine returned a page with no results in it. That is what screen "
                "scraping looks like under load or from a datacentre IP — the contract is "
                "HTML that can be withheld at any moment, and there is no error to catch. "
                "Set SEARCH_API_KEY to a Brave (api-dashboard.search.brave.com) or Serper "
                "(serper.dev) key — both have free tiers — and this answers every time. "
                "The managed Azure equivalent is Grounding with Bing Search, which needs a "
                "Bing-eligible subscription.")
    elif keyless:
        note = ("Set SEARCH_API_KEY (Brave or Serper, both have free tiers) for a managed "
                "provider that answers every time. Without one this is screen scraping and "
                "will be rate-limited — which is the lesson, not a defect.")
    else:
        note = ("Answered by a managed search API: a documented contract, a quota, and "
                "results every time. Compare with the keyless path by clearing SEARCH_API_KEY.")
    return WebSearchResponse(
        query=req.query, provider=provider, count=len(hits),
        results=[WebSearchHit(**h.__dict__) for h in hits],
        note=note,
    )


@app.post("/tools/azure-search/sync", tags=["7 · Azure AI Search"],
         dependencies=[Depends(rate_limit_dependency(_tools_limiter))])
def azure_search_sync(req: AzureSearchSyncRequest) -> dict:
    """Chunk, embed and push into **Azure AI Search** instead of the local store.

    The same chunks and the same vectors as `/ingest` — only the destination
    changes. That is the point: migrating store is mechanical; what you gain is
    keyword search, filters and access rules.
    """
    pieces, params = _do_chunk(req)
    if not pieces:
        raise HTTPException(status_code=422, detail="No chunks produced — is the text empty?")
    vectors = _embed(pieces)
    try:
        aisearch.ensure_index(len(vectors[0]))
        uploaded = aisearch.upload(pieces, vectors, req.source, params["strategy"], req.allowed_groups)
    except aisearch.SearchUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {
        "uploaded": uploaded, "index": settings.azure_search_index,
        "vector_dimension": len(vectors[0]), "strategy": params["strategy"],
        "source": req.source, "documents_in_index": aisearch.count(),
    }


@app.post("/tools/azure-search/query", tags=["7 · Azure AI Search"],
         dependencies=[Depends(rate_limit_dependency(_tools_limiter))])
def azure_search_query(req: AzureSearchQueryRequest) -> dict:
    """Keyword, vector or **hybrid** search — run the same query three ways and
    compare. Hybrid is where exact terms and paraphrases both land."""
    text = req.query if req.mode in ("keyword", "hybrid") else ""
    vector = _embed([req.query])[0] if req.mode in ("vector", "hybrid") else None
    try:
        hits = aisearch.query(text, vector, top=req.top or settings.top_k,
                              filter_expression=req.filter, semantic=req.semantic)
    except aisearch.SearchUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {"query": req.query, "mode": req.mode, "count": len(hits), "hits": hits,
            "index": settings.azure_search_index}


@app.get("/tools/azure-search", tags=["7 · Azure AI Search"])
def azure_search_status() -> dict:
    """Is it configured, and how many documents does the index hold?"""
    return aisearch.describe()


@app.post("/tools/transcribe", response_model=TranscribeResponse, tags=["6 · tools"],
         dependencies=[Depends(rate_limit_dependency(_tools_limiter))])
async def transcribe(file: UploadFile = File(..., description="WAV, 16 kHz mono, under ~60 s")):
    """Speech → text (Azure AI Speech). Upload the WAV you just generated and
    watch it come back as text — the round trip in two calls."""
    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=422, detail="The uploaded file is empty.")
    try:
        result = speech.transcribe(audio, content_type=file.content_type or "audio/wav")
    except speech.SpeechUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")
    return TranscribeResponse(**result)


# --- banking calculators --------------------------------------------------------
# Plain arithmetic (see app/finance.py) — not a model call, so no LLM cost, no
# hallucination risk, and no rate limit tied to the LLM-backed tools above; still
# behind _tools_limiter since it's the same "don't get hammered" concern as any
# other route.
@app.post("/tools/loan-payment", response_model=LoanPaymentResponse, tags=["6 · tools"],
         dependencies=[Depends(rate_limit_dependency(_tools_limiter))])
def loan_payment(req: LoanPaymentRequest) -> LoanPaymentResponse:
    """Fixed-rate loan monthly payment — principal, annual rate, term in years.
    The exact calculation for the class of question ("80,000 euros, 30 years,
    fixed rate") that a RAG lookup over product docs can't actually answer."""
    return LoanPaymentResponse(**finance.loan_payment(
        req.principal, req.annual_rate_percent, req.years))


@app.post("/tools/loan-payoff", response_model=LoanPayoffResponse, tags=["6 · tools"],
         dependencies=[Depends(rate_limit_dependency(_tools_limiter))])
def loan_payoff(req: LoanPayoffRequest) -> LoanPayoffResponse:
    """The inverse of /tools/loan-payment: given what you can actually pay each
    month, how long until the loan is paid off."""
    try:
        return LoanPayoffResponse(**finance.loan_payoff(
            req.principal, req.annual_rate_percent, req.monthly_payment))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/tools/savings-growth", response_model=SavingsGrowthResponse, tags=["6 · tools"],
         dependencies=[Depends(rate_limit_dependency(_tools_limiter))])
def savings_growth(req: SavingsGrowthRequest) -> SavingsGrowthResponse:
    """Compound growth of a deposit plus an optional fixed monthly contribution,
    compounded monthly — the savings-side counterpart to the two loan tools above."""
    return SavingsGrowthResponse(**finance.savings_growth(
        req.principal, req.annual_rate_percent, req.years, req.monthly_contribution))


# --- contract extraction ---------------------------------------------------------
@app.post("/tools/contract-extract", response_model=ContractExtractResponse, tags=["6 · tools"],
         dependencies=[Depends(rate_limit_dependency(_tools_limiter))])
async def contract_extract(file: UploadFile = File(..., description="A contract as PDF — credit, employment, real estate, or anything else")):
    """Pull the practically important facts out of a dense, formal contract: parties,
    duration, amounts, obligations, penalties, and anything worth a second look. A
    one-shot read — the file's text is sent to the model and the result returned;
    nothing is written to Qdrant or the knowledge base, unlike /ingest."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="The uploaded file is empty.")
    try:
        text, truncated = contracts.extract_text(data)
    except contracts.PdfUnreadable as e:
        raise HTTPException(status_code=422, detail=str(e))
    if not text.strip():
        raise HTTPException(status_code=422, detail="No extractable text found in this PDF — "
                             "it may be a scanned image with no text layer (OCR isn't wired up here).")

    llm = get_llm()
    extras = reasoning_extras(llm.model, override="low")
    try:
        result = llm.chat(system=contracts.SYSTEM_PROMPT, user=text, temperature=0.1,
                          max_tokens=1500, extras=extras)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Extraction failed: {e}")
    try:
        fields = contracts.parse_response(result.text)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return ContractExtractResponse(**fields, truncated=truncated, chars_analyzed=len(text))
