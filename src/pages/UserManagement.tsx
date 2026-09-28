import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { api } from '../lib/apiClient';
import { Profile, Role, Condominium } from '../types';
import { 
  Shield, Plus, Loader2, Search, User, Phone, 
  Building2, Power, Key, Edit2, Filter, X, Trash2, MoreVertical,
  Check, Copy, AlertTriangle, Send, Info
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { registrarAuditoria } from '../services/auditService';
import { SHIFT_PRESETS } from '../lib/plantaoUtils';
import { getWhatsAppLink } from '../services/whatsappService';
import { normalizeRole } from '../lib/authUtils';
import UserFormModal from '../components/UserFormModal';

interface UserManagementProps {
  user: Profile;
}

export default function UserManagement({ user }: UserManagementProps) {
  const [users, setUsers] = useState<Profile[]>([]);
  const [condos, setCondos] = useState<Condominium[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  // Modals state for admin actions
  const [resetConfirmUser, setResetConfirmUser] = useState<Profile | null>(null);
  const [resetSuccessData, setResetSuccessData] = useState<{ user: Profile; tempPassword: string } | null>(null);
  const [createdSuccessData, setCreatedSuccessData] = useState<{
    user: Profile;
    tempPassword: string;
    email: string;
    role: Role;
    condominiumName: string;
  } | null>(null);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<Profile | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [copiedCredentials, setCopiedCredentials] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    email: '', // For Auth creation (simulated)
    role: 'porteiro' as Role,
    condominium_id: '',
    active: true,
    horario_inicio: '',
    horario_fim: ''
  });

  const navigate = useNavigate();

  useEffect(() => {
    // Only redirect if we ARE sure the user should not be here
    // Avoid redirecting if user state is temporarily loading/missing
    if (user?.role && user.role !== 'admin' && user.role !== 'sindico') {
      navigate('/portaria');
    }
    fetchData();
  }, [user?.role]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch profiles via backend API to bypass RLS and support preview sessions
      const pRes = await api.get('/api/admin/users');
      if (pRes.ok) {
        setUsers(pRes.data?.profiles || []);
      }

      // Fetch condominiums via backend API
      const cRes = await api.get('/api/admin/condominiums');
      if (cRes.ok) {
        setCondos(cRes.data?.condominiums || []);
      }
    } catch (error: any) {
      console.error("[DEBUG FRONTEND] Erro ao carregar dados:", error);
      toast.error('Erro ao carregar dados: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (u: Profile | null = null) => {
    if (u) {
      setEditingUser(u);
      setFormData({
        full_name: u.full_name,
        phone: u.phone || '',
        email: u.email || '',
        role: (normalizeRole(u.role) as Role) || 'porteiro',
        condominium_id: u.condominium_id || '',
        active: u.active,
        horario_inicio: u.horario_inicio || '',
        horario_fim: u.horario_fim || ''
      });
    } else {
      setEditingUser(null);
      setFormData({
        full_name: '',
        phone: '',
        email: '',
        role: 'porteiro',
        condominium_id: user.role === 'sindico' ? user.condominium_id : (condos[0]?.id || ''),
        active: true,
        horario_inicio: '',
        horario_fim: ''
      });
    }
    setShowModal(true);
  };

  const getValidSession = async () => {
    try {
      // 1. Try to get current session from Supabase
      const { data: { session } } = await supabase.auth.getSession();
      if (session) return session;

      // 2. Check for Mock User (AI Studio Preview) fallback
      if (user && user.id) {
        return {
          access_token: 'MOCK_TOKEN',
          user: { id: user.id, email: user.email || 'demo@example.com' }
        } as any;
      }

      // 3. Fallback to getUser()
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const { data: { session: refreshed } } = await supabase.auth.getSession();
        if (refreshed) return refreshed;
      }

      return null;
    } catch (err) {
      console.error('[DEBUG FRONTEND] Erro ao validar sessão:', err);
      return null;
    }
  };

  const handleCreateUser = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (modalLoading) return;
    
    // Manual validation because type="button" might bypass HTML5 validation in some scenarios
    if (!editingUser && !formData.email && formData.role !== 'porteiro') {
      toast.error('O e-mail é obrigatório para novos usuários.');
      return;
    }
    if (!formData.full_name) {
      toast.error('O nome completo é obrigatório.');
      return;
    }
    if (formData.role === 'porteiro' && !formData.condominium_id) {
      toast.error('Selecione um condomínio para o porteiro.');
      return;
    }

    setModalLoading(true);

    try {
      const session = await getValidSession();
      
      if (!session) {
        toast.error('Não foi possível validar sua sessão. Tente recarregar a página antes de salvar.');
        setModalLoading(false);
        return;
      }

      const loadingToast = toast.loading(editingUser ? 'Salvando alterações...' : 'Criando usuário...');

      if (editingUser) {
        console.log("[DEBUG FRONTEND] Enviando PATCH para /api/admin/users/" + editingUser.id);
        // Update existing user profile via backend API to ensure consistency and bypass RLS if needed
        const response = await fetch(`/api/admin/users/${editingUser.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            full_name: formData.full_name,
            phone: formData.phone,
            role: formData.role,
            condominium_id: formData.condominium_id || null,
            active: formData.active,
            horario_inicio: formData.horario_inicio || null,
            horario_fim: formData.horario_fim || null
          })
        });

        console.log("[DEBUG FRONTEND] Resposta PATCH recebida:", response.status);

        if (!response.ok) {
          const err = await response.json();
          console.error("[DEBUG FRONTEND] Erro no PATCH:", err);
          toast.dismiss(loadingToast);
          throw new Error(err.error || 'Erro ao atualizar usuário');
        }

        const { profile: updatedProfile } = await response.json();
        console.log("[DEBUG FRONTEND] Perfil atualizado com sucesso:", updatedProfile);

        // Update local state immediately for better UX
        setUsers(prev => prev.map(u => u.id === updatedProfile.id ? updatedProfile : u));

        try {
          await registrarAuditoria({
            condominio_id: user.condominium_id || '',
            usuario_id: user.id,
            usuario_nome: user.full_name,
            usuario_perfil: user.role,
            tipo_evento: 'USUARIO_EDITADO',
            acao: 'UPDATE',
            tabela_afetada: 'profiles',
            registro_id: editingUser.id,
            descricao: `Usuário editado: ${formData.full_name}`,
            metodo: 'MANUAL',
            dados_antes: editingUser,
            dados_depois: updatedProfile
          });
        } catch (auditErr) {
          console.warn("[DEBUG FRONTEND] Erro ao registrar log de auditoria (não crítico):", auditErr);
        }

        toast.success('Usuário atualizado com sucesso! ✅', { id: loadingToast });
      } else {
        // Create new user with temporary password
        const tempPassword = Math.random().toString(36).slice(-8);
        console.log("[DEBUG FRONTEND] Criando novo usuário com senha temporária");
        
        const response = await fetch('/api/admin/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            email: formData.email,
            password: tempPassword,
            full_name: formData.full_name,
            phone: formData.phone,
            role: formData.role,
            condominium_id: formData.condominium_id || null,
            horario_inicio: formData.horario_inicio || null,
            horario_fim: formData.horario_fim || null
          })
        });

        if (!response.ok) {
          const err = await response.json();
          console.error("[DEBUG FRONTEND] Erro no POST:", err);
          toast.dismiss(loadingToast);
          throw new Error(err.error || 'Erro ao criar usuário');
        }

        const resData = await response.json();
        const newProfile = resData.profile;
        const actualTempPassword = resData.tempPassword || tempPassword;
        const condoName = condos.find(c => c.id === formData.condominium_id)?.name || 'Todos / Sistema';

        toast.dismiss(loadingToast);

        // Update local state
        setUsers(prev => [...prev.filter(u => u.id !== newProfile.id), newProfile]);

        try {
          await registrarAuditoria({
            condominio_id: user.condominium_id || '',
            usuario_id: user.id,
            usuario_nome: user.full_name,
            usuario_perfil: user.role,
            tipo_evento: 'USUARIO_CRIADO',
            acao: 'CREATE',
            tabela_afetada: 'profiles',
            registro_id: newProfile.id,
            descricao: `Usuário criado: ${formData.full_name}`,
            metodo: 'MANUAL',
            dados_depois: newProfile
          });
        } catch (auditErr) {
          console.warn("[DEBUG FRONTEND] Erro ao registrar log de auditoria (não crítico):", auditErr);
        }

        setShowModal(false);
        setCreatedSuccessData({
          user: newProfile,
          tempPassword: actualTempPassword,
          email: formData.email,
          role: formData.role,
          condominiumName: condoName
        });
      }
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar usuário:', error);
      toast.error('Erro ao salvar usuário: ' + error.message);
    } finally {
      setModalLoading(false);
    }
  };

  const executeResetPassword = async () => {
    if (!resetConfirmUser) return;
    const target = resetConfirmUser;
    setResetLoading(true);

    try {
      const session = await getValidSession();
      if (!session) throw new Error('Sessão não encontrada. Recarregue a página.');

      const newTempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4);

      const response = await fetch(`/api/admin/users/${target.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ newPassword: newTempPassword })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || 'Erro ao resetar senha');
      }

      const finalPassword = resData.tempPassword || newTempPassword;

      // Update UI state automatically
      setUsers(prev => prev.map(u => u.id === target.id ? { ...u, must_change_password: true } : u));

      // Record audit log
      registrarAuditoria({
        condominio_id: user.condominium_id || target.condominium_id || '',
        usuario_id: user.id,
        usuario_nome: user.full_name,
        usuario_perfil: user.role,
        tipo_evento: 'SENHA_RESETADA',
        acao: 'UPDATE',
        tabela_afetada: 'profiles',
        registro_id: target.id,
        descricao: `Senha redefinida para o usuário ${target.full_name} (${target.phone || 'sem tel'})`,
        metodo: 'MANUAL'
      }).catch(() => {});

      setResetConfirmUser(null);
      setCopiedPassword(false);
      setResetSuccessData({ user: target, tempPassword: finalPassword });
      toast.success('Senha redefinida com sucesso!');
    } catch (error: any) {
      console.error("Erro ao resetar senha:", error);
      toast.error('Erro ao resetar: ' + error.message);
    } finally {
      setResetLoading(false);
    }
  };

  const executeDeleteUser = async () => {
    if (!deleteConfirmUser) return;
    const target = deleteConfirmUser;

    if (target.id === user.id) {
      toast.error('Você não pode excluir seu próprio usuário.');
      setDeleteConfirmUser(null);
      return;
    }

    setDeletingId(target.id);
    const cachedUsers = users;

    try {
      // Optimistic UI update
      setUsers(prev => prev.filter(item => item.id !== target.id));

      const session = await getValidSession();
      if (!session) throw new Error('Sessão não encontrada');

      const response = await fetch(`/api/admin/users/${target.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      const resData = await response.json();

      if (!response.ok) {
        // Revert UI on error
        setUsers(cachedUsers);
        throw new Error(resData.error || 'Erro ao excluir usuário');
      }

      registrarAuditoria({
        condominio_id: user.condominium_id || target.condominium_id || '',
        usuario_id: user.id,
        usuario_nome: user.full_name,
        usuario_perfil: user.role,
        tipo_evento: 'USUARIO_EXCLUIDO',
        acao: 'DELETE',
        tabela_afetada: 'profiles',
        registro_id: target.id,
        descricao: `Usuário ${target.full_name} (${target.role}) foi excluído permanentemente do sistema.`,
        metodo: 'MANUAL'
      }).catch(() => {});

      toast.success(`Usuário ${target.full_name} excluído com sucesso ✅`);
      setDeleteConfirmUser(null);
    } catch (error: any) {
      console.error("Erro ao excluir usuário:", error);
      toast.error('Erro ao excluir: ' + error.message);
      setUsers(cachedUsers);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopyPassword = (pwd: string) => {
    navigator.clipboard.writeText(pwd);
    setCopiedPassword(true);
    toast.success('Senha temporária copiada para a área de transferência!');
    setTimeout(() => setCopiedPassword(false), 3000);
  };

  const handleCopyCredentials = (data: { name: string; email: string; tempPassword: string; role: Role; condoName?: string }) => {
    const text = `*Acesso ENCOMENDAS INTELIGENTES*\n` +
      `Nome: ${data.name}\n` +
      `E-mail: ${data.email}\n` +
      `Senha Temporária: ${data.tempPassword}\n` +
      `Perfil: ${getRoleLabel(data.role)}\n` +
      `Condomínio: ${data.condoName || 'N/A'}`;
    navigator.clipboard.writeText(text);
    setCopiedCredentials(true);
    toast.success('Credenciais completas copiadas para a área de transferência!');
    setTimeout(() => setCopiedCredentials(false), 3000);
  };

  const handleSendWhatsApp = (data: { name: string; phone?: string; email: string; tempPassword: string; role: Role; condoName?: string }) => {
    const rawPhone = data.phone || formData.phone || '';
    const message = `*Acesso ENCOMENDAS INTELIGENTES*\n\n` +
      `Olá, ${data.name}!\n` +
      `Sua conta de acesso ao ENCOMENDAS INTELIGENTES foi criada/atualizada com sucesso.\n\n` +
      `📍 Condomínio: ${data.condoName || 'N/A'}\n` +
      `👤 Perfil: ${getRoleLabel(data.role)}\n` +
      `📧 Login: ${data.email}\n` +
      `🔑 Senha Temporária: ${data.tempPassword}\n\n` +
      `⚠️ *Importante:* No seu primeiro acesso, você deverá cadastrar uma nova senha pessoal.`;

    const link = getWhatsAppLink(rawPhone, message);
    window.open(link, '_blank');

    registrarAuditoria({
      condominio_id: user.condominium_id || '',
      usuario_id: user.id,
      usuario_nome: user.full_name,
      usuario_perfil: user.role,
      tipo_evento: 'ENVIO_CREDENCIAIS_WHATSAPP',
      acao: 'CREATE',
      tabela_afetada: 'profiles',
      registro_id: user.id,
      descricao: `Envio de credenciais via WhatsApp para ${data.name} (${rawPhone || 'sem telefone'})`,
      metodo: 'WHATSAPP'
    }).catch(() => {});

    toast.success('WhatsApp aberto para envio das credenciais! 📲');
  };

  const toggleStatus = async (u: Profile) => {
    try {
      const newStatus = !u.active;
      
      // Optimistic UI update
      setUsers(prev => prev.map(item => item.id === u.id ? { ...item, active: newStatus } : item));
      
      const session = await getValidSession();
      if (!session) throw new Error('Sessão não encontrada');
      
      const response = await fetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ active: newStatus })
      });

      if (!response.ok) {
        // Revert on error
        setUsers(prev => prev.map(item => item.id === u.id ? { ...item, active: u.active } : item));
        const err = await response.json();
        throw new Error(err.error || 'Erro ao alterar status');
      }

      registrarAuditoria({
        condominio_id: user.condominium_id || '',
        usuario_id: user.id,
        usuario_nome: user.full_name,
        usuario_perfil: user.role,
        tipo_evento: newStatus ? 'USUARIO_ATIVADO' : 'USUARIO_DESATIVADO',
        acao: 'UPDATE',
        tabela_afetada: 'profiles',
        registro_id: u.id,
        descricao: `Usuário ${newStatus ? 'ativado' : 'desativado'}: ${u.full_name}`,
        metodo: 'MANUAL'
      }).catch(() => {});

      toast.success(`Usuário ${newStatus ? 'ativado' : 'inativado'} com sucesso! ✅`);
    } catch (error: any) {
      console.error("Erro ao alterar status:", error);
      toast.error('Erro ao alterar status: ' + error.message);
    }
  };

  const filteredUsers = (users || []).filter(u => {
    if (!u) return false;
    const term = (searchTerm || '').toLowerCase().trim();
    const nameStr = (u.full_name || '').toLowerCase();
    const phoneStr = (u.phone || '').toLowerCase();
    const condoNameStr = (condos.find(c => c.id === u.condominium_id)?.name || '').toLowerCase();

    return !term || nameStr.includes(term) || phoneStr.includes(term) || condoNameStr.includes(term);
  });

  const getRoleLabel = (role: string) => {
    const labels: any = {
      admin: 'Administrador',
      sindico: 'Síndico',
      porteiro: 'Porteiro'
    };
    return labels[role] || role;
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Usuários</h1>
          <p className="text-zinc-500">Controle de acesso para administradores, síndicos e porteiros</p>
        </div>
        {user.role === 'admin' && (
          <button
            onClick={() => handleOpenModal()}
            className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Adicionar Usuário
          </button>
        )}
      </div>

      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-4 rounded-2xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all bg-white"
          placeholder="Buscar por nome, telefone ou condomínio..."
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-zinc-100 shadow-sm overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-100">
                <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-wider">Usuário</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-wider">Perfil</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-wider">Condomínio</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {filteredUsers.map((u) => (
                <tr key={u.id} className="hover:bg-zinc-50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-zinc-100 rounded-full flex items-center justify-center text-zinc-500">
                        <User className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-bold text-zinc-900">{u.full_name}</p>
                        <p className="text-xs text-zinc-500">{u.phone}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      u.role === 'admin' ? 'bg-red-100 text-red-700' :
                      u.role === 'sindico' ? 'bg-emerald-100 text-emerald-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {getRoleLabel(u.role)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-zinc-600">
                      <Building2 className="w-4 h-4" />
                      <span className="text-sm">{condos.find(c => c.id === u.condominium_id)?.name || 'N/A'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`flex items-center gap-1.5 text-sm font-medium ${u.active ? 'text-emerald-600' : 'text-red-500'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${u.active ? 'bg-emerald-600' : 'bg-red-500'}`} />
                      {u.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right relative">
                    <div className="flex items-center justify-end">
                      {user.role === 'admin' || user.role === 'sindico' ? (
                        <div className="relative">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenu(activeMenu === u.id ? null : u.id);
                            }}
                            className="p-2 hover:bg-zinc-100 rounded-xl text-zinc-400 hover:text-zinc-900 transition-all flex items-center justify-center"
                            title="Ações"
                          >
                            <MoreVertical className="w-5 h-5" />
                          </button>

                          {activeMenu === u.id && (
                            <>
                              <div 
                                className="fixed inset-0 z-30" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveMenu(null);
                                }}
                              />
                              <div className="absolute right-0 top-10 w-48 bg-white rounded-2xl shadow-2xl border border-zinc-100 py-2 z-40 overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top-right">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenModal(u);
                                    setActiveMenu(null);
                                  }}
                                  className="w-full px-4 py-2.5 text-left text-sm font-bold text-zinc-700 hover:bg-zinc-50 flex items-center gap-3 transition-colors"
                                >
                                  <Edit2 className="w-4 h-4 text-emerald-600" />
                                  Editar usuário
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleStatus(u);
                                    setActiveMenu(null);
                                  }}
                                  className={`w-full px-4 py-2.5 text-left text-sm font-bold flex items-center gap-3 transition-colors ${u.active ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`}
                                >
                                  <Power className="w-4 h-4" />
                                  {u.active ? 'Inativar usuário' : 'Reativar usuário'}
                                </button>

                                {normalizeRole(u.role) !== 'porteiro' && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setResetConfirmUser(u);
                                      setActiveMenu(null);
                                    }}
                                    className="w-full px-4 py-2.5 text-left text-sm font-bold text-zinc-700 hover:bg-zinc-50 flex items-center gap-3 transition-colors"
                                  >
                                    <Key className="w-4 h-4 text-blue-600" />
                                    Resetar Senha
                                  </button>
                                )}

                                <div className="h-px bg-zinc-100 my-1" />

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setDeleteConfirmUser(u);
                                    setActiveMenu(null);
                                  }}
                                  disabled={deletingId === u.id || u.id === user.id}
                                  className={`w-full px-4 py-2.5 text-left text-sm font-bold flex items-center gap-3 transition-colors ${
                                    u.id === user.id 
                                      ? 'opacity-20 cursor-not-allowed text-zinc-400' 
                                      : 'text-red-600 hover:bg-red-50'
                                  }`}
                                >
                                  {deletingId === u.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                  Excluir usuário
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-400 italic">Sem permissão</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Reusable User Form Modal */}
      <UserFormModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        currentUser={user}
        editingUser={editingUser}
        condominiums={condos}
        onSuccess={(savedUser, isEdit) => {
          setUsers(prev => isEdit 
            ? prev.map(u => u.id === savedUser.id ? savedUser : u) 
            : [...prev.filter(u => u.id !== savedUser.id), savedUser]
          );
        }}
      />

      {/* Modal Confirmação de Reset de Senha */}
      {resetConfirmUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600">
                <Key className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-zinc-900">Resetar Senha</h2>
                <p className="text-xs text-zinc-500">Confirmação de ação administrativa</p>
              </div>
            </div>

            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 mb-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500 font-medium">Usuário:</span>
                <span className="font-bold text-zinc-900">{resetConfirmUser.full_name}</span>
              </div>
              {resetConfirmUser.email && (
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500 font-medium">E-mail:</span>
                  <span className="font-bold text-zinc-900">{resetConfirmUser.email}</span>
                </div>
              )}
              {resetConfirmUser.phone && (
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500 font-medium">Telefone:</span>
                  <span className="font-bold text-zinc-900">{resetConfirmUser.phone}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500 font-medium">Perfil:</span>
                <span className="font-bold text-blue-600 uppercase text-xs tracking-wider">{getRoleLabel(resetConfirmUser.role)}</span>
              </div>
            </div>

            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 mb-6">
              <p className="text-xs text-amber-800 leading-relaxed flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                <span>
                  Uma nova <strong>senha temporária</strong> será gerada e todas as sessões ativas deste usuário serão invalidadas imediatamente.
                </span>
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setResetConfirmUser(null)}
                disabled={resetLoading}
                className="flex-1 px-5 py-3 rounded-xl font-bold text-zinc-600 hover:bg-zinc-100 transition-all text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={resetLoading}
                onClick={executeResetPassword}
                className="flex-1 bg-blue-600 text-white px-5 py-3 rounded-xl font-bold hover:bg-blue-700 transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {resetLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirmar Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Resultado de Cadastro de Usuário (FASE 2) */}
      {createdSuccessData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600">
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

            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 mb-4 space-y-2 text-sm">
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
                  fetchData();
                }}
                className="w-full bg-zinc-900 text-white py-3 rounded-xl font-bold hover:bg-black transition-all text-sm"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Resultado de Reset de Senha (Exibe e Copia Senha) */}
      {resetSuccessData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600">
                <Check className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-zinc-900">Senha Redefinida!</h2>
                <p className="text-xs text-zinc-500">Operação concluída com sucesso</p>
              </div>
            </div>

            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 mb-4 space-y-2 text-sm">
              <div className="flex justify-between items-center py-1 border-b border-zinc-100">
                <span className="text-zinc-500 font-medium">Nome:</span>
                <span className="font-bold text-zinc-900">{resetSuccessData.user.full_name}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-zinc-100">
                <span className="text-zinc-500 font-medium">Perfil:</span>
                <span className="font-bold text-blue-600 uppercase text-xs tracking-wider">{getRoleLabel(resetSuccessData.user.role)}</span>
              </div>
              {resetSuccessData.user.email && (
                <div className="flex justify-between items-center py-1 border-b border-zinc-100">
                  <span className="text-zinc-500 font-medium">E-mail:</span>
                  <span className="font-bold text-zinc-900">{resetSuccessData.user.email}</span>
                </div>
              )}
              <div className="flex justify-between items-center py-1">
                <span className="text-zinc-500 font-medium">Condomínio:</span>
                <span className="font-bold text-zinc-900">{condos.find(c => c.id === resetSuccessData.user.condominium_id)?.name || 'Todos / Sistema'}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                Nova Senha Temporária
              </label>
              <div className="bg-zinc-900 text-emerald-400 p-4 rounded-2xl font-mono text-center text-xl font-bold tracking-wider relative flex items-center justify-between border border-zinc-800">
                <span>{resetSuccessData.tempPassword}</span>
                <button
                  type="button"
                  onClick={() => handleCopyPassword(resetSuccessData.tempPassword)}
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

            <div className="p-3.5 bg-blue-50 rounded-2xl border border-blue-100 mb-6 text-xs text-blue-800 leading-relaxed">
              O usuário precisará utilizar essa senha no próximo login e será solicitado a definir uma nova senha pessoal.
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => handleCopyCredentials({
                  name: resetSuccessData.user.full_name,
                  email: resetSuccessData.user.email || 'N/A',
                  tempPassword: resetSuccessData.tempPassword,
                  role: resetSuccessData.user.role,
                  condoName: condos.find(c => c.id === resetSuccessData.user.condominium_id)?.name || 'Todos / Sistema'
                })}
                className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-800 py-3 rounded-xl font-bold transition-all text-sm flex items-center justify-center gap-2"
              >
                <Copy className="w-4 h-4 text-zinc-600" />
                {copiedCredentials ? 'Credenciais Copiadas!' : 'Copiar Credenciais'}
              </button>
              <button
                type="button"
                onClick={() => handleSendWhatsApp({
                  name: resetSuccessData.user.full_name,
                  phone: resetSuccessData.user.phone,
                  email: resetSuccessData.user.email || 'N/A',
                  tempPassword: resetSuccessData.tempPassword,
                  role: resetSuccessData.user.role,
                  condoName: condos.find(c => c.id === resetSuccessData.user.condominium_id)?.name || 'Todos / Sistema'
                })}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl font-bold transition-all text-sm flex items-center justify-center gap-2 shadow-sm"
              >
                <Send className="w-4 h-4" />
                Enviar pelo WhatsApp
              </button>
              <button
                type="button"
                onClick={() => setResetSuccessData(null)}
                className="w-full bg-zinc-900 text-white py-3 rounded-xl font-bold hover:bg-black transition-all text-sm"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmação de Exclusão de Usuário */}
      {deleteConfirmUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center text-red-600">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-zinc-900">Excluir Usuário</h2>
                <p className="text-xs text-red-600 font-bold uppercase tracking-wider">Ação Irreversível</p>
              </div>
            </div>

            <div className="p-4 bg-red-50 border border-red-100 rounded-2xl mb-4">
              <p className="text-xs text-red-800 leading-relaxed font-medium flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
                <span>
                  Você está prestes a excluir permanentemente o usuário <strong>{deleteConfirmUser.full_name}</strong>. Esta ação removerá os acessos e permissões do sistema.
                </span>
              </p>
            </div>

            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 mb-6 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500 font-medium">Nome:</span>
                <span className="font-bold text-zinc-900">{deleteConfirmUser.full_name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500 font-medium">Perfil:</span>
                <span className="font-bold text-zinc-900 uppercase text-xs">{getRoleLabel(deleteConfirmUser.role)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500 font-medium">Condomínio:</span>
                <span className="font-bold text-zinc-900">{condos.find(c => c.id === deleteConfirmUser.condominium_id)?.name || 'N/A'}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirmUser(null)}
                disabled={deletingId === deleteConfirmUser.id}
                className="flex-1 px-5 py-3 rounded-xl font-bold text-zinc-600 hover:bg-zinc-100 transition-all text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingId === deleteConfirmUser.id}
                onClick={executeDeleteUser}
                className="flex-1 bg-red-600 text-white px-5 py-3 rounded-xl font-bold hover:bg-red-700 transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {deletingId === deleteConfirmUser.id && <Loader2 className="w-4 h-4 animate-spin" />}
                Excluir Definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
