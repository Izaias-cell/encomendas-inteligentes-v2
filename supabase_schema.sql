-- SQL para o Banco de Dados Supabase (PostgreSQL)

-- Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabela de Condomínios
CREATE TABLE condominiums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Perfis (Moradores, Porteiros, Síndicos)
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Removido REFERENCES auth.users(id) para permitir login de demonstração
  full_name TEXT NOT NULL,
  phone TEXT,
  condominium_id UUID REFERENCES condominiums(id),
  role TEXT CHECK (role IN ('resident', 'concierge', 'manager', 'admin', 'porteiro', 'sindico')) DEFAULT 'resident',
  unit_number TEXT, -- Apartamento/Casa (Legacy/Full string)
  unit_type TEXT, -- casa, lote, ap, etc
  unit_number_val TEXT, -- apenas o número
  block TEXT,
  tower TEXT,
  complement TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Encomendas
CREATE TABLE packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id UUID REFERENCES condominiums(id) NOT NULL,
  recipient_id UUID REFERENCES profiles(id),
  recipient_name_raw TEXT,
  unit_number_raw TEXT, -- Legacy/Full string
  unit_type TEXT,
  unit_number_val TEXT,
  block TEXT,
  tower TEXT,
  complement TEXT,
  carrier TEXT,
  tracking_code TEXT,
  status TEXT CHECK (status IN ('received', 'notified', 'delivered')) DEFAULT 'received',
  photo_url TEXT,
  received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  delivered_at TIMESTAMP WITH TIME ZONE,
  received_by UUID REFERENCES profiles(id),
  delivered_to_name TEXT,
  notes TEXT,
  pickup_token TEXT,
  pickup_qr_code TEXT DEFAULT 'active',
  qr_code_generated_at TIMESTAMP WITH TIME ZONE,
  pickup_code TEXT,
  whatsapp_status TEXT DEFAULT 'pending',
  last_notification_at TIMESTAMP WITH TIME ZONE,
  delivery_method TEXT,
  retrieved_at TIMESTAMP WITH TIME ZONE,
  retrieved_by_user_id UUID REFERENCES profiles(id)
);

-- Função para gerar código de retirada aleatório (6 dígitos)
CREATE OR REPLACE FUNCTION generate_pickup_code() RETURNS TEXT AS $
DECLARE
  chars TEXT := '0123456789';
  result TEXT := '';
  i INTEGER := 0;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$ LANGUAGE plpgsql;

-- Trigger para preencher campos automáticos na inserção de encomendas
CREATE OR REPLACE FUNCTION before_package_insert() RETURNS TRIGGER AS $
BEGIN
  IF NEW.pickup_code IS NULL THEN
    NEW.pickup_code := generate_pickup_code();
  END IF;
  IF NEW.pickup_token IS NULL THEN
    NEW.pickup_token := encode(gen_random_bytes(16), 'hex');
  END IF;
  IF NEW.qr_code_generated_at IS NULL THEN
    NEW.qr_code_generated_at := NOW();
  END IF;
  RETURN NEW;
END;
$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_before_package_insert ON packages;
CREATE TRIGGER trg_before_package_insert
BEFORE INSERT ON packages
FOR EACH ROW
EXECUTE FUNCTION before_package_insert();

-- Função RPC para enfileirar notificação WhatsApp
CREATE OR REPLACE FUNCTION enfileirar_notificacao_whatsapp(p_encomenda_id UUID)
RETURNS VOID AS $
BEGIN
  -- Atualiza o status para pendente e registra o momento da solicitação
  UPDATE packages 
  SET whatsapp_status = 'pending', 
      last_notification_at = NOW()
  WHERE id = p_encomenda_id;
END;
$ LANGUAGE plpgsql;

-- Tabela de Configurações do Condomínio
CREATE TABLE condominium_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condominium_id UUID REFERENCES condominiums(id) UNIQUE,
  notification_template TEXT,
  reminder_48h_enabled BOOLEAN DEFAULT TRUE,
  reminder_72h_enabled BOOLEAN DEFAULT TRUE,
  light_mode_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Logs de Mensagens
CREATE TABLE message_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone TEXT,
  status TEXT,
  erro_api TEXT,
  data_envio TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Notificações
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  message TEXT,
  status TEXT,
  delivery_channel TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Conversas WhatsApp
CREATE TABLE whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT,
  message TEXT,
  direction TEXT, -- 'inbound' ou 'outbound'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Logs de Retirada
CREATE TABLE retrieval_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID REFERENCES packages(id),
  porter_id UUID REFERENCES profiles(id),
  delivery_method TEXT, -- 'qr_code' ou 'manual'
  status TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Tokens de Acesso do Morador
