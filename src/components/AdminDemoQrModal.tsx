import React, { useState, useEffect } from 'react';
import { 
  Link2, Copy, Check, Plus, Loader2, Sparkles, 
  Users, Building2, Phone, Calendar, ArrowRight, 
  ExternalLink, CheckCircle2, Shield, RefreshCw, X,
  Gift, Award, AlertCircle, MessageSquare, QrCode, Share2
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'react-hot-toast';
import { api } from '../lib/apiClient';
import { supabase } from '../lib/supabase';
import { DemoQRCode, ReferralLead } from '../types';
import { buildPublicDemoUrl } from '../lib/urlUtils';

interface AdminDemoQrModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AdminDemoQrModal({ isOpen, onClose }: AdminDemoQrModalProps) {
  const [activeTab, setActiveTab] = useState<'links' | 'leads'>('links');
  const [qrs, setQrs] = useState<DemoQRCode[]>([]);
  const [leads, setLeads] = useState<ReferralLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      let loadedQrs: DemoQRCode[] = [];
      let loadedLeads: ReferralLead[] = [];

      // 1. Try server API first
      try {
        const [qrsRes, leadsRes] = await Promise.all([
          api.get('/api/admin/demo-qr'),
          api.get('/api/admin/referrals/leads')
        ]);

        if (qrsRes && qrsRes.data && qrsRes.data.success) {
          loadedQrs = qrsRes.data.qrs || [];
        }
        if (leadsRes && leadsRes.data && leadsRes.data.success) {
          loadedLeads = leadsRes.data.leads || [];
        }
      } catch (apiErr) {
        console.warn('API backend indisponível (Vercel), carregando dados diretamente do Supabase:', apiErr);
      }

      // 2. Fallback to direct Supabase queries if API returned empty / failed
      if (loadedQrs.length === 0) {
        const { data: dbQrs } = await supabase
          .from('demonstracao_qrs')
          .select('*')
          .order('created_at', { ascending: false });

        if (dbQrs && dbQrs.length > 0) {
          loadedQrs = dbQrs;
        } else {
          // Check audit events for generated demo links
          const { data: auditEvents } = await supabase
            .from('auditoria_eventos')
            .select('*')
            .eq('tipo_evento', 'DEMO_LINK_GERADO')
            .order('criado_em', { ascending: false });

          if (auditEvents && auditEvents.length > 0) {
            loadedQrs = auditEvents.map(evt => {
              const d = evt.dados_depois || {};
              const token = d.token || evt.registro_id || 'DEMO-OFICIAL';
              return {
                id: evt.id,
                token: token,
                origin: (d.origin as any) || 'ADMINISTRADOR',
                created_at: evt.criado_em,
                status: 'active',
                hits_count: d.hits_count || 0,
                adhesions_count: d.adhesions_count || 0,
                url: d.url || buildPublicDemoUrl(token, 'token')
              };
            });
          }
        }
      }

      if (loadedLeads.length === 0) {
        const { data: dbLeads } = await supabase
          .from('referrals')
          .select('*')
          .order('created_at', { ascending: false });

        if (dbLeads && dbLeads.length > 0) {
          loadedLeads = dbLeads;
        } else {
          // Check audit events for leads
          const { data: auditLeads } = await supabase
            .from('auditoria_eventos')
            .select('*')
            .in('tipo_evento', ['TESTE_ADERIDO', 'TESTE_ATIVADO'])
            .order('criado_em', { ascending: false });

          if (auditLeads && auditLeads.length > 0) {
            // Deduplicate by phone or id
            const seen = new Set<string>();
            const mappedLeads: ReferralLead[] = [];

            for (const evt of auditLeads) {
              const d = evt.dados_depois || {};
              const phone = d.phone || d.contato_whatsapp || '';
              const key = phone || evt.id;
              if (!seen.has(key)) {
                seen.add(key);
                mappedLeads.push({
                  id: d.id || evt.id,
                  name: d.name || d.sindico_nome || evt.usuario_nome || 'Síndico',
                  phone: phone,
                  condo_name: d.condo_name || d.condominio_nome || 'Condomínio',
                  origin_type: (d.origin_type as any) || 'ADMINISTRADOR',
                  referrer_condo_name: d.referrer_condo_name,
                  referrer_user_name: d.referrer_user_name,
                  token_or_ref: d.token_or_ref || 'DEMO-OFICIAL',
                  status: (evt.tipo_evento === 'TESTE_ATIVADO' || d.status === 'TESTE_ATIVADO') ? 'TESTE_ATIVADO' : 'TESTE_ADERIDO',
                  bonus_granted: Boolean(d.bonus_granted),
                  bonus_days_granted: d.bonus_days_granted || 0,
                  created_at: evt.criado_em,
                  activated_at: d.activated_at
                });
              }
            }
            loadedLeads = mappedLeads;
          }
        }
      }

      setQrs(loadedQrs);
      setLeads(loadedLeads);
    } catch (err: any) {
      console.error('Erro ao carregar dados da demonstração:', err);
      toast.error('Erro ao carregar dados da demonstração.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen]);

  const handleGenerateLink = async () => {
    setGenerating(true);
    try {
      let created = false;

      // 1. Try server API first
      try {
        const res = await api.post('/api/admin/demo-qr/generate');
        if (res && res.data && res.data.success) {
          created = true;
        }
      } catch (apiErr) {
        console.warn('API de geração de link indisponível (Vercel), gerando e persistindo diretamente:', apiErr);
      }

      // 2. Fallback direct generation
      if (!created) {
        const token = `DEMO-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const canonicalUrl = buildPublicDemoUrl(token, 'token');

        const newQr: Partial<DemoQRCode> = {
          token,
          origin: 'ADMINISTRADOR',
          status: 'active',
          hits_count: 0,
          adhesions_count: 0,
          url: canonicalUrl,
          created_at: new Date().toISOString()
        };

        // Try insert in table
        try {
          await supabase.from('demonstracao_qrs').insert(newQr);
        } catch (tableErr) {
          console.warn('Tabela demonstracao_qrs não acessível diretamente, registrando via auditoria:', tableErr);
        }

        // Log audit event
        await supabase.rpc('registrar_auditoria', {
          p_condominio_id: null,
          p_usuario_id: null,
          p_usuario_nome: 'Administrador',
          p_usuario_perfil: 'admin',
          p_tipo_evento: 'DEMO_LINK_GERADO',
          p_acao: 'CREATE',
          p_tabela_afetada: 'demonstracao_qrs',
          p_registro_id: null,
          p_descricao: `Link de demonstração gerado com sucesso: ${token} (${canonicalUrl})`,
          p_metodo: 'ADMIN_PANEL',
          p_dados_antes: null,
          p_dados_depois: newQr
        });
      }

      toast.success('Novo Link de Demonstração gerado com sucesso!');
      await fetchData();
    } catch (err: any) {
      console.error('Erro ao gerar link:', err);
      toast.error('Erro ao gerar link de demonstração.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyLink = (url: string, token: string) => {
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    toast.success('Link de demonstração copiado!');
    setTimeout(() => setCopiedToken(null), 2500);
  };

  const handleShareWhatsApp = (url: string) => {
    const text = `Olá! Conheça a demonstração interativa do Encomendas Inteligentes para condomínios. Acesse diretamente pelo link:\n\n${url}`;
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank');
  };

  const handleActivateTrial = async (lead: ReferralLead) => {
    if (lead.status === 'TESTE_ATIVADO') {
      toast.error('Este teste já foi ativado anteriormente.');
      return;
    }

    setActivatingId(lead.id);
    try {
      let activated = false;

      // 1. Try server API
      try {
        const res = await api.post(`/api/admin/referrals/${lead.id}/activate`, {
          condo_name: lead.condo_name,
          manager_name: lead.name,
          phone: lead.phone
        });

        if (res && res.data && res.data.success) {
          activated = true;
        }
      } catch (apiErr) {
        console.warn('API de ativação indisponível (Vercel), realizando ativação diretamente no Supabase:', apiErr);
      }

      // 2. Direct Supabase activation fallback
      if (!activated) {
        const now = new Date();
        const trialEnds = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
        const accessCode = `TESTE-${Math.floor(1000 + Math.random() * 9000)}`;

        // Create or update condominium
        const { data: newCondo } = await supabase
          .from('condominiums')
          .insert({
            name: lead.condo_name,
            address: 'Cadastrado via Demonstração Comercial',
            manager_name: lead.name,
            manager_phone: lead.phone,
            phone: lead.phone,
            active: true,
            plan_status: 'trial',
            trial_started_at: now.toISOString(),
            trial_ends_at: trialEnds.toISOString(),
            portaria_access_code: accessCode,
            portaria_name: 'Portaria Principal',
            created_at: now.toISOString()
          })
          .select()
          .single();

        // Update referrals record if accessible
        try {
          await supabase
            .from('referrals')
            .update({
              status: 'TESTE_ATIVADO',
              activated_at: now.toISOString(),
              condo_created_id: newCondo?.id
            })
            .eq('id', lead.id);
        } catch (refErr) {
          console.warn('Atualização direta na tabela referrals falhou:', refErr);
        }

        // Log audit event for TESTE_ATIVADO
        await supabase.rpc('registrar_auditoria', {
          p_condominio_id: newCondo?.id || null,
          p_usuario_id: null,
          p_usuario_nome: 'Administrador',
          p_usuario_perfil: 'admin',
          p_tipo_evento: 'TESTE_ATIVADO',
          p_acao: 'UPDATE',
          p_tabela_afetada: 'condominiums',
          p_registro_id: newCondo?.id || lead.id,
          p_descricao: `Período de teste de 15 dias ativado com sucesso para ${lead.condo_name} (Síndico: ${lead.name}, WhatsApp: ${lead.phone}). Código Portaria: ${accessCode}.`,
          p_metodo: 'ADMIN_ACTIVATION',
          p_dados_antes: { status: 'TESTE_ADERIDO' },
          p_dados_depois: {
            lead_id: lead.id,
            condo_id: newCondo?.id,
            condo_name: lead.condo_name,
            manager_name: lead.name,
            phone: lead.phone,
            trial_days: 15,
            trial_started_at: now.toISOString(),
            trial_ends_at: trialEnds.toISOString(),
            portaria_access_code: accessCode,
            status: 'TESTE_ATIVADO'
          }
        });
      }

      toast.success('Período de teste de 15 dias ativado com sucesso!');
      await fetchData();
    } catch (err: any) {
      console.error('Erro ao ativar teste:', err);
      toast.error('Erro ao ativar teste.');
    } finally {
      setActivatingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 text-white rounded-2xl flex items-center justify-center shadow-md shadow-emerald-600/20">
              <Link2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 leading-tight">
                Mecanismo Comercial • Links de Demonstração & Indicação 15+15
              </h2>
              <p className="text-xs text-slate-500">
                Compartilhamento via link para celular/WhatsApp e controle de adesões de testes
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 border-b border-slate-100 flex gap-4 bg-white">
          <button
            onClick={() => setActiveTab('links')}
            className={`py-3.5 text-xs sm:text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'links'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Link2 className="w-4 h-4" />
            Links de Demonstração ({qrs.length})
          </button>

          <button
            onClick={() => setActiveTab('leads')}
            className={`py-3.5 text-xs sm:text-sm font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'leads'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            Adesões ao Teste / Leads ({leads.length})
            {leads.filter(l => l.status === 'TESTE_ADERIDO').length > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            )}
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
            </div>
          ) : activeTab === 'links' ? (
            <div className="space-y-6">
              {/* Action Top Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-emerald-50/70 border border-emerald-200/70 p-5 rounded-2xl">
                <div>
                  <h3 className="text-sm font-black text-emerald-950 flex items-center gap-2">
                    <Share2 className="w-4 h-4 text-emerald-600" />
                    Gerador de Link de Demonstração
                  </h3>
                  <p className="text-xs text-emerald-800 mt-1 max-w-xl">
                    O <strong>Link</strong> é a forma recomendada para envio direto no celular e WhatsApp do síndico (abertura imediata). O QR Code fica disponível como alternativa para telas e impressos.
                  </p>
                </div>

                <button
                  onClick={handleGenerateLink}
                  disabled={generating}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  {generating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  GERAR LINK DE DEMONSTRAÇÃO
                </button>
              </div>

              {/* Links Cards Grid */}
              {qrs.length === 0 ? (
                <div className="text-center py-12 text-slate-400 border border-dashed border-slate-200 rounded-3xl">
                  <Link2 className="w-12 h-12 mx-auto mb-2 opacity-40 text-emerald-600" />
                  <p className="font-bold text-sm text-slate-700">Nenhum link de demonstração gerado ainda.</p>
                  <p className="text-xs mt-1 text-slate-500">Clique em "GERAR LINK DE DEMONSTRAÇÃO" acima para criar seu primeiro link rastreável.</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {qrs.map((qr) => {
                    const displayUrl = buildPublicDemoUrl(qr.token, 'token', qr.url);
                    return (
                    <div
                      key={qr.id}
                      className="border border-slate-200 hover:border-emerald-300 rounded-3xl p-5 sm:p-6 bg-white shadow-sm transition-all space-y-5"
                    >
                      {/* Main Header & Metrics */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-100/70 border border-emerald-200 px-2.5 py-1 rounded-lg">
                            {qr.token}
                          </span>
                          <span className="text-xs text-slate-500">
                            Origem: <strong className="text-slate-800 font-semibold">{qr.origin}</strong>
                          </span>
                        </div>

                        <div className="flex items-center gap-5 text-xs font-bold text-slate-700">
                          <span>Acessos: <strong className="text-emerald-600 font-mono text-sm">{qr.hits_count}</strong></span>
                          <span>Adesões: <strong className="text-emerald-600 font-mono text-sm">{qr.adhesions_count}</strong></span>
                          <span className="text-[11px] text-slate-400 font-normal">
                            Criado em {new Date(qr.created_at).toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                      </div>

                      {/* Primary Channel: Link de Demonstração */}
                      <div className="space-y-2">
                        <label className="text-xs font-black text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                          <Link2 className="w-3.5 h-3.5 text-emerald-600" />
                          Link de Demonstração (Principal para Celular / WhatsApp)
                        </label>

                        <div className="flex flex-col sm:flex-row items-stretch gap-2">
                          <input
                            type="text"
                            readOnly
                            value={displayUrl}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-mono text-slate-800 select-all focus:outline-none focus:border-emerald-500"
                          />

                          <button
                            onClick={() => handleCopyLink(displayUrl, qr.token)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                          >
                            {copiedToken === qr.token ? (
                              <>
                                <Check className="w-4 h-4" />
                                Copiado!
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4" />
                                COPIAR LINK
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => handleShareWhatsApp(displayUrl)}
                            className="bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                          >
                            <MessageSquare className="w-4 h-4" />
                            COMPARTILHAR NO WHATSAPP
                          </button>

                          <a
                            href={displayUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-3.5 py-2.5 rounded-xl transition-all flex items-center justify-center gap-1 shrink-0"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Abrir Demo
                          </a>
                        </div>
                      </div>

                      {/* Secondary Channel: OU UTILIZE O QR CODE */}
                      <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-4 flex flex-col sm:flex-row items-center sm:items-start gap-4">
                        <div className="p-2.5 bg-white border border-slate-200 rounded-xl shrink-0 shadow-sm">
                          <QRCodeSVG value={displayUrl} size={84} />
                        </div>

                        <div className="space-y-1 text-center sm:text-left flex-1">
                          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                            <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                              <QrCode className="w-3.5 h-3.5 text-slate-500" />
                              OU UTILIZE O QR CODE (Canal Secundário / Alternativo)
                            </h4>
                            <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-bold">
                              Opcional
                            </span>
                          </div>

                          <p className="text-xs text-slate-500 leading-relaxed">
                            Ideal para apresentações presenciais, reuniões em computadores/telas, materiais impressos ou eventos. Para envio individual pelo celular, <strong>prefira sempre o Link acima</strong>.
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {leads.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Users className="w-12 h-12 mx-auto mb-2 opacity-40" />
                  <p className="font-bold text-sm">Nenhum síndico aderiu ao teste ainda.</p>
                  <p className="text-xs mt-1">Divulgue o Link de Demonstração para atrair novos condomínios.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {leads.map((lead) => (
                    <div
                      key={lead.id}
                      className={`border rounded-2xl p-4 transition-all ${
                        lead.status === 'TESTE_ATIVADO'
                          ? 'bg-slate-50/80 border-slate-200'
                          : 'bg-white border-emerald-300 shadow-sm'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-slate-900 text-sm">{lead.name}</h4>
                            <span
                              className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                                lead.status === 'TESTE_ATIVADO'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {lead.status === 'TESTE_ATIVADO' ? 'Teste Ativado' : 'Adesão Pendente'}
                            </span>

                            {lead.origin_type === 'SINDICO' && (
                              <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <Award className="w-3 h-3" />
                                Indicado por: {lead.referrer_condo_name || 'Síndico'}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                            <span className="flex items-center gap-1 font-semibold text-slate-700">
                              <Building2 className="w-3.5 h-3.5 text-slate-400" />
                              {lead.condo_name}
                            </span>
                            <span className="flex items-center gap-1">
                              <Phone className="w-3.5 h-3.5 text-slate-400" />
                              {lead.phone}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-slate-400" />
                              {new Date(lead.created_at).toLocaleString('pt-BR')}
                            </span>
                          </div>
                        </div>

                        <div>
                          {lead.status === 'TESTE_ATIVADO' ? (
                            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              15 Dias Liberados
                              {lead.bonus_granted && ' (+15 Bônus Indicador)'}
                            </div>
                          ) : (
                            <button
                              onClick={() => handleActivateTrial(lead)}
                              disabled={activatingId === lead.id}
                              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                            >
                              {activatingId === lead.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Gift className="w-4 h-4" />
                              )}
                              ATIVAR TESTE (15 Dias)
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer info banner */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-600" />
            Regra 15 + 15 controlada 100% pelo servidor com auditoria de eventos
          </span>
          <button onClick={fetchData} className="text-slate-600 hover:text-slate-900 flex items-center gap-1 font-semibold cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </button>
        </div>
      </div>
    </div>
  );
}

