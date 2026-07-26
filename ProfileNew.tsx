import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AuditLog, Profile } from '../types';
import { 
  History, Loader2, Search, User, Calendar, 
  Database, ArrowRight, Filter, Download,
  Tag, Activity, ShieldCheck, Clock
} from 'lucide-react';
import { ptBR } from 'date-fns/locale';
import { toast } from 'react-hot-toast';
import { subDays, startOfDay, endOfDay } from 'date-fns';

function formatarDataBrasil(dataUtc: string) {
  if (!dataUtc) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dataUtc));
}

interface AuditLogsProps {
  user: Profile;
}

export default function AuditLogs({ user }: AuditLogsProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterEventType, setFilterEventType] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [dateRange, setDateRange] = useState({
    start: subDays(new Date(), 7).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    fetchLogs();
  }, [dateRange.start, dateRange.end]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('auditoria_eventos')
        .select('*')
        .eq('condominio_id', user.condominium_id)
        .gte('criado_em', startOfDay(new Date(dateRange.start + 'T00:00:00')).toISOString())
        .lte('criado_em', endOfDay(new Date(dateRange.end + 'T23:59:59')).toISOString())
        .order('criado_em', { ascending: false })
        .limit(500);

      const { data, error } = await query;

      if (error) throw error;
      setLogs(data || []);
    } catch (error: any) {
      toast.error('Erro ao carregar logs: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.descricao.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.tabela_afetada.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.usuario_nome.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesEventType = filterEventType ? log.tipo_evento === filterEventType : true;
    const matchesUser = filterUser ? log.usuario_nome === filterUser : true;
    
    return matchesSearch && matchesEventType && matchesUser;
  });

  const eventTypes = Array.from(new Set(logs.map(l => l.tipo_evento))).sort();
  const users = Array.from(new Set(logs.map(l => l.usuario_nome))).sort();

  const handleExportCSV = () => {
    if (filteredLogs.length === 0) {
      toast.error("Nenhum log para exportar");
      return;
    }

    const headers = ["Data", "Usuário", "Evento", "Ação", "Tabela", "Descrição", "Método"];
    const rows = filteredLogs.map(log => [
      formatarDataBrasil(log.criado_em),
      log.usuario_nome,
      log.tipo_evento,
      log.acao,
      log.tabela_afetada,
      log.descricao,
      log.metodo
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell?.toString().replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `auditoria_${dateRange.start}_a_${dateRange.end}.csv`;
    link.click();
    toast.success("Logs exportados com sucesso!");
  };

  const formatValue = (val: any) => {
    if (val === null || val === undefined) return 'Nao informado';
    if (typeof val === 'object') {
      return JSON.stringify(val, null, 2);
    }
    return String(val);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 flex items-center gap-2">
            <ShieldCheck className="w-8 h-8 text-emerald-600" />
            Auditoria do Sistema
          </h1>
          <p className="text-zinc-500 text-sm">Rastreabilidade completa de todas as ações e alterações</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button
            onClick={handleExportCSV}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl font-bold hover:bg-emerald-100 transition-all text-sm"
          >
            <Download className="w-4 h-4" />
            EXPORTAR CSV
          </button>
          <button
            onClick={fetchLogs}
            className="p-2.5 bg-zinc-100 hover:bg-zinc-200 rounded-xl transition-all text-zinc-600"
            title="Atualizar"
          >
            <History className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white p-6 rounded-3xl border border-zinc-100 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-1">Busca Geral</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                placeholder="Descrição, tabela, usuário..."
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-1">Período</label>
            <div className="flex gap-2 items-center">
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
                className="flex-1 px-3 py-2.5 rounded-xl border border-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
              />
              <span className="text-zinc-300">/</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
                className="flex-1 px-3 py-2.5 rounded-xl border border-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-1">Evento</label>
            <select
              value={filterEventType}
              onChange={(e) => setFilterEventType(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all bg-white"
            >
              <option value="">Todos os Eventos</option>
              {eventTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-1">Usuário</label>
            <select
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 text-sm focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all bg-white"
            >
              <option value="">Todos os Usuários</option>
              {users.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
          <p className="text-zinc-500 font-medium">Carregando logs...</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredLogs.map((log) => (
            <div key={log.id} className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-5 sm:p-6 hover:shadow-md transition-all">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="flex items-start gap-4 flex-1">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                    log.acao === 'CREATE' ? 'bg-emerald-50 text-emerald-600' :
                    log.acao === 'DELETE' ? 'bg-red-50 text-red-600' :
                    'bg-zinc-50 text-zinc-600'
                  }`}>
                    <Activity className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full ${
                        log.acao === 'CREATE' ? 'bg-emerald-100 text-emerald-700' :
                        log.acao === 'DELETE' ? 'bg-red-100 text-red-700' :
                        'bg-zinc-100 text-zinc-700'
                      }`}>
                        {log.acao}
                      </span>
                      <span className="text-sm font-bold text-zinc-900 truncate">{log.tipo_evento}</span>
                      <span className="text-xs text-zinc-400">•</span>
                      <span className="text-xs font-medium text-zinc-500">{log.tabela_afetada}</span>
                    </div>
                    <p className="text-sm text-zinc-600 mb-3 font-medium leading-relaxed">{log.descricao}</p>
                    
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <User className="w-3.5 h-3.5 text-zinc-400" />
                        <span className="font-bold text-zinc-700">{log.usuario_nome}</span>
                        <span className="px-1.5 py-0.5 bg-zinc-100 rounded text-[9px] uppercase font-bold text-zinc-500">{log.usuario_perfil}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <Clock className="w-3.5 h-3.5 text-zinc-400" />
                        {log.criado_em ? formatarDataBrasil(log.criado_em) : '-'}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <Tag className="w-3.5 h-3.5 text-zinc-400" />
                        Método: <span className="font-bold uppercase">{log.metodo}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <div className="text-[10px] font-mono text-zinc-400 bg-zinc-50 px-2.5 py-1 rounded-lg border border-zinc-100">
                    ID: {log.registro_id || 'N/A'}
                  </div>
                </div>
              </div>

              {(log.dados_antes || log.dados_depois) && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5">Estado Anterior</p>
                    <pre className="text-[11px] text-zinc-600 overflow-x-auto max-h-32 whitespace-pre-wrap font-mono scrollbar-thin">
                      {log.dados_antes ? formatValue(log.dados_antes) : 'N/A'}
                    </pre>
                  </div>
                  <div className="p-3 bg-emerald-50/30 rounded-2xl border border-emerald-100/50">
                    <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest mb-1.5">Novo Estado</p>
                    <pre className="text-[11px] text-emerald-900/70 overflow-x-auto max-h-32 whitespace-pre-wrap font-mono scrollbar-thin">
                      {log.dados_depois ? formatValue(log.dados_depois) : 'N/A'}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))}

          {filteredLogs.length === 0 && (
            <div className="bg-white rounded-3xl border border-zinc-100 p-20 text-center">
              <div className="w-20 h-20 bg-zinc-50 text-zinc-300 rounded-full flex items-center justify-center mx-auto mb-6">
                <History className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">Nenhum log encontrado</h3>
              <p className="text-zinc-500">Tente ajustar os filtros ou o período de busca.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
