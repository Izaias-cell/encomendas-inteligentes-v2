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
      const [qrsRes, leadsRes] = await Promise.all([
        api.get('/api/admin/demo-qr'),
        api.get('/api/admin/referrals/leads')
      ]);

      if (qrsRes && qrsRes.data && qrsRes.data.success) {
        setQrs(qrsRes.data.qrs || []);
      }
      if (leadsRes && leadsRes.data && leadsRes.data.success) {
        setLeads(leadsRes.data.leads || []);
      }
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
      const res = await api.post('/api/admin/demo-qr/generate');
      if (res && res.data && res.data.success) {
        toast.success('Novo Link de Demonstração gerado com sucesso!');
        await fetchData();
      } else {
        toast.error(res?.data?.error || 'Erro ao gerar link de demonstração.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao gerar link de demonstração.');
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
      const res = await api.post(`/api/admin/referrals/${lead.id}/activate`, {
        condo_name: lead.condo_name,
        manager_name: lead.name,
        phone: lead.phone
      });

      if (res && res.data && res.data.success) {
        toast.success(res.data.message || 'Período de teste ativado com sucesso!');
        await fetchData();
      } else {
        toast.error(res?.data?.error || 'Erro ao ativar teste.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao ativar teste.');
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
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 border-b border-slate-100 flex gap-4 bg-white">
          <button
            onClick={() => setActiveTab('links')}
            className={`py-3.5 text-xs sm:text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
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
            className={`py-3.5 text-xs sm:text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
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
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 shrink-0 disabled:opacity-50"
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
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0"
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
                            className="bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0"
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

