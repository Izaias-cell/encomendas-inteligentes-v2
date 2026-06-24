import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Condominium } from '../types';
import { Building, Plus, Loader2, Search, MapPin } from 'lucide-react';

export default function CondominiumList() {
  const [condos, setCondos] = useState<Condominium[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
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

  const filteredCondos = condos.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.address.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Condomínios</h1>
          <p className="text-zinc-500">Gerencie os condomínios cadastrados no sistema</p>
        </div>
        <button
          onClick={() => navigate('/condominiums/new')}
          className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Novo Condomínio
        </button>
      </div>

      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-4 rounded-2xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all bg-white"
          placeholder="Buscar por nome ou endereço..."
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
        </div>
      ) : filteredCondos.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCondos.map((condo) => (
            <div 
              key={condo.id}
              className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-6 hover:shadow-md transition-all group"
            >
              <div className="w-12 h-12 bg-zinc-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-emerald-100 transition-colors">
                <Building className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">{condo.name}</h3>
              <div className="flex items-start gap-2 text-zinc-500 text-sm">
                <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>{condo.address}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-zinc-100 p-20 text-center">
          <div className="w-20 h-20 bg-zinc-50 text-zinc-300 rounded-full flex items-center justify-center mx-auto mb-6">
            <Building className="w-10 h-10" />
          </div>
          <h3 className="text-xl font-bold text-zinc-900 mb-2">Nenhum condomínio encontrado</h3>
          <p className="text-zinc-500">Comece cadastrando um novo condomínio no sistema.</p>
        </div>
      )}
    </div>
  );
}
