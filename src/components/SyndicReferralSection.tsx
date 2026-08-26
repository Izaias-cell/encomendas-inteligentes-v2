import React, { useState, useEffect } from 'react';
import { 
  Gift, Award, Users, Share2, Copy, Check, 
  ExternalLink, Smartphone, Clock, Sparkles, 
  CheckCircle2, AlertCircle, RefreshCw, Loader2,
  Building2, MessageSquare
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'react-hot-toast';
import { api } from '../lib/apiClient';
import { SyndicReferralInfo } from '../types';
import { buildPublicDemoUrl } from '../lib/urlUtils';

export default function SyndicReferralSection() {
  const [data, setData] = useState<SyndicReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const fetchReferralInfo = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/sindico/referral-info');
      if (res && res.data && res.data.success) {
        setData(res.data);
      }
    } catch (err: any) {
      console.warn('Erro ao carregar programa de indicação:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReferralInfo();
  }, []);

  const displayReferralUrl = data ? buildPublicDemoUrl(data.referral_code, 'ref', data.referral_url) : '';

  const handleCopy = () => {
    if (!displayReferralUrl) return;
    navigator.clipboard.writeText(displayReferralUrl);
    setCopied(true);
    toast.success('Link de indicação copiado!');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleShareWhatsApp = () => {
    if (!displayReferralUrl) return;
    const shareText = `Olá, Síndico! Estou usando o sistema ENCOMENDAS INTELIGENTES e a gestão da portaria ficou 100% automatizada e sem extravios.\n\nExperimente você também com 15 DIAS GRÁTIS pelo link:\n${displayReferralUrl}`;
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank');
  };

  if (loading) {
    return (
      <div className="bg-white rounded-3xl border border-slate-100 p-8 flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Banner with 15 + 15 Highlight */}
      <div className="bg-gradient-to-br from-emerald-900 via-slate-900 to-teal-950 text-white rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold uppercase tracking-widest px-3.5 py-1 rounded-full">
            <Gift className="w-3.5 h-3.5" />
            Programa Oficial 15 + 15
          </div>

          <h2 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight">
            Indique um Síndico Amigo e ganhe <span className="text-emerald-400">+15 DIAS GRÁTIS</span>.
          </h2>

          <p className="text-slate-300 text-xs sm:text-sm leading-relaxed max-w-2xl">
            Para cada condomínio que aderir ao teste pelo seu link exclusivo, o síndico indicado recebe <strong>15 dias de teste grátis</strong> e o seu condomínio ganha <strong>+15 dias de bônus automático</strong> no plano.
          </p>

          <div className="pt-2 flex flex-wrap gap-4">
            <div className="bg-white/10 backdrop-blur-md border border-white/10 px-4 py-2.5 rounded-2xl">
              <span className="text-[11px] text-slate-300 uppercase font-bold block">Seus Dias Restantes</span>
              <span className="text-2xl font-black text-emerald-400">{data.days_remaining} Dias</span>
            </div>

            <div className="bg-white/10 backdrop-blur-md border border-white/10 px-4 py-2.5 rounded-2xl">
              <span className="text-[11px] text-slate-300 uppercase font-bold block">Bônus Acumulados</span>
              <span className="text-2xl font-black text-teal-300">+{data.referral_bonus_days} Dias</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sharing & QR Code Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Referral Card */}
        <div className="md:col-span-2 bg-white rounded-3xl border border-slate-100 p-6 sm:p-7 shadow-sm space-y-5 flex flex-col justify-between">
          <div className="space-y-3">
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <Share2 className="w-5 h-5 text-emerald-600" />
              Link de Indicação (Recomendado para Celular / WhatsApp)
            </h3>
            <p className="text-xs text-slate-500">
              Envie o link diretamente para colegas síndicos ou grupos. Ao clicar, a demonstração abre imediatamente no navegador do celular deles.
            </p>

            <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-2xl">
              <input
                type="text"
                readOnly
                value={displayReferralUrl}
                className="flex-1 bg-transparent px-3 text-xs sm:text-sm font-mono text-slate-700 select-all focus:outline-none"
              />
              <button
                onClick={handleCopy}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all flex items-center gap-1.5 shrink-0 shadow-sm"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copiar
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={handleShareWhatsApp}
              className="w-full sm:w-auto bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold text-xs uppercase tracking-wider px-5 py-3 rounded-xl transition-all shadow-md shadow-[#25D366]/20 flex items-center justify-center gap-2"
            >
              <MessageSquare className="w-4 h-4" />
              Convidar Síndico no WhatsApp
            </button>

            <span className="text-xs text-slate-400 font-medium">
              Código Único: <strong className="text-slate-700 font-mono">{data.referral_code}</strong>
            </span>
          </div>
        </div>

        {/* QR Code Card */}
        <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm flex flex-col items-center justify-center text-center">
          <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl shadow-inner mb-3">
            <QRCodeSVG value={displayReferralUrl} size={110} />
          </div>
          <h4 className="text-xs font-bold text-slate-800">OU USE O QR CODE</h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Alternativa para apresentações presenciais, reuniões ou cartazes impressos.
          </p>
        </div>
      </div>

      {/* Referrals List & Statistics */}
      <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-7 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-600" />
              Condomínios e Síndicos Indicados por Você
            </h3>
            <p className="text-xs text-slate-500">
              Acompanhe o status das suas indicações em tempo real
            </p>
          </div>

          <button
            onClick={fetchReferralInfo}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-50"
            title="Atualizar"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {data.referrals.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-slate-200 rounded-2xl">
            <Gift className="w-10 h-10 mx-auto text-slate-300 mb-2" />
            <p className="text-xs font-bold text-slate-600">Nenhuma indicação registrada ainda.</p>
            <p className="text-[11px] text-slate-400 mt-1">
              Envie seu link para colegas síndicos e ganhe +15 dias grátis para cada condomínio ativado.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.referrals.map((refLead) => (
              <div
                key={refLead.id}
                className="border border-slate-100 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h5 className="font-bold text-slate-900 text-xs sm:text-sm">{refLead.name}</h5>
                    <span
                      className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                        refLead.status === 'TESTE_ATIVADO'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {refLead.status === 'TESTE_ATIVADO' ? 'Teste Ativado (+15 Bônus)' : 'Adesão Registrada'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1 font-medium text-slate-700">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      {refLead.condo_name}
                    </span>
                    <span>•</span>
                    <span>{new Date(refLead.created_at).toLocaleDateString('pt-BR')}</span>
                  </div>
                </div>

                <div>
                  {refLead.status === 'TESTE_ATIVADO' ? (
                    <div className="flex items-center gap-1.5 text-xs font-black text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-xl">
                      <CheckCircle2 className="w-4 h-4" />
                      +15 Dias Adicionados
                    </div>
                  ) : (
                    <span className="text-xs text-amber-600 font-semibold bg-amber-50 px-3 py-1.5 rounded-xl">
                      Aguardando ativação pelo Administrador
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
