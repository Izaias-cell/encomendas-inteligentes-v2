import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { 
  Package, CheckCircle2, Shield, Smartphone, 
  ArrowRight, Users, Bell, Sparkles, Building2, 
  Check, Phone, User, Clock, Gift, Lock, MessageSquare,
  ChevronRight, Play, RefreshCw, Send, Eye, KeyRound
} from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { api } from '../lib/apiClient';
import { supabase } from '../lib/supabase';

export default function PublicDemo() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const ref = searchParams.get('ref') || '';

  const [loadingOrigin, setLoadingOrigin] = useState(true);
  const [originData, setOriginData] = useState<{
    origin_type: 'ADMINISTRADOR' | 'SINDICO';
    origin_title: string;
    referrer_name: string;
    condo_name: string;
    referrer_condo_id?: string | null;
    referrer_user_id?: string | null;
    token: string | null;
    ref: string | null;
  }>({
    origin_type: 'ADMINISTRADOR',
    origin_title: 'Demonstração Oficial',
    referrer_name: 'Administração',
    condo_name: '',
    token: null,
    ref: null
  });

  // Interactive Simulation State
  const [activeTab, setActiveTab] = useState<'flow' | 'scan' | 'whatsapp' | 'pickup'>('flow');
  const [simulatedStep, setSimulatedStep] = useState(1);
  const [simulatedResident, setSimulatedResident] = useState('Mariana Silva');
  const [simulatedUnit, setSimulatedUnit] = useState('Apto 402 - Bloco B');
  const [simulatedCourier, setSimulatedCourier] = useState('Mercado Livre');
  const [simulatedCode, setSimulatedCode] = useState('8492');

  // Adherence Form State
  const [form, setForm] = useState({
    name: '',
    phone: '',
    condo_name: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);

  useEffect(() => {
    const fetchOrigin = async () => {
      try {
        const query = new URLSearchParams();
        if (token) query.set('token', token);
        if (ref) query.set('ref', ref);

        const res = await api.get(`/api/public/demo-info?${query.toString()}`);
        if (res && res.data && res.data.success) {
          setOriginData(res.data);
        }
      } catch (err) {
        console.warn('Erro ao carregar origem da demonstração:', err);
      } finally {
        setLoadingOrigin(false);
      }
    };
    fetchOrigin();
  }, [token, ref]);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 11) val = val.slice(0, 11);
    if (val.length > 6) {
      val = `(${val.slice(0, 2)}) ${val.slice(2, 7)}-${val.slice(7)}`;
    } else if (val.length > 2) {
      val = `(${val.slice(0, 2)}) ${val.slice(2)}`;
    } else if (val.length > 0) {
      val = `(${val}`;
    }
    setForm({ ...form, phone: val });
  };

  const handleAdhereSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || submittedSuccess) return;

    const cleanName = form.name.trim();
    const cleanPhone = form.phone.trim();
    const cleanCondo = form.condo_name.trim();
    const activeToken = originData.token || token || '';
    const activeRef = originData.ref || ref || '';

    if (!cleanName) {
      toast.error('Por favor, informe seu nome completo.');
      return;
    }
    if (!cleanPhone || cleanPhone.replace(/\D/g, '').length < 10) {
      toast.error('Por favor, informe um WhatsApp válido com DDD.');
      return;
    }
    if (!cleanCondo) {
      toast.error('Por favor, informe o nome do seu condomínio.');
      return;
    }

    setSubmitting(true);

    try {
      let saved = false;

      // 1. Try server endpoint first
      try {
        const res = await api.post('/api/public/demo-adhere', {
          name: cleanName,
          phone: cleanPhone,
          condo_name: cleanCondo,
          token: activeToken || undefined,
          ref: activeRef || undefined
        });

        if (res && res.data && res.data.success) {
          saved = true;
        }
      } catch (apiErr) {
        console.warn('API endpoint indisponível no ambiente de hospedagem (Vercel), acionando persistência direta no Supabase:', apiErr);
      }

      // 2. Fallback to direct Supabase persistence if server endpoint failed or returned non-200 (production Vercel)
      if (!saved) {
        const leadRecord = {
          id: `lead-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
          name: cleanName,
          phone: cleanPhone,
          condo_name: cleanCondo,
          origin_type: activeRef ? 'SINDICO' : 'ADMINISTRADOR',
          referrer_condo_id: originData.referrer_condo_id || undefined,
          referrer_condo_name: originData.condo_name || undefined,
          referrer_user_id: originData.referrer_user_id || undefined,
          referrer_user_name: originData.referrer_name || undefined,
          token_or_ref: activeRef || activeToken || 'DEMO-OFICIAL',
          status: 'TESTE_ADERIDO',
          bonus_granted: false,
          bonus_days_granted: 0,
          created_at: new Date().toISOString()
        };

        // Log TESTE_ADERIDO in audit trail via RPC
        await supabase.rpc('registrar_auditoria', {
          p_condominio_id: originData.referrer_condo_id || null,
          p_usuario_id: null,
          p_usuario_nome: cleanName,
          p_usuario_perfil: 'lead',
          p_tipo_evento: 'TESTE_ADERIDO',
          p_acao: 'CREATE',
          p_tabela_afetada: 'referrals',
          p_registro_id: null,
          p_descricao: `Novo interesse registrado: ${cleanName} (${cleanCondo}, WhatsApp: ${cleanPhone}). Origem: ${activeRef ? `Indicação de ${originData.referrer_name || activeRef}` : (activeToken ? `Link Admin (${activeToken})` : 'Demonstração Direta')}.`,
          p_metodo: 'DEMO_ADHERENCE',
          p_dados_antes: null,
          p_dados_depois: leadRecord
        });

        // Log ADMIN_NOTIFICADO in audit trail via RPC
        await supabase.rpc('registrar_auditoria', {
          p_condominio_id: originData.referrer_condo_id || null,
          p_usuario_id: null,
          p_usuario_nome: 'Sistema de Notificação',
          p_usuario_perfil: 'sistema',
          p_tipo_evento: 'ADMIN_NOTIFICADO',
          p_acao: 'CREATE',
          p_tabela_afetada: 'referrals',
          p_registro_id: null,
          p_descricao: `Notificação enviada ao Administrador: Síndico ${cleanName} do condomínio ${cleanCondo} aderiu ao teste de 15 dias. Contato: ${cleanPhone}.`,
          p_metodo: 'SYSTEM_NOTIFICATION',
          p_dados_antes: null,
          p_dados_depois: {
            sindico_nome: cleanName,
            condominio_nome: cleanCondo,
            contato_whatsapp: cleanPhone,
            origem: activeRef ? `Indicação de ${originData.referrer_name || activeRef}` : 'Demonstração Direta',
            status: 'TESTE_ADERIDO',
            data_hora: new Date().toISOString()
          }
        });
      }

      setSubmittedSuccess(true);
      toast.success('Solicitação de teste registrada com sucesso!');
    } catch (err: any) {
      console.error('Erro ao registrar adesão:', err);
      toast.error('Não foi possível registrar sua solicitação neste momento. Tente novamente em alguns instantes.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-emerald-500 selection:text-white">
      {/* Top Brand Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-tr from-emerald-600 to-teal-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Package className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="font-black tracking-tight text-white sm:text-lg block leading-none">
                ENCOMENDAS INTELIGENTES
              </span>
              <span className="text-[11px] text-emerald-400 font-medium tracking-wide">
                Demonstração Interativa & Período Grátis
              </span>
            </div>
          </div>

          <a 
            href="#aderir"
            className="hidden sm:inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all shadow-md shadow-emerald-500/20 hover:scale-105"
          >
            <Gift className="w-4 h-4" />
            QUERO TESTAR → 15 dias gratuitos!
          </a>
        </div>
      </header>

      {/* Invitation Header Banner */}
      {originData.origin_type === 'SINDICO' && (
        <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 border-b border-emerald-500/30 py-3 px-4 text-center">
          <div className="max-w-4xl mx-auto flex items-center justify-center gap-2 text-xs sm:text-sm text-emerald-300 font-medium">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 animate-pulse" />
            <span>
              Você foi convidado especialmente pelo <strong>{originData.referrer_name}</strong> do <strong>{originData.condo_name}</strong> para testar o sistema.
            </span>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-12 pb-16 px-4 sm:px-6">
        {/* Glow Effects */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold uppercase tracking-widest px-4 py-1.5 rounded-full mb-6">
            <Shield className="w-3.5 h-3.5" />
            Gestão Definitiva de Portaria
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-6xl font-black text-white tracking-tight leading-[1.15] mb-6">
            Acabe com o extravio de encomendas no seu condomínio.
          </h1>

          <p className="text-base sm:text-xl text-slate-300 max-w-3xl mx-auto leading-relaxed mb-10">
            A tecnologia mais simples e segura para portarias: registre pacotes em 3 segundos, avise moradores pelo WhatsApp oficial e entregue com código de confirmação.
          </p>

          {/* Quick Pillars */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto mb-12">
            <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl text-left hover:border-emerald-500/40 transition-colors">
              <div className="w-10 h-10 bg-emerald-500/10 text-emerald-400 rounded-xl flex items-center justify-center mb-3">
                <Smartphone className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-white text-base mb-1">WhatsApp Automático</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                O morador recebe uma notificação instantânea com foto, transportadora e código PIN de retirada.
              </p>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl text-left hover:border-emerald-500/40 transition-colors">
              <div className="w-10 h-10 bg-teal-500/10 text-teal-400 rounded-xl flex items-center justify-center mb-3">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-white text-base mb-1">Retirada Segura</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Entrega confirmada exclusivamente por PIN de 4 dígitos. Registro com data, hora e porteiro responsável.
              </p>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl text-left hover:border-emerald-500/40 transition-colors">
              <div className="w-10 h-10 bg-amber-500/10 text-amber-400 rounded-xl flex items-center justify-center mb-3">
                <Users className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-white text-base mb-1">Zero Pranchetas</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Histórico 100% digital auditável para o síndico acompanhar encomendas pendentes e entregues em tempo real.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Simulator Section */}
      <section className="py-12 bg-slate-900/40 border-y border-slate-800 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-widest mb-2">
              <Play className="w-3.5 h-3.5 fill-current" />
              Simulação Interativa em Tempo Real
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white">
              Veja como funciona na prática
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Experimente as etapas do sistema em poucos cliques
            </p>
          </div>

          {/* Step Selector Tabs */}
          <div className="flex flex-wrap justify-center gap-2 mb-8">
            <button
              onClick={() => setSimulatedStep(1)}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center gap-2 cursor-pointer ${
                simulatedStep === 1
                  ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20 scale-105'
                  : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-xs">1</span>
              Entrada na Portaria
            </button>
            <button
              onClick={() => setSimulatedStep(2)}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center gap-2 cursor-pointer ${
                simulatedStep === 2
                  ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20 scale-105'
                  : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-xs">2</span>
              Aviso no WhatsApp
            </button>
            <button
              onClick={() => setSimulatedStep(3)}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center gap-2 cursor-pointer ${
                simulatedStep === 3
                  ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20 scale-105'
                  : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-xs">3</span>
              Retirada Segura (PIN)
            </button>
          </div>

          {/* Interactive Screen Simulation */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-3xl mx-auto shadow-2xl relative overflow-hidden">
            {simulatedStep === 1 && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-xl flex items-center justify-center font-bold">
                      📦
                    </div>
                    <div>
                      <h4 className="font-bold text-white">Passo 1: Porteiro recebe a encomenda</h4>
                      <p className="text-xs text-slate-400">Digitação rápida com busca inteligente de moradores</p>
                    </div>
                  </div>
                  <span className="text-xs font-mono bg-slate-800 text-slate-300 px-3 py-1 rounded-full">
                    Tempo: ~3 seg
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">Morador(a)</label>
                    <select
                      value={simulatedResident}
                      onChange={(e) => {
                        setSimulatedResident(e.target.value);
                        if (e.target.value === 'Mariana Silva') setSimulatedUnit('Apto 402 - Bloco B');
                        if (e.target.value === 'Carlos Eduardo') setSimulatedUnit('Apto 101 - Bloco A');
                        if (e.target.value === 'Fernanda Lima') setSimulatedUnit('Casa 24');
                      }}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white font-medium focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="Mariana Silva">Mariana Silva (Apto 402 - Bloco B)</option>
                      <option value="Carlos Eduardo">Carlos Eduardo (Apto 101 - Bloco A)</option>
                      <option value="Fernanda Lima">Fernanda Lima (Casa 24)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">Transportadora</label>
                    <select
                      value={simulatedCourier}
                      onChange={(e) => setSimulatedCourier(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white font-medium focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="Mercado Livre">Mercado Livre</option>
                      <option value="Amazon">Amazon</option>
                      <option value="Shopee">Shopee</option>
                      <option value="Correios">Correios</option>
                      <option value="Outra / Diversos">Outra / Diversos</option>
                    </select>
                  </div>
                </div>

                <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <div>
                      <p className="text-xs font-bold text-white">Status da Encomenda</p>
                      <p className="text-[11px] text-slate-400">PIN de retirada gerado automaticamente: <span className="font-mono text-emerald-400 font-bold">{simulatedCode}</span></p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSimulatedStep(2)}
                    className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    Notificar Morador
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {simulatedStep === 2 && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-xl flex items-center justify-center font-bold">
                      <Smartphone className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white">Passo 2: WhatsApp enviado para {simulatedResident}</h4>
                      <p className="text-xs text-slate-400">Mensagem personalizada e instantânea</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-full flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Enviado
                  </span>
                </div>

                {/* WhatsApp Message Bubble Simulation */}
                <div className="max-w-md mx-auto bg-emerald-950/30 border border-emerald-500/30 rounded-2xl p-5 shadow-lg relative">
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b border-emerald-500/20 text-emerald-400 text-xs font-bold">
                    <MessageSquare className="w-4 h-4" />
                    Portaria do Condomínio
                  </div>

                  <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                    📦 Olá, <strong>{simulatedResident}</strong> ({simulatedUnit})!
                    <br /><br />
                    Uma nova encomenda da <strong>{simulatedCourier}</strong> acabou de chegar na portaria.
                    <br /><br />
                    🔑 Seu código seguro de retirada é: <strong className="text-emerald-400 text-base font-mono bg-emerald-950 px-2 py-0.5 rounded">{simulatedCode}</strong>
                    <br /><br />
                    Basta apresentar este código PIN de 4 dígitos no balcão da portaria para retirar sua encomenda.
                  </p>

                  <div className="mt-4 pt-3 border-t border-emerald-500/20 flex items-center justify-between text-[10px] text-slate-400">
                    <span>Mensagem Oficial Criptografada</span>
                    <span>Agora</span>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => setSimulatedStep(3)}
                    className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-4 py-2.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    Simular Retirada do Pacote
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {simulatedStep === 3 && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-xl flex items-center justify-center font-bold">
                      <Lock className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-white">Passo 3: Baixa expressa com confirmação via PIN</h4>
                      <p className="text-xs text-slate-400">Segurança total e auditoria instantânea por código numérico</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-full flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Concluído
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <div className="bg-slate-950/80 border border-emerald-500/30 p-6 rounded-2xl text-center flex flex-col items-center justify-center">
                    <div className="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-black uppercase tracking-wider px-3 py-1 rounded-full mb-3">
                      <KeyRound className="w-3.5 h-3.5" />
                      🔐 RETIRADA SEGURA
                    </div>
                    
                    <p className="text-xs font-semibold text-slate-300 mb-1">Código PIN:</p>
                    <div className="font-mono text-3xl sm:text-4xl font-black text-emerald-400 bg-slate-900 border border-emerald-500/40 px-6 py-2.5 rounded-2xl tracking-widest shadow-inner my-2">
                      {simulatedCode}
                    </div>

                    <p className="text-[11px] text-slate-400 mt-2 leading-tight">
                      O morador apresenta o PIN na portaria.
                    </p>
                    <p className="text-[11px] text-emerald-400/90 font-medium">
                      A portaria confirma a entrega utilizando o PIN.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="bg-slate-950/80 border border-slate-800 p-3.5 rounded-xl">
                      <p className="text-[11px] text-slate-400 uppercase font-bold">Destinatário</p>
                      <p className="text-sm font-bold text-white">{simulatedResident}</p>
                      <p className="text-xs text-slate-400">{simulatedUnit}</p>
                    </div>
                    <div className="bg-slate-950/80 border border-slate-800 p-3.5 rounded-xl">
                      <p className="text-[11px] text-slate-400 uppercase font-bold">Porteiro Responsável</p>
                      <p className="text-sm font-bold text-white">Portaria Central (Plantão Diurno)</p>
                      <p className="text-xs text-emerald-400 font-mono">Retirado com sucesso via PIN!</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => {
                      setSimulatedCode(Math.floor(1000 + Math.random() * 9000).toString());
                      setSimulatedStep(1);
                    }}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Reiniciar Simulação
                  </button>

                  <a
                    href="#aderir"
                    className="bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-lg shadow-emerald-500/20"
                  >
                    QUERO TESTAR → 15 dias gratuitos!
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Adherence Form Section ("QUERO TESTAR → 15 dias gratuitos!") */}
      <section id="aderir" className="py-20 px-4 sm:px-6 relative">
        <div className="max-w-xl mx-auto">
          <div className="bg-slate-900 border-2 border-emerald-500/40 rounded-3xl p-6 sm:p-10 shadow-2xl relative overflow-hidden">
            {/* Background Glow */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/20 rounded-full blur-2xl pointer-events-none" />

            {!submittedSuccess ? (
              <>
                <div className="text-center mb-8">
                  <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold uppercase tracking-widest px-4 py-1 rounded-full mb-3">
                    <Gift className="w-3.5 h-3.5" />
                    15 Dias Grátis • Sem Compromisso
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                    QUERO TESTAR → 15 dias gratuitos!
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-300 mt-2">
                    Preencha os dados abaixo para solicitar o período de teste grátis no seu condomínio.
                  </p>
                </div>

                <form onSubmit={handleAdhereSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                      Nome do Síndico / Gestor *
                    </label>
                    <div className="relative">
                      <User className="w-5 h-5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        disabled={submitting}
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="Ex: Carlos Eduardo"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none transition-colors disabled:opacity-60"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                      WhatsApp para Contato e Ativação *
                    </label>
                    <div className="relative">
                      <Phone className="w-5 h-5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="tel"
                        required
                        disabled={submitting}
                        value={form.phone}
                        onChange={handlePhoneChange}
                        placeholder="(11) 99999-9999"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none transition-colors disabled:opacity-60"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                      Nome do Condomínio *
                    </label>
                    <div className="relative">
                      <Building2 className="w-5 h-5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        disabled={submitting}
                        value={form.condo_name}
                        onChange={(e) => setForm({ ...form, condo_name: e.target.value })}
                        placeholder="Ex: Condomínio Residencial Jardins"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none transition-colors disabled:opacity-60"
                      />
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-sm uppercase tracking-wider py-4 rounded-xl transition-all shadow-xl shadow-emerald-500/25 flex items-center justify-center gap-2 group disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {submitting ? (
                        <>
                          <RefreshCw className="w-5 h-5 animate-spin" />
                          <span>Enviando Solicitação...</span>
                        </>
                      ) : (
                        <>
                          QUERO TESTAR → 15 dias gratuitos!
                          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-center gap-6 pt-4 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Sem cartão
                    </span>
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> 15 dias completos
                    </span>
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Suporte incluso
                    </span>
                  </div>
                </form>
              </>
            ) : (
              <div className="text-center py-6 sm:py-8 px-2 space-y-6">
                <div className="text-5xl select-none">
                  🎉
                </div>

                <div className="space-y-3">
                  <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-snug">
                    TESTE SOLICITADO COM SUCESSO!
                  </h3>

                  <p className="text-sm sm:text-base font-bold text-emerald-400 max-w-lg mx-auto leading-relaxed uppercase tracking-wide">
                    O ADMINISTRADOR DA PLATAFORMA ENTRARÁ EM CONTATO ASSIM QUE POSSÍVEL.
                  </p>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 p-5 rounded-2xl max-w-md mx-auto text-left text-xs space-y-2.5">
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-400">Condomínio:</span>
                    <strong className="text-white">{form.condo_name}</strong>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-400">Síndico:</span>
                    <strong className="text-white">{form.name}</strong>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-400">WhatsApp:</span>
                    <strong className="text-emerald-400 font-mono">{form.phone}</strong>
                  </div>
                  <div className="flex items-center justify-between text-slate-300 pt-1.5 border-t border-slate-800">
                    <span className="text-slate-400">Status da Solicitação:</span>
                    <span className="font-extrabold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2.5 py-0.5 rounded-full text-[10px] uppercase">
                      AGUARDANDO CONTATO DO ADMINISTRADOR
                    </span>
                  </div>
                </div>

                <div className="pt-2">
                  <p className="text-sm sm:text-base font-semibold text-slate-200">
                    Obrigado por escolher o ENCOMENDAS INTELIGENTES! 😀
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8 px-4 text-center text-xs text-slate-500">
        <p className="font-semibold text-slate-400">ENCOMENDAS INTELIGENTES © {new Date().getFullYear()}</p>
        <p className="mt-1">Gestão inteligente, segura e automatizada de encomendas para condomínios residenciais e comerciais.</p>
      </footer>

      <Toaster position="bottom-right" />
    </div>
  );
}
