import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Profile, Role } from '../types';
import { UserPlus, ArrowLeft, Loader2, User, Phone, Home, Shield } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { registrarAuditoria } from '../services/auditService';

interface ProfileNewProps {
  user: Profile;
}

export default function ProfileNew({ user }: ProfileNewProps) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('resident');
  const [unitType, setUnitType] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [block, setBlock] = useState('');
  const [lote, setLote] = useState('');
  const [street, setStreet] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: newResident, error } = await supabase
        .from('moradores')
        .insert([{
          nome: fullName,
          telefone: phone,
          unidade: unitNumber,
          unit_type: unitType,
          block: block,
          lote: lote,
          street: street,
          condominium_id: user.condominium_id,
          ativo: true
        }])
        .select()
        .single();

      if (error) throw error;
      
      await registrarAuditoria({
        condominio_id: user.condominium_id || '',
        usuario_id: user.id,
        usuario_nome: user.full_name,
        usuario_perfil: user.role,
        tipo_evento: 'MORADOR_CRIADO',
        acao: 'CREATE',
        tabela_afetada: 'moradores',
        registro_id: newResident.id,
        descricao: `Morador criado: ${fullName} - ${unitNumber}`,
        metodo: 'MANUAL'
      });

      toast.success('Morador cadastrado com sucesso!');
      navigate('/portaria?tab=residents');
    } catch (error: any) {
      toast.error('Erro ao cadastrar morador: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <button 
        onClick={() => navigate(-1)} 
        className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 mb-6 transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
        Voltar
      </button>

      <div className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center">
            <UserPlus className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Novo Morador</h1>
            <p className="text-zinc-500">Cadastre um novo morador no sistema</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-2">
              Nome Completo
            </label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full pl-12 pr-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                placeholder="Ex: João Silva"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-2">
                Telefone
              </label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                  placeholder="(00) 00000-0000"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-2">
                Unidade
              </label>
              <div className="relative">
                <Home className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
                <input
                  type="text"
                  value={unitNumber}
                  onChange={(e) => setUnitNumber(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                  placeholder="Ex: 101"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-2">
                Tipo de Unidade
              </label>
              <select
                value={unitType}
                onChange={(e) => setUnitType(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all bg-white"
              >
                <option value="">Selecione o tipo</option>
                <option value="Apartamento">Apartamento</option>
                <option value="Casa">Casa</option>
                <option value="Sobrado">Sobrado</option>
                <option value="Lote">Lote</option>
                <option value="Sala">Sala</option>
                <option value="Outro">Outro</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-2">
                Bloco / Torre (Opcional)
              </label>
              <input
                type="text"
                value={block}
                onChange={(e) => setBlock(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                placeholder="Ex: Bloco A"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-2">
                Lote / Quadra (Opcional)
              </label>
              <input
                type="text"
                value={lote}
                onChange={(e) => setLote(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                placeholder="Ex: Lote 4"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-sm font-medium text-zinc-700 mb-2">
                Rua / Endereço (Opcional)
              </label>
              <input
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                placeholder="Ex: Rua das Palmeiras"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 text-white py-4 rounded-xl font-bold hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-5 h-5 animate-spin" />}
            Cadastrar Morador
          </button>
        </form>
      </div>
    </div>
  );
}
