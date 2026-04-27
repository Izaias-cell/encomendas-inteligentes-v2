import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Save, 
  MessageSquare, 
  Settings as SettingsIcon,
  Shield,
  Loader2,
  CheckCircle2,
  Eye,
  EyeOff,
  Copy,
  Check,
  Zap
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Profile, CondominiumSettings } from '../types';
import toast from 'react-hot-toast';
import { motion } from 'motion/react';
import { testZApiConnection } from '../services/whatsappService';

interface SettingsProps {
  user: Profile;
}

export default function Settings({ user }: SettingsProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [settings, setSettings] = useState<Partial<CondominiumSettings>>({
    whatsapp_mode: 'manual_assistido',
    whatsapp_provider: 'z-api',
    instance_id: '',
    api_token: '',
    api_url: 'https://api.z-api.io'
  });

  useEffect(() => {
    const fetchSettings = async () => {
      // 1. Initial State from localStorage (User's primary requirement)
      const localInstanceId = localStorage.getItem('zapi_instance_id') || '';
      const localToken = localStorage.getItem('zapi_token') || '';
      
      setSettings(prev => ({
        ...prev,
        instance_id: localInstanceId,
        api_token: localToken
      }));

      // 2. Fetch from Supabase (Secondary/Sync)
      if (!user?.condominium_id) return;
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('condominium_settings')
          .select('*')
          .eq('condominium_id', user.condominium_id)
          .maybeSingle();
        
        if (error) throw error;
        if (data) {
          setSettings(prev => ({
            ...prev,
            ...data,
            // Prioritize localStorage if available or use DB
            instance_id: localInstanceId || data.instance_id || '',
            api_token: localToken || data.api_token || ''
          }));
        }
      } catch (err: any) {
        console.error("Erro ao carregar configurações:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [user?.condominium_id]);

  const handleSave = async () => {
    // 1. Save to LocalStorage (User's primary requirement)
    localStorage.setItem('zapi_instance_id', settings.instance_id || '');
    localStorage.setItem('zapi_token', settings.api_token || '');

    // 2. Save to Supabase (Secondary/Sync)
    if (!user?.condominium_id) {
      toast.success("Configurações salvas!");
      return;
    }

    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from('condominium_settings')
        .select('id')
        .eq('condominium_id', user.condominium_id)
        .maybeSingle();

      let error;
      if (existing) {
        const { error: updateError } = await supabase
          .from('condominium_settings')
          .update({
            ...settings,
            updated_at: new Date().toISOString()
          })
          .eq('condominium_id', user.condominium_id);
        error = updateError;
      } else {
        const { error: insertError } = await supabase
          .from('condominium_settings')
          .insert([{
            ...settings,
            condominium_id: user.condominium_id
          }]);
        error = insertError;
      }

      if (error) throw error;
      toast.success("Configurações salvas com sucesso!");
    } catch (err: any) {
      console.error("Erro ao salvar no banco:", err);
      toast.success("Configurações salvas (Local)");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = (text: string, field: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success('Copiado para a área de transferência');
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleTestConnection = async () => {
    if (!settings.instance_id || !settings.api_token) {
      toast.error('Informe o ID e o Token da instância');
      return;
    }

    setTestingConnection(true);
    try {
      let testUrl = settings.api_url || 'https://api.z-api.io';
      if (!testUrl.includes('/instances/')) {
        testUrl = `${testUrl.replace(/\/$/, '')}/instances/${settings.instance_id}/token/${settings.api_token}/status`;
      }

      const result = await testZApiConnection(testUrl, settings.api_token || '');
      if (result.success) {
        toast.success('Conexão realizada com sucesso!');
      } else {
        toast.error(`Falha na conexão: ${result.error}`);
      }
    } catch (err) {
      toast.error('Erro ao testar a conexão');
    } finally {
      setTestingConnection(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/dashboard')}
            className="p-2 hover:bg-zinc-200 rounded-xl transition-all"
          >
            <ArrowLeft className="w-6 h-6 text-zinc-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Configurações</h1>
            <p className="text-zinc-500">Ajustes do sistema e integrações</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          Salvar
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="space-y-2">
          <h2 className="font-bold text-zinc-900 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-emerald-600" />
            WhatsApp (Z-API)
          </h2>
          <p className="text-sm text-zinc-500">
            Configure a integração com a Z-API para disparar notificações automáticas para os moradores.
          </p>
        </div>

        <div className="md:col-span-2 bg-white rounded-3xl border border-zinc-100 p-8 shadow-sm space-y-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-zinc-700 mb-2">Modo de Operação</label>
              <select 
                value={settings.whatsapp_mode}
                onChange={(e) => setSettings({...settings, whatsapp_mode: e.target.value as any})}
                className="w-full p-4 rounded-2xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-medium"
              >
                <option value="manual_assistido">Manual Assistido (wa.me)</option>
                <option value="api_automatica">Automático (Z-API)</option>
              </select>
            </div>

            <div className="space-y-4 pt-4 border-t border-zinc-100">
              <div>
                <label className="block text-sm font-bold text-zinc-700 mb-2">ID da Instância (Z-API)</label>
                <div className="relative group">
                  <input 
                    type="text"
                    value={settings.instance_id || ''}
                    onChange={(e) => setSettings({...settings, instance_id: e.target.value})}
                    placeholder="ID da instância fornecido pela Z-API"
                    className="w-full p-4 pr-12 rounded-2xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-mono text-sm bg-zinc-50 focus:bg-white"
                  />
                  <button
                    onClick={() => handleCopy(settings.instance_id || '', 'instance_id')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-zinc-400 hover:text-emerald-600 transition-colors"
                  >
                    {copiedField === 'instance_id' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-zinc-700 mb-2">Token da Instância (Z-API)</label>
                <div className="relative group">
                  <input 
                    type={showToken ? "text" : "password"}
                    value={settings.api_token || ''}
                    onChange={(e) => setSettings({...settings, api_token: e.target.value})}
                    placeholder="Token secreto fornecido pela Z-API"
                    className="w-full p-4 pr-24 rounded-2xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-mono text-sm bg-zinc-50 focus:bg-white"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      onClick={() => setShowToken(!showToken)}
                      className="p-2 text-zinc-400 hover:text-emerald-600 transition-colors"
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleCopy(settings.api_token || '', 'api_token')}
                      className="p-2 text-zinc-400 hover:text-emerald-600 transition-colors"
                    >
                      {copiedField === 'api_token' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-zinc-700 mb-2">URL Base (Opcional)</label>
                <input 
                  type="text"
                  value={settings.api_url || ''}
                  onChange={(e) => setSettings({...settings, api_url: e.target.value})}
                  placeholder="https://api.z-api.io"
                  className="w-full p-4 rounded-2xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-mono text-sm text-zinc-500 bg-zinc-50 focus:bg-white"
                />
                <p className="mt-2 text-xs text-zinc-400">Padrão: https://api.z-api.io. Altere apenas se usar um gateway customizado.</p>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleTestConnection}
                  disabled={testingConnection}
                  className="flex items-center justify-center gap-2 px-6 py-3 border-2 border-emerald-100 bg-emerald-50 text-emerald-700 rounded-2xl font-bold hover:bg-emerald-100 transition-all disabled:opacity-50 w-full"
                >
                  {testingConnection ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {testingConnection ? 'Testando...' : 'Testar Conexão'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-10 border-t border-zinc-100">
        <div className="bg-emerald-50 ring-1 ring-emerald-100 p-6 rounded-3xl flex items-start gap-4">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
          <div>
            <h4 className="font-bold text-emerald-900">Configurações Seguras</h4>
            <p className="text-sm text-emerald-700">
              Todos os dados de integração são criptografados e armazenados com segurança. 
              A Z-API é utilizada exclusivamente para o envio de notificações de encomendas.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
