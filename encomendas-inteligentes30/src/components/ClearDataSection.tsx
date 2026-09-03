import React, { useState, useEffect } from 'react';
import { 
  Trash2, 
  AlertTriangle, 
  CheckCircle, 
  Loader2, 
  RefreshCw,
  ShieldAlert,
  Users,
  Package as PackageIcon,
  UserX
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';
import { normalizeRole } from '../lib/authUtils';
import toast from 'react-hot-toast';

interface ClearDataSectionProps {
  user: Profile;
}

export default function ClearDataSection({ user }: ClearDataSectionProps) {
  const [clearing, setClearing] = useState(false);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [clearType, setClearType] = useState<'options' | 'test' | 'inactive' | 'allPackages' | 'done'>('options');
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [clearReport, setClearReport] = useState({ residents: 0, porters: 0, packages: 0 });
  const [testCounts, setTestCounts] = useState({
    residents: 0,
    porters: 0,
    packages: 0,
    testPending: 0,
    testDelivered: 0
  });
  const [inactiveCount, setInactiveCount] = useState(0);
  const [stats, setStats] = useState({ total: 0, pending: 0, delivered: 0 });

  const fetchCounts = async () => {
    if (!user?.condominium_id) return;
    setLoadingCounts(true);
    try {
      const [resC, porterC, pkgC, pkgPendingC, pkgDeliverC, inactiveC] = await Promise.all([
        supabase.from('moradores').select('id', { count: 'exact', head: true }).eq('condominium_id', user.condominium_id).or('nome.ilike.%teste%,observacoes.ilike.%teste%'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('condominium_id', user.condominium_id).ilike('full_name', '%teste%'),
        supabase.from('packages').select('id', { count: 'exact', head: true }).eq('condominium_id', user.condominium_id),
        supabase.from('packages').select('id', { count: 'exact', head: true }).eq('condominium_id', user.condominium_id).neq('status', 'delivered'),
        supabase.from('packages').select('id', { count: 'exact', head: true }).eq('condominium_id', user.condominium_id).eq('status', 'delivered'),
        supabase.from('moradores').select('id', { count: 'exact', head: true }).eq('condominium_id', user.condominium_id).eq('ativo', false)
      ]);

      setTestCounts({
        residents: resC.count || 0,
        porters: porterC.count || 0,
        packages: pkgC.count || 0,
        testPending: pkgPendingC.count || 0,
        testDelivered: pkgDeliverC.count || 0
      });

      setStats({
        total: pkgC.count || 0,
        pending: pkgPendingC.count || 0,
        delivered: pkgDeliverC.count || 0
      });

      setInactiveCount(inactiveC.count || 0);
    } catch (err) {
      console.error('Erro ao carregar contagens de limpeza:', err);
    } finally {
      setLoadingCounts(false);
    }
  };

  useEffect(() => {
    fetchCounts();
  }, [user?.condominium_id]);

  const handleClearTestData = async () => {
    if (!user.condominium_id) return;
    
    if (normalizeRole(user.role) !== 'admin') {
      toast.error('Apenas administradores podem realizar esta ação.');
      return;
    }

    setClearing(true);
    try {
      const { data: testResidents } = await supabase
        .from('moradores')
        .select('id')
        .eq('condominium_id', user.condominium_id)
        .or('nome.ilike.%teste%,observacoes.ilike.%teste%');
      
      const resIds = testResidents?.map(r => r.id) || [];

      const { data: testPorters } = await supabase
        .from('profiles')
        .select('id')
        .eq('condominium_id', user.condominium_id)
        .ilike('full_name', '%teste%');
      
      const porterIds = testPorters?.map(p => p.id) || [];

      const { data: testPkgs } = await supabase
        .from('packages')
        .select('id')
        .eq('condominium_id', user.condominium_id)
        .or('recipient_name.ilike.%teste%,unit.ilike.%teste%');
      
      const pkgIds = testPkgs?.map(p => p.id) || [];

      if (pkgIds.length > 0) {
        await supabase.from('packages').delete().in('id', pkgIds);
      }
      if (resIds.length > 0) {
        await supabase.from('moradores').delete().in('id', resIds);
      }
      if (porterIds.length > 0) {
        await supabase.from('profiles').delete().in('id', porterIds);
      }

      setClearReport({
        residents: resIds.length,
        porters: porterIds.length,
        packages: pkgIds.length
      });

      setClearType('done');
      toast.success('Limpeza de dados de teste concluída com sucesso.');
      fetchCounts();
    } catch (error: any) {
      console.error('Erro na limpeza de dados:', error);
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
      const { data: pkgs } = await supabase
        .from('packages')
        .select('id')
        .eq('condominium_id', user.condominium_id);
      
      const pkgIds = pkgs?.map(p => p.id) || [];
      if (pkgIds.length > 0) {
        await supabase.from('retrieval_logs').delete().in('package_id', pkgIds);
      }
      
      const { error } = await supabase
        .from('packages')
        .delete()
        .eq('condominium_id', user.condominium_id);
      
      if (error) throw error;

      toast.success('Todas as encomendas foram excluídas com sucesso.');
      setConfirmationPhrase('');
      setClearType('options');
      fetchCounts();
    } catch (error: any) {
      console.error('Erro na limpeza total de encomendas:', error);
      toast.error('Erro ao realizar limpeza: ' + error.message);
    } finally {
      setClearing(false);
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
      const { error } = await supabase
        .from('moradores')
        .delete()
        .eq('condominium_id', user.condominium_id)
        .eq('ativo', false);

      if (error) throw error;

      toast.success('Moradores desativados removidos com sucesso.');
      setClearType('options');
      fetchCounts();
    } catch (error: any) {
      console.error('Erro ao remover moradores desativados:', error);
      toast.error('Erro ao remover moradores desativados: ' + error.message);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-amber-600" />
            Limpeza e Manutenção de Dados
          </h2>
          <p className="text-sm text-zinc-500 mt-1">
            Remova moradores de teste, registros desativados e encomendas para reiniciar o uso ou manter o banco limpo.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchCounts}
          disabled={loadingCounts}
          className="self-start sm:self-auto px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-bold rounded-xl transition-all flex items-center gap-2"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingCounts ? 'animate-spin' : ''}`} />
          Atualizar Contagens
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-zinc-200/80 p-6 sm:p-8 shadow-sm">
        {clearType === 'options' && (
          <div className="space-y-4">
            {/* Opção 1: Limpar dados de teste */}
            <div className="border border-amber-200/80 bg-amber-50/40 rounded-2xl p-5 sm:p-6 transition-all hover:bg-amber-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-amber-100 text-amber-700 rounded-xl">
                    <ShieldAlert className="w-5 h-5" />
                  </span>
                  <h3 className="font-bold text-zinc-900">Limpar Dados de Teste</h3>
                </div>
                <p className="text-xs sm:text-sm text-zinc-600 pl-11">
                  Remove moradores, porteiros e registros de teste cadastrados para demonstração.
                </p>
                <div className="pl-11 text-xs text-amber-800 font-medium pt-1">
                  Encontrados: {testCounts.residents} moradores de teste • {testCounts.porters} porteiros de teste • {testCounts.packages} encomendas de teste
                </div>
              </div>
              <button
                type="button"
                onClick={() => setClearType('test')}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs sm:text-sm font-bold px-5 py-3 rounded-xl transition-all shrink-0 self-start sm:self-auto shadow-xs"
              >
                Limpar Testes
              </button>
            </div>

            {/* Opção 2: Limpar moradores desativados */}
            <div className="border border-zinc-200 rounded-2xl p-5 sm:p-6 transition-all hover:bg-zinc-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-zinc-100 text-zinc-700 rounded-xl">
                    <UserX className="w-5 h-5" />
                  </span>
                  <h3 className="font-bold text-zinc-900">Limpar Moradores Desativados</h3>
                </div>
                <p className="text-xs sm:text-sm text-zinc-600 pl-11">
                  Remove do banco todos os moradores que já foram marcados como inativos/desativados.
                </p>
                <div className="pl-11 text-xs text-zinc-500 font-medium pt-1">
                  Encontrados: {inactiveCount} moradores inativos
                </div>
              </div>
              <button
                type="button"
                onClick={() => setClearType('inactive')}
                className="bg-zinc-800 hover:bg-zinc-900 text-white text-xs sm:text-sm font-bold px-5 py-3 rounded-xl transition-all shrink-0 self-start sm:self-auto shadow-xs"
              >
                Limpar Inativos
              </button>
            </div>

            {/* Opção 3: LIMPAR TODAS AS ENCOMENDAS */}
            <div className="border border-red-200 bg-red-50/40 rounded-2xl p-5 sm:p-6 transition-all hover:bg-red-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-red-100 text-red-700 rounded-xl">
                    <PackageIcon className="w-5 h-5" />
                  </span>
                  <h3 className="font-bold text-red-950">LIMPAR TODAS AS ENCOMENDAS</h3>
                </div>
                <p className="text-xs sm:text-sm text-zinc-600 pl-11">
                  Exclui permanentemente todas as encomendas (pendentes, retiradas, entregues e notificações).
                </p>
                <div className="pl-11 text-xs text-red-800 font-medium pt-1">
                  Total no condomínio: {stats.total} ({stats.pending} pendentes, {stats.delivered} retiradas)
                </div>
              </div>
              <button
                type="button"
                onClick={() => setClearType('allPackages')}
                className="bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm font-bold px-5 py-3 rounded-xl transition-all shrink-0 self-start sm:self-auto shadow-xs"
              >
                Limpar Encomendas
              </button>
            </div>
          </div>
        )}

        {clearType === 'test' && (
          <div className="space-y-6 max-w-xl">
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 space-y-2">
                <p className="font-bold">Confirmação de Limpeza de Testes</p>
                <p>Somente registros contendo o termo "TESTE" serão excluídos. Itens a serem removidos:</p>
                <ul className="list-disc list-inside font-medium space-y-0.5 text-xs sm:text-sm">
                  <li>{testCounts.residents} moradores de teste</li>
                  <li>{testCounts.porters} porteiros de teste</li>
                  <li>{testCounts.packages} encomendas de teste</li>
                </ul>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={handleClearTestData}
                disabled={clearing}
                className="flex-1 bg-amber-600 text-white py-3.5 rounded-xl font-bold hover:bg-amber-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm shadow-xs"
              >
                {clearing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirmar e Limpar Testes'}
              </button>
              <button
                type="button"
                onClick={() => setClearType('options')}
                disabled={clearing}
                className="py-3.5 px-6 bg-zinc-100 text-zinc-600 rounded-xl font-bold hover:bg-zinc-200 text-sm"
              >
                Voltar
              </button>
            </div>
          </div>
        )}

        {clearType === 'inactive' && (
          <div className="space-y-6 max-w-xl">
            <div className="p-4 bg-red-50 rounded-2xl border border-red-200 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm text-red-800 space-y-1">
                <p className="font-bold">Excluir Moradores Desativados</p>
                <p>
                  Deseja realmente excluir permanentemente os {inactiveCount} moradores desativados? Essa ação não pode ser desfeita.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={handleClearInactiveResidents}
                disabled={clearing}
                className="flex-1 bg-red-600 text-white py-3.5 rounded-xl font-bold hover:bg-red-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm shadow-xs"
              >
                {clearing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirmar Exclusão'}
              </button>
              <button
                type="button"
                onClick={() => setClearType('options')}
                disabled={clearing}
                className="py-3.5 px-6 bg-zinc-100 text-zinc-600 rounded-xl font-bold hover:bg-zinc-200 text-sm"
              >
                Voltar
              </button>
            </div>
          </div>
        )}

        {clearType === 'allPackages' && (
          <div className="space-y-6 max-w-xl">
            <div className="p-4 bg-red-50 rounded-2xl border border-red-200 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm text-red-800 space-y-2">
                <p className="font-bold">Atenção Crítica: Limpeza Total de Encomendas</p>
                <p>Essa ação irá excluir TODAS as encomendas cadastradas no sistema deste condomínio. Para confirmar a operação, digite <span className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-red-200">LIMPAR</span> abaixo:</p>
                <div className="bg-white/70 p-2.5 rounded-xl border border-red-100 text-xs space-y-0.5">
                  <p>• {stats.total} encomendas no total</p>
                  <p>• {stats.pending} encomendas pendentes</p>
                  <p>• {stats.delivered} encomendas baixadas</p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-600 mb-1.5 uppercase tracking-wider">
                Digite LIMPAR para confirmar
              </label>
              <input 
                type="text"
                className="w-full p-3.5 rounded-xl border border-zinc-300 outline-none focus:ring-2 focus:ring-red-500 font-mono font-bold uppercase tracking-wider text-zinc-900"
                placeholder="LIMPAR"
                value={confirmationPhrase}
                onChange={(e) => setConfirmationPhrase(e.target.value)}
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={handleClearAllPackages}
                disabled={clearing || confirmationPhrase !== 'LIMPAR'}
                className="flex-1 bg-red-600 text-white py-3.5 rounded-xl font-bold hover:bg-red-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm shadow-xs"
              >
                {clearing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirmar e Limpar TUDO'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setClearType('options');
                  setConfirmationPhrase('');
                }}
                disabled={clearing}
                className="py-3.5 px-6 bg-zinc-100 text-zinc-600 rounded-xl font-bold hover:bg-zinc-200 text-sm"
              >
                Voltar
              </button>
            </div>
          </div>
        )}

        {clearType === 'done' && (
          <div className="space-y-6 max-w-xl text-center py-4">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-2">
              <CheckCircle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-zinc-900">Limpeza Concluída!</h3>
              <div className="text-sm text-zinc-600 space-y-1 mt-2">
                <p><span className="font-bold text-zinc-900">{clearReport.residents}</span> moradores de teste removidos</p>
                <p><span className="font-bold text-zinc-900">{clearReport.porters}</span> porteiros de teste removidos</p>
                <p><span className="font-bold text-zinc-900">{clearReport.packages}</span> encomendas de teste removidas</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setClearType('options')}
              className="bg-zinc-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-black transition-all text-sm"
            >
              Concluir
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
