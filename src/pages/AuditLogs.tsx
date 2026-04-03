import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AuditLog, Profile } from '../types';
import { 
  History, Loader2, Search, User, Calendar, 
  Database, ArrowRight, Filter, Download 
} from 'lucide-react';
import { formatDate } from '../lib/dateUtils';
import { ptBR } from 'date-fns/locale';
import { toast } from 'react-hot-toast';

interface AuditLogsProps {
  user: Profile;
}

export default function AuditLogs({ user }: AuditLogsProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState('');

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select(`
          *,
          user:profiles!user_id(full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(200);

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
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.entity_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log as any).user?.full_name.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesAction = filterAction ? log.action === filterAction : true;
    
    return matchesSearch && matchesAction;
  });

  const actions = Array.from(new Set(logs.map(l => l.action)));

  const formatValue = (val: any) => {
    if (typeof val === 'object' && val !== null) {
      return JSON.stringify(val, null, 2);
    }
    return String(val);
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Logs de Auditoria</h1>
          <p className="text-zinc-500">Histórico completo de ações realizadas no sistema</p>
        </div>
        <button
          onClick={fetchLogs}
          className="p-3 hover:bg-zinc-100 rounded-xl transition-all text-zinc-500"
          title="Atualizar"
        >
          <History className={`w-6 h-6 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-4 rounded-2xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all bg-white"
            placeholder="Buscar por ação, usuário ou entidade..."
          />
        </div>
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="px-6 py-4 rounded-2xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white min-w-[200px]"
        >
          <option value="">Todas as Ações</option>
          {actions.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
        </div>
      ) : (
        <div className="space-y-4">
          {filteredLogs.map((log) => (
            <div key={log.id} className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-6 hover:shadow-md transition-all">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-zinc-50 rounded-2xl flex items-center justify-center text-zinc-400">
                    <Database className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wider rounded-full">
                        {log.action}
                      </span>
                      <span className="text-sm font-bold text-zinc-900">{log.entity_type}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <div className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {(log as any).user?.full_name || 'Sistema'}
                      </div>
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(log.created_at, "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-xs font-mono text-zinc-400 bg-zinc-50 px-2 py-1 rounded">
                  ID: {log.entity_id}
                </div>
              </div>

              {(log.old_value || log.new_value) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 p-4 bg-zinc-50 rounded-2xl border border-zinc-100 overflow-hidden">
                  <div>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2">Valor Antigo</p>
                    <pre className="text-xs text-zinc-600 overflow-x-auto max-h-40 whitespace-pre-wrap">
                      {log.old_value ? formatValue(log.old_value) : 'N/A'}
                    </pre>
                  </div>
                  <div className="border-t md:border-t-0 md:border-l border-zinc-200 pt-4 md:pt-0 md:pl-4">
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2">Novo Valor</p>
                    <pre className="text-xs text-zinc-600 overflow-x-auto max-h-40 whitespace-pre-wrap">
                      {log.new_value ? formatValue(log.new_value) : 'N/A'}
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
              <p className="text-zinc-500">As ações realizadas no sistema aparecerão aqui.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
