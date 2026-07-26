import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Profile, Role, Condominium } from '../types';
import { 
  Shield, Plus, Loader2, Search, User, Phone, 
  Building2, Power, Key, Edit2, Filter, X, Trash2, MoreVertical,
  Check, Copy, AlertTriangle
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { registrarAuditoria } from '../services/auditService';

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
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<Profile | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);

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
      const session = await getValidSession();
      if (!session) {
        throw new Error('Sessão não encontrada');
      }

      // Fetch profiles via backend API to bypass RLS and support preview sessions
      const pResponse = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      if (!pResponse.ok) throw new Error('Erro ao carregar usuários');
      const { profiles } = await pResponse.json();
      setUsers(profiles || []);

      // Fetch condominiums via backend API
      const cResponse = await fetch('/api/admin/condominiums', {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      if (!cResponse.ok) throw new Error('Erro ao carregar condomínios');
      const { condominiums } = await cResponse.json();
      setCondos(condominiums || []);
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
        role: u.role,
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
    if (!editingUser && !formData.email) {
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

        const { profile: newProfile } = await response.json();
        
        // Update local state
        setUsers(prev => [...prev, newProfile]);

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

        toast.success(`Usuário criado com sucesso! Senha temporária: ${tempPassword}`, {
          id: loadingToast,
          duration: 10000,
          icon: '🔑'
        });
      }
      setShowModal(false);
      // Still call fetchData to ensure everything is in sync (e.g. condo names)
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

      {/* Modal User Form */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-zinc-900">
                {editingUser ? 'Editar Usuário' : 'Novo Usuário'}
              </h2>
              <button 
                type="button"
                onClick={() => setShowModal(false)} 
                className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-zinc-400" />
              </button>
            </div>

            <form 
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleCreateUser(e);
              }} 
              className="p-6 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={formData.full_name}
                  onChange={e => setFormData({...formData, full_name: e.target.value})}
                  className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  disabled={!!editingUser}
                  value={formData.email}
                  onChange={e => setFormData({...formData, email: e.target.value})}
                  className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-zinc-50 disabled:text-zinc-500"
                  placeholder="email@exemplo.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Telefone</label>
                <input
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={e => setFormData({...formData, phone: e.target.value})}
                  className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Perfil</label>
                  <select
                    value={formData.role}
                    onChange={e => setFormData({...formData, role: e.target.value as Role})}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                  >
                    <option value="porteiro">Porteiro</option>
                    {user.role === 'admin' && <option value="sindico">Síndico</option>}
                    {user.role === 'admin' && <option value="admin">Administrador</option>}
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

              {formData.role === 'porteiro' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Início do Plantão</label>
                    <input
                      type="time"
                      value={formData.horario_inicio}
                      onChange={e => setFormData({...formData, horario_inicio: e.target.value})}
                      className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Fim do Plantão</label>
                    <input
                      type="time"
                      value={formData.horario_fim}
                      onChange={e => setFormData({...formData, horario_fim: e.target.value})}
                      className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Condomínio</label>
                <select
                  required
                  disabled={user.role === 'sindico'}
                  value={formData.condominium_id}
                  onChange={e => setFormData({...formData, condominium_id: e.target.value})}
                  className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white disabled:bg-zinc-50 disabled:text-zinc-500"
                >
                  <option value="">Selecione um condomínio</option>
                  {condos.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {!editingUser && (
                <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                  <p className="text-xs text-amber-700 flex items-start gap-2">
                    <Key className="w-4 h-4 mt-0.5" />
                    O usuário será criado com uma senha provisória e deverá alterá-la no primeiro acesso.
                  </p>
                </div>
              )}

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-6 py-3 rounded-xl font-bold text-zinc-500 hover:bg-zinc-100 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={modalLoading}
                  onClick={(e) => handleCreateUser(e)}
                  className="flex-1 bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {modalLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingUser ? 'Salvar Alterações' : 'Criar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

            <p className="text-sm text-zinc-600 mb-4">
              A senha do usuário <strong>{resetSuccessData.user.full_name}</strong> foi redefinida. Informe a nova senha temporária abaixo ao usuário:
            </p>

            <div className="bg-zinc-900 text-emerald-400 p-4 rounded-2xl font-mono text-center text-xl font-bold tracking-wider mb-4 relative flex items-center justify-between border border-zinc-800">
              <span>{resetSuccessData.tempPassword}</span>
              <button
                type="button"
                onClick={() => handleCopyPassword(resetSuccessData.tempPassword)}
                className="p-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl transition-all text-xs font-sans font-bold flex items-center gap-1.5"
                title="Copiar Senha"
              >
                {copiedPassword ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400">Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copiar</span>
                  </>
                )}
              </button>
            </div>

            <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 mb-6 text-xs text-blue-800 leading-relaxed">
              O usuário precisará utilizar essa senha no próximo login e será solicitado a definir uma nova senha pessoal.
            </div>

            <button
              type="button"
              onClick={() => setResetSuccessData(null)}
              className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all text-sm"
            >
              Concluir
            </button>
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
