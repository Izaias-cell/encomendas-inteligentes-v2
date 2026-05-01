import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Package, QrCode, Clock, CheckCircle, AlertCircle, Loader2, ChevronRight, Home, History, Hash, Search } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { ptBR } from 'date-fns/locale';
import { formatDate, formatSafeDateTime } from '../lib/dateUtils';
import { motion, AnimatePresence } from 'motion/react';
import { Package as PackageType, Morador, Condominium } from '../types';



const Card = ({ children, className = "", onClick }: { children: React.ReactNode, className?: string, onClick?: () => void }) => (
  <div 
    onClick={onClick}
    className={`bg-white rounded-3xl shadow-sm border border-zinc-100 overflow-hidden ${className} ${onClick ? 'cursor-pointer' : ''}`}
  >
    {children}
  </div>
);

const Badge = ({ children, variant = 'emerald' }: { children: React.ReactNode, variant?: 'emerald' | 'gray' | 'amber' }) => {
  const variants = {
    emerald: 'bg-emerald-50 text-emerald-600',
    gray: 'bg-zinc-100 text-zinc-500',
    amber: 'bg-amber-50 text-amber-600'
  };
  return (
    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${variants[variant]}`}>
      {children}
    </span>
  );
};

const ResidentPortal = () => {
  const { token, code } = useParams<{ token?: string, code?: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resident, setResident] = useState<Morador | null>(null);
  const [condo, setCondo] = useState<Condominium | null>(null);
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<PackageType | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');

  useEffect(() => {
    const validateAccess = async () => {
      try {
        const endpoint = token 
          ? `/api/portal/validate/${token}` 
          : `/api/portal/validate-code/${code}`;
          
        const response = await fetch(endpoint);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Acesso inválido ou expirado');
        }

        setResident(data.resident);
        setCondo(data.condominium);
        setPackages(data.packages);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (token || code) {
      validateAccess();
    } else {
      setError('Nenhum código ou token de acesso fornecido');
      setLoading(false);
    }
  }, [token, code]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-6">
        <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mb-4" />
        <p className="text-zinc-500 font-medium">Carregando seu portal...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6">
          <AlertCircle className="w-10 h-10" />
        </div>
        <h1 className="text-2xl font-bold text-zinc-900 mb-2">Acesso Indisponível</h1>
        <p className="text-zinc-500 mb-8 max-w-xs">
          {error === 'Link expirado' 
            ? 'Este link de acesso expirou por segurança. Solicite um novo link com a portaria.' 
            : 'Este link é inválido ou não existe mais.'}
        </p>
        <div className="bg-white p-6 rounded-3xl border border-zinc-100 shadow-sm w-full max-w-sm">
          <p className="text-sm text-zinc-600 mb-4">Precisa de ajuda?</p>
          <p className="text-xs text-zinc-400">Entre em contato com a administração do seu condomínio para receber um novo link de acesso.</p>
        </div>
      </div>
    );
  }

  const pendingPackages = packages.filter(p => p.status !== 'delivered');
  const historyPackages = packages.filter(p => p.status === 'delivered');

  return (
    <div className="min-h-screen bg-zinc-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-zinc-100 px-6 py-8 sticky top-0 z-10">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-emerald-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-100">
              <Home className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-900">{condo?.name}</h1>
              <p className="text-zinc-500 text-xs">Portal do Morador</p>
            </div>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-zinc-400 text-[10px] font-bold uppercase tracking-widest mb-1">Bem-vindo,</p>
              <h2 className="text-2xl font-bold text-zinc-900">{resident?.nome.split(' ')[0]}</h2>
              <p className="text-zinc-500 text-sm">Unidade {resident?.unidade}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto p-6 space-y-6">
        {/* Tabs */}
        <div className="flex p-1 bg-zinc-100 rounded-2xl">
          <button 
            onClick={() => setActiveTab('pending')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'pending' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500'}`}
          >
            <Package className="w-4 h-4" />
            Pendentes
            {pendingPackages.length > 0 && (
              <span className="bg-emerald-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center">
                {pendingPackages.length}
              </span>
            )}
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'history' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
          >
            <History className="w-4 h-4" />
            Histórico
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          {activeTab === 'pending' ? (
            pendingPackages.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-zinc-200">
                <div className="w-16 h-16 bg-zinc-50 text-zinc-300 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8" />
                </div>
                <p className="text-zinc-500 font-medium">Tudo em dia!</p>
                <p className="text-zinc-400 text-xs">Nenhuma encomenda aguardando retirada.</p>
              </div>
            ) : (
              pendingPackages.map(pkg => (
                <div 
                  key={pkg.id} 
                  className="bg-white rounded-3xl shadow-sm border border-zinc-100 overflow-hidden p-4 hover:border-emerald-200 transition-colors cursor-pointer" 
                  onClick={() => setSelectedPkg(pkg)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
                      <Package className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-zinc-900">{pkg.carrier}</h4>
                        <Badge variant="emerald">Pendente</Badge>
                      </div>
                      <p className="text-xs text-zinc-500 mt-1">
                        Recebido em {formatSafeDateTime(pkg.created_at)}
                      </p>
                      
                      <div className="mt-3 space-y-2 border-t border-zinc-50 pt-3">
                        {pkg.tracking_code && (
                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-zinc-400 tracking-widest uppercase">Código da etiqueta</span>
                            <p className="text-xs font-mono text-zinc-600">{pkg.tracking_code}</p>
                          </div>
                        )}
                        <div className="flex flex-col">
                          <span className="text-[9px] font-bold text-zinc-400 tracking-widest uppercase">Código de retirada</span>
                          <p className={`text-sm font-mono font-bold ${pkg.status === 'delivered' ? 'text-zinc-500' : 'text-emerald-600'}`}>{pkg.pickup_code || '-'}</p>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-zinc-300" />
                  </div>
                </div>
              ))
            )
          ) : (
            historyPackages.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-zinc-200">
                <p className="text-zinc-400 text-xs">Nenhum histórico de retiradas.</p>
              </div>
            ) : (
              historyPackages.map(pkg => (
                <div 
                  key={pkg.id} 
                  className="bg-white rounded-3xl shadow-sm border border-zinc-100 overflow-hidden p-4 opacity-70"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-zinc-50 text-zinc-400 rounded-2xl flex items-center justify-center">
                      <Package className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-zinc-900">{pkg.carrier}</h4>
                        <Badge variant="gray">Retirado</Badge>
                      </div>
                      <p className="text-xs text-zinc-500 mt-1">
                        Retirado em {pkg.delivered_at ? formatDate(pkg.delivered_at, "dd/MM 'às' HH:mm", { locale: ptBR }) : '---'}
                      </p>

                      <div className="mt-3 space-y-2 border-t border-zinc-50 pt-3">
                        {pkg.status === 'delivered' && pkg.tracking_code && (
                          <div className="flex flex-col">
                            <span className="text-[9px] font-bold text-zinc-400 tracking-widest uppercase">Código da etiqueta</span>
                            <p className="text-xs font-mono text-zinc-600">{pkg.tracking_code}</p>
                          </div>
                        )}
                        <div className="flex flex-col">
                          <span className="text-[9px] font-bold text-zinc-400 tracking-widest uppercase">Código de retirada</span>
                          <p className="text-sm font-mono text-zinc-500 font-bold">{pkg.pickup_code || '-'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      </div>

      {/* Package Detail Modal */}
      <AnimatePresence>
        {selectedPkg && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 backdrop-blur-sm">
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="bg-white w-full max-w-md rounded-t-[40px] sm:rounded-[40px] overflow-hidden shadow-2xl"
            >
              <div className="p-8">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <Badge variant="emerald">Encomenda Disponível</Badge>
                    <h3 className="text-2xl font-bold text-zinc-900 mt-2">{selectedPkg.carrier}</h3>
                    <p className="text-zinc-500 text-sm">Recebido em {formatSafeDateTime(selectedPkg.created_at)}</p>
                  </div>
                  <button 
                    type="button"
                    onClick={(e) => { e.preventDefault(); setSelectedPkg(null); }} 
                    className="p-2 bg-zinc-100 rounded-full text-zinc-400"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {selectedPkg.photo_url && (
                  <div className="mb-8">
                    <img src={selectedPkg.photo_url} className="w-full h-48 object-cover rounded-3xl border border-zinc-100" alt="Foto da encomenda" />
                  </div>
                )}

                <div className="bg-zinc-50 p-8 rounded-[32px] text-center mb-8">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-4">QR Code de Retirada</p>
                  <div className="bg-white p-4 rounded-3xl inline-block shadow-sm border border-zinc-100 mb-4">
                    <QRCodeSVG value={selectedPkg.pickup_token || ''} size={180} />
                  </div>
                  <p className="text-xs text-zinc-500 max-w-[200px] mx-auto">
                    Apresente este código na portaria para retirar sua encomenda rapidamente.
                  </p>
                </div>

                <div className="space-y-4">
                  {selectedPkg.status === 'delivered' && selectedPkg.tracking_code && (
                    <div className="flex justify-between items-center py-3 border-b border-zinc-50">
                      <div className="flex flex-col">
                        <span className="text-zinc-400 text-[10px] font-bold tracking-widest uppercase">Código da etiqueta</span>
                        <span className="font-mono text-sm font-bold text-zinc-900">{selectedPkg.tracking_code}</span>
                      </div>
                    </div>
                  )}
                  {selectedPkg.pickup_code && (
                    <div className="flex justify-between items-center py-3 border-b border-zinc-50">
                      <div className="flex flex-col">
                        <span className="text-zinc-400 text-[10px] font-bold tracking-widest uppercase">Código de retirada</span>
                        <span className={`font-mono font-black tracking-wider ${selectedPkg.status === 'delivered' ? 'text-zinc-500 text-sm' : 'text-emerald-600 text-lg'}`}>{selectedPkg.pickup_code}</span>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-center py-3 border-b border-zinc-50">
                    <span className="text-zinc-400 text-sm">Unidade</span>
                    <span className="font-bold text-zinc-900">{selectedPkg.unit_number}</span>
                  </div>
                </div>

                <button 
                  onClick={() => setSelectedPkg(null)}
                  className="w-full bg-zinc-900 text-white py-4 rounded-2xl font-bold mt-8 active:scale-95 transition-transform"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const X = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

export default ResidentPortal;
