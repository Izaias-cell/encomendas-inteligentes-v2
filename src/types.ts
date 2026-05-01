export type Role = 'resident' | 'porteiro' | 'sindico' | 'admin';

export interface Profile {
  id: string;
  full_name: string;
  phone: string;
  condominium_id: string;
  role: Role;
  email?: string;
  unit?: string;
  unit_type?: string;
  unidade?: string;
  block?: string;
  tower?: string;
  street?: string;
  complement?: string;
  active: boolean;
  is_teste?: boolean;
  must_change_password?: boolean;
  horario_inicio?: string;
  horario_fim?: string;
  created_by?: string;
  updated_by?: string;
  created_at: string;
  updated_at?: string;
}

export interface AuditLog {
  id: string;
  condominio_id: string;
  usuario_id: string;
  usuario_nome: string;
  usuario_perfil: string;
  tipo_evento: string;
  acao: string;
  tabela_afetada: string;
  registro_id: string;
  descricao: string;
  metodo: string;
  dados_antes?: any;
  dados_depois?: any;
  criado_em: string;
}

export interface Morador {
  id: string;
  nome: string;
  unidade: string;
  unit_type?: string;
  block?: string;
  bloco?: string;
  lote?: string;
  street?: string;
  telefone: string;
  ativo: boolean;
  is_teste?: boolean;
  observacoes?: string;
  created_at: string;
  condominium_id?: string;
}

export interface ScoredResident {
  resident: Morador;
  score: number;
}

export interface Condominium {
  id: string;
  name: string;
  address: string;
  city_state?: string;
  manager_name?: string;
  manager_phone?: string;
  manager_email?: string;
  rules?: string;
  internal_notes?: string;
  active: boolean;
  created_at: string;
}

export interface Package {
  id: string;
  condominium_id: string;
  recipient_id?: string;
  unit_number?: string;
  unit?: string;
  unit_type?: string;
  block?: string;
  tower?: string;
  complement?: string;
  carrier: string;
  tracking_code?: string;
  status: 'received' | 'notified' | 'delivered';
  photo_url?: string;
  received_at: string;
  delivered_at?: string;
  received_by: string;
  porter_name?: string;
  recebido_por?: string;
  entregue_por?: string;
  registered_by?: string;
  created_by?: string;
  delivered_by?: string;
  delivered_to_name?: string;
  notes?: string;
  is_teste?: boolean;
  whatsapp_status?: 'pending' | 'pendente' | 'sent' | 'enviado' | 'failed' | 'error' | 'delivered' | 'read' | 'not_configured' | 'pending_configuration' | 'no_recipient';
  whatsapp_notified?: boolean;
  whatsapp_sent?: boolean;
  notified_at?: string;
  last_notification_at?: string;
  whatsapp_sent_at?: string;
  notification_mode?: 'api' | 'manual';
  notification_fallback?: boolean;
  pickup_token?: string;
  pickup_qr_code?: 'active' | 'used' | 'expired';
  qr_code_generated_at?: string;
  pickup_code?: string;
  retrieved_at?: string;
  retrieved_by_user_id?: string;
  delivery_method?: 'qr_code' | 'manual' | 'photo' | 'code' | 'CÓDIGO';
  delivery_photo_url?: string;
  whatsapp_message?: string;
  created_at: string;
  unit_label?: string;
  porter?: { full_name: string }; // Joined data
  deliverer?: { full_name: string }; // Joined data
  registrar?: { full_name: string }; // Joined data
  moradores?: { 
    nome: string; 
    unidade: string;
    unit_type?: string;
    unit_number?: string;
    block?: string;
    street?: string;
  }; // Joined data
}

export interface RetrievalLog {
  id: string;
  package_id: string;
  porter_id: string;
  condominium_id: string;
  delivery_method: 'qr_code' | 'manual' | 'CÓDIGO';
  token_used?: string;
  status: 'success' | 'failed';
  error_message?: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  condominium_id: string;
  message: string;
  status: 'sent' | 'failed';
  created_at: string;
  delivery_channel: 'whatsapp';
  recipient_phone?: string;
}

export interface MessageLog {
  id: string;
  condominium_id: string;
  telefone: string;
  status: string;
  erro_api?: string;
  data_envio: string;
}

export interface WhatsAppConversation {
  id: string;
  condominium_id: string;
  phone: string;
  message: string;
  direction: 'inbound' | 'outbound';
  created_at: string;
}

export interface CondominiumSettings {
  id: string;
  condominium_id: string;
  notification_template: string;
  reminder_48h_enabled: boolean;
  reminder_72h_enabled: boolean;
  contact_phone?: string;
  whatsapp_mode?: 'manual_assistido' | 'api_automatica';
  whatsapp_provider?: string;
  api_url?: string;
  api_token?: string;
  instance_id?: string;
  sender_phone?: string;
}

export interface ResidentAccessToken {
  id: string;
  resident_id: string;
  condominium_id: string;
  token: string;
  expires_at: string;
  created_at: string;
  last_accessed_at?: string;
  active: boolean;
}
