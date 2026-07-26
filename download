import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Condominium, Profile, Role } from '../types';
import { 
  Building, Building2, Plus, Loader2, Search, MapPin, 
  Users, Package, Edit2, Trash2, Power, Key, X, Filter, 
  Check, Copy, AlertTriangle, Phone, Mail, Calendar, 
  ArrowUpDown, Shield, User, FileText, CheckCircle2, XCircle,
  MoreVertical, Eye, UserPlus
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { registrarAuditoria } from '../services/auditService';

export interface NewCondoInitialUser {
  tempId: string;
  full_name: string;
  role: Role | 'zelador' | string;
  email: string;
  phone: string;
  cpf?: string;
  password?: string;
  active: boolean;
}

interface SummaryData {
  total_condos: number;
  active_condos: number;
  inactive_condos: number;
  total_users: number;
  total_packages: number;
}

export default function CondominiumList() {
  const [condos, setCondos] = useState<Condominium[]>([]);
  const [summary, setSummary] = useState<SummaryData>({
    total_condos: 0,
    active_condos: 0,
    inactive_condos: 0,
    total_users: 0,
    total_packages: 0
  });
  const [loading, setLoading] = useState(true);

  // Filters & Sorting state
  const [searchTerm, setSearchTerm] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [cnpjFilter, setCnpjFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'oldest' | 'name_asc' | 'name_desc'>('recent');

  // Modal States
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCondo, setEditingCondo] = useState<Condominium | null>(null);
  const [selectedCondo, setSelectedCondo] = useState<Condominium | null>(null);
  const [condoTab, setCondoTab] = useState<'details' | 'users'>('details');
  const [deleteCondoConfirm, setDeleteCondoConfirm] = useState<Condominium | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Users inside selected condo
  const [condoUsers, setCondoUsers] = useState<Profile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // User Actions within Condo Details
  const [userToEdit, setUserToEdit] = useState<Profile | null>(null);
  const [userToReset, setUserToReset] = useState<Profile | null>(null);
  const [userToDelete, setUserToDelete] = useState<Profile | null>(null);
  const [resetSuccessData, setResetSuccessData] = useState<{ user: Profile; tempPassword: string } | null>(null);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);

  // Form states
  const [condoForm, setCondoForm] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    cnpj: '',
    zip_code: '',
    phone: '',
    email: '',
    manager_name: '',
    manager_phone: '',
    manager_email: '',
    rules: '',
    internal_notes: '',
    active: true
  });

  const [userForm, setUserForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    role: 'sindico' as Role,
    active: true,
    horario_inicio: '',
    horario_fim: ''
  });

  // In-Memory Users for New Condominium Creation
  const [initialUsers, setInitialUsers] = useState<NewCondoInitialUser[]>([]);
  const [showAddInitialUserModal, setShowAddInitialUserModal] = useState(false);
  const [editingInitialUserIndex, setEditingInitialUserIndex] = useState<number | null>(null);
  const [initialUserForm, setInitialUserForm] = useState({
    full_name: '',
    role: 'sindico' as string,
    email: '',
    phone: '',
    cpf: '',
    password: '',
    active: true
  });

  const navigate = useNavigate();

  useEffect(() => {
    fetchCondominiums();
  }, []);

  const getValidSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  };

  const fetchCondominiums = async () => {
    setLoading(true);
    try {
      const session = await getValidSession();
      if (!session) {
        throw new Error('Sessão inválida');
      }

      const res = await fetch('/api/admin/condominiums', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Erro ao carregar condomínios');
      }

      const data = await res.json();
      setCondos(data.condominiums || []);
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (error: any) {
      console.error('Erro ao buscar condomínios:', error);
      toast.error('Erro ao carregar condomínios: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchCondoUsers = async (condoId: string) => {
    setUsersLoading(true);
    try {
      const session = await getValidSession();
      if (!session) return;

      const res = await fetch(`/api/admin/condominiums/${condoId}/users`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      if (!res.ok) {
        throw new Error('Erro ao carregar usuários do condomínio');
      }

      const data = await res.json();
      setCondoUsers(data.profiles || []);
    } catch (error: any) {
      console.error("Erro ao buscar usuários do condomínio:", error);
      toast.error('Erro ao carregar usuários: ' + error.message);
    } finally {
      setUsersLoading(false);
    }
  };

  const openCondoDetail = (condo: Condominium, tab: 'details' | 'users' = 'details') => {
    setSelectedCondo(condo);
    setCondoTab(tab);
    fetchCondoUsers(condo.id);
  };

  const handleCreateCondominium = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!condoForm.name || !condoForm.address) {
      toast.error('Nome e endereço são obrigatórios.');
      return;
    }

    setActionLoading(true);
    try {
      const session = await getValidSession();
      if (!session) throw new Error('Sessão expirada. Recarregue a página.');

      const response = await fetch('/api/condominiums/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          ...condoForm,
          city_state: condoForm.city && condoForm.state ? `${condoForm.city}/${condoForm.state}` : condoForm.city,
          initialUsers: initialUsers
        })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Erro ao cadastrar condomínio');

      const userMsg = result.createdUsersCount > 0 
        ? `Condomínio "${result.condo.name}" e ${result.createdUsersCount} usuário(s) vinculados cadastrados com sucesso!`
        : `Condomínio "${result.condo.name}" criado com sucesso!`;

      toast.success(userMsg);
      setShowCreateModal(false);
      resetCondoForm();
      fetchCondominiums();
    } catch (error: any) {
      console.error('Erro ao criar condomínio:', error);
      toast.error('Erro: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditCondominium = (condo: Condominium) => {
    setEditingCondo(condo);
    const cityStateParts = (condo.city_state || '').split('/');
    setCondoForm({
      name: condo.name || '',
      address: condo.address || '',
      city: condo.city || cityStateParts[0] || '',
      state: condo.state || cityStateParts[1] || '',
      cnpj: condo.cnpj || '',
      zip_code: condo.zip_code || '',
      phone: condo.phone || '',
      email: condo.email || '',
      manager_name: condo.manager_name || '',
      manager_phone: condo.manager_phone || '',
      manager_email: condo.manager_email || '',
      rules: condo.rules || '',
      internal_notes: condo.internal_notes || '',
      active: condo.active !== false
    });
  };

  const handleUpdateCondominium = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCondo) return;

    setActionLoading(true);
    try {
      const session = await getValidSession();
      if (!session) throw new Error('Sessão não encontrada');

      const response = await fetch(`/api/admin/condominiums/${editingCondo.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          ...condoForm,
          city_state: condoForm.city && condoForm.state ? `${condoForm.city}/${condoForm.state}` : condoForm.city
        })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Erro ao atualizar condomínio');

      toast.success('Condomínio atualizado com sucesso!');
      setEditingCondo(null);
      if (selectedCondo?.id === editingCondo.id) {
        setSelectedCondo(result.condominium);
      }
      fetchCondominiums();
    } catch (error: any) {
      console.error('Erro ao atualizar condomínio:', error);
      toast.error('Erro ao atualizar: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleStatus = async (condo: Condominium) => {
    const newStatus = !condo.active;
    try {
      const session = await getValidSession();
      if (!session) return;

      const response = await fetch(`/api/admin/condominiums/${condo.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ active: newStatus })
      });

      if (!response.ok) throw new Error('Erro ao alterar status');

      toast.success(`Condomínio ${condo.name} agora está ${newStatus ? 'ATIVO' : 'INATIVO'}`);
      setCondos(prev => prev.map(c => c.id === condo.id ? { ...c, active: newStatus } : c));
      if (selectedCondo?.id === condo.id) {
        setSelectedCondo({ ...selectedCondo, active: newStatus });
      }
      fetchCondominiums();
    } catch (error: any) {
      toast.error('Erro ao alterar status: ' + error.message);
    }
  };

  const handleDeleteCondominium = async (force: boolean = false) => {
    if (!deleteCondoConfirm) return;
    const target = deleteCondoConfirm;
    setDeleteLoading(true);

    try {
      const session = await getValidSession();
      if (!session) throw new Error('Sessão expirada');

      const response = await fetch(`/api/admin/condominiums/${target.id}?force=${force ? 'true' : 'false'}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.hasDependencies) {
          toast((t) => (
            <div className="space-y-2">
              <p className="font-bold text-sm text-zinc-900">{data.error}</p>
              <p className="text-xs text-zinc-500">Deseja forçar a exclusão desvinculando os registros?</p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    toast.dismiss(t.id);
                    handleDeleteCondominium(true);
                  }}
                  className="px-3 py-1.5 bg-red-600 text-white font-bold rounded-lg text-xs"
                >
                  Sim, Excluir Definitivamente
                </button>
                <button
                  onClick={() => toast.dismiss(t.id)}
                  className="px-3 py-1.5 bg-zinc-200 text-zinc-700 font-bold rounded-lg text-xs"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ), { duration: 10000 });
          setDeleteLoading(false);
          return;
        }
        throw new Error(data.error || 'Erro ao excluir condomínio');
      }

      toast.success(data.message || 'Condomínio excluído com sucesso!');
      setDeleteCondoConfirm(null);
      if (selectedCondo?.id === target.id) {
        setSelectedCondo(null);
      }
      fetchCondominiums();
    } catch (error: any) {
      console.error('Erro ao excluir condomínio:', error);
      toast.error('Erro: ' + error.message);
    } finally {
      setDeleteLoading(false);
    }
  };

  // User Management Actions inside Condo Details
  const handleToggleUserStatus = async (targetUser: Profile) => {
    const newStatus = !targetUser.active;
    try {
      const session = await getValidSession();
      if (!session) return;

      const response = await fetch(`/api/admin/users/${targetUser.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ active: newStatus })
      });

      if (!response.ok) throw new Error('Erro ao atualizar usuário');

      toast.success(`Usuário ${targetUser.full_name} agora está ${newStatus ? 'Ativo' : 'Inativo'}`);
      setCondoUsers(prev => prev.map(u => u.id === targetUser.id ? { ...u, active: newStatus } : u));
    } catch (error: any) {
      toast.error('Erro ao alterar status do usuário: ' + error.message);
    }
  };

  const executeResetUserPassword = async () => {
    if (!userToReset) return;
    const target = userToReset;
    setActionLoading(true);

    try {
      const session = await getValidSession();
      if (!session) throw new Error('Sessão expirada');

      const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4);

      const response = await fetch(`/api/admin/users/${target.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ newPassword: tempPassword })
      });

      const resData = await response.json();
      if (!response.ok) throw new Error(resData.error || 'Erro ao resetar senha');

      const finalPassword = resData.tempPassword || tempPassword;
      setUserToReset(null);
      setResetSuccessData({ user: target, tempPassword: finalPassword });
      toast.success('Senha redefinida com sucesso!');
    } catch (error: any) {
      toast.error('Erro ao resetar senha: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const executeDeleteUser = async () => {
    if (!userToDelete) return;
    const target = userToDelete;
    setActionLoading(true);

    try {
      const session = await getValidSession();
      if (!session) throw new Error('Sessão expirada');

      const response = await fetch(`/api/admin/users/${target.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao excluir usuário');

      toast.success(`Usuário ${target.full_name} excluído com sucesso!`);
      setCondoUsers(prev => prev.filter(u => u.id !== target.id));
      setUserToDelete(null);
      fetchCondominiums();
    } catch (error: any) {
      toast.error('Erro ao excluir usuário: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateUserInCondo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCondo) return;
    if (!userForm.full_name || !userForm.email) {
      toast.error('Nome e E-mail são obrigatórios.');
      return;
    }

    setActionLoading(true);
    try {
      const session = await getValidSession();
      if (!session) throw new Error('Sessão expirada');

      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          ...userForm,
          condominium_id: selectedCondo.id
        })
      });

      const resData = await response.json();
      if (!response.ok) throw new Error(resData.error || 'Erro ao criar usuário');

      toast.success(`Usuário ${userForm.full_name} cadastrado com sucesso!`);
      setShowAddUserModal(false);
      resetUserForm();
      fetchCondoUsers(selectedCondo.id);
      fetchCondominiums();
    } catch (error: any) {
      toast.error('Erro ao criar usuário: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToEdit) return;

    setActionLoading(true);
    try {
      const session = await getValidSession();
      if (!session) throw new Error('Sessão expirada');

      const response = await fetch(`/api/admin/users/${userToEdit.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          full_name: userForm.full_name,
          phone: userForm.phone,
          role: userForm.role,
          active: userForm.active,
          horario_inicio: userForm.horario_inicio,
          horario_fim: userForm.horario_fim
        })
      });

      const resData = await response.json();
      if (!response.ok) throw new Error(resData.error || 'Erro ao editar usuário');

      toast.success('Usuário atualizado com sucesso!');
      setUserToEdit(null);
      if (selectedCondo) fetchCondoUsers(selectedCondo.id);
    } catch (error: any) {
      toast.error('Erro ao atualizar usuário: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const openUserEditModal = (u: Profile) => {
    setUserToEdit(u);
    setUserForm({
      full_name: u.full_name || '',
      phone: u.phone || '',
      email: u.email || '',
      role: u.role || 'porteiro',
      active: u.active !== false,
      horario_inicio: u.horario_inicio || '',
      horario_fim: u.horario_fim || ''
    });
  };

  const handleOpenAddInitialUserModal = () => {
    setEditingInitialUserIndex(null);
    setInitialUserForm({
      full_name: '',
      role: 'sindico',
      email: '',
      phone: '',
      cpf: '',
      password: '',
      active: true
    });
    setShowAddInitialUserModal(true);
  };

  const handleOpenEditInitialUserModal = (index: number) => {
    const u = initialUsers[index];
    if (!u) return;
    setEditingInitialUserIndex(index);
    setInitialUserForm({
      full_name: u.full_name || '',
      role: u.role || 'sindico',
      email: u.email || '',
      phone: u.phone || '',
      cpf: u.cpf || '',
      password: u.password || '',
      active: u.active !== false
    });
    setShowAddInitialUserModal(true);
  };

  const handleSaveInitialUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!initialUserForm.full_name.trim()) {
      toast.error('O nome completo é obrigatório.');
      return;
    }
    if (!initialUserForm.email.trim()) {
      toast.error('O e-mail é obrigatório.');
      return;
    }

    const newUserItem: NewCondoInitialUser = {
      tempId: editingInitialUserIndex !== null && initialUsers[editingInitialUserIndex]
        ? initialUsers[editingInitialUserIndex].tempId
        : Math.random().toString(36).substring(2, 9),
      full_name: initialUserForm.full_name.trim(),
      role: initialUserForm.role,
      email: initialUserForm.email.trim(),
      phone: initialUserForm.phone.trim(),
      cpf: initialUserForm.cpf.trim(),
      password: initialUserForm.password.trim(),
      active: initialUserForm.active
    };

    if (editingInitialUserIndex !== null) {
      const updated = [...initialUsers];
      updated[editingInitialUserIndex] = newUserItem;
      setInitialUsers(updated);
      toast.success('Usuário atualizado na lista!');
    } else {
      setInitialUsers([...initialUsers, newUserItem]);
      toast.success('Usuário adicionado à lista!');
    }

    setShowAddInitialUserModal(false);
    setEditingInitialUserIndex(null);
  };

  const handleRemoveInitialUser = (index: number) => {
    const updated = initialUsers.filter((_, i) => i !== index);
    setInitialUsers(updated);
    toast.success('Usuário removido da lista.');
  };

  const getRoleLabelAndColor = (role: string) => {
    switch (role) {
      case 'admin':
        return { label: 'Administrador', bg: 'bg-purple-100 text-purple-800 border-purple-200' };
      case 'sindico':
        return { label: 'Síndico', bg: 'bg-blue-100 text-blue-800 border-blue-200' };
      case 'porteiro':
        return { label: 'Porteiro', bg: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
      case 'zelador':
        return { label: 'Zelador', bg: 'bg-amber-100 text-amber-800 border-amber-200' };
      case 'resident':
        return { label: 'Morador', bg: 'bg-zinc-100 text-zinc-800 border-zinc-200' };
      default:
        return { label: role, bg: 'bg-zinc-100 text-zinc-700 border-zinc-200' };
    }
  };

  const resetCondoForm = () => {
    setCondoForm({
      name: '',
      address: '',
      city: '',
      state: '',
      cnpj: '',
      zip_code: '',
      phone: '',
      email: '',
      manager_name: '',
      manager_phone: '',
      manager_email: '',
      rules: '',
      internal_notes: '',
      active: true
    });
    setInitialUsers([]);
  };

  const resetUserForm = () => {
    setUserForm({
      full_name: '',
      phone: '',
      email: '',
      role: 'sindico',
      active: true,
      horario_inicio: '',
      horario_fim: ''
    });
  };

  // Filter & Sort Logic
  const filteredCondos = (condos || []).filter(c => {
    if (!c) return false;

    const searchTermLower = (searchTerm || '').toLowerCase().trim();
    const cityFilterLower = (cityFilter || '').toLowerCase().trim();
    const cnpjFilterLower = (cnpjFilter || '').toLowerCase().trim();

    const nameStr = (c.name || '').toLowerCase();
    const addressStr = (c.address || '').toLowerCase();
    const cityStateStr = (c.city_state || c.city || '').toLowerCase();
    const cnpjStr = (c.cnpj || '').toLowerCase();

    const matchesName = !searchTermLower ||
                        nameStr.includes(searchTermLower) ||
                        addressStr.includes(searchTermLower) ||
                        cityStateStr.includes(searchTermLower) ||
                        cnpjStr.includes(searchTermLower);

    const matchesCity = !cityFilterLower || cityStateStr.includes(cityFilterLower);
    const matchesCnpj = !cnpjFilterLower || cnpjStr.includes(cnpjFilterLower);
    const matchesStatus = statusFilter === 'all' ? true :
                          statusFilter === 'active' ? c.active !== false :
                          c.active === false;

    return matchesName && matchesCity && matchesCnpj && matchesStatus;
  }).sort((a, b) => {
    if (!a || !b) return 0;
    if (sortBy === 'recent') return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    if (sortBy === 'oldest') return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
    if (sortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '');
    if (sortBy === 'name_desc') return (b.name || '').localeCompare(a.name || '');
    return 0;
  });

  const getRoleLabel = (role: Role) => {
    switch (role) {
      case 'admin': return 'Administrador';
      case 'sindico': return 'Síndico';
      case 'porteiro': return 'Porteiro';
      case 'resident': return 'Morador';
      default: return role;
    }
  };

  const getRoleBadge = (role: Role) => {
    switch (role) {
      case 'admin': return 'bg-red-50 text-red-700 border-red-200';
      case 'sindico': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'porteiro': return 'bg-amber-50 text-amber-700 border-amber-200';
      default: return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
      {/* HEADER BAR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-zinc-100 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0">
            <Building2 className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-zinc-900 tracking-tight">GESTÃO DE CONDOMÍNIOS</h1>
            <p className="text-sm text-zinc-500 font-medium mt-0.5">Painel administrativo de controle de condomínios e usuários</p>
          </div>
        </div>

        <button
          onClick={() => {
            resetCondoForm();
            setShowCreateModal(true);
          }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3.5 rounded-2xl font-bold shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2.5 text-sm shrink-0"
        >
          <Plus className="w-5 h-5" />
          <span>+ Adicionar Novo Condomínio</span>
        </button>
      </div>

      {/* PAINEL RESUMO (INDICATORS) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-zinc-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Total Condomínios</span>
            <Building className="w-5 h-5 text-zinc-400" />
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-zinc-900">{summary.total_condos}</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-zinc-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Ativos</span>
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-emerald-600">{summary.active_condos}</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-zinc-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Inativos</span>
            <XCircle className="w-5 h-5 text-zinc-400" />
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-zinc-600">{summary.inactive_condos}</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-zinc-100 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Total Usuários</span>
            <Users className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-blue-600">{summary.total_users}</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-zinc-100 shadow-sm col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">Total Encomendas</span>
            <Package className="w-5 h-5 text-amber-500" />
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-amber-600">{summary.total_packages}</p>
        </div>
      </div>

      {/* PESQUISA E FILTROS */}
      <div className="bg-white p-6 rounded-3xl border border-zinc-100 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Nome / Endereço */}
          <div className="relative md:col-span-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome ou endereço..."
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition-all"
            />
          </div>

          {/* Cidade */}
          <div className="relative">
            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              placeholder="Filtrar por cidade/estado..."
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition-all"
            />
          </div>

          {/* Status */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-zinc-400 shrink-0" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full px-3 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition-all bg-white font-medium text-zinc-700"
            >
              <option value="all">Todos os Status</option>
              <option value="active">Somente Ativos</option>
              <option value="inactive">Somente Inativos</option>
            </select>
          </div>

          {/* Ordenação */}
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-zinc-400 shrink-0" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-3 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition-all bg-white font-medium text-zinc-700"
            >
              <option value="recent">Mais Recentes</option>
              <option value="oldest">Mais Antigos</option>
              <option value="name_asc">Nome (A-Z)</option>
              <option value="name_desc">Nome (Z-A)</option>
            </select>
          </div>
        </div>
      </div>

      {/* CONDOMINIUM CARDS GRID */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-zinc-100">
          <Loader2 className="w-10 h-10 animate-spin text-emerald-600 mb-3" />
          <p className="text-sm font-medium text-zinc-500">Carregando condomínios...</p>
        </div>
      ) : filteredCondos.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCondos.map((condo) => (
            <div 
              key={condo.id}
              className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-6 hover:shadow-md transition-all flex flex-col justify-between group relative overflow-hidden"
            >
              {/* Header inside Card */}
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 bg-zinc-50 text-emerald-600 rounded-2xl flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                    <Building2 className="w-6 h-6" />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                      condo.active !== false 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                        : 'bg-zinc-100 text-zinc-500 border-zinc-200'
                    }`}>
                      {condo.active !== false ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                </div>

                <h3 className="text-xl font-extrabold text-zinc-900 mb-2 leading-tight">{condo.name}</h3>

                <div className="space-y-1.5 text-xs text-zinc-500 mb-6">
                  {condo.address && (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-400" />
                      <span className="line-clamp-2">{condo.address}</span>
                    </div>
                  )}

                  {condo.city_state && (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-700 ml-5">{condo.city_state}</span>
                    </div>
                  )}

                  {condo.cnpj && (
                    <div className="flex items-center gap-2 ml-5">
                      <span className="font-mono text-zinc-600">CNPJ: {condo.cnpj}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 ml-5 pt-1 text-[11px] text-zinc-400">
                    <Calendar className="w-3 h-3" />
                    <span>Cadastrado em {new Date(condo.created_at).toLocaleDateString('pt-BR')}</span>
                  </div>
                </div>

                {/* Stat Counters inside Card */}
                <div className="grid grid-cols-3 gap-2 bg-zinc-50 p-3 rounded-2xl border border-zinc-100 mb-6 text-center">
                  <div>
                    <span className="block text-[10px] font-bold text-zinc-400 uppercase">Usuários</span>
                    <span className="text-base font-extrabold text-zinc-900">{condo.user_count || 0}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-zinc-400 uppercase">Casas/Aps</span>
                    <span className="text-base font-extrabold text-zinc-900">{condo.unit_count || 0}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold text-zinc-400 uppercase">Encomendas</span>
                    <span className="text-base font-extrabold text-zinc-900">{condo.package_count || 0}</span>
                  </div>
                </div>
              </div>

              {/* CARD ACTIONS FOOTER */}
              <div className="pt-4 border-t border-zinc-100 flex items-center justify-between gap-2">
                <button
                  onClick={() => openCondoDetail(condo, 'details')}
                  className="flex-1 px-3 py-2 bg-zinc-900 text-white rounded-xl text-xs font-bold hover:bg-zinc-800 transition-all flex items-center justify-center gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Detalhes</span>
                </button>

                <button
                  onClick={() => openCondoDetail(condo, 'users')}
                  className="p-2 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
                  title="Ver Usuários"
                >
                  <Users className="w-4 h-4" />
                </button>

                <button
                  onClick={() => handleEditCondominium(condo)}
                  className="p-2 text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-xl transition-colors"
                  title="Editar Condomínio"
                >
                  <Edit2 className="w-4 h-4" />
                </button>

                <button
                  onClick={() => handleToggleStatus(condo)}
                  className={`p-2 rounded-xl transition-colors ${
                    condo.active !== false 
                      ? 'text-amber-600 bg-amber-50 hover:bg-amber-100' 
                      : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                  }`}
                  title={condo.active !== false ? 'Inativar Condomínio' : 'Ativar Condomínio'}
                >
                  <Power className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setDeleteCondoConfirm(condo)}
                  className="p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition-colors"
                  title="Excluir Condomínio"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-zinc-100 p-16 text-center">
          <div className="w-20 h-20 bg-zinc-50 text-zinc-300 rounded-full flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-10 h-10" />
          </div>
          <h3 className="text-xl font-bold text-zinc-900 mb-1">Nenhum condomínio encontrado</h3>
          <p className="text-zinc-500 text-sm max-w-md mx-auto mb-6">Não foi possível encontrar nenhum condomínio correspondente aos filtros aplicados.</p>
          <button
            onClick={() => {
              setSearchTerm('');
              setCityFilter('');
              setCnpjFilter('');
              setStatusFilter('all');
            }}
            className="px-5 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold rounded-xl text-xs"
          >
            Limpar Filtros
          </button>
        </div>
      )}

      {/* MODAL DETALHES DO CONDOMÍNIO & USUÁRIOS VINCULADOS */}
      {selectedCondo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-6 bg-zinc-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-emerald-500/20 text-emerald-400 rounded-2xl flex items-center justify-center">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold">{selectedCondo.name}</h2>
                  <p className="text-xs text-zinc-400">{selectedCondo.address}</p>
                </div>
              </div>

              <button
                onClick={() => setSelectedCondo(null)}
                className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="flex border-b border-zinc-200 px-6 bg-zinc-50">
              <button
                onClick={() => setCondoTab('details')}
                className={`px-6 py-4 font-bold text-sm border-b-2 transition-all flex items-center gap-2 ${
                  condoTab === 'details' 
                    ? 'border-emerald-600 text-emerald-600 bg-white' 
                    : 'border-transparent text-zinc-500 hover:text-zinc-900'
                }`}
              >
                <Building className="w-4 h-4" />
                <span>Dados do Condomínio</span>
              </button>

              <button
                onClick={() => setCondoTab('users')}
                className={`px-6 py-4 font-bold text-sm border-b-2 transition-all flex items-center gap-2 ${
                  condoTab === 'users' 
                    ? 'border-emerald-600 text-emerald-600 bg-white' 
                    : 'border-transparent text-zinc-500 hover:text-zinc-900'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Usuários do Condomínio ({condoUsers.length})</span>
              </button>
            </div>

            {/* Modal Content Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {condoTab === 'details' ? (
                <div className="space-y-6">
                  {/* Informações Principais */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Localização e Registro</h4>
                      <div>
                        <span className="text-xs text-zinc-400 block">Nome Oficial</span>
                        <span className="text-sm font-bold text-zinc-900">{selectedCondo.name}</span>
                      </div>
                      <div>
                        <span className="text-xs text-zinc-400 block">CNPJ</span>
                        <span className="text-sm font-semibold text-zinc-800">{selectedCondo.cnpj || 'Não informado'}</span>
                      </div>
                      <div>
                        <span className="text-xs text-zinc-400 block">Endereço Completo</span>
                        <span className="text-sm font-medium text-zinc-800">{selectedCondo.address}</span>
                      </div>
                      <div>
                        <span className="text-xs text-zinc-400 block">Cidade / Estado</span>
                        <span className="text-sm font-medium text-zinc-800">{selectedCondo.city_state || 'Não informado'}</span>
                      </div>
                    </div>

                    <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Responsável e Contato</h4>
                      <div>
                        <span className="text-xs text-zinc-400 block">Síndico / Responsável</span>
                        <span className="text-sm font-bold text-zinc-900">{selectedCondo.manager_name || 'Não cadastrado'}</span>
                      </div>
                      <div>
                        <span className="text-xs text-zinc-400 block">E-mail de Contato</span>
                        <span className="text-sm font-semibold text-zinc-800">{selectedCondo.manager_email || selectedCondo.email || 'Não informado'}</span>
                      </div>
                      <div>
                        <span className="text-xs text-zinc-400 block">Telefone</span>
                        <span className="text-sm font-semibold text-zinc-800">{selectedCondo.manager_phone || selectedCondo.phone || 'Não informado'}</span>
                      </div>
                      <div>
                        <span className="text-xs text-zinc-400 block">Data de Criação</span>
                        <span className="text-sm font-medium text-zinc-800">{new Date(selectedCondo.created_at).toLocaleDateString('pt-BR')}</span>
                      </div>
                    </div>
                  </div>

                  {/* Regras e Observações */}
                  {(selectedCondo.rules || selectedCondo.internal_notes) && (
                    <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 space-y-2 text-xs text-amber-900">
                      {selectedCondo.rules && (
                        <div>
                          <strong className="block text-amber-950 font-bold">Regras do Condomínio:</strong>
                          <p>{selectedCondo.rules}</p>
                        </div>
                      )}
                      {selectedCondo.internal_notes && (
                        <div>
                          <strong className="block text-amber-950 font-bold">Observações Internas:</strong>
                          <p>{selectedCondo.internal_notes}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions Bar for condo details */}
                  <div className="pt-4 border-t border-zinc-100 flex flex-wrap gap-3">
                    <button
                      onClick={() => handleEditCondominium(selectedCondo)}
                      className="px-5 py-2.5 bg-zinc-900 text-white rounded-xl text-xs font-bold hover:bg-zinc-800 transition-all flex items-center gap-2"
                    >
                      <Edit2 className="w-4 h-4" />
                      <span>Editar Dados</span>
                    </button>

                    <button
                      onClick={() => handleToggleStatus(selectedCondo)}
                      className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                        selectedCondo.active !== false 
                          ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' 
                          : 'bg-emerald-600 text-white hover:bg-emerald-700'
                      }`}
                    >
                      <Power className="w-4 h-4" />
                      <span>{selectedCondo.active !== false ? 'Inativar Condomínio' : 'Ativar Condomínio'}</span>
                    </button>

                    <button
                      onClick={() => setDeleteCondoConfirm(selectedCondo)}
                      className="px-5 py-2.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ml-auto"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Excluir Condomínio</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* USUÁRIOS VINCULADOS TAB */
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="text-lg font-bold text-zinc-900">Usuários do Condomínio</h3>
                      <p className="text-xs text-zinc-500">Administradores, Síndicos e Porteiros vinculados</p>
                    </div>

                    <button
                      onClick={() => {
                        resetUserForm();
                        setShowAddUserModal(true);
                      }}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-xs hover:bg-emerald-700 transition-all flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Novo Usuário</span>
                    </button>
                  </div>

                  {usersLoading ? (
                    <div className="py-12 text-center">
                      <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto mb-2" />
                      <p className="text-xs text-zinc-500">Buscando usuários...</p>
                    </div>
                  ) : condoUsers.length > 0 ? (
                    <div className="overflow-x-auto rounded-2xl border border-zinc-100">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-zinc-50 text-xs font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-100">
                            <th className="px-4 py-3">Nome</th>
                            <th className="px-4 py-3">Perfil</th>
                            <th className="px-4 py-3">Contato</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3 text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 text-xs">
                          {condoUsers.map((u) => (
                            <tr key={u.id} className="hover:bg-zinc-50/50 transition-colors">
                              <td className="px-4 py-3 font-bold text-zinc-900">
                                <div>{u.full_name}</div>
                                {u.email && <div className="text-[11px] text-zinc-400 font-normal">{u.email}</div>}
                              </td>

                              <td className="px-4 py-3">
                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wider ${getRoleBadge(u.role)}`}>
                                  {getRoleLabel(u.role)}
                                </span>
                              </td>

                              <td className="px-4 py-3 text-zinc-600">
                                {u.phone || 'Sem telefone'}
                              </td>

                              <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  u.active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'
                                }`}>
                                  {u.active !== false ? 'Ativo' : 'Inativo'}
                                </span>
                              </td>

                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => openUserEditModal(u)}
                                    className="p-1.5 hover:bg-zinc-100 rounded-lg text-zinc-600"
                                    title="Editar Usuário"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>

                                  <button
                                    onClick={() => handleToggleUserStatus(u)}
                                    className="p-1.5 hover:bg-amber-50 rounded-lg text-amber-600"
                                    title={u.active !== false ? 'Inativar' : 'Ativar'}
                                  >
                                    <Power className="w-3.5 h-3.5" />
                                  </button>

                                  <button
                                    onClick={() => setUserToReset(u)}
                                    className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600"
                                    title="Resetar Senha"
                                  >
                                    <Key className="w-3.5 h-3.5" />
                                  </button>

                                  <button
                                    onClick={() => setUserToDelete(u)}
                                    className="p-1.5 hover:bg-red-50 rounded-lg text-red-600"
                                    title="Excluir Usuário"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-8 text-center bg-zinc-50 rounded-2xl border border-zinc-100">
                      <p className="text-xs text-zinc-500">Nenhum usuário cadastrado neste condomínio.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL ADICIONAR / EDITAR CONDOMÍNIO */}
      {(showCreateModal || editingCondo) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in zoom-in-95 duration-200 overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-100">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-zinc-900">
                    {editingCondo ? 'Editar Condomínio' : 'Novo Condomínio'}
                  </h2>
                  <p className="text-xs text-zinc-500">Preencha os dados do condomínio para gerenciar no sistema</p>
                </div>
              </div>

              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingCondo(null);
                }}
                className="p-2 text-zinc-400 hover:text-zinc-600 rounded-xl"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={editingCondo ? handleUpdateCondominium : handleCreateCondominium} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                    Nome do Condomínio *
                  </label>
                  <input
                    type="text"
                    required
                    value={condoForm.name}
                    onChange={(e) => setCondoForm({ ...condoForm, name: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                    placeholder="Ex: Condomínio Belle Ville"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                    CNPJ
                  </label>
                  <input
                    type="text"
                    value={condoForm.cnpj}
                    onChange={(e) => setCondoForm({ ...condoForm, cnpj: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                    placeholder="00.000.000/0001-00"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                    CEP
                  </label>
                  <input
                    type="text"
                    value={condoForm.zip_code}
                    onChange={(e) => setCondoForm({ ...condoForm, zip_code: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                    placeholder="00000-000"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                    Endereço Completo *
                  </label>
                  <input
                    type="text"
                    required
                    value={condoForm.address}
                    onChange={(e) => setCondoForm({ ...condoForm, address: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                    placeholder="Av. Principal, 1000 - Bairro Central"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                    Cidade
                  </label>
                  <input
                    type="text"
                    value={condoForm.city}
                    onChange={(e) => setCondoForm({ ...condoForm, city: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                    placeholder="São Paulo"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                    Estado (UF)
                  </label>
                  <input
                    type="text"
                    maxLength={2}
                    value={condoForm.state}
                    onChange={(e) => setCondoForm({ ...condoForm, state: e.target.value.toUpperCase() })}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium uppercase"
                    placeholder="SP"
                  />
                </div>

                <div className="sm:col-span-2 pt-2 border-t border-zinc-100">
                  <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Dados do Síndico / Responsável</h4>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                    Nome do Responsável
                  </label>
                  <input
                    type="text"
                    value={condoForm.manager_name}
                    onChange={(e) => setCondoForm({ ...condoForm, manager_name: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                    placeholder="Carlos Silva"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                    E-mail do Responsável
                  </label>
                  <input
                    type="email"
                    value={condoForm.manager_email}
                    onChange={(e) => setCondoForm({ ...condoForm, manager_email: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                    placeholder="sindico@condominio.com"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                    Telefone
                  </label>
                  <input
                    type="text"
                    value={condoForm.manager_phone}
                    onChange={(e) => setCondoForm({ ...condoForm, manager_phone: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                    placeholder="(11) 99999-9999"
                  />
                </div>

                <div className="flex items-center pt-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={condoForm.active}
                      onChange={(e) => setCondoForm({ ...condoForm, active: e.target.checked })}
                      className="w-4 h-4 text-emerald-600 rounded border-zinc-300 focus:ring-emerald-500"
                    />
                    <span className="text-sm font-bold text-zinc-800">Condomínio Ativo</span>
                  </label>
                </div>

                {/* SEÇÃO USUÁRIOS DO CONDOMÍNIO (Criação de novos condomínios) */}
                {!editingCondo && (
                  <div className="sm:col-span-2 pt-6 border-t border-zinc-200 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-50 p-4 rounded-2xl border border-zinc-200">
                      <div>
                        <div className="flex items-center gap-2">
                          <UserPlus className="w-5 h-5 text-emerald-600" />
                          <h3 className="text-sm font-extrabold text-zinc-900 uppercase tracking-wider">
                            USUÁRIOS DO CONDOMÍNIO ({initialUsers.length})
                          </h3>
                        </div>
                        <p className="text-xs text-zinc-500 mt-1">
                          Cadastre previamente os usuários (síndicos, porteiros, zeladores, administradores) pertencentes a este condomínio.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={handleOpenAddInitialUserModal}
                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 shrink-0"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Adicionar Usuário</span>
                      </button>
                    </div>

                    {/* LISTA DE USUÁRIOS A SEREM CRIADOS */}
                    {initialUsers.length > 0 ? (
                      <div className="grid grid-cols-1 gap-2.5 max-h-60 overflow-y-auto pr-1">
                        {initialUsers.map((u, idx) => {
                          const badge = getRoleLabelAndColor(u.role);
                          return (
                            <div
                              key={u.tempId || idx}
                              className="flex items-center justify-between p-3.5 bg-white rounded-2xl border border-zinc-200 hover:border-zinc-300 shadow-sm transition-all"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl flex items-center justify-center font-bold text-sm shrink-0">
                                  {u.full_name.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-bold text-zinc-900 truncate">
                                      {u.full_name}
                                    </span>
                                    <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded-md border ${badge.bg}`}>
                                      {badge.label}
                                    </span>
                                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md ${
                                      u.active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                                    }`}>
                                      {u.active ? 'Ativo' : 'Inativo'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5 flex-wrap">
                                    <span>{u.email}</span>
                                    {u.phone && <span>• {u.phone}</span>}
                                    {u.cpf && <span>• CPF: {u.cpf}</span>}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0 ml-2">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditInitialUserModal(idx)}
                                  className="p-2 hover:bg-zinc-100 text-zinc-600 rounded-lg transition-colors"
                                  title="Editar usuário"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleRemoveInitialUser(idx)}
                                  className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-colors"
                                  title="Remover usuário"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-6 text-center bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                        <p className="text-xs text-zinc-500 font-medium">
                          Nenhum usuário adicionado ainda. Clique no botão acima "+ Adicionar Usuário" para cadastrar síndicos, porteiros, zeladores, etc.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingCondo(null);
                  }}
                  className="flex-1 py-3 px-4 rounded-xl font-bold text-zinc-600 hover:bg-zinc-100 transition-all text-sm"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 py-3 px-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{editingCondo ? 'Salvar Alterações' : 'Cadastrar Condomínio'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL ADICIONAR / EDITAR USUÁRIO DENTRO DO CONDOMÍNIO */}
      {(showAddUserModal || userToEdit) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in zoom-in-95 duration-200">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
              <h3 className="text-lg font-bold text-zinc-900">
                {userToEdit ? 'Editar Usuário' : 'Novo Usuário do Condomínio'}
              </h3>
              <button
                onClick={() => {
                  setShowAddUserModal(false);
                  setUserToEdit(null);
                }}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={userToEdit ? handleUpdateUser : handleCreateUserInCondo} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  required
                  value={userForm.full_name}
                  onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                  placeholder="Nome do usuário"
                />
              </div>

              {!userToEdit && (
                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                    E-mail *
                  </label>
                  <input
                    type="email"
                    required
                    value={userForm.email}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                    placeholder="email@exemplo.com"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                  Telefone / WhatsApp
                </label>
                <input
                  type="text"
                  value={userForm.phone}
                  onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                  placeholder="(11) 99999-9999"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                  Perfil de Acesso *
                </label>
                <select
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value as Role })}
                  className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium bg-white"
                >
                  <option value="sindico">Síndico</option>
                  <option value="porteiro">Porteiro</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddUserModal(false);
                    setUserToEdit(null);
                  }}
                  className="flex-1 py-2.5 px-4 rounded-xl font-bold text-zinc-600 hover:bg-zinc-100 transition-all text-xs"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 py-2.5 px-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all text-xs flex items-center justify-center gap-2"
                >
                  {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{userToEdit ? 'Salvar' : 'Criar Usuário'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL RESET DE SENHA DE USUÁRIO */}
      {userToReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
                <Key className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-zinc-900">Resetar Senha</h3>
            </div>

            <p className="text-xs text-zinc-600">
              Deseja redefinir a senha do usuário <strong>{userToReset.full_name}</strong>? Uma nova senha temporária será gerada.
            </p>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setUserToReset(null)}
                className="flex-1 py-2 px-3 bg-zinc-100 text-zinc-700 font-bold rounded-xl text-xs"
              >
                Cancelar
              </button>
              <button
                onClick={executeResetUserPassword}
                disabled={actionLoading}
                className="flex-1 py-2 px-3 bg-blue-600 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirmar Reset</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EXIBIÇÃO DE SENHA RESETADA */}
      {resetSuccessData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
                <Check className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-zinc-900">Senha Redefinida!</h3>
            </div>

            <p className="text-xs text-zinc-600">
              Nova senha para <strong>{resetSuccessData.user.full_name}</strong>:
            </p>

            <div className="bg-zinc-900 text-emerald-400 p-3 rounded-xl font-mono text-center text-lg font-bold flex items-center justify-between">
              <span>{resetSuccessData.tempPassword}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(resetSuccessData.tempPassword);
                  setCopiedPassword(true);
                  toast.success('Senha copiada!');
                  setTimeout(() => setCopiedPassword(false), 2000);
                }}
                className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-xs flex items-center gap-1"
              >
                {copiedPassword ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            <button
              onClick={() => setResetSuccessData(null)}
              className="w-full py-2.5 bg-emerald-600 text-white font-bold rounded-xl text-xs"
            >
              Concluir
            </button>
          </div>
        </div>
      )}

      {/* MODAL EXCLUIR USUÁRIO */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 text-red-600 rounded-xl flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-zinc-900">Excluir Usuário</h3>
            </div>

            <p className="text-xs text-zinc-600">
              Tem certeza que deseja excluir permanentemente o usuário <strong>{userToDelete.full_name}</strong>?
            </p>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setUserToDelete(null)}
                className="flex-1 py-2 px-3 bg-zinc-100 text-zinc-700 font-bold rounded-xl text-xs"
              >
                Cancelar
              </button>
              <button
                onClick={executeDeleteUser}
                disabled={actionLoading}
                className="flex-1 py-2 px-3 bg-red-600 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Excluir</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONFIRMAÇÃO EXCLUSÃO DE CONDOMÍNIO */}
      {deleteCondoConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-zinc-900">Excluir Condomínio</h3>
                <p className="text-xs text-red-600 font-bold uppercase">Ação Irreversível</p>
              </div>
            </div>

            <p className="text-sm text-zinc-600">
              Deseja realmente remover o condomínio <strong>{deleteCondoConfirm.name}</strong> do sistema?
            </p>

            <div className="bg-zinc-50 p-3 rounded-xl text-xs space-y-1 text-zinc-600">
              <p>• Usuários vinculados: <strong>{deleteCondoConfirm.user_count || 0}</strong></p>
              <p>• Encomendas vinculadas: <strong>{deleteCondoConfirm.package_count || 0}</strong></p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setDeleteCondoConfirm(null)}
                className="flex-1 py-3 bg-zinc-100 text-zinc-700 font-bold rounded-xl text-xs"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDeleteCondominium(false)}
                disabled={deleteLoading}
                className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2"
              >
                {deleteLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Excluir Condomínio</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL SUB-FORMULÁRIO PARA ADICIONAR/EDITAR USUÁRIO DA LISTA INICIAL */}
      {showAddInitialUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in zoom-in-95 duration-200">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
                  <UserPlus className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-zinc-900">
                  {editingInitialUserIndex !== null ? 'Editar Usuário do Condomínio' : 'Adicionar Usuário ao Condomínio'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddInitialUserModal(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveInitialUser} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  required
                  value={initialUserForm.full_name}
                  onChange={(e) => setInitialUserForm({ ...initialUserForm, full_name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                  placeholder="Ex: Carlos Roberto Silva"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                    Perfil / Função *
                  </label>
                  <select
                    value={initialUserForm.role}
                    onChange={(e) => setInitialUserForm({ ...initialUserForm, role: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium bg-white"
                  >
                    <option value="sindico">Síndico</option>
                    <option value="porteiro">Porteiro</option>
                    <option value="zelador">Zelador</option>
                    <option value="admin">Administrador</option>
                    <option value="resident">Morador</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                    Status
                  </label>
                  <select
                    value={initialUserForm.active ? 'true' : 'false'}
                    onChange={(e) => setInitialUserForm({ ...initialUserForm, active: e.target.value === 'true' })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium bg-white"
                  >
                    <option value="true">Ativo</option>
                    <option value="false">Inativo</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                  E-mail *
                </label>
                <input
                  type="email"
                  required
                  value={initialUserForm.email}
                  onChange={(e) => setInitialUserForm({ ...initialUserForm, email: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                  placeholder="usuario@condominio.com"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                    Telefone / Contato
                  </label>
                  <input
                    type="text"
                    value={initialUserForm.phone}
                    onChange={(e) => setInitialUserForm({ ...initialUserForm, phone: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                    placeholder="(11) 99999-9999"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                    CPF
                  </label>
                  <input
                    type="text"
                    value={initialUserForm.cpf}
                    onChange={(e) => setInitialUserForm({ ...initialUserForm, cpf: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                    placeholder="000.000.000-00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1">
                  Senha Inicial
                </label>
                <input
                  type="text"
                  value={initialUserForm.password}
                  onChange={(e) => setInitialUserForm({ ...initialUserForm, password: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                  placeholder="Geração automática se em branco"
                />
                <p className="text-[11px] text-zinc-400 mt-1">
                  Se deixado em branco, o sistema gerará uma senha temporária automaticamente.
                </p>
              </div>

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddInitialUserModal(false)}
                  className="flex-1 py-2.5 px-3 rounded-xl font-bold text-zinc-600 hover:bg-zinc-100 text-xs transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition-all shadow-sm"
                >
                  {editingInitialUserIndex !== null ? 'Salvar Alterações' : 'Adicionar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
