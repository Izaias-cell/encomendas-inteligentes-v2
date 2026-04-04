import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Profile, Role, Condominium } from '../types';
import { 
  Shield, Plus, Loader2, Search, User, Phone, 
  Building2, Power, Key, Edit2, Filter, X, Trash2
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
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

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
      navigate('/dashboard');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão não encontrada');

      if (editingUser && editingUser.id) {
  const { data: updatedProfile, error } = await supabase
    .from('profiles')
    .update({
      full_name: formData.full_name,
      phone: formData.phone,
      role: formData.role,
      active: formData.active,
      updated_at: new Date().toISOString()
    })
    .eq('id', editingUser.id)
    .select()
    .single();

  if (error) throw error;

  await logAction(
    user.id,
    user.condominium_id,
    'UPDATE_USER',
    'profiles',
    editingUser.id,
    editingUser,
    updatedProfile
  );

  toast.success('Usuário atualizado com sucesso!');
}


          
    
            
          
          
        
            
            
            
            
          
          
      

      
        
          
        

        

    
        
        
          
      
          
          
          
      

        
       else {
        // Create new user with temporary password
        const tempPassword = Math.random().toString(36).slice(-8);
        console.log('CRIAR USUÁRIO INICIADO');
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
            condominium_id: formData.condominium_id
          })
        });
console.log('STATUS RESPONSE:', response.status);

const data = await response.json();
console.log('RESPOSTA API:', data);
        if (!response.ok) {
  throw new Error(data.error || 'Erro ao criar usuário');
}
        

        const { profile: newProfile } = await response.json();

        

        toast.success(`Usuário criado com sucesso! Senha temporária: ${tempPassword}`, {
          duration: 10000,
          icon: '🔑'
        });
      }
      setShowModal(false);
      fetchData();
    } catch (error: any) {
      toast.error('Erro ao salvar usuário: ' + error.message);
    } finally {
      setModalLoading(false);
    }
  };

  const handleResetPassword = async (u: Profile) => {
    if (!confirm(`Deseja realmente resetar a senha de ${u.full_name}? Uma nova senha temporária será gerada.`)) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão não encontrada');

      const newPassword = Math.random().toString(36).slice(-8);

      const response = await fetch(`/api/admin/users/${u.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ newPassword })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Erro ao resetar senha');
      }

      await logAction(
        user.id,
        user.condominium_id,
        'RESET_PASSWORD',
        'profiles',
        u.id,
        null,
        { must_change_password: true }
      );

      toast.success(`Senha resetada com sucesso! Nova senha temporária: ${newPassword}`, {
        duration: 10000,
        icon: '🔑'
      });
    } catch (error: any) {
      toast.error('Erro ao resetar senha: ' + error.message);
    }
  };


    const toggleStatus = async (u: Profile) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sessão não encontrada');

    const newStatus = !u.active;

    const { error } = await supabase
      .from('profiles')
      .update({ active: newStatus })
      .eq('id', u.id);

    if (error) throw error;

toast.success(`Usuário ${newStatus ? 'ativado' : 'inativado'} com sucesso!`);
fetchData();
    
    } catch (error: any) {
    toast.error('Erro ao alterar status: ' + error.message);
  }
};

  const handleDeleteUser = async (u: Profile) => {
    if (!confirm(`Tem certeza que deseja excluir este usuário? (${u.full_name})`)) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão não encontrada');
const { error } = await supabase
  .from('profiles')
  .delete()
  .eq('id', u.id);

if (error) throw error;

      await logAction(
        user.id,
        user.condominium_id,
        'DELETE_USER',
        'profiles',
        u.id,
        u,
        null
      );

      toast.success('Usuário excluído com sucesso!');
      fetchData();
    } catch (error: any) {
      toast.error('Erro ao excluir usuário: ' + error.message);
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
      porteiro: 'Porteiro',
      resident: 'Morador'
    };
    return labels[role] || role;
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Gerenciar Usuários</h1>
          <p className="text-zinc-500">Administre síndicos, porteiros e acessos ao sistema</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Novo Usuário
        </button>
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
        <div className="bg-white rounded-3xl border border-zinc-100 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
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
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => handleResetPassword(u)}
                        className="p-2 hover:bg-zinc-100 rounded-lg text-zinc-400 hover:text-zinc-900 transition-all"
                        title="Resetar Senha"
                      >
                        <Key className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleOpenModal(u)}
                        className="p-2 hover:bg-zinc-100 rounded-lg text-zinc-400 hover:text-zinc-900 transition-all"
                        title="Editar"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => toggleStatus(u)}
                        className={`p-2 rounded-lg transition-all ${u.active ? 'hover:bg-red-50 text-red-400 hover:text-red-600' : 'hover:bg-emerald-50 text-emerald-400 hover:text-emerald-600'}`}
                        title={u.active ? 'Inativar' : 'Ativar'}
                      >
                        <Power className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDeleteUser(u)}
                        className="p-2 hover:bg-red-50 rounded-lg text-zinc-400 hover:text-red-600 transition-all"
                        title="Excluir"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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
