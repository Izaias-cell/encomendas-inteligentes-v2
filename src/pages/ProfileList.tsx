import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';
import { Users, Plus, Loader2, Search, User, Phone, Home, Shield } from 'lucide-react';
import { formatResidentAddress } from '../lib/residentUtils';

interface ProfileListProps {
  user: Profile;
}

export default function ProfileList({ user }: ProfileListProps) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchProfiles();
  }, [user.condominium_id]);

  const fetchProfiles = async () => {
    if (!user.condominium_id) return;
    try {
      // Fetch staff from profiles
      const { data: staffData, error: staffError } = await supabase
        .from('profiles')
        .select('*')
        .eq('condominium_id', user.condominium_id)
        .neq('role', 'resident');

      if (staffError) throw staffError;

      // Fetch residents from moradores
      const { data: residentsData, error: residentsError } = await supabase
        .from('moradores')
        .select('*')
        .eq('condominium_id', user.condominium_id);

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

      setProfiles([...(staffData || []), ...mappedResidents].sort((a, b) => a.full_name.localeCompare(b.full_name)));
    } catch (error) {
      console.error('Erro ao buscar perfis:', error);
    } finally {
      setLoading(false);
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
          <h1 className="text-3xl font-bold text-zinc-900">Perfis</h1>
          <p className="text-zinc-500">Gerencie moradores e funcionários do condomínio</p>
        </div>
        <button
          onClick={() => navigate('/profiles/new')}
          className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Novo Perfil
        </button>
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
                {getRoleBadge(profile.role)}
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
          <h3 className="text-xl font-bold text-zinc-900 mb-2">Nenhum perfil encontrado</h3>
          <p className="text-zinc-500">Comece cadastrando um novo perfil no sistema.</p>
        </div>
      )}
    </div>
  );
}
