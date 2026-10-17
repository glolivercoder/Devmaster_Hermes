-- ═══════════════════════════════════════════════════════════════════════════
-- Hermes — Memória de contexto por projeto (pgvector)
-- Camada 2: seleção/compressão por relevância + histórico de continuidade.
-- Independente de LLM: embeddings + texto ficam no Postgres; trocar de modelo
-- (Claude/Gemini/Cheaper) não perde nada.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Projetos ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Memórias (checkpoints, decisões, código, contexto, tarefas) ──────────
CREATE TABLE IF NOT EXISTS project_memories (
  id         BIGSERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,              -- checkpoint | decision | code | context | task | doc
  title      TEXT,
  content    TEXT NOT NULL,
  tags       TEXT[] NOT NULL DEFAULT '{}',
  embedding  VECTOR(1536),               -- OpenAI text-embedding-3-small / Gemini@1536
  metadata   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Estado de continuidade ("onde o código parou") ────────────────────────
CREATE TABLE IF NOT EXISTS project_state (
  project_id  INT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  last_task   TEXT,
  last_files  TEXT[] NOT NULL DEFAULT '{}',
  next_steps  TEXT,
  embedding   VECTOR(1536),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Índices ───────────────────────────────────────────────────────────────
-- HNSW: busca por similaridade de cosseno acelerada (mantida incrementalmente).
CREATE INDEX IF NOT EXISTS idx_memories_embedding
  ON project_memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_memories_project
  ON project_memories (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_kind
  ON project_memories (project_id, kind);
CREATE INDEX IF NOT EXISTS idx_state_embedding
  ON project_state USING hnsw (embedding vector_cosine_ops);
