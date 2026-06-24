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

export const registrarAuditoria = async (params: AuditParams) => {
  try {
    const { error } = await supabase.rpc('registrar_auditoria', {
      p_condominio_id: params.condominio_id,
      p_usuario_id: params.usuario_id,
      p_usuario_nome: params.usuario_nome,
      p_usuario_perfil: params.usuario_perfil,
      p_tipo_evento: params.tipo_evento,
      p_acao: params.acao,
      p_tabela_afetada: params.tabela_afetada,
      p_registro_id: params.registro_id,
      p_descricao: params.descricao,
      p_metodo: params.metodo,
      p_dados_antes: params.dados_antes,
      p_dados_depois: params.dados_depois
    });

    if (error) {
      console.error('Erro no RPC registrar_auditoria:', error);
      // Fallback para inserção direta se a função não existir ou falhar
      await supabase.from('auditoria_eventos').insert({
        condominio_id: params.condominio_id,
        usuario_id: params.usuario_id,
        usuario_nome: params.usuario_nome,
        usuario_perfil: params.usuario_perfil,
        tipo_evento: params.tipo_evento,
        acao: params.acao,
        tabela_afetada: params.tabela_afetada,
        registro_id: params.registro_id,
        descricao: params.descricao,
        metodo: params.metodo,
        dados_antes: params.dados_antes,
        dados_depois: params.dados_depois
      });
    }
  } catch (err) {
    console.error('Falha crítica na auditoria:', err);
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
