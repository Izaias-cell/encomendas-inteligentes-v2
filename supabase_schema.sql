-- ============================================================================
-- PROJETO PRISMAS — ESQUEMA COMPLETO SUPABASE POSTGRESQL
-- MODO DE PERSISTÊNCIA OFICIAL E DEFINITIVO
-- ============================================================================

-- 1. TIPOS ENUMERADOS
DO $$ BEGIN
    CREATE TYPE prisma_estado AS ENUM ('DISPONIVEL', 'EM_USO', 'PENDENTE', 'INDISPONIVEL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE movimentacao_tipo AS ENUM ('ENTREGA', 'DEVOLUCAO', 'PENDENCIA_ABERTA', 'PENDENCIA_RESOLVIDA', 'INDISPONIBILIDADE', 'CORRECAO');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('PORTEIRO', 'SINDICO', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE tipo_turno AS ENUM ('12X36', 'COMERCIAL', 'PERSONALIZADO');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE paridade_12x36 AS ENUM ('IMPAR', 'PAR');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE categoria_contato AS ENUM ('SINDICO', 'PORTARIA', 'GRUPO_PORTARIA', 'OUTRO');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE tipo_acesso AS ENUM ('PORTARIA', 'ADMIN', 'SINDICO');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;


-- 2. TABELA: CONDOMINIOS
CREATE TABLE IF NOT EXISTS condominios (
    id VARCHAR(64) PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    endereco VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABELA: USUARIOS
CREATE TABLE IF NOT EXISTS usuarios (
    id VARCHAR(64) PRIMARY KEY,
    condominio_id VARCHAR(64) NOT NULL REFERENCES condominios(id) ON DELETE RESTRICT,
    nome VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'PORTEIRO',
    cargo VARCHAR(255) NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    matricula VARCHAR(64),
    tipo_turno tipo_turno DEFAULT '12X36',
    opcao_turno_12x36 VARCHAR(32),
    paridade_12x36 paridade_12x36,
    hora_inicio VARCHAR(10),
    hora_fim VARCHAR(10),
    excluido BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABELA: PRISMAS
CREATE TABLE IF NOT EXISTS prismas (
    id VARCHAR(64) PRIMARY KEY,
    condominio_id VARCHAR(64) NOT NULL REFERENCES condominios(id) ON DELETE RESTRICT,
    numero VARCHAR(32) NOT NULL,
    cor_id VARCHAR(32) NOT NULL,
    cor_nome VARCHAR(64) NOT NULL,
    estado prisma_estado NOT NULL DEFAULT 'DISPONIVEL',
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    excluido BOOLEAN NOT NULL DEFAULT FALSE,
    data_exclusao TIMESTAMPTZ,
    usuario_exclusao_id VARCHAR(64) REFERENCES usuarios(id),
    usuario_exclusao_nome VARCHAR(255),
    motivo_inativacao TEXT,
    observacao TEXT,
    movimentacao_atual_id VARCHAR(64),
    casa_atual VARCHAR(64),
    horario_entrega_atual TIMESTAMPTZ,
    porteiro_entrega_atual VARCHAR(255),
    foto_entrega_atual TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. TABELA: MOVIMENTACOES
CREATE TABLE IF NOT EXISTS movimentacoes (
    id VARCHAR(64) PRIMARY KEY,
    condominio_id VARCHAR(64) NOT NULL REFERENCES condominios(id) ON DELETE RESTRICT,
    prisma_id VARCHAR(64) NOT NULL REFERENCES prismas(id) ON DELETE RESTRICT,
    prisma_numero VARCHAR(32) NOT NULL,
    prisma_cor_nome VARCHAR(64) NOT NULL,
    tipo movimentacao_tipo NOT NULL,
    casa VARCHAR(64) NOT NULL,
    usuario_id VARCHAR(64) NOT NULL REFERENCES usuarios(id),
    usuario_nome VARCHAR(255) NOT NULL,
    turno_id VARCHAR(64),
    turno_nome VARCHAR(255),
    data_hora TIMESTAMPTZ NOT NULL,
    foto_evidencia_url TEXT,
    estado_anterior prisma_estado NOT NULL,
    estado_posterior prisma_estado NOT NULL,
    movimentacao_anterior_id VARCHAR(64) REFERENCES movimentacoes(id),
    encerrada BOOLEAN NOT NULL DEFAULT FALSE,
    data_hora_encerramento TIMESTAMPTZ,
    usuario_encerramento_id VARCHAR(64) REFERENCES usuarios(id),
    usuario_encerramento_nome VARCHAR(255),
    motivo_correcao TEXT,
    motivo_pendencia TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TABELA: AUDITORIA
CREATE TABLE IF NOT EXISTS auditoria (
    id VARCHAR(64) PRIMARY KEY,
    condominio_id VARCHAR(64) NOT NULL REFERENCES condominios(id) ON DELETE RESTRICT,
    acao VARCHAR(128) NOT NULL,
    prisma_id VARCHAR(64),
    prisma_numero VARCHAR(32),
    prisma_cor_nome VARCHAR(64),
    usuario_id VARCHAR(64) NOT NULL,
    usuario_nome VARCHAR(255) NOT NULL,
    usuario_cargo VARCHAR(255),
    turno_id VARCHAR(64),
    turno_nome VARCHAR(255),
    data_hora TIMESTAMPTZ NOT NULL,
    detalhes TEXT NOT NULL,
    dados_anteriores JSONB,
    dados_novos JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. TABELA: CONTATOS
CREATE TABLE IF NOT EXISTS contatos (
    id VARCHAR(64) PRIMARY KEY,
    condominio_id VARCHAR(64) NOT NULL REFERENCES condominios(id) ON DELETE RESTRICT,
    nome VARCHAR(255) NOT NULL,
    categoria categoria_contato NOT NULL DEFAULT 'PORTARIA',
    telefone_ou_whatsapp VARCHAR(64) NOT NULL,
    identificador VARCHAR(128),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. TABELA: CREDENCIAIS_ACESSO (Camada de Autenticação / PVA-6)
CREATE TABLE IF NOT EXISTS credenciais_acesso (
    id VARCHAR(64) PRIMARY KEY,
    usuario_id VARCHAR(64) NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    condominio_id VARCHAR(64) NOT NULL REFERENCES condominios(id) ON DELETE RESTRICT,
    tipo_acesso tipo_acesso NOT NULL,
    identificador VARCHAR(255) NOT NULL UNIQUE,
    senha_hash TEXT,
    pin_hash TEXT,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    bloqueado BOOLEAN NOT NULL DEFAULT FALSE,
    tentativas_invalidas INTEGER NOT NULL DEFAULT 0,
    ultimo_login TIMESTAMPTZ,
    ultimo_bloqueio TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. ÍNDICES DE ALTA PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_prismas_condo_estado ON prismas(condominio_id, estado, excluido);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_prisma ON movimentacoes(prisma_id, data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_condo ON movimentacoes(condominio_id, data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_condo ON auditoria(condominio_id, data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_credenciais_usuario ON credenciais_acesso(usuario_id);
CREATE INDEX IF NOT EXISTS idx_credenciais_identificador ON credenciais_acesso(identificador);
CREATE INDEX IF NOT EXISTS idx_credenciais_condo ON credenciais_acesso(condominio_id);
CREATE INDEX IF NOT EXISTS idx_credenciais_tipo_acesso ON credenciais_acesso(tipo_acesso);

-- 10. HABILITAR ROW LEVEL SECURITY (RLS)
ALTER TABLE condominios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE prismas ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimentacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE credenciais_acesso ENABLE ROW LEVEL SECURITY;

-- 11. POLÍTICAS DE ACESSO (Permitir acesso completo via Service Role no Backend)
DROP POLICY IF EXISTS "Service role acesso irrestrito condominios" ON condominios;
CREATE POLICY "Service role acesso irrestrito condominios" ON condominios FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role acesso irrestrito usuarios" ON usuarios;
CREATE POLICY "Service role acesso irrestrito usuarios" ON usuarios FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role acesso irrestrito prismas" ON prismas;
CREATE POLICY "Service role acesso irrestrito prismas" ON prismas FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role acesso irrestrito movimentacoes" ON movimentacoes;
CREATE POLICY "Service role acesso irrestrito movimentacoes" ON movimentacoes FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role acesso irrestrito auditoria" ON auditoria;
CREATE POLICY "Service role acesso irrestrito auditoria" ON auditoria FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role acesso irrestrito contatos" ON contatos;
CREATE POLICY "Service role acesso irrestrito contatos" ON contatos FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role acesso irrestrito credenciais_acesso" ON credenciais_acesso;
CREATE POLICY "Service role acesso irrestrito credenciais_acesso" ON credenciais_acesso FOR ALL USING (true);


-- 11. STORAGE BUCKET: EVIDENCIAS-PRISMAS (Armazenamento Privado de Fotos)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'evidencias-prismas',
    'evidencias-prismas',
    false,
    10485760, -- Limite de 10MB por foto
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Políticas de Storage para Service Role / Backend
DROP POLICY IF EXISTS "Service role acesso irrestrito evidencias-prismas" ON storage.objects;
CREATE POLICY "Service role acesso irrestrito evidencias-prismas" ON storage.objects
FOR ALL USING (bucket_id = 'evidencias-prismas');

-- 12. TABELA: SCHEMA_VERSION (Controle de Versão Estrutural do Banco)
CREATE TABLE IF NOT EXISTS schema_version (
    version VARCHAR(32) PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE schema_version ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role acesso irrestrito schema_version" ON schema_version;
CREATE POLICY "Service role acesso irrestrito schema_version" ON schema_version FOR ALL USING (true);


