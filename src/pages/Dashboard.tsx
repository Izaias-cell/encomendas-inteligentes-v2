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
  History,
  Trash2,
  AlertTriangle,
  X
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
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [condoName, setCondoName] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchStats();
    fetchCondoName();
  }, [user.condominium_id]);

  const fetchCondoName = async () => {
    if (!user.condominium_id) return;
    try {
      const { data, error } = await supabase
        .from('condominiums')
        .select('name')
        .eq('id', user.condominium_id)
        .maybeSingle();
      
      if (error) throw error;
      if (data) setCondoName(data.name);
    } catch (error) {
      console.error('Erro ao buscar nome do condomínio:', error);
    }
  };

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

  const handleClearTestData = async () => {
    if (!user.condominium_id) return;
    
    // Security check: Only admin can execute
    if (normalizeRole(user.role) !== 'admin') {
      toast.error('Apenas administradores podem realizar esta ação.');
      return;
    }
    
    setClearing(true);
    try {
      // 1. Excluir logs de retirada primeiro (devido a FKs se houver, embora schema não mostre ON DELETE CASCADE explícito)
      const { error: logsError } = await supabase
        .from('retrieval_logs')
        .delete()
        .eq('condominium_id', user.condominium_id);
      
      if (logsError) console.warn('Erro ao limpar logs:', logsError);

      // 2. Excluir TODAS as encomendas do condomínio
      const { error: pkgError } = await supabase
        .from('packages')
        .delete()
        .eq('condominium_id', user.condominium_id);

      if (pkgError) throw pkgError;

      // 3. Excluir moradores de teste
      // Buscamos moradores que tenham "teste" no nome ou observações
      const { error: resError } = await supabase
        .from('moradores')
        .delete()
        .eq('condominium_id', user.condominium_id)
        .or('nome.ilike.%teste%,observacoes.ilike.%teste%');

      if (resError) console.warn('Erro ao limpar moradores de teste:', resError);

      toast.success('Limpeza concluída com sucesso.');
      setShowClearModal(false);
      fetchStats();
    } catch (error: any) {
      console.error('Erro na limpeza:', error);
      toast.error('Erro ao realizar limpeza: ' + error.message);
    } finally {
      setClearing(false);
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
        {(() => {
          const role = normalizeRole(user.role);
          if (role === 'sindico') {
            return <h1 className="text-3xl font-bold text-zinc-900 mb-2">{condoName || 'Carregando...'}</h1>;
          }
          return (
            <>
              <h1 className="text-3xl font-bold text-zinc-900 mb-2">Olá, {user.full_name}!</h1>
              {role === 'admin' && <p className="text-zinc-500">Gerenciamento completo do sistema</p>}
              {role === 'porteiro' && <p className="text-zinc-500">Agilidade no registro, recebimento e entrega!</p>}
            </>
          );
        })()}
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

        {/* Admin Only Actions */}
        {normalizeRole(user.role) === 'admin' && (
          <ActionCard 
            title="Limpar Dados" 
            description="Remova moradores de teste e todas as encomendas para iniciar o uso real." 
            icon={Trash2} 
            onClick={() => setShowClearModal(true)}
            color="bg-amber-100 text-amber-600"
          />
        )}

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

      {/* Modal de Confirmação de Limpeza */}
      {showClearModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="p-8">
              <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mb-6">
                <AlertTriangle className="w-8 h-8" />
              </div>
              
              <h3 className="text-2xl font-bold text-zinc-900 mb-4">Confirmar Limpeza</h3>
              
              <p className="text-zinc-600 leading-relaxed mb-8">
                Deseja realmente limpar os dados de teste? Esta ação excluirá os moradores marcados com <span className="font-bold text-zinc-900">'teste'</span> e apagará <span className="font-bold text-zinc-900">todos os registros de encomendas</span> do sistema. Os moradores reais permanecerão cadastrados.
              </p>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleClearTestData}
                  disabled={clearing}
                  className="w-full bg-amber-600 text-white py-4 rounded-2xl font-bold hover:bg-amber-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {clearing ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Trash2 className="w-5 h-5" />
                      Confirmar e Limpar
                    </>
                  )}
                </button>
                
                <button
                  onClick={() => setShowClearModal(false)}
                  disabled={clearing}
                  className="w-full bg-zinc-100 text-zinc-600 py-4 rounded-2xl font-bold hover:bg-zinc-200 transition-all disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
