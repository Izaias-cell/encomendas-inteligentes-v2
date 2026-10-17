import { supabase } from '../lib/supabase';

export interface AuditParams {
  condominio_id: string;
  usuario_id: string;
  usuario_nome: string;
  usuario_perfil: string;
  tipo_evento: string;
  acao: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT';
  tabela_afetada: string;
  registro_id: string;
  descricao: string;
  metodo: string;
  dados_antes?: any;
  dados_depois?: any;
}

export const isValidUuid = (id?: string | null): boolean => {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};

export const sanitizeUuid = (id?: string | null): string | null => {
  if (!id) return null;
  if (isValidUuid(id)) return id;
  // Handle synthetic prefix like "portaria-64710b73-88f7-49a7-aeb7-3f513bec125c"
  const clean = id.replace(/^portaria-/, '');
  if (isValidUuid(clean)) return clean;
  // Match any embedded 36-char hex UUID string
  const match = id.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (match) return match[0];
  return null;
};

export const registrarAuditoria = async (params: AuditParams) => {
  try {
    const condominioId = sanitizeUuid(params.condominio_id);
    const usuarioId = sanitizeUuid(params.usuario_id);
    const registroId = sanitizeUuid(params.registro_id);

    const { error } = await supabase.rpc('registrar_auditoria', {
      p_condominio_id: condominioId,
      p_usuario_id: usuarioId,
      p_usuario_nome: params.usuario_nome || 'Usuário',
      p_usuario_perfil: params.usuario_perfil || 'porteiro',
      p_tipo_evento: params.tipo_evento,
      p_acao: params.acao,
      p_tabela_afetada: params.tabela_afetada,
      p_registro_id: registroId,
      p_descricao: params.descricao,
      p_metodo: params.metodo,
      p_dados_antes: params.dados_antes,
      p_dados_depois: params.dados_depois
    });

    if (error) {
      console.warn('Aviso no RPC registrar_auditoria (tentando fallback):', error.message || error);
      // Fallback para inserção direta se a função RPC falhar
      await supabase.from('auditoria_eventos').insert({
        condominio_id: condominioId,
        usuario_id: usuarioId,
        usuario_nome: params.usuario_nome || 'Usuário',
        usuario_perfil: params.usuario_perfil || 'porteiro',
        tipo_evento: params.tipo_evento,
        acao: params.acao,
        tabela_afetada: params.tabela_afetada,
        registro_id: registroId,
        descricao: params.descricao,
        metodo: params.metodo,
        dados_antes: params.dados_antes,
        dados_depois: params.dados_depois
      });
    }
  } catch (err) {
    console.warn('Aviso na auditoria (ignorado com segurança):', err);
  }
};

/**
 * @deprecated Use registrarAuditoria instead.
 * Mapping old logAction to the new registrar_auditoria for compatibility.
 */
export const logAction = async (
  userId: string,
  condominiumId: string,
  action: string,
  entityType: string,
  entityId: string,
  oldValue?: any,
  newValue?: any
) => {
  // Try to determine the name and role from the profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', userId)
    .single();

  return registrarAuditoria({
    condominio_id: condominiumId,
    usuario_id: userId,
    usuario_nome: profile?.full_name || 'Desconhecido',
    usuario_perfil: profile?.role || 'porteiro',
    tipo_evento: action.toUpperCase(),
    acao: action.includes('create') ? 'CREATE' : (action.includes('delete') ? 'DELETE' : 'UPDATE'),
    tabela_afetada: entityType === 'resident' ? 'moradores' : (entityType === 'package' ? 'encomendas' : entityType),
    registro_id: entityId,
    descricao: `${action} em ${entityType}`,
    metodo: 'MANUAL',
    dados_antes: oldValue,
    dados_depois: newValue
  });
};
