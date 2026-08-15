import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/apiClient';
import { Profile, Role, Condominium } from '../types';
import { 
  X, Loader2, Check, Copy, AlertTriangle, Send, Info, Key 
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { registrarAuditoria } from '../services/auditService';
import { SHIFT_PRESETS } from '../lib/plantaoUtils';
import { getWhatsAppLink } from '../services/whatsappService';
import { normalizeRole } from '../lib/authUtils';

export interface UserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: Profile;
  editingUser?: Profile | null;
  condominiums: Condominium[];
  presetCondominiumId?: string;
  onSuccess: (savedUser: Profile, isEdit: boolean) => void;
}

export default function UserFormModal({
  isOpen,
  onClose,
  currentUser,
  editingUser = null,
  condominiums,
  presetCondominiumId,
  onSuccess
}: UserFormModalProps) {
  const [modalLoading, setModalLoading] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [copiedCredentials, setCopiedCredentials] = useState(false);

  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    email: '',
    role: 'porteiro' as Role,
    condominium_id: '',
    active: true,
    horario_inicio: '',
    horario_fim: ''
  });

  const [createdSuccessData, setCreatedSuccessData] = useState<{
    user: Profile;
    tempPassword: string;
    email: string;
    role: Role;
    condominiumName: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCreatedSuccessData(null);
      setCopiedPassword(false);
      setCopiedCredentials(false);

      if (editingUser) {
        setFormData({
          full_name: editingUser.full_name || '',
          phone: editingUser.phone || '',
          email: editingUser.email || '',
          role: (normalizeRole(editingUser.role) as Role) || 'porteiro',
          condominium_id: editingUser.condominium_id || presetCondominiumId || '',
          active: editingUser.active !== false,
          horario_inicio: editingUser.horario_inicio || '',
          horario_fim: editingUser.horario_fim || ''
        });
      } else {
        const defaultCondoId = presetCondominiumId || (currentUser.role === 'sindico' ? currentUser.condominium_id || '' : condominiums[0]?.id || '');
        setFormData({
          full_name: '',
          phone: '',
          email: '',
          role: 'porteiro',
          condominium_id: defaultCondoId,
          active: true,
          horario_inicio: '',
          horario_fim: ''
        });
      }
    }
  }, [isOpen, editingUser, presetCondominiumId, currentUser, condominiums]);

  if (!isOpen) return null;

  const getValidSession = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) return session;

      if (currentUser && currentUser.id) {
        return {
          access_token: 'MOCK_TOKEN',
          user: { id: currentUser.id, email: currentUser.email || 'demo@example.com' }
        } as any;
      }

      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const { data: { session: refreshed } } = await supabase.auth.getSession();
        if (refreshed) return refreshed;
      }

      return null;
    } catch (err) {
      console.error('[UserFormModal] Erro ao validar sessão:', err);
      return null;
    }
  };

  const handleCopyPassword = (pwd: string) => {
    navigator.clipboard.writeText(pwd);
    setCopiedPassword(true);
    toast.success('Senha copiada para a área de transferência!');
    setTimeout(() => setCopiedPassword(false), 3000);
  };

  const handleCopyCredentials = (data: { name: string; email: string; tempPassword: string; role: Role; condoName?: string }) => {
    const text = 
      `*Acesso - Encomendas Inteligentes*\n\n` +
      `*Condomínio:* ${data.condoName || 'N/A'}\n` +
      `*Nome:* ${data.name}\n` +
      `*E-mail:* ${data.email}\n` +
      `*Senha Temporária:* ${data.tempPassword}\n\n` +
      `Acesse o sistema e altere sua senha no primeiro login.`;
    navigator.clipboard.writeText(text);
    setCopiedCredentials(true);
    toast.success('Credenciais copiadas!');
    setTimeout(() => setCopiedCredentials(false), 3000);
  };

  const handleSendWhatsApp = (data: { name: string; phone?: string; email: string; tempPassword: string; role: Role; condoName?: string }) => {
    const rawPhone = data.phone || '';
    const message = 
      `Olá *${data.name}*!\n\n` +
      `Seu cadastro no *Encomendas Inteligentes* foi realizado com sucesso.\n\n` +
      `*Condomínio:* ${data.condoName || 'N/A'}\n` +
      `*Login:* ${data.email}\n` +
      `*Senha Temporária:* ${data.tempPassword}\n\n` +
      `Por favor, acesse o sistema e redefina sua senha no primeiro acesso.`;

    const link = getWhatsAppLink(rawPhone, message);
    window.open(link, '_blank');

    try {
      registrarAuditoria({
        condominio_id: currentUser.condominium_id || '',
        usuario_id: currentUser.id,
        usuario_nome: currentUser.full_name,
        usuario_perfil: currentUser.role,
        tipo_evento: 'ENVIO_CREDENCIAIS_WHATSAPP',
        acao: 'UPDATE',
        tabela_afetada: 'profiles',
        registro_id: data.email,
        descricao: `Envio de credenciais via WhatsApp para ${data.name} (${rawPhone || 'sem telefone'})`,
        metodo: 'MANUAL'
      });
    } catch (e) {}

    toast.success('WhatsApp aberto para envio das credenciais! 📲');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (modalLoading) return;

    if (!editingUser && !formData.email && normalizeRole(formData.role) !== 'porteiro') {
      toast.error('O e-mail é obrigatório para este perfil.');
      return;
    }
    if (!formData.full_name.trim()) {
      toast.error('O nome completo é obrigatório.');
      return;
    }
    const targetCondoId = formData.condominium_id || presetCondominiumId || '';
    if (normalizeRole(formData.role) === 'porteiro' && !targetCondoId) {
      toast.error('Selecione um condomínio para o porteiro.');
      return;
    }

    setModalLoading(true);

    try {
      const session = await getValidSession();
      if (!session) {
        toast.error('Sessão inválida. Tente recarregar a página.');
        setModalLoading(false);
        return;
      }

      const loadingToast = toast.loading(editingUser ? 'Salvando alterações...' : 'Criando usuário...');

      if (editingUser) {
        const response = await fetch(`/api/admin/users/${editingUser.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            full_name: formData.full_name.trim(),
            phone: formData.phone ? formData.phone.trim() : null,
            role: formData.role,
            condominium_id: targetCondoId || null,
            active: formData.active,
            horario_inicio: formData.horario_inicio || null,
            horario_fim: formData.horario_fim || null
          })
        });

        if (!response.ok) {
          const err = await response.json();
          toast.dismiss(loadingToast);
          throw new Error(err.error || 'Erro ao atualizar usuário');
        }

        const { profile: updatedProfile } = await response.json();

        try {
          await registrarAuditoria({
            condominio_id: currentUser.condominium_id || targetCondoId || '',
            usuario_id: currentUser.id,
            usuario_nome: currentUser.full_name,
            usuario_perfil: currentUser.role,
            tipo_evento: 'USUARIO_EDITADO',
            acao: 'UPDATE',
            tabela_afetada: 'profiles',
            registro_id: editingUser.id,
            descricao: `Usuário editado: ${formData.full_name}`,
            metodo: 'MANUAL',
            dados_antes: editingUser,
            dados_depois: updatedProfile
          });
        } catch (auditErr) {}

        toast.success('Usuário atualizado com sucesso! ✅', { id: loadingToast });
        onSuccess(updatedProfile, true);
        onClose();
      } else {
        const tempPassword = Math.random().toString(36).slice(-8);

        const response = await fetch('/api/admin/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            email: formData.email,
            password: tempPassword,
            full_name: formData.full_name.trim(),
            phone: formData.phone ? formData.phone.trim() : null,
            role: formData.role,
            condominium_id: targetCondoId || null,
            horario_inicio: formData.horario_inicio || null,
            horario_fim: formData.horario_fim || null
          })
        });

        if (!response.ok) {
          const err = await response.json();
          toast.dismiss(loadingToast);
          throw new Error(err.error || 'Erro ao criar usuário');
        }

        const resData = await response.json();
        const newProfile = resData.profile;
        const actualTempPassword = resData.tempPassword || tempPassword;
        const condoName = condominiums.find(c => c.id === targetCondoId)?.name || 'Todos / Sistema';

        toast.dismiss(loadingToast);

        try {
          await registrarAuditoria({
            condominio_id: currentUser.condominium_id || targetCondoId || '',
            usuario_id: currentUser.id,
            usuario_nome: currentUser.full_name,
            usuario_perfil: currentUser.role,
            tipo_evento: 'USUARIO_CRIADO',
            acao: 'CREATE',
            tabela_afetada: 'profiles',
            registro_id: newProfile.id,
            descricao: `Usuário criado: ${formData.full_name}`,
            metodo: 'MANUAL',
            dados_depois: newProfile
          });
        } catch (auditErr) {}

        // Notify parent immediately so list updates in real-time
        onSuccess(newProfile, false);

        setCreatedSuccessData({
          user: newProfile,
          tempPassword: actualTempPassword,
          email: resData.profile.email || formData.email || '',
          role: formData.role,
          condominiumName: condoName
        });
      }
    } catch (error: any) {
      toast.error('Erro ao salvar usuário: ' + error.message);
    } finally {
      setModalLoading(false);
    }
  };

  const getRoleLabel = (r: Role) => {
    switch (normalizeRole(r)) {
      case 'admin': return 'Administrador';
      case 'sindico': return 'Síndico';
      case 'porteiro': return 'Porteiro';
      default: return r;
    }
  };

  const isRolePorteiro = normalizeRole(formData.role) === 'porteiro';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
        
        {createdSuccessData ? (
          /* SUCCESS MODAL AFTER CREATION */
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0">
                <Check className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-zinc-900">
                  {normalizeRole(createdSuccessData.role) === 'porteiro' ? 'Porteiro cadastrado com sucesso.' : 'Usuário Criado com Sucesso!'}
                </h2>
                <p className="text-xs text-zinc-500">
                  {normalizeRole(createdSuccessData.role) === 'porteiro' ? 'Operação realizada com sucesso' : 'Cadastro sincronizado com o sistema'}
                </p>
              </div>
            </div>

            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 space-y-2 mb-6 text-sm">
              <div className="flex justify-between items-center py-1 border-b border-zinc-100">
                <span className="text-zinc-500 font-medium">Nome:</span>
                <span className="font-bold text-zinc-900">{createdSuccessData.user.full_name}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-zinc-100">
                <span className="text-zinc-500 font-medium">Perfil:</span>
                <span className="font-bold text-emerald-600 uppercase text-xs tracking-wider">{getRoleLabel(createdSuccessData.role)}</span>
              </div>
              <div className={`flex justify-between items-center py-1 ${normalizeRole(createdSuccessData.role) !== 'porteiro' ? 'border-b border-zinc-100' : ''}`}>
                <span className="text-zinc-500 font-medium">Condomínio:</span>
                <span className="font-bold text-zinc-900">{createdSuccessData.condominiumName}</span>
              </div>
              {normalizeRole(createdSuccessData.role) !== 'porteiro' && (
                <div className="flex justify-between items-center py-1">
                  <span className="text-zinc-500 font-medium">E-mail:</span>
                  <span className="font-bold text-zinc-900">{createdSuccessData.email}</span>
                </div>
              )}
            </div>

            {normalizeRole(createdSuccessData.role) === 'porteiro' ? (
              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 mb-6 text-xs text-emerald-900 leading-relaxed flex items-start gap-2.5">
                <Info className="w-5 h-5 mt-0.5 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-bold mb-1 text-emerald-950">Identificação por Plantão</p>
                  <p>Este porteiro será identificado automaticamente pela seleção do plantão no início do turno, não sendo necessário login ou senha individuais.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                    Senha Temporária
                  </label>
                  <div className="bg-zinc-900 text-emerald-400 p-4 rounded-2xl font-mono text-center text-xl font-bold tracking-wider relative flex items-center justify-between border border-zinc-800">
                    <span>{createdSuccessData.tempPassword}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyPassword(createdSuccessData.tempPassword)}
                      className="p-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl transition-all text-xs font-sans font-bold flex items-center gap-1.5 shrink-0"
                      title="Copiar Senha"
                    >
                      {copiedPassword ? (
                        <>
                          <Check className="w-4 h-4 text-emerald-400" />
                          <span className="text-emerald-400">Copiada!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>Copiar Senha</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-100 mb-6 text-xs text-amber-800 leading-relaxed flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                  <span>
                    O usuário deverá obrigatoriamente redefinir esta senha temporária no primeiro acesso.
                  </span>
                </div>
              </>
            )}

            <div className="flex flex-col gap-2.5">
              {normalizeRole(createdSuccessData.role) !== 'porteiro' && (
                <>
                  <button
                    type="button"
                    onClick={() => handleCopyCredentials({
                      name: createdSuccessData.user.full_name,
                      email: createdSuccessData.email,
                      tempPassword: createdSuccessData.tempPassword,
                      role: createdSuccessData.role,
                      condoName: createdSuccessData.condominiumName
                    })}
                    className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-800 py-3 rounded-xl font-bold transition-all text-sm flex items-center justify-center gap-2"
                  >
                    <Copy className="w-4 h-4 text-zinc-600" />
                    {copiedCredentials ? 'Credenciais Copiadas!' : 'Copiar Credenciais'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendWhatsApp({
                      name: createdSuccessData.user.full_name,
                      phone: createdSuccessData.user.phone,
                      email: createdSuccessData.email,
                      tempPassword: createdSuccessData.tempPassword,
                      role: createdSuccessData.role,
                      condoName: createdSuccessData.condominiumName
                    })}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl font-bold transition-all text-sm flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Send className="w-4 h-4" />
                    Enviar pelo WhatsApp
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setCreatedSuccessData(null);
                  onClose();
                }}
                className="w-full bg-zinc-900 text-white py-3 rounded-xl font-bold hover:bg-black transition-all text-sm"
              >
                Concluir
              </button>
            </div>
          </div>
        ) : (
          /* REGULAR USER FORM */
          <>
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-zinc-900">
                {editingUser ? 'Editar Usuário' : 'Novo Usuário'}
              </h2>
              <button 
                type="button"
                onClick={onClose} 
                className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-zinc-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Nome Completo *</label>
                <input
                  type="text"
                  required
                  value={formData.full_name}
                  onChange={e => setFormData({...formData, full_name: e.target.value})}
                  className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Nome do usuário"
                />
              </div>

              {!isRolePorteiro && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Email *</label>
                  <input
                    type="email"
                    required={!editingUser}
                    disabled={!!editingUser}
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-zinc-50 disabled:text-zinc-500"
                    placeholder="email@exemplo.com"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Telefone {isRolePorteiro && <span className="text-zinc-400 font-normal text-xs">(Opcional)</span>}
                </label>
                <input
                  type="tel"
                  required={!isRolePorteiro}
                  value={formData.phone}
                  onChange={e => setFormData({...formData, phone: e.target.value})}
                  className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder={isRolePorteiro ? 'Opcional' : '(00) 00000-0000'}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Perfil *</label>
                  <select
                    value={normalizeRole(formData.role)}
                    onChange={e => setFormData({...formData, role: e.target.value as Role})}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                  >
                    <option value="porteiro">Porteiro</option>
                    <option value="sindico">Síndico</option>
                    {currentUser.role === 'admin' && <option value="admin">Administrador</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Status</label>
                  <select
                    value={formData.active ? 'true' : 'false'}
                    onChange={e => setFormData({...formData, active: e.target.value === 'true'})}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                  >
                    <option value="true">Ativo</option>
                    <option value="false">Inativo</option>
                  </select>
                </div>
              </div>

              {isRolePorteiro && (
                <div className="space-y-3 p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
                      Escala de Trabalho
                    </label>
                    <select
                      value={
                        SHIFT_PRESETS.find(p => p.inicio === formData.horario_inicio && p.fim === formData.horario_fim)?.label || 'Horário Personalizado'
                      }
                      onChange={e => {
                        const selected = SHIFT_PRESETS.find(p => p.label === e.target.value);
                        if (selected && selected.inicio !== 'custom') {
                          setFormData({...formData, horario_inicio: selected.inicio, horario_fim: selected.fim});
                        }
                      }}
                      className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-sm font-medium"
                    >
                      {SHIFT_PRESETS.map((preset, idx) => (
                        <option key={idx} value={preset.label}>{preset.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 mb-1">Horário de Entrada</label>
                      <input
                        type="time"
                        value={formData.horario_inicio}
                        onChange={e => setFormData({...formData, horario_inicio: e.target.value})}
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 mb-1">Horário de Saída</label>
                      <input
                        type="time"
                        value={formData.horario_fim}
                        onChange={e => setFormData({...formData, horario_fim: e.target.value})}
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Condomínio {presetCondominiumId ? <span className="text-zinc-400 font-normal text-xs">(Preenchido automaticamente)</span> : '*'}
                </label>
                <select
                  required
                  disabled={!!presetCondominiumId || currentUser.role === 'sindico'}
                  value={formData.condominium_id}
                  onChange={e => setFormData({...formData, condominium_id: e.target.value})}
                  className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white disabled:bg-zinc-100 disabled:text-zinc-600 font-medium"
                >
                  <option value="">Selecione um condomínio</option>
                  {condominiums.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {!editingUser && (
                <>
                  {isRolePorteiro ? (
                    <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                      <p className="text-xs text-emerald-800 flex items-start gap-2 font-medium">
                        <Info className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
                        <span>Este porteiro será identificado no início do plantão, não sendo necessário login ou senha individuais.</span>
                      </p>
                    </div>
                  ) : (
                    <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                      <p className="text-xs text-amber-700 flex items-start gap-2">
                        <Key className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>O usuário será criado com uma senha provisória e deverá alterá-la no primeiro acesso.</span>
                      </p>
                    </div>
                  )}
                </>
              )}

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-200 text-zinc-600 hover:bg-zinc-50 font-bold transition-all text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={modalLoading}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold transition-all shadow-md shadow-emerald-600/20 text-sm flex items-center justify-center gap-2"
                >
                  {modalLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingUser ? 'Salvar Alterações' : 'Criar Usuário'}
                </button>
              </div>
            </form>
          </>
        )}

      </div>
    </div>
  );
}
