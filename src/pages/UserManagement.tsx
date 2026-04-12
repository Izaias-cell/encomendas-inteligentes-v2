import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Profile, Role, Condominium } from '../types';
import { 
  Shield, Plus, Loader2, Search, User, Phone, 
  Building2, Power, Key, Edit2, Filter, X, Trash2, MoreVertical
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { logAction } from '../services/auditService';

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

  // Form state
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    email: '', // For Auth creation (simulated)
    role: 'porteiro' as Role,
    condominium_id: '',
    active: true
  });

  const navigate = useNavigate();

  useEffect(() => {
    if (user.role !== 'admin' && user.role !== 'sindico') {
      navigate('/portaria');
      return;
    }
    fetchData();
  }, [user.role]);

  const fetchData = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('profiles')
        .select('*')
        .in('role', ['admin', 'sindico', 'porteiro'])
        .order('full_name');

      if (user.role === 'sindico') {
        query = query.eq('condominium_id', user.condominium_id);
      }

      const { data: profiles, error: pError } = await query;

      if (pError) throw pError;
      setUsers(profiles || []);

      let condoQuery = supabase
        .from('condominiums')
        .select('*')
        .order('name');
      
      if (user.role === 'sindico') {
        condoQuery = condoQuery.eq('id', user.condominium_id);
      }

      const { data: condominiums, error: cError } = await condoQuery;

      if (cError) throw cError;
      setCondos(condominiums || []);
    } catch (error: any) {
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
        active: u.active
      });
    } else {
      setEditingUser(null);
      setFormData({
        full_name: '',
        phone: '',
        email: '',
        role: 'porteiro',
        condominium_id: user.role === 'sindico' ? user.condominium_id : (condos[0]?.id || ''),
        active: true
      });
    }
    setShowModal(true);
  };

  const getValidSession = async () => {
    console.log("[DEBUG FRONTEND] getValidSession iniciada");
    try {
      // 1. Try to get current session from Supabase
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (session) {
        console.log("[DEBUG FRONTEND] Sessão encontrada via getSession");
        return session;
      }

      if (sessionError) {
        console.warn('[DEBUG FRONTEND] Aviso ao buscar sessão:', sessionError.message);
      }

      // 2. Check for Mock User (AI Studio Preview)
      // If we have a user prop with a mock ID, we return a simulated session
      if (user.id && user.id.startsWith('00000000-0000-0000-0000')) {
        console.warn("[DEBUG FRONTEND] Usuário Mock detectado. Retornando sessão simulada.");
        return {
          access_token: 'MOCK_TOKEN',
          user: { id: user.id, email: user.email || 'demo@example.com' }
        } as any;
      }

      // 3. Try fallback to getUser() which might work if session is partially lost
      console.log("[DEBUG FRONTEND] Sessão não encontrada via getSession, tentando getUser...");
      const { data: { user: authUser }, error: userError } = await supabase.auth.getUser();
      
      if (authUser) {
        console.log("[DEBUG FRONTEND] Usuário encontrado via getUser, tentando recuperar sessão...");
        const { data: { session: refreshedSession } } = await supabase.auth.getSession();
        if (refreshedSession) {
          console.log("[DEBUG FRONTEND] Sessão recuperada com sucesso");
          return refreshedSession;
        }
        
        // If we have a user but no session object, we can't get a token for the backend
        // but we might be able to proceed if it's a local operation (not the case here)
      }

      if (userError && userError.message !== 'Auth session missing!') {
        console.error('[DEBUG FRONTEND] Erro ao buscar usuário via getUser:', userError.message);
      }

      console.error("[DEBUG FRONTEND] Nenhuma sessão válida encontrada");
      return null;
    } catch (err) {
      console.error('[DEBUG FRONTEND] Erro inesperado no getValidSession:', err);
      return null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalLoading(true);

    try {
      console.log("[DEBUG FRONTEND] handleSubmit iniciado", { editingUser: editingUser?.id, formData });
      const session = await getValidSession();
      
      if (!session) {
        console.error("[DEBUG FRONTEND] Sessão não encontrada no handleSubmit");
        toast.error('Sessão não encontrada. Por favor, faça login novamente para realizar esta ação.');
        setModalLoading(false);
        return;
      }

      const isMock = session.access_token === 'MOCK_TOKEN';
      const loadingToast = toast.loading(editingUser ? 'Salvando alterações...' : 'Criando usuário...');

      if (editingUser) {
        if (isMock) {
          // Simulate success for mock users
          setTimeout(() => {
            const updatedProfile = { ...editingUser, ...formData };
            setUsers(prev => prev.map(u => u.id === editingUser.id ? updatedProfile : u));
            toast.success('Usuário atualizado com sucesso! (Modo Demo) ✅', { id: loadingToast });
            setShowModal(false);
            setModalLoading(false);
          }, 1000);
          return;
        }

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
            active: formData.active
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
          await logAction(
            user.id,
            user.condominium_id,
            'UPDATE_USER',
            'profiles',
            editingUser.id,
            editingUser,
            updatedProfile
          );
        } catch (auditErr) {
          console.warn("[DEBUG FRONTEND] Erro ao registrar log de auditoria (não crítico):", auditErr);
        }

        toast.success('Usuário atualizado com sucesso! ✅', { id: loadingToast });
      } else {
        if (isMock) {
          // Simulate creation for mock users
          setTimeout(() => {
            const newProfile = { 
              id: Math.random().toString(36).substring(7),
              ...formData,
              created_at: new Date().toISOString(),
              active: true
            } as Profile;
            setUsers(prev => [...prev, newProfile]);
            toast.success(`Usuário criado com sucesso! (Modo Demo) ✅`, {
              id: loadingToast,
              duration: 5000
            });
            setShowModal(false);
            setModalLoading(false);
          }, 1000);
          return;
        }

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
            condominium_id: formData.condominium_id || null
          })
        });

        console.log("[DEBUG FRONTEND] Resposta POST recebida:", response.status);

        if (!response.ok) {
          const err = await response.json();
          console.error("[DEBUG FRONTEND] Erro no POST:", err);
          toast.dismiss(loadingToast);
          throw new Error(err.error || 'Erro ao criar usuário');
        }

        const { profile: newProfile } = await response.json();
        console.log("[DEBUG FRONTEND] Novo usuário criado com sucesso:", newProfile);

        // Update local state
        setUsers(prev => [...prev, newProfile]);

        try {
          await logAction(
            user.id,
            user.condominium_id,
            'CREATE_USER',
            'profiles',
            newProfile.id,
            null,
            newProfile
          );
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
      console.error('Erro no handleSubmit:', error);
      toast.error('Erro ao salvar usuário: ' + error.message);
    } finally {
      setModalLoading(false);
    }
  };

  const handleResetPassword = async (u: Profile) => {
    if (!confirm(`Deseja realmente resetar a senha de ${u.full_name}? Uma nova senha temporária será gerada.`)) return;

    try {
      console.log("[DEBUG FRONTEND] handleResetPassword iniciado para:", u.id, u.email);
      const session = await getValidSession();
      if (!session) {
        console.error("[DEBUG FRONTEND] Sessão não encontrada no handleResetPassword");
        toast.error('Sessão não encontrada. Por favor, faça login novamente.');
        return;
      }

      const isMock = session.access_token === 'MOCK_TOKEN';
      const newPassword = Math.random().toString(36).slice(-8);

      if (isMock) {
        toast.success(`Senha resetada com sucesso! (Modo Demo) Nova senha: ${newPassword} ✅`, {
          duration: 10000,
          icon: '🔑'
        });
        return;
      }

      console.log("[DEBUG FRONTEND] Enviando POST para reset-password");
      const response = await fetch(`/api/admin/users/${u.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ newPassword })
      });

      console.log("[DEBUG FRONTEND] Resposta reset-password recebida:", response.status);

      if (!response.ok) {
        const err = await response.json();
        console.error("[DEBUG FRONTEND] Erro no reset-password:", err);
        throw new Error(err.error || 'Erro ao resetar senha');
      }

      try {
        await logAction(
          user.id,
          user.condominium_id,
          'RESET_PASSWORD',
          'profiles',
          u.id,
          null,
          { must_change_password: true }
        );
      } catch (auditErr) {
        console.warn("[DEBUG FRONTEND] Erro ao registrar log de auditoria (não crítico):", auditErr);
      }

      toast.success(`Senha resetada com sucesso! Nova senha temporária: ${newPassword} ✅`, {
        duration: 10000,
        icon: '🔑'
      });
    } catch (error: any) {
      console.error("Erro ao resetar senha:", error);
      toast.error('Erro ao resetar senha: ' + error.message + ' ❌');
    }
  };

  const toggleStatus = async (u: Profile) => {
    try {
      console.log("[DEBUG FRONTEND] toggleStatus iniciado para:", u.id, "Status atual:", u.active);
      const session = await getValidSession();
      if (!session) {
        console.error("[DEBUG FRONTEND] Sessão não encontrada no toggleStatus");
        toast.error('Sessão não encontrada. Por favor, faça login novamente.');
        return;
      }

      const isMock = session.access_token === 'MOCK_TOKEN';
      const newStatus = !u.active;

      if (isMock) {
        setUsers(prev => prev.map(item => item.id === u.id ? { ...item, active: newStatus } : item));
        toast.success(`Usuário ${newStatus ? 'ativado' : 'inativado'} com sucesso! (Modo Demo) ✅`);
        return;
      }
      
      console.log("[DEBUG FRONTEND] Enviando PATCH para alterar status para:", newStatus);
      const response = await fetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ active: newStatus })
      });

      console.log("[DEBUG FRONTEND] Resposta toggleStatus recebida:", response.status);

      if (!response.ok) {
        const err = await response.json();
        console.error("[DEBUG FRONTEND] Erro no toggleStatus:", err);
        throw new Error(err.error || 'Erro ao alterar status');
      }

      // Update local state immediately
      setUsers(prev => prev.map(item => item.id === u.id ? { ...item, active: newStatus } : item));

      try {
        await logAction(
          user.id,
          user.condominium_id,
          newStatus ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
          'profiles',
          u.id,
          { active: u.active },
          { active: newStatus }
        );
      } catch (auditErr) {
        console.warn("[DEBUG FRONTEND] Erro ao registrar log de auditoria (não crítico):", auditErr);
      }

      toast.success(`Usuário ${newStatus ? 'ativado' : 'inativado'} com sucesso! ✅`);
      fetchData();
    } catch (error: any) {
      console.error("Erro ao alterar status:", error);
      toast.error('Erro ao alterar status: ' + error.message + ' ❌');
    }
  };

  const handleDeleteUser = async (u: Profile) => {
    if (u.id === user.id) {
      toast.error('Você não pode excluir seu próprio usuário.');
      return;
    }

    if (!confirm('ATENÇÃO: Deseja excluir este usuário permanentemente? Esta ação não poderá ser desfeita.')) {
      return;
    }

    console.log("[DEBUG FRONTEND] handleDeleteUser iniciado para:", u.id);
    setDeletingId(u.id);
    try {
      const session = await getValidSession();
      if (!session) {
        console.error("[DEBUG FRONTEND] Sessão não encontrada no handleDeleteUser");
        toast.error('Sessão não encontrada. Por favor, faça login novamente.');
        setDeletingId(null);
        return;
      }

      const isMock = session.access_token === 'MOCK_TOKEN';

      if (isMock) {
        setTimeout(() => {
          setUsers(prev => prev.filter(item => item.id !== u.id));
          toast.success('Usuário excluído com sucesso! (Modo Demo) ✅');
          setDeletingId(null);
        }, 1000);
        return;
      }

      console.log("[DEBUG FRONTEND] Enviando DELETE para /api/admin/users/" + u.id);
      const response = await fetch(`/api/admin/users/${u.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      console.log("[DEBUG FRONTEND] Resposta DELETE recebida:", response.status);

      if (!response.ok) {
        const err = await response.json();
        console.error("[DEBUG FRONTEND] Erro no DELETE:", err);
        throw new Error(err.error || 'Erro ao excluir usuário');
      }

      // Update local state immediately
      const deletedId = u.id;
      setUsers(prev => prev.filter(item => item.id !== deletedId));

      try {
        await logAction(
          user.id,
          user.condominium_id,
          'DELETE_USER',
          'profiles',
          u.id,
          u,
          null
        );
      } catch (auditErr) {
        console.warn("[DEBUG FRONTEND] Erro ao registrar log de auditoria (não crítico):", auditErr);
      }

      toast.success('Usuário excluído permanentemente com sucesso ✅');
      fetchData();
    } catch (error: any) {
      console.error("Erro ao excluir usuário:", error);
      toast.error('Erro ao excluir usuário: ' + error.message + ' ❌');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredUsers = users.filter(u => 
    u.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.phone || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    condos.find(c => c.id === u.condominium_id)?.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
                      {user.role === 'admin' ? (
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleResetPassword(u);
                                    setActiveMenu(null);
                                  }}
                                  className="w-full px-4 py-2.5 text-left text-sm font-bold text-zinc-700 hover:bg-zinc-50 flex items-center gap-3 transition-colors"
                                >
                                  <Key className="w-4 h-4 text-blue-600" />
                                  Resetar Senha
                                </button>

                                <div className="h-px bg-zinc-100 my-1" />

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteUser(u);
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
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
                <X className="w-5 h-5 text-zinc-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
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
                  type="submit"
                  disabled={modalLoading}
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
    </div>
  );
}
