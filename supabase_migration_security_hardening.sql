-- ============================================================================
-- ENCOMENDAS INTELIGENTES — MIGRAÇÃO SQL DE SEGURANÇA, INTEGRIDADE E PRODUÇÃO
-- IMPORTANTE:
--   1. NÃO EXECUTADO AUTOMATICAMENTE. Revisar e validar primeiro em STAGING.
--   2. Executar com backup/snapshot prévio do banco Supabase/PostgreSQL.
--   3. Todas as alterações estruturais utilizam IF NOT EXISTS / salvaguardas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PRÉ-VERIFICAÇÕES (EXECUTAR ANTES DA MIGRAÇÃO PARA CONFERIR DADOS)
-- ----------------------------------------------------------------------------
-- Verificar eventuais códigos ou tokens de portaria duplicados antes de criar índices únicos:
SELECT UPPER(TRIM(portaria_access_code)) AS code_norm, COUNT(*) AS qtd
FROM condominium_settings
WHERE portaria_access_code IS NOT NULL AND TRIM(portaria_access_code) <> ''
GROUP BY UPPER(TRIM(portaria_access_code))
HAVING COUNT(*) > 1;

SELECT active_portaria_token, COUNT(*) AS qtd
FROM condominium_settings
WHERE active_portaria_token IS NOT NULL AND TRIM(active_portaria_token) <> ''
GROUP BY active_portaria_token
HAVING COUNT(*) > 1;

-- Verificar existência de registros órfãos antes de consolidar integridade:
SELECT COUNT(*) AS orphaned_profiles
FROM profiles p
LEFT JOIN condominiums c ON c.id = p.condominium_id
WHERE p.condominium_id IS NOT NULL AND c.id IS NULL;

SELECT COUNT(*) AS orphaned_packages
FROM packages pkg
LEFT JOIN condominiums c ON c.id = pkg.condominium_id
WHERE pkg.condominium_id IS NOT NULL AND c.id IS NULL;

-- ----------------------------------------------------------------------------
-- 2. COLUNAS DE COMPATIBILIDADE, IDEMPOTÊNCIA E AUDITORIA
-- ----------------------------------------------------------------------------
BEGIN;

-- 2.1 condominiums
ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;
ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS city_state TEXT;
ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS manager_name TEXT;
ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS manager_phone TEXT;
ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS manager_email TEXT;
ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS rules TEXT;
ALTER TABLE condominiums ADD COLUMN IF NOT EXISTS internal_notes TEXT;

-- 2.2 condominium_settings
ALTER TABLE condominium_settings ADD COLUMN IF NOT EXISTS api_url TEXT;
ALTER TABLE condominium_settings ADD COLUMN IF NOT EXISTS api_token TEXT;
ALTER TABLE condominium_settings ADD COLUMN IF NOT EXISTS instance_id TEXT;
ALTER TABLE condominium_settings ADD COLUMN IF NOT EXISTS whatsapp_provider TEXT;
ALTER TABLE condominium_settings ADD COLUMN IF NOT EXISTS whatsapp_mode TEXT;

-- 2.3 packages (campos usados em runtime)
ALTER TABLE packages ADD COLUMN IF NOT EXISTS unit_number TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS recebido_por TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS porter_name TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS whatsapp_notified BOOLEAN DEFAULT FALSE;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS whatsapp_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS whatsapp_message TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS delivery_photo_url TEXT;

-- 2.4 message_logs
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS condominium_id UUID REFERENCES condominiums(id);
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS status_envio TEXT;
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

-- 2.5 whatsapp_conversations
ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS condominium_id UUID REFERENCES condominiums(id);

-- ----------------------------------------------------------------------------
-- 3. TABELA DEDICADA PARA IDEMPOTÊNCIA DO WEBHOOK WHATSAPP / META
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL, -- 'status' | 'message'
  provider_message_id TEXT,
  status_value TEXT,
  payload JSONB,
  processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 4. ÍNDICES PARCIAIS ÚNICOS PARA CREDENCIAIS DA PORTARIA E DESEMPENHO
-- ----------------------------------------------------------------------------
-- Garante unicidade case-insensitive do código da portaria e evita colisão de tokens ativos
CREATE UNIQUE INDEX IF NOT EXISTS ux_condominium_settings_portaria_code
  ON condominium_settings (UPPER(TRIM(portaria_access_code)))
  WHERE portaria_access_code IS NOT NULL AND TRIM(portaria_access_code) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS ux_condominium_settings_active_portaria_token
  ON condominium_settings (active_portaria_token)
  WHERE active_portaria_token IS NOT NULL AND TRIM(active_portaria_token) <> '';

-- Índices operacionais adicionais para logs por condomínio
CREATE INDEX IF NOT EXISTS idx_message_logs_condo_data
  ON message_logs (condominium_id, data_envio DESC);

CREATE INDEX IF NOT EXISTS idx_auditoria_tipo_registro
  ON auditoria_eventos (tipo_evento, registro_id, criado_em DESC);

-- ----------------------------------------------------------------------------
-- 5. HARDENING DE RLS (REMOVER POLÍTICAS PERMISSIVAS DE DEMONSTRAÇÃO/ANON)
-- ATENÇÃO: Verificar primeiro que todos os fluxos de Portaria/Portal usam as rotas
--          de API protegidas (/api/portal/*, /api/packages/create, etc.) com
--          SUPABASE_SERVICE_ROLE_KEY no servidor antes de aplicar DROP POLICY abaixo.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Demo concierge access" ON packages;
DROP POLICY IF EXISTS "Demo profiles access" ON profiles;

-- Restringir upload/alteração no Storage 'packages' apenas a usuários autenticados (removendo anon)
DROP POLICY IF EXISTS "Authenticated Upload" ON storage.objects;
CREATE POLICY "Authenticated Upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'packages' AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "Authenticated Update" ON storage.objects;
CREATE POLICY "Authenticated Update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'packages' AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "Authenticated Delete" ON storage.objects;
CREATE POLICY "Authenticated Delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'packages' AND auth.role() = 'authenticated'
  );

-- Impedir leitura anônima direta na tabela residente/tokens caso políticas amplas existam:
-- (O Portal do Morador consulta exclusivamente via backend /api/portal/* autenticado com service_role)
DROP POLICY IF EXISTS "Public read packages" ON packages;
DROP POLICY IF EXISTS "Public read moradores" ON moradores;
DROP POLICY IF EXISTS "Public read resident_access_tokens" ON resident_access_tokens;

COMMIT;

-- ============================================================================
-- 6. PROCEDIMENTO DE ROLLBACK (EM CASO DE NECESSIDADE)
-- ============================================================================
/*
BEGIN;

DROP INDEX IF EXISTS ux_condominium_settings_portaria_code;
DROP INDEX IF EXISTS ux_condominium_settings_active_portaria_token;
DROP INDEX IF EXISTS idx_message_logs_condo_data;
DROP INDEX IF EXISTS idx_auditoria_tipo_registro;

DROP TABLE IF EXISTS whatsapp_webhook_events;

ALTER TABLE message_logs DROP COLUMN IF EXISTS condominium_id;
ALTER TABLE message_logs DROP COLUMN IF EXISTS status_envio;
ALTER TABLE message_logs DROP COLUMN IF EXISTS provider_message_id;

ALTER TABLE whatsapp_conversations DROP COLUMN IF EXISTS condominium_id;

COMMIT;
*/
