#!/usr/bin/env python3
"""Builds the K1 Parlant agent with no LLM: embeddings are zero vectors and every generation call fails loudly.

  python3 parlant/check_build.py

It proves that the catalog, the journey, the glossary, the canned responses and the tool wiring are valid for the
installed Parlant SDK. It says nothing about how the agent talks; that needs a real model (k1_agent.py with K1_PARLANT_NLP).
"""
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault('OPENAI_API_KEY', 'sk-offline-check')
os.environ['K1_PARLANT_NLP'] = 'openai'
os.environ.setdefault('PARLANT_HOME', '/tmp/parlant-check-home')

from parlant.core.nlp import embedding, generation  # noqa: E402
from parlant.adapters.nlp import openai_service  # noqa: E402

GENERATIONS = []


async def zero_embed(self, texts, hints={}):
    return embedding.EmbeddingResult(vectors=[[0.0] * self.dimensions for _ in texts])


async def refuse_generation(self, *args, **kwargs):
    GENERATIONS.append(type(self).__name__)
    raise RuntimeError('offline check: no LLM')


for cls in vars(openai_service).values():
    if isinstance(cls, type) and issubclass(cls, embedding.BaseEmbedder) and cls is not embedding.BaseEmbedder:
        cls.do_embed = zero_embed
    if isinstance(cls, type) and issubclass(cls, generation.BaseSchematicGenerator) and cls is not generation.BaseSchematicGenerator:
        cls.do_generate = refuse_generation

sys.path.insert(0, str(Path(__file__).resolve().parent))
import k1_agent  # noqa: E402
import parlant.sdk as p  # noqa: E402
import yaml  # noqa: E402


async def main():
    catalog = yaml.safe_load(k1_agent.CATALOG.read_text())
    server = p.Server(nlp_service=k1_agent.nlp_service(), configure_api=k1_agent.configure_api,
                      port=int(os.environ.get('K1_PARLANT_PORT', '8811')), tool_service_port=8819)
    async with server:
        agent = await server.create_agent(name=k1_agent.AGENT_NAME, description='offline check', composition_mode=p.CompositionMode.FLUID,
                                          perceived_performance_policy=p.NullPerceivedPerformancePolicy())
        await agent.create_variable(name='lead_context', description='lead', tool=k1_agent.tools.get_lead_context)
        for name, description, synonyms in k1_agent.GLOSSARY:
            await agent.create_term(name=name, description=description, synonyms=synonyms)
        made = await k1_agent.build_guidelines(agent, catalog)
        journey = await k1_agent.build_booking_journey(agent)
        core = sum(1 for g in catalog['guidelines'] if g.get('core'))
        tooled = sum(1 for rid in made if k1_agent.TOOLS_FOR.get(rid))
        relations = sum(len(g.get('excludes') or []) + len(g.get('depends_on') or []) for g in catalog['guidelines'])
        print(f'ok: {len(made)} guidelines ({core} always on, {tooled} with tools), {relations} relationships, '
              f'journey "{journey.title}", {len(k1_agent.GLOSSARY)} terms', flush=True)
        os._exit(0)


if __name__ == '__main__':
    asyncio.run(main())