CREATE TABLE resident_access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id UUID REFERENCES profiles(id) NOT NULL,
  condominium_id UUID REFERENCES condominiums(id) NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE condominiums ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE condominium_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert message logs" ON message_logs
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Staff can view message logs" ON message_logs
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('concierge', 'manager', 'admin', 'porteiro', 'sindico')
    )
  );
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE retrieval_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE resident_access_tokens ENABLE ROW LEVEL SECURITY;

-- POLÍTICAS DE SEGURANÇA (RLS)

-- Condomínios: Usuários podem ver o condomínio ao qual pertencem
CREATE POLICY "Users can view their own condominium" ON condominiums
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.condominium_id = condominiums.id
    )
  );

-- Perfis: Usuários podem ver perfis do mesmo condomínio
CREATE POLICY "Profiles are viewable by members of the same condominium" ON profiles
  FOR SELECT USING (
    id = auth.uid() OR
    condominium_id = (
      SELECT p.condominium_id 
      FROM profiles p 
      WHERE p.id = auth.uid()
      LIMIT 1
    )
  );

-- Perfis: Porteiros, Síndicos e Admins podem cadastrar moradores
CREATE POLICY "Staff can insert resident profiles" ON profiles
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.condominium_id = profiles.condominium_id
      AND p.role IN ('concierge', 'manager', 'admin')
    )
    AND role = 'resident'
  );

-- Perfis: Porteiros, Síndicos e Admins podem editar moradores
CREATE POLICY "Staff can update resident profiles" ON profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.condominium_id = profiles.condominium_id
      AND p.role IN ('concierge', 'manager', 'admin')
    )
    AND role = 'resident'
  );

-- Encomendas: Porteiros, Síndicos e Admins podem gerenciar tudo no seu condomínio
CREATE POLICY "Staff can manage packages in their condo" ON packages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (profiles.role = 'admin' OR profiles.condominium_id = packages.condominium_id)
      AND profiles.role IN ('concierge', 'manager', 'admin', 'porteiro', 'sindico')
    )
  );

-- Encomendas: Moradores podem ver suas próprias encomendas
CREATE POLICY "Residents can view their own packages" ON packages
  FOR SELECT USING (
    recipient_id = auth.uid() OR
    unit_number_raw = (
      SELECT p.unit_number 
      FROM profiles p 
      WHERE p.id = auth.uid()
      LIMIT 1
    )
  );

-- INSERIR DADOS DE DEMONSTRAÇÃO (Opcional, para testar sem criar contas reais)
INSERT INTO condominiums (id, name, address) 
VALUES ('00000000-0000-0000-0000-000000000000', 'Condomínio de Demonstração', 'Rua Exemplo, 123')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, full_name, role, condominium_id, unit_number)
VALUES ('00000000-0000-0000-0000-000000000001', 'Porteiro Silva (Demo)', 'concierge', '00000000-0000-0000-0000-000000000000', 'Portaria')
ON CONFLICT (id) DO NOTHING;

-- POLÍTICA ADICIONAL PARA DEMONSTRAÇÃO (Permitir que o usuário de demo gerencie encomendas)
CREATE POLICY "Demo concierge access" ON packages
  FOR ALL USING (condominium_id = '00000000-0000-0000-0000-000000000000');

CREATE POLICY "Demo profiles access" ON profiles
  FOR SELECT USING (condominium_id = '00000000-0000-0000-0000-000000000000');

-- ==========================================
-- CONFIGURAÇÃO DE STORAGE (SUPABASE)
-- ==========================================

-- 1. Criar o bucket 'packages' se não existir
-- Nota: Em alguns ambientes Supabase, isso deve ser feito via Dashboard ou API de Admin
-- Mas incluímos aqui para referência e automação se possível via SQL
INSERT INTO storage.buckets (id, name, public)
VALUES ('packages', 'packages', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Políticas para o bucket 'packages' na tabela storage.objects

-- Permitir acesso público para leitura (SELECT)
-- Isso permite que qualquer pessoa veja as fotos das encomendas se tiver o link
CREATE POLICY "Public Access" ON storage.objects
  FOR SELECT USING (bucket_id = 'packages');

-- Permitir que usuários autenticados façam upload (INSERT)
CREATE POLICY "Authenticated Upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'packages' AND
    (auth.role() = 'authenticated' OR auth.role() = 'anon') -- Permitir anon para facilitar demo se necessário
  );

-- Permitir que usuários autenticados atualizem (UPDATE)
-- Necessário se 'upsert: true' for usado
CREATE POLICY "Authenticated Update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'packages' AND
    (auth.role() = 'authenticated' OR auth.role() = 'anon')
  );

-- Permitir que usuários autenticados excluam (DELETE)
CREATE POLICY "Authenticated Delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'packages' AND
    (auth.role() = 'authenticated' OR auth.role() = 'anon')
  );
