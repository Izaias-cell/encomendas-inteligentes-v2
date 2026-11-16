import { getPackageItemCount } from '../lib/packageUtils';
import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { api } from '../lib/apiClient';
import { toast } from 'react-hot-toast';
import { Profile, Package } from '../types';
import { formatSafeDateTime, formatSafeDate } from '../lib/dateUtils';
import { 
  LayoutDashboard, 
  Package as PackageIcon, 
  Users, 
  Building, 
  Building2,
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
  X,
  RefreshCw
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
  const [historyStartDate, setHistoryStartDate] = useState<string | null>(null);
  const [periodRange, setPeriodRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [undatedPackagesCount, setUndatedPackagesCount] = useState<number>(0);
  const [statsError, setStatsError] = useState<string | null>(null);
  const activeCondoIdRef = useRef<string | null>(user.condominium_id || null);
  const activeRequestIdRef = useRef<number>(0);
  const [loading, setLoading] = useState(true);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearType, setClearType] = useState<'options' | 'test' | 'inactive' | 'report' | 'allPackages'>('options');
  const [testCounts, setTestCounts] = useState({ residents: 0, porters: 0, packages: 0, testPending: 0, testDelivered: 0 });
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [clearReport, setClearReport] = useState({ residents: 0, porters: 0, packages: 0 });
  const [showCondoModal, setShowCondoModal] = useState(false);
  const [condoLoading, setCondoLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [condoName, setCondoName] = useState('');
  const navigate = useNavigate();

  const [condoFormData, setCondoFormData] = useState({
    name: '',
    address: '',
    city_state: '',
    manager_name: '',
    manager_phone: '',
    manager_email: '',
    rules: '',
    internal_notes: '',
    active: true,
    porters: [{ name: '', phone: '', email: '' }]
  });

  const handleAddPorter = () => {
    setCondoFormData(prev => ({
      ...prev,
      porters: [...prev.porters, { name: '', phone: '', email: '' }]
    }));
  };

  const handleRemovePorter = (index: number) => {
    setCondoFormData(prev => ({
      ...prev,
      porters: prev.porters.filter((_, i) => i !== index)
    }));
  };

  const handlePorterChange = (index: number, field: 'name' | 'phone' | 'email', value: string) => {
    setCondoFormData(prev => ({
      ...prev,
      porters: prev.porters.map((p, i) => i === index ? { ...p, [field]: value } : p)
    }));
  };

  const handleSaveCondo = async () => {
    if (!condoFormData.name || !condoFormData.address) {
      toast.error('Nome e Endereço são obrigatórios.');
      return;
    }

    setCondoLoading(true);
    try {
      const res = await api.post('/api/condominiums/create', condoFormData);
      if (!res.ok) throw new Error(res.error || 'Erro ao cadastrar condomínio');

      toast.success('Condomínio cadastrado com sucesso');
      setShowCondoModal(false);
      // Reset form
      setCondoFormData({
        name: '',
        address: '',
        city_state: '',
        manager_name: '',
        manager_phone: '',
        manager_email: '',
        rules: '',
        internal_notes: '',
        active: true,
        porters: [{ name: '', phone: '', email: '' }]
      });
    } catch (error: any) {
      console.error('Erro ao cadastrar condomínio:', error);
      toast.error('Erro ao cadastrar condomínio: ' + error.message);
    } finally {
      setCondoLoading(false);
    }
  };

  useEffect(() => {
    // Ao trocar de condomínio: limpa imediatamente os indicadores e o período anterior
    setStats({ total: 0, pending: 0, delivered: 0 });
    setHistoryStartDate(null);
    setPeriodRange({ start: null, end: null });
    setUndatedPackagesCount(0);
    setStatsError(null);
    setLoading(true);

    activeCondoIdRef.current = user.condominium_id || null;

    if (!user.condominium_id) {
      setLoading(false);
      return;
    }

    fetchStats();
    fetchCondoName();

    // Atualização ao focar ou retornar para a aba
    const handleFocus = () => {
      fetchStats();
    };

    window.addEventListener('focus', handleFocus);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchStats();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Inscrição no canal Realtime do Supabase para alterações na tabela packages
    let channel: any = null;
    try {
      channel = supabase
        .channel(`dashboard-package-counts-${user.condominium_id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'packages',
            filter: `condominium_id=eq.${user.condominium_id}`
          },
          () => {
            fetchStats();
          }
        )
        .subscribe();
    } catch (e) {
      console.warn('Realtime channel error in Dashboard:', e);
    }

    // Intervalo suave de sincronização periódica (a cada 20 segundos)
    const interval = setInterval(() => {
      fetchStats();
    }, 20000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(interval);
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [user.condominium_id]);

  const fetchCondoName = async () => {
    if (!user.condominium_id) return;
    const currentCondoId = user.condominium_id;
    try {
      const res = await api.get<{ condominium?: { name?: string } | null }>(
        `/api/operational/context?condominiumId=${encodeURIComponent(currentCondoId)}`
      );
      if (res.ok && res.data?.condominium?.name && activeCondoIdRef.current === currentCondoId) {
        setCondoName(res.data.condominium.name);
      }
    } catch (error) {
      console.error('Erro ao buscar nome do condomínio:', error);
    }
  };

  const fetchStats = async () => {
    const targetCondoId = user.condominium_id;
    if (!targetCondoId) {
      setLoading(false);
      return;
    }

    const thisRequestId = ++activeRequestIdRef.current;

    try {
      const res = await api.get<{
        condominium?: { name?: string } | null;
        stats?: { total: number; pending: number; delivered: number };
        periodRange?: { start: string | null; end: string | null };
        undatedPackagesCount?: number;
        testCounts?: { residents: number; porters: number; packages: number; testPending: number; testDelivered: number };
      }>(`/api/operational/dashboard?condominiumId=${encodeURIComponent(targetCondoId)}`);

      if (!res.ok) {
        throw new Error(res.error || 'Erro ao carregar painel');
      }

      if (
        activeCondoIdRef.current !== targetCondoId ||
        activeRequestIdRef.current !== thisRequestId
      ) {
        return;
      }

      const payload = res.data;
      if (payload?.condominium?.name) {
        setCondoName(payload.condominium.name);
      }
      if (payload?.stats) {
        setStats(payload.stats);
      }
      const start = payload?.periodRange?.start || null;
      const end = payload?.periodRange?.end || null;
      setHistoryStartDate(start);
      setPeriodRange({ start, end });
      setUndatedPackagesCount(payload?.undatedPackagesCount ?? 0);
      if (payload?.testCounts) {
        setTestCounts(payload.testCounts);
      }
      setStatsError(null);
    } catch (error: any) {
      if (
        activeCondoIdRef.current === targetCondoId &&
        activeRequestIdRef.current === thisRequestId
      ) {
        console.error('Erro ao buscar estatísticas do Dashboard:', error);
        setStatsError('Não foi possível atualizar os indicadores do condomínio no momento.');
      }
    } finally {
      if (
        activeCondoIdRef.current === targetCondoId &&
        activeRequestIdRef.current === thisRequestId
      ) {
        setLoading(false);
      }
    }
  };

  const handleClearTestData = async () => {
    if (!user.condominium_id) return;
    if (normalizeRole(user.role) !== 'admin') {
      toast.error('Apenas administradores podem realizar esta ação.');
      return;
    }

    setClearing(true);
    try {
      const res = await api.post<{ report?: { residents: number; porters: number; packages: number } }>(
        '/api/operational/packages/clear',
        { condominiumId: user.condominium_id, mode: 'test' }
      );
      if (!res.ok) throw new Error(res.error || 'Erro ao limpar dados de teste');
      setClearReport(res.data?.report || { residents: 0, porters: 0, packages: 0 });
      setClearType('report');
      fetchStats();
    } catch (error: any) {
      console.error('Erro na limpeza:', error);
      toast.error('Erro ao realizar limpeza: ' + error.message);
    } finally {
      setClearing(false);
    }
  };

  const handleClearAllPackages = async () => {
    if (!user.condominium_id) return;
    if (normalizeRole(user.role) !== 'admin') {
      toast.error('Apenas administradores podem realizar esta ação.');
      return;
    }

    if (confirmationPhrase !== 'LIMPAR') {
      toast.error('Por favor, digite LIMPAR para confirmar.');
      return;
    }

    setClearing(true);
    try {
      const res = await api.post('/api/operational/packages/clear', {
        condominiumId: user.condominium_id,
        mode: 'all_packages'
      });
      if (!res.ok) throw new Error(res.error || 'Erro ao excluir encomendas');

      toast.success('Todas as encomendas foram excluídas com sucesso.');
      setShowClearModal(false);
      fetchStats();
    } catch (error: any) {
      console.error('Erro na limpeza total de encomendas:', error);
      toast.error('Erro ao realizar limpeza: ' + error.message);
    } finally {
      setClearing(false);
    }
  };

  const openClearModal = async () => {
    setClearType('options');
    setConfirmationPhrase('');
    setShowClearModal(true);

    if (user.condominium_id) {
      try {
        const res = await api.get<{
          testCounts?: { residents: number; porters: number; packages: number; testPending: number; testDelivered: number };
        }>(`/api/operational/dashboard?condominiumId=${encodeURIComponent(user.condominium_id)}`);
        if (res.ok && res.data?.testCounts) {
          setTestCounts(res.data.testCounts);
        }
      } catch (e) {
        console.warn('Erro ao buscar contagens prévias:', e);
      }
    }
  };

  const handleClearInactiveResidents = async () => {
    if (!user.condominium_id) return;

    if (normalizeRole(user.role) !== 'admin') {
      toast.error('Apenas administradores podem realizar esta ação.');
      return;
    }

    setClearing(true);
    try {
      const res = await api.post('/api/operational/packages/clear', {
        condominiumId: user.condominium_id,
        mode: 'inactive'
      });
      if (!res.ok) throw new Error(res.error || 'Erro ao remover moradores desativados');

      toast.success('Moradores desativados removidos com sucesso.');
      setShowClearModal(false);
      fetchStats();
    } catch (error: any) {
      console.error('Erro ao remover moradores desativados:', error);
      toast.error('Erro ao remover moradores desativados: ' + error.message);
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
            return (
              <>
                <h1 className="text-3xl font-bold text-zinc-900 mb-1">{condoName || 'Carregando...'}</h1>
                {historyStartDate && stats.total > 0 && (
                  <p className="text-sm font-medium text-zinc-500">
                    Primeiro registro com data disponível: {formatSafeDate(historyStartDate)}.
                  </p>
                )}
              </>
            );
          }
          return (
            <>
              <h1 className="text-3xl font-bold text-zinc-900 mb-1">Olá, {user.full_name}!</h1>
              {condoName && (
                <p className="text-base font-semibold text-emerald-800 mb-1 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-emerald-600 inline" />
                  {condoName}
                </p>
              )}
              {historyStartDate && stats.total > 0 && (
                <p className="text-sm font-medium text-zinc-500 mb-1">
                  Primeiro registro com data disponível: {formatSafeDate(historyStartDate)}.
                </p>
              )}
              {role === 'admin' && <p className="text-zinc-500 text-xs">Gerenciamento completo do sistema</p>}
              {role === 'porteiro' && <p className="text-zinc-500 text-xs">Agilidade no registro, recebimento e entrega!</p>}
            </>
          );
        })()}
      </div>

      {statsError ? (
        <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="text-sm font-medium text-amber-900">{statsError}</p>
          </div>
          <button
            onClick={() => { setLoading(true); fetchStats(); }}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Tentar novamente
          </button>
        </div>
      ) : (
        <div className="mb-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

          {stats.total > 0 && (
            <div className="mt-3 px-1 space-y-0.5 text-right md:text-left">
              {periodRange.start && periodRange.end ? (
                <p className="text-xs text-zinc-500 font-medium">
                  {undatedPackagesCount > 0 
                    ? `Datas disponíveis: ${formatSafeDate(periodRange.start)} até ${formatSafeDate(periodRange.end)}`
                    : `Período dos indicadores: ${formatSafeDate(periodRange.start)} até ${formatSafeDate(periodRange.end)}`}
                </p>
              ) : (
                <p className="text-xs text-zinc-400 italic font-medium">
                  Não há datas de recebimento disponíveis.
                </p>
              )}
              {undatedPackagesCount > 0 && (
                <p className="text-[11px] text-zinc-400 font-medium">
                  {undatedPackagesCount} {undatedPackagesCount === 1 ? 'registro sem data de recebimento' : 'registros sem data de recebimento'}
                </p>
              )}
            </div>
          )}
        </div>
      )}

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
            </>
          );
        })()}

        {/* Admin Only Actions */}
        {(() => {
          const role = normalizeRole(user.role);
          return role === 'admin' && (
            <>
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
              <ActionCard 
                title="GESTÃO DE CONDOMÍNIOS" 
                description="Gerencie todos os condomínios cadastrados, usuários e estatísticas da plataforma." 
                icon={Building2} 
                onClick={() => navigate('/condominiums')}
                color="bg-indigo-100 text-indigo-600"
              />
              <ActionCard 
                title="Limpar Dados" 
                description="Remova moradores de teste e todas as encomendas para iniciar o uso real." 
                icon={Trash2} 
                onClick={openClearModal}
                color="bg-amber-100 text-amber-600"
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

      {/* Modal de Cadastro de Condomínio */}
      {showCondoModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl my-8 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-zinc-100 flex justify-between items-center sticky top-0 bg-white z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                  <Building2 className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-zinc-900">Novo Condomínio</h3>
              </div>
              <button 
                onClick={() => setShowCondoModal(false)}
                className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
                title="Fechar"
              >
                <X className="w-5 h-5 text-zinc-400" />
              </button>
            </div>

            <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto">
              {/* Seção 1: Dados do Condomínio */}
              <div className="space-y-6">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Dados Básicos</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-bold text-zinc-700 mb-2">Nome do Condomínio</label>
                    <input 
                      type="text"
                      className="w-full p-4 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Ex: Condomínio Belle Ville"
                      value={condoFormData.name}
                      onChange={(e) => setCondoFormData({...condoFormData, name: e.target.value})}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-bold text-zinc-700 mb-2">Endereço Completo</label>
                    <input 
                      type="text"
                      className="w-full p-4 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Rua, Número, Bairro"
                      value={condoFormData.address}
                      onChange={(e) => setCondoFormData({...condoFormData, address: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-zinc-700 mb-2">Cidade/Estado</label>
                    <input 
                      type="text"
                      className="w-full p-4 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Ex: São Paulo / SP"
                      value={condoFormData.city_state}
                      onChange={(e) => setCondoFormData({...condoFormData, city_state: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-zinc-700 mb-2">Status</label>
                    <select 
                      className="w-full p-4 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                      value={condoFormData.active ? 'true' : 'false'}
                      onChange={(e) => setCondoFormData({...condoFormData, active: e.target.value === 'true'})}
                    >
                      <option value="true">Ativo</option>
                      <option value="false">Inativo</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Seção 2: Síndico */}
              <div className="space-y-6 pt-6 border-t border-zinc-100">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Informações do Síndico</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-bold text-zinc-700 mb-2">Nome do Síndico</label>
                    <input 
                      type="text"
                      className="w-full p-4 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Nome completo"
                      value={condoFormData.manager_name}
                      onChange={(e) => setCondoFormData({...condoFormData, manager_name: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-zinc-700 mb-2">Telefone/WhatsApp</label>
                    <input 
                      type="tel"
                      className="w-full p-4 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="(00) 00000-0000"
                      value={condoFormData.manager_phone}
                      onChange={(e) => setCondoFormData({...condoFormData, manager_phone: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-zinc-700 mb-2">E-mail</label>
                    <input 
                      type="email"
                      className="w-full p-4 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="sindico@exemplo.com"
                      value={condoFormData.manager_email}
                      onChange={(e) => setCondoFormData({...condoFormData, manager_email: e.target.value})}
                    />
                  </div>
                </div>
              </div>

              {/* Seção 3: Porteiros */}
              <div className="space-y-6 pt-6 border-t border-zinc-100">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Porteiros</h4>
                  <button 
                    onClick={handleAddPorter}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    Adicionar outro
                  </button>
                </div>
                {condoFormData.porters.map((porter, index) => (
                  <div key={index} className="p-4 bg-zinc-50 rounded-2xl relative group">
                    {condoFormData.porters.length > 1 && (
                      <button 
                        onClick={() => handleRemovePorter(index)}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-100 text-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remover"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-zinc-500 mb-1">Nome</label>
                        <input 
                          type="text"
                          className="w-full p-3 rounded-lg border border-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                          placeholder="Nome do porteiro"
                          value={porter.name}
                          onChange={(e) => handlePorterChange(index, 'name', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-zinc-500 mb-1">WhatsApp</label>
                        <input 
                          type="tel"
                          className="w-full p-3 rounded-lg border border-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                          placeholder="(00) 00000-0000"
                          value={porter.phone}
                          onChange={(e) => handlePorterChange(index, 'phone', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-zinc-500 mb-1">E-mail (Opcional)</label>
                        <input 
                          type="email"
                          className="w-full p-3 rounded-lg border border-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                          placeholder="Opcional (gerado automaticamente)"
                          value={porter.email}
                          onChange={(e) => handlePorterChange(index, 'email', e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Seção 4: Particularidades */}
              <div className="space-y-6 pt-6 border-t border-zinc-100">
                <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Particularidades e Regras</h4>
                <div>
                  <label className="block text-sm font-bold text-zinc-700 mb-2">Regras/Particularidades</label>
                  <textarea 
                    className="w-full p-4 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500 min-h-[100px]"
                    placeholder="Ex: Horários de entrega, acessibilidade, etc."
                    value={condoFormData.rules}
                    onChange={(e) => setCondoFormData({...condoFormData, rules: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-zinc-700 mb-2">Observações Internas</label>
                  <textarea 
                    className="w-full p-4 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500 min-h-[100px]"
                    placeholder="Notas visíveis apenas para administradores"
                    value={condoFormData.internal_notes}
                    onChange={(e) => setCondoFormData({...condoFormData, internal_notes: e.target.value})}
                  />
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-zinc-100 flex flex-col md:flex-row gap-3 sticky bottom-0 bg-white">
              <button
                onClick={() => setShowCondoModal(false)}
                className="flex-1 py-4 text-zinc-500 font-bold hover:bg-zinc-100 rounded-2xl transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveCondo}
                disabled={condoLoading}
                className="flex-[2] bg-indigo-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all disabled:opacity-50"
              >
                {condoLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Building2 className="w-5 h-5" />}
                Salvar Condomínio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Limpeza de Dados */}
      {showClearModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="p-8">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center">
                    <Trash2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold text-zinc-900">Limpar Dados</h3>
                </div>
                <button 
                  onClick={() => setShowClearModal(false)}
                  disabled={clearing}
                  className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-zinc-400" />
                </button>
              </div>

              {clearType === 'options' ? (
                <div className="space-y-4">
                  <button
                    onClick={() => setClearType('test')}
                    className="w-full text-left p-6 rounded-2xl border border-zinc-100 hover:border-amber-200 hover:bg-amber-50 transition-all group"
                  >
                    <h4 className="font-bold text-zinc-900 mb-1 group-hover:text-amber-700 transition-colors">Limpar dados de teste</h4>
                    <p className="text-sm text-zinc-500">Remove moradores, porteiros e registros que contenham a palavra TESTE.</p>
                  </button>

                  <button
                    onClick={() => setClearType('inactive')}
                    className="w-full text-left p-6 rounded-2xl border border-zinc-100 hover:border-red-200 hover:bg-red-50 transition-all group"
                  >
                    <h4 className="font-bold text-zinc-900 mb-1 group-hover:text-red-700 transition-colors">Limpar moradores desativados</h4>
                    <p className="text-sm text-zinc-500">Remove moradores marcados como inativos/desativados.</p>
                  </button>

                  <button
                    onClick={() => setClearType('allPackages')}
                    className="w-full text-left p-6 rounded-2xl border border-zinc-100 hover:border-blue-200 hover:bg-blue-50 transition-all group"
                  >
                    <h4 className="font-bold text-zinc-900 mb-1 group-hover:text-blue-700 transition-colors">LIMPAR TODAS AS ENCOMENDAS</h4>
                    <p className="text-sm text-zinc-500">Remove todas as encomendas cadastradas, incluindo pendentes, retiradas, baixadas e notificadas.</p>
                  </button>
                </div>
              ) : clearType === 'allPackages' ? (
                <div className="space-y-6">
                  <div className="p-4 bg-red-50 rounded-2xl border border-red-100 flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div className="text-sm text-red-700 space-y-2">
                      <p>Essa ação irá excluir TODAS as encomendas cadastradas no sistema. Essa ação não pode ser desfeita. Para confirmar, digite LIMPAR.</p>
                      <div className="bg-white/50 p-3 rounded-xl border border-red-100 space-y-1">
                        <p className="font-bold">Total a ser removido:</p>
                        <p>• {stats.total} encomendas no total</p>
                        <p>• {stats.pending} encomendas pendentes</p>
                        <p>• {stats.delivered} encomendas baixadas</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-500 mb-2 uppercase tracking-wider">Digite LIMPAR para confirmar</label>
                    <input 
                      type="text"
                      className="w-full p-4 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-red-500 font-bold"
                      placeholder="LIMPAR"
                      value={confirmationPhrase}
                      onChange={(e) => setConfirmationPhrase(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-3">
                    <button
                      onClick={handleClearAllPackages}
                      disabled={clearing || confirmationPhrase !== 'LIMPAR'}
                      className="w-full bg-red-600 text-white py-4 rounded-2xl font-bold hover:bg-red-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-red-100"
                    >
                      {clearing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirmar e Limpar TUDO'}
                    </button>
                    <button
                      onClick={() => setClearType('options')}
                      disabled={clearing}
                      className="w-full bg-zinc-100 text-zinc-600 py-4 rounded-2xl font-bold hover:bg-zinc-200"
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              ) : clearType === 'test' ? (
                <div className="space-y-6">
                  <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-700 space-y-2">
                      <p>Somente registros marcados como teste serão excluídos. Foram encontrados:</p>
                      <ul className="list-disc list-inside font-medium">
                        <li>{testCounts.residents} moradores de teste</li>
                        <li>{testCounts.porters} porteiros de teste</li>
                        <li>{testCounts.packages} encomendas de teste</li>
                      </ul>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <button
                      onClick={handleClearTestData}
                      disabled={clearing}
                      className="w-full bg-amber-600 text-white py-4 rounded-2xl font-bold hover:bg-amber-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {clearing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirmar e Limpar'}
                    </button>
                    <button
                      onClick={() => setClearType('options')}
                      disabled={clearing}
                      className="w-full bg-zinc-100 text-zinc-600 py-4 rounded-2xl font-bold hover:bg-zinc-200"
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              ) : clearType === 'inactive' ? (
                <div className="space-y-6">
                  <div className="p-4 bg-red-50 rounded-2xl border border-red-100 flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">
                      Deseja realmente excluir todos os moradores desativados? Essa ação não pode ser desfeita.
                    </p>
                  </div>

                  <div className="flex flex-col gap-3">
                    <button
                      onClick={handleClearInactiveResidents}
                      disabled={clearing}
                      className="w-full bg-red-600 text-white py-4 rounded-2xl font-bold hover:bg-red-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {clearing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirmar Exclusão'}
                    </button>
                    <button
                      onClick={() => setClearType('options')}
                      disabled={clearing}
                      className="w-full bg-zinc-100 text-zinc-600 py-4 rounded-2xl font-bold hover:bg-zinc-200"
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="p-6 bg-emerald-50 rounded-2xl border border-emerald-100 text-center">
                    <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="w-8 h-8" />
                    </div>
                    <h4 className="text-xl font-bold text-zinc-900 mb-2">Limpeza concluída</h4>
                    <div className="text-zinc-600 space-y-1">
                      <p><span className="font-bold">{clearReport.residents}</span> moradores de teste</p>
                      <p><span className="font-bold">{clearReport.porters}</span> porteiros de teste</p>
                      <p><span className="font-bold">{clearReport.packages}</span> encomendas de teste</p>
                      <p className="mt-2 text-sm italic">Removidos com sucesso.</p>
                    </div>
                  </div>

                  <button
                    onClick={() => setShowClearModal(false)}
                    className="w-full bg-zinc-900 text-white py-4 rounded-2xl font-bold hover:bg-zinc-800 transition-all"
                  >
                    Fechar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
