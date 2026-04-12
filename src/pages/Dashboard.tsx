import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { Profile, Package } from '../types';
import { formatSafeDateTime } from '../lib/dateUtils';
import { 
  LayoutDashboard, 
  Package as PackageIcon, 
  Users, 
  Building, 
  Plus, 
  CheckCircle, 
  Clock, 
  TrendingUp,
  ArrowRight,
  Loader2,
  UserPlus,
  Search,
  Settings,
  Shield,
  History
} from 'lucide-react';

import { normalizeRole } from '../lib/authUtils';

interface DashboardProps {
  user: Profile;
}

export default function Dashboard({ user }: DashboardProps) {
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    delivered: 0
  });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchStats();
  }, [user.condominium_id]);

  const fetchStats = async () => {
    if (!user.condominium_id) return;
    try {
      const [allRes, pendingRes, deliveredRes] = await Promise.all([
        supabase
          .from('packages')
          .select('id')
          .eq('condominium_id', user.condominium_id),
        supabase
          .from('packages')
          .select('id')
          .eq('condominium_id', user.condominium_id)
          .neq('status', 'delivered'),
        supabase
          .from('packages')
          .select('id')
          .eq('condominium_id', user.condominium_id)
          .eq('status', 'delivered')
      ]);

      if (allRes.error) console.error('Erro ao buscar todas:', allRes.error);
      if (pendingRes.error) console.error('Erro ao buscar pendentes:', pendingRes.error);
      if (deliveredRes.error) console.error('Erro ao buscar retiradas:', deliveredRes.error);

      setStats({ 
        total: allRes.data?.length || 0, 
        pending: pendingRes.data?.length || 0, 
        delivered: deliveredRes.data?.length || 0 
      });
    } catch (error) {
      console.error('Erro ao buscar estatísticas:', error);
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({ title, value, icon: Icon, color }: any) => (
    <div className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-6 flex items-center gap-6">
      <div className={`w-16 h-16 ${color} rounded-2xl flex items-center justify-center`}>
        <Icon className="w-8 h-8" />
      </div>
      <div>
        <p className="text-zinc-500 text-sm font-medium">{title}</p>
        <p className="text-3xl font-bold text-zinc-900">{value}</p>
      </div>
    </div>
  );

  const ActionCard = ({ title, description, icon: Icon, onClick, color }: any) => (
    <button 
      onClick={onClick}
      className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-8 hover:shadow-md transition-all group text-left flex flex-col items-start"
    >
      <div className={`w-14 h-14 ${color} rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
        <Icon className="w-7 h-7" />
      </div>
      <h3 className="text-xl font-bold text-zinc-900 mb-2">{title}</h3>
      <p className="text-zinc-500 text-sm mb-6 flex-grow">{description}</p>
      <div className="flex items-center gap-2 text-emerald-600 font-bold group-hover:gap-4 transition-all">
        Acessar agora
        <ArrowRight className="w-5 h-5" />
      </div>
    </button>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-zinc-900 mb-2">Olá, {user.full_name}!</h1>
        <p className="text-zinc-500">Bem-vindo ao painel de controle da Portaria Inteligente.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <StatCard 
          title="Total de Pacotes" 
          value={stats.total} 
          icon={PackageIcon} 
          color="bg-blue-100 text-blue-600" 
        />
        <StatCard 
          title="Pacotes Pendentes" 
          value={stats.pending} 
          icon={Clock} 
          color="bg-amber-100 text-amber-600" 
        />
        <StatCard 
          title="Pacotes Entregues" 
          value={stats.delivered} 
          icon={CheckCircle} 
          color="bg-emerald-100 text-emerald-600" 
        />
      </div>

      <h2 className="text-2xl font-bold text-zinc-900 mb-6">Ações Rápidas</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Porter & Manager Actions */}
        {(() => {
          const role = normalizeRole(user.role);
          return (role === 'porteiro' || role === 'sindico' || role === 'admin') && (
            <>
              <ActionCard 
                title="Registrar Encomenda" 
                description="Registre a chegada de uma nova encomenda na portaria." 
                icon={Plus} 
                onClick={() => navigate('/packages/new')}
                color="bg-emerald-100 text-emerald-600"
              />
              <ActionCard 
                title="Ver Encomendas" 
                description="Visualize e gerencie todas as encomendas do condomínio." 
                icon={PackageIcon} 
                onClick={() => navigate('/packages')}
                color="bg-blue-100 text-blue-600"
              />
              <ActionCard 
                title="Moradores" 
                description="Lista completa de moradores e unidades." 
                icon={Users} 
                onClick={() => navigate('/profiles')}
                color="bg-zinc-100 text-zinc-600"
              />
            </>
          );
        })()}

        {/* Manager & Admin Only Actions */}
        {(() => {
          const role = normalizeRole(user.role);
          return (role === 'sindico' || role === 'admin') && (
            <>
              <ActionCard 
                title="Cadastrar Morador" 
                description="Adicione um novo morador ao sistema." 
                icon={UserPlus} 
                onClick={() => navigate('/profiles/new')}
                color="bg-emerald-100 text-emerald-600"
              />
              <ActionCard 
                title="Usuários" 
                description="Controle de acesso para administradores, síndicos e porteiros." 
                icon={Shield} 
                onClick={() => navigate('/users')}
                color="bg-red-100 text-red-600"
              />
              <ActionCard 
                title="Configurações" 
                description="Ajuste as configurações gerais do condomínio." 
                icon={Settings} 
                onClick={() => navigate('/settings')}
                color="bg-zinc-100 text-zinc-600"
              />
            </>
          );
        })()}

        {/* Resident Actions */}
        {normalizeRole(user.role) === 'resident' && (
          <ActionCard 
            title="Minhas Encomendas" 
            description="Veja o histórico e status das suas encomendas." 
            icon={PackageIcon} 
            onClick={() => navigate('/packages')}
            color="bg-emerald-100 text-emerald-600"
          />
        )}
      </div>
    </div>
  );
}
