import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';
import { Users, Plus, Loader2, Search, User, Phone, Home, Shield, Trash2, MoreVertical, Edit, Power, X } from 'lucide-react';
import { formatResidentAddress } from '../lib/residentUtils';
import { toast } from 'react-hot-toast';
import { logAction } from '../services/auditService';

interface ProfileListProps {
  user: Profile;
}

export default function ProfileList({ user }: ProfileListProps) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeResidentMenu, setActiveResidentMenu] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    role: 'porteiro' as any,
    active: true
  });
  const [condoSettings, setCondoSettings] = useState<any>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchSettings();
    fetchProfiles();
  }, [user.condominium_id]);

  const fetchSettings = async () => {
    if (!user.condominium_id) return;
    const { data } = await supabase
      .from('condominium_settings')
      .select('*')
      .eq('condominium_id', user.condominium_id)
      .maybeSingle();
    if (data) setCondoSettings(data);
  };

  const fetchProfiles = async () => {
    if (!user.condominium_id) return;
    try {
      // Fetch residents from moradores
      let query = supabase
        .from('moradores')
        .select('*')
        .eq('condominium_id', user.condominium_id);
      
      if (condoSettings?.light_mode_enabled) {
        query = query.limit(100);
      }

      const { data: residentsData, error: residentsError } = await query;

      if (residentsError) throw residentsError;

      // Map residents to Profile-like structure
      const mappedResidents: Profile[] = (residentsData || []).map(r => ({
        id: r.id,
        full_name: r.nome,
        phone: r.telefone,
        role: 'resident' as any,
        condominium_id: r.condominium_id,
        unidade: r.unidade,
        unit_type: r.unit_type,
        block: r.block,
        street: r.street,
        active: r.ativo,
        created_at: r.created_at
      }));

      setProfiles(mappedResidents.sort((a, b) => a.full_name.localeCompare(b.full_name)));
    } catch (error) {
      console.error('Erro ao buscar moradores:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteResident = async (profile: Profile) => {
    if (profile.role !== 'resident') return;
    if (!confirm('O morador será removido da lista ativa, mas o histórico de encomendas será preservado. Deseja continuar?')) return;

    try {
      setLoading(true);
      
      // Soft delete in moradores table
      const { error: errorMorador } = await supabase
        .from('moradores')
        .update({ ativo: false })
        .eq('id', profile.id);

      if (errorMorador) throw errorMorador;

      // Also try to deactivate in profiles table if it exists
      await supabase
        .from('profiles')
        .update({ active: false })
        .eq('id', profile.id);

      await logAction(
        user.id,
        user.condominium_id,
        'DELETE_RESIDENT',
        'moradores',
        profile.id,
        profile,
        { active: false }
      );

      toast.success('Morador excluído com sucesso!');
      fetchProfiles();
    } catch (error: any) {
      console.error('Erro ao excluir morador:', error);
      toast.error('Erro ao excluir morador: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleResidentStatus = async (profile: Profile) => {
    if (profile.role !== 'resident') return;
    try {
      setLoading(true);
      const newStatus = !profile.active;
      
      const { error } = await supabase
        .from('moradores')
        .update({ ativo: newStatus })
        .eq('id', profile.id);

      if (error) throw error;

      await logAction(
        user.id,
        user.condominium_id,
        newStatus ? 'ACTIVATE_RESIDENT' : 'DEACTIVATE_RESIDENT',
        'moradores',
        profile.id,
        profile,
        { active: newStatus }
      );

      toast.success(`Morador ${newStatus ? 'ativado' : 'desativado'} com sucesso!`);
      fetchProfiles();
    } catch (error: any) {
      console.error('Erro ao alterar status do morador:', error);
      toast.error('Erro ao alterar status: ' + error.message);
    } finally {
      setLoading(false);
      setActiveResidentMenu(null);
    }
  };

  const toggleStaffStatus = async (profile: Profile) => {
    if (profile.role === 'resident') return;
    try {
      setLoading(true);
      const newStatus = !profile.active;
      
      const { error } = await supabase
        .from('profiles')
        .update({ active: newStatus })
        .eq('id', profile.id);

      if (error) throw error;

      await logAction(
        user.id,
        user.condominium_id,
        newStatus ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
        'profiles',
        profile.id,
        profile,
        { active: newStatus }
      );

      toast.success(`Usuário ${newStatus ? 'ativado' : 'inativado'} com sucesso!`);
      fetchProfiles();
    } catch (error: any) {
      console.error('Erro ao alterar status do usuário:', error);
      toast.error('Erro ao alterar status: ' + error.message);
    } finally {
      setLoading(false);
      setActiveResidentMenu(null);
    }
  };

  const handleOpenEditModal = (profile: Profile) => {
    setEditingProfile(profile);
    setFormData({
      full_name: profile.full_name,
      phone: profile.phone || '',
      role: profile.role,
      active: profile.active
    });
    setShowEditModal(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProfile) return;
    
    setModalLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name,
          phone: formData.phone,
          role: formData.role,
          active: formData.active,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingProfile.id);

      if (error) throw error;

      await logAction(
        user.id,
        user.condominium_id,
        'UPDATE_PROFILE',
        'profiles',
        editingProfile.id,
        editingProfile,
        formData
      );

      toast.success('Perfil atualizado com sucesso!');
      setShowEditModal(false);
      fetchProfiles();
    } catch (error: any) {
      toast.error('Erro ao salvar perfil: ' + error.message);
    } finally {
      setModalLoading(false);
    }
  };

  const filteredProfiles = profiles.filter(p => 
    p.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.phone.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.unidade?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getRoleBadge = (role: string) => {
    const variants: any = {
      resident: 'bg-blue-100 text-blue-700',
      porteiro: 'bg-amber-100 text-amber-700',
      sindico: 'bg-emerald-100 text-emerald-700',
      admin: 'bg-red-100 text-red-700'
    };
    const labels: any = {
      resident: 'Morador',
      porteiro: 'Porteiro',
      sindico: 'Síndico',
      admin: 'Admin'
    };
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${variants[role] || 'bg-zinc-100 text-zinc-600'}`}>
        {labels[role] || role}
      </span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Moradores</h1>
          <p className="text-zinc-500">Gerencie os moradores do condomínio</p>
        </div>
        {(user.role === 'admin' || user.role === 'sindico') && (
          <button
            onClick={() => navigate('/profiles/new')}
            className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Novo Morador
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
          placeholder="Buscar por nome, telefone ou unidade..."
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
        </div>
      ) : filteredProfiles.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProfiles.map((profile) => (
            <div 
              key={profile.id}
              className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-6 hover:shadow-md transition-all group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 bg-zinc-50 text-emerald-600 rounded-2xl flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                  <User className="w-6 h-6" />
                </div>
                <div className="flex items-center gap-2">
                  {!profile.active && profile.role === 'resident' && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700">
                      Inativo
                    </span>
                  )}
                  <div className="relative">
                    <button
                      onClick={() => setActiveResidentMenu(activeResidentMenu === profile.id ? null : profile.id)}
                      className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-all"
                      title="Ações"
                    >
                      <MoreVertical className="w-5 h-5" />
                    </button>

                    {activeResidentMenu === profile.id && (
                      <>
                        <div 
                          className="fixed inset-0 z-10" 
                          onClick={() => setActiveResidentMenu(null)}
                        />
                        <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-zinc-100 py-2 z-20 overflow-hidden animate-in fade-in zoom-in duration-200 origin-top-right">
                          <button
                            onClick={() => {
                              if (profile.role === 'resident') {
                                navigate('/portaria?tab=residents');
                                toast.success("Localize o morador e clique em Editar");
                              } else {
                                handleOpenEditModal(profile);
                              }
                              setActiveResidentMenu(null);
                            }}
                            className="w-full px-4 py-3 text-left text-sm font-bold text-zinc-700 hover:bg-zinc-50 flex items-center gap-3 transition-colors"
                          >
                            <Edit className="w-4 h-4 text-emerald-600" />
                            {profile.role === 'resident' ? 'Editar Morador' : 'Editar Perfil'}
                          </button>

                          {profile.role !== 'resident' && user.role === 'admin' && (
                            <button
                              onClick={() => {
                                toggleStaffStatus(profile);
                                setActiveResidentMenu(null);
                              }}
                              className={`w-full px-4 py-3 text-left text-sm font-bold flex items-center gap-3 transition-colors ${profile.active ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`}
                            >
                              <Power className="w-4 h-4" />
                              {profile.active ? 'Inativar Usuário' : 'Reativar Usuário'}
                            </button>
                          )}

                          {profile.role === 'resident' && (user.role === 'admin' || user.role === 'sindico') && (
                            <>
                              <button
                                onClick={() => toggleResidentStatus(profile)}
                                className={`w-full px-4 py-3 text-left text-sm font-bold flex items-center gap-3 transition-colors ${profile.active ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`}
                              >
                                <Power className="w-4 h-4" />
                                {profile.active ? 'Desativar Morador' : 'Ativar Morador'}
                              </button>

                              <div className="h-px bg-zinc-100 my-1" />

                              <button
                                onClick={() => {
                                  handleDeleteResident(profile);
                                  setActiveResidentMenu(null);
                                }}
                                className="w-full px-4 py-3 text-left text-sm font-bold text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                                Excluir Morador
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {getRoleBadge(profile.role)}
                </div>
              </div>
              
              <h3 className="text-xl font-bold text-zinc-900 mb-4">{profile.full_name}</h3>
              
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-zinc-500 text-sm">
                  <Phone className="w-4 h-4 flex-shrink-0" />
                  <p>{profile.phone}</p>
                </div>
                {(profile.unidade || profile.unit_type) && (
                  <div className="flex items-center gap-3 text-zinc-500 text-sm">
                    <Home className="w-4 h-4 flex-shrink-0" />
                    <p>{formatResidentAddress(profile)}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-zinc-100 p-20 text-center">
          <div className="w-20 h-20 bg-zinc-50 text-zinc-300 rounded-full flex items-center justify-center mx-auto mb-6">
            <Users className="w-10 h-10" />
          </div>
          <h3 className="text-xl font-bold text-zinc-900 mb-2">Nenhum morador encontrado</h3>
          <p className="text-zinc-500">Comece cadastrando um novo morador no sistema.</p>
        </div>
      )}

      {/* Edit Staff Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-zinc-900">Editar Perfil</h2>
              <button onClick={() => setShowEditModal(false)} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
                <X className="w-5 h-5 text-zinc-400" />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="p-6 space-y-4">
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
                    onChange={e => setFormData({...formData, role: e.target.value as any})}
                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                  >
                    <option value="porteiro">Porteiro</option>
                    <option value="sindico">Síndico</option>
                    <option value="admin">Administrador</option>
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

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
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
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
