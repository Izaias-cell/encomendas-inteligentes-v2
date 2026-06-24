import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Condominium, Profile } from '../types';
import { Building, Loader2, Search, MapPin, CheckCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { normalizeRole } from '../lib/authUtils';

interface SelectCondominiumProps {
  user: Profile;
  onUpdateUser: (user: Profile) => void;
}

export default function SelectCondominium({ user, onUpdateUser }: SelectCondominiumProps) {
  const [condos, setCondos] = useState<Condominium[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selecting, setSelecting] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchCondos();
  }, []);

  const fetchCondos = async () => {
    try {
      const { data, error } = await supabase
        .from('condominiums')
        .select('*')
        .order('name');

      if (error) throw error;
      setCondos(data || []);
    } catch (error) {
      console.error('Erro ao buscar condomínios:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (condoId: string) => {
    setSelecting(condoId);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        toast.error('Sessão não encontrada. Por favor, faça login novamente.');
        setSelecting(null);
        return;
      }

      const response = await fetch('/api/profiles/select-condominium', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ condominiumId: condoId })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Erro ao selecionar condomínio');
      }

      toast.success('Condomínio selecionado com sucesso!');
      onUpdateUser(result.profile);
      
      const role = normalizeRole(result.profile.role);
      if (role === 'porteiro') {
        navigate('/portaria');
      } else if (role === 'admin' || role === 'sindico') {
        navigate('/dashboard');
      } else {
        navigate('/dashboard');
      }
    } catch (error: any) {
      toast.error('Erro ao selecionar condomínio: ' + error.message);
    } finally {
      setSelecting(null);
    }
  };

  const filteredCondos = condos.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.address.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="text-center mb-12">
        <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <Building className="w-10 h-10" />
        </div>
        <h1 className="text-3xl font-bold text-zinc-900 mb-2">Selecione seu Condomínio</h1>
        <p className="text-zinc-500 max-w-md mx-auto">
          Para continuar, você precisa estar vinculado a um condomínio cadastrado no sistema.
        </p>
      </div>

      <div className="relative mb-8 flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-4 rounded-2xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all bg-white"
            placeholder="Buscar condomínio por nome ou endereço..."
          />
        </div>
        {(user.role === 'sindico' || user.role === 'admin') && (
          <button 
            onClick={() => navigate('/condominiums/new')}
            className="px-6 py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center gap-2"
          >
            <Building className="w-5 h-5" />
            Novo Condomínio
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
        </div>
      ) : filteredCondos.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredCondos.map((condo) => (
            <button 
              key={condo.id}
              onClick={() => handleSelect(condo.id)}
              disabled={selecting !== null}
              className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-8 hover:shadow-md transition-all group text-left relative overflow-hidden flex flex-col items-start"
            >
              <div className="w-12 h-12 bg-zinc-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-emerald-100 transition-colors">
                <Building className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">{condo.name}</h3>
              <div className="flex items-start gap-2 text-zinc-500 text-sm mb-6">
                <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>{condo.address}</p>
              </div>
              
              <div className="w-full h-12 bg-zinc-50 rounded-xl flex items-center justify-center font-bold text-zinc-600 group-hover:bg-emerald-600 group-hover:text-white transition-all">
                {selecting === condo.id ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  'Selecionar este condomínio'
                )}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-zinc-100 p-20 text-center">
          <div className="w-20 h-20 bg-zinc-50 text-zinc-300 rounded-full flex items-center justify-center mx-auto mb-6">
            <Building className="w-10 h-10" />
          </div>
          <h3 className="text-xl font-bold text-zinc-900 mb-2">Nenhum condomínio encontrado</h3>
          <p className="text-zinc-500">Não encontrou seu condomínio? Entre em contato com o administrador.</p>
        </div>
      )}
    </div>
  );
}
