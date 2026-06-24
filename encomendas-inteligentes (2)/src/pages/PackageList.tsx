import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Package, Profile } from '../types';
import { Package as PackageIcon, Plus, Loader2, Search, User, Home, Truck, Calendar, CheckCircle, Clock, QrCode, Hash, MessageSquare, MessageCircle, AlertCircle, ArrowRight } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatDate, formatSafeDateTime } from '../lib/dateUtils';
import { formatResidentAddress, formatPackageUnit } from '../lib/residentUtils';
import { ptBR } from 'date-fns/locale';
import { motion } from 'motion/react';

interface PackageListProps {
  user: Profile;
}

export default function PackageList({ user }: PackageListProps) {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  const [selectedPkg, setSelectedPkg] = useState<Package | null>(null);
  const [viewPhotoUrl, setViewPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    fetchPackages();
  }, [user.condominium_id, user.id]);

  const fetchPackages = async () => {
    if (!user.condominium_id) return;
    try {
      const { data, error } = await supabase
        .from('packages')
        .select('*, moradores(nome, unidade, unit_type, block, street), package_id:id, unit_label:unit_number')
        .eq('condominium_id', user.condominium_id)
        .order('received_at', { ascending: false });

      if (error) throw error;
      
      let pkgs = data || [];
      
      if (user.role === 'resident') {
        // Filter by recipient_id or unit
        pkgs = pkgs.filter((p: any) => 
          p.recipient_id === user.id || 
          p.unit_label === (user.unit || user.unidade || '')
        );
      }

      setPackages(pkgs);
    } catch (error) {
      console.error('Erro ao buscar encomendas:', error);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredPackages = () => {
    const filtered = packages.filter((p: any) => 
      (p.moradores?.nome || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.unit_label?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.carrier?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.tracking_code?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Agrupamento para encomendas pendentes
    const pending = filtered.filter(p => p.status !== 'delivered');
    const delivered = filtered.filter(p => p.status === 'delivered');

    const groups: { [key: string]: any[] } = {};
    pending.forEach(pkg => {
      const key = pkg.pickup_token || pkg.pickup_code || pkg.id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(pkg);
    });

    const groupedPending = Object.values(groups).map(group => {
      if (group.length === 1) return group[0];
      return {
        ...group[0],
        isGroup: true,
        packages: group,
        count: group.length
      };
    });

    return [...groupedPending, ...delivered];
  };

  const filteredPackages = getFilteredPackages();

  const getStatusBadge = (status: string) => {
    const variants: any = {
      received: 'bg-blue-100 text-blue-700',
      notified: 'bg-amber-100 text-amber-700',
      delivered: 'bg-emerald-100 text-emerald-700'
    };
    const labels: any = {
      received: 'Recebido',
      notified: 'Notificado',
      delivered: 'Entregue'
    };
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${variants[status] || 'bg-zinc-100 text-zinc-600'}`}>
        {labels[status] || status}
      </span>
    );
  };

  const getWhatsAppBadge = (status: string, pkg?: any) => {
    // Check if was notified by flag or by status string
    const isActuallySent = (pkg?.whatsapp_sent || pkg?.whatsapp_notified) || 
      ['sent', 'enviado', 'delivered', 'read'].includes((status || '').toLowerCase());
    
    if (isActuallySent) {
      return (
        <div className="flex items-center gap-2 px-5 py-0.5 text-emerald-600 font-black opacity-90 hover:opacity-100 bg-emerald-50/50 rounded-full border border-emerald-100" title="Avisado">
          <span className="text-[12px] uppercase tracking-wide">💬 Avisado</span>
        </div>
      );
    }

    return (
      <motion.div 
        animate={{ 
          scale: [1, 1.05, 1],
        }}
        transition={{ 
          duration: 1.5, 
          repeat: Infinity,
          ease: "easeInOut"
        }}
        className="flex items-center gap-1.5 px-3 py-1 bg-red-50 text-red-600 font-bold rounded-full border border-red-200 shadow-sm"
        title="Clique para avisar o morador"
      >
        <span className="text-[10px] uppercase tracking-tight">💬 Avisar Morador</span>
      </motion.div>
    );
  };

  const getDeliveryMethodLabel = (method?: string) => {
    switch (method) {
      case 'manual': return 'MANUAL';
      case 'qr_code': return 'QR CODE';
      case 'code':
      case 'CÓDIGO':
      case 'pickup_code': return 'CÓDIGO';
      case 'photo':
      case 'foto': return 'RETIRADA COM FOTO';
      default: return '-';
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Encomendas</h1>
          <p className="text-zinc-500">Acompanhe a chegada e entrega de pacotes</p>
        </div>
        {(user.role === 'porteiro' || user.role === 'sindico' || user.role === 'admin') && (
          <button
            onClick={() => navigate('/packages/new')}
            className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Nova Encomenda
          </button>
        )}
      </div>

      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-4 rounded-2xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all bg-white"
          placeholder="Buscar por destinatário ou unidade..."
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
        </div>
      ) : filteredPackages.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPackages.map((pkg: any) => (
            <div 
              key={pkg.package_id}
              onClick={() => pkg.status !== 'delivered' && setSelectedPkg(pkg)}
              className={`bg-white rounded-3xl border border-zinc-100 shadow-sm p-6 hover:shadow-md transition-all group ${pkg.status !== 'delivered' ? 'cursor-pointer border-emerald-100' : ''}`}
            >
              <div className="flex justify-between items-start mb-4">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center relative transition-colors shrink-0 ${pkg.status === 'delivered' ? 'bg-emerald-50' : 'bg-zinc-100 group-hover:bg-zinc-200'}`}>
                  <div className="relative">
                    <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 drop-shadow-sm">
                      <rect x="2" y="5" width="20" height="16" rx="2" fill="#FBBF24" />
                      <rect x="10" y="5" width="4" height="8" fill="#FFFFFF" fillOpacity="0.9" />
                      <rect x="5" y="15" width="6" height="1" rx="0.5" fill="#4B5563" fillOpacity="0.7" />
                      <rect x="5" y="17" width="6" height="1" rx="0.5" fill="#4B5563" fillOpacity="0.7" />
                      <rect x="5" y="19" width="6" height="1" rx="0.5" fill="#4B5563" fillOpacity="0.7" />
                    </svg>
                    {pkg.status === 'delivered' && (
                      <div className="absolute -bottom-1 -right-1 bg-emerald-500 rounded-full w-6 h-6 flex items-center justify-center border-2 border-white shadow-sm scale-110">
                        <CheckCircle className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </div>
                  <span className={`absolute -top-3 -right-3 text-white text-sm font-bold w-9 h-9 rounded-full flex items-center justify-center border-2 border-white shadow-lg z-10 group-hover:scale-110 transition-transform ${pkg.status === 'delivered' ? 'bg-emerald-500 shadow-[0_4px_12px_rgba(16,185,129,0.3)]' : 'bg-red-500 shadow-[0_4px_12px_rgba(239,68,68,0.3)]'}`}>
                    {pkg.isGroup ? pkg.count : 1}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {pkg.status !== 'delivered' && pkg.pickup_token && (
                    <div className="w-8 h-8 bg-zinc-100 rounded-lg flex items-center justify-center text-zinc-600">
                      <QrCode className="w-5 h-5" />
                    </div>
                  )}
                  {getStatusBadge(pkg.status)}
                </div>
              </div>
              
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-zinc-900 truncate pr-2" title={pkg.moradores?.nome}>
                  {pkg.moradores?.nome || 'Morador não identificado'}
                </h3>
                {getWhatsAppBadge(pkg.whatsapp_status, pkg)}
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-zinc-500 text-sm">
                  <Home className="w-4 h-4 flex-shrink-0" />
                  <p className="font-medium">{formatPackageUnit(pkg)}</p>
                </div>
                <div className="mt-4 pt-4 border-t border-zinc-50 space-y-3">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-zinc-400 tracking-widest uppercase">
                      Código de retirada {pkg.isGroup ? 'Único' : ''}
                    </span>
                    <p className={`font-mono text-sm font-bold ${pkg.status === 'delivered' ? 'text-emerald-600' : 'text-red-600'}`}>{pkg.pickup_code || '-'}</p>
                  </div>

                  {!pkg.isGroup && pkg.tracking_code && (
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-zinc-400 tracking-widest uppercase">
                        Etiqueta
                      </span>
                      <p className="font-mono text-sm text-zinc-900 font-bold truncate" title={pkg.tracking_code}>{pkg.tracking_code}</p>
                    </div>
                  )}

                  {!pkg.isGroup && pkg.photo_url && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewPhotoUrl(pkg.photo_url);
                      }}
                      className="w-full mt-2 py-2 bg-zinc-50 text-zinc-600 rounded-xl text-xs font-bold hover:bg-zinc-100 transition-all flex items-center justify-center gap-2 border border-zinc-100"
                    >
                      <Truck className="w-3.5 h-3.5" />
                      VER FOTO DA ETIQUETA
                    </button>
                  )}
                </div>
                <div className="space-y-1 pt-2 border-t border-zinc-50/50">
                  <div className="flex items-center gap-2 text-zinc-500 text-[11px]">
                    <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                    <p>{pkg.isGroup ? 'Última recebida em:' : 'Recebido em:'} <span className="font-medium text-zinc-700">{formatSafeDateTime(pkg.received_at)}</span></p>
                  </div>
                  {pkg.delivered_at && (
                    <div className="flex items-center gap-2 text-emerald-600 text-[11px]">
                      <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      <p>Retirado em: <span className="font-bold">{formatSafeDateTime(pkg.delivered_at)}</span></p>
                    </div>
                  )}
                  {pkg.status === 'delivered' && (
                    <div className="flex items-center gap-2 text-zinc-500 text-[11px]">
                      <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" />
                      <p>Forma: <span className="font-bold uppercase">{getDeliveryMethodLabel(pkg.delivery_method)}</span></p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-zinc-100 p-20 text-center">
          <div className="w-20 h-20 bg-zinc-50 text-zinc-300 rounded-full flex items-center justify-center mx-auto mb-6">
            <PackageIcon className="w-10 h-10" />
          </div>
          <h3 className="text-xl font-bold text-zinc-900 mb-2">Nenhuma encomenda encontrada</h3>
          <p className="text-zinc-500">As encomendas do seu condomínio aparecerão aqui.</p>
        </div>
      )}

      {/* Modal de Foto */}
      {viewPhotoUrl && (
        <div className="fixed inset-0 bg-black/90 z-[70] flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-300">
          <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center">
            <button 
              onClick={() => setViewPhotoUrl(null)}
              className="absolute -top-12 right-0 text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-all"
            >
              <Plus className="w-6 h-6 rotate-45" />
            </button>
            <img 
              src={viewPhotoUrl} 
              alt="Foto da etiqueta" 
              className="max-w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl border-4 border-white/10"
              referrerPolicy="no-referrer"
            />
            <div className="mt-6 flex gap-4">
              <button
                onClick={() => setViewPhotoUrl(null)}
                className="bg-white text-zinc-900 px-8 py-3 rounded-xl font-bold hover:bg-zinc-100 transition-all"
              >
                Fechar
              </button>
              <a 
                href={viewPhotoUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center gap-2"
              >
                Abrir imagem original
              </a>
            </div>
          </div>
        </div>
      )}

      {selectedPkg && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl max-w-sm w-full p-8 text-center animate-in zoom-in-95 duration-300 shadow-2xl">
            <h3 className="text-xl font-bold mb-2">QR Code de Retirada</h3>
            <p className="text-zinc-500 text-sm mb-6">Apresente este código na portaria para retirar sua encomenda.</p>
            
            <div className="bg-white p-4 rounded-2xl border-2 border-zinc-100 inline-block mb-6">
              <QRCodeSVG 
                value={JSON.stringify({
                  id: selectedPkg.id,
                  code: selectedPkg.pickup_code,
                  token: selectedPkg.pickup_token
                })} 
                size={200} 
              />
            </div>

            <div className="text-left bg-zinc-50 p-4 rounded-xl mb-6 space-y-1">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Detalhes</p>
              <p className="text-xs text-zinc-500">Recebido em {formatSafeDateTime(selectedPkg.received_at)}</p>
              <p className="text-xs text-zinc-500">
                Registrado por: <span className="font-semibold text-zinc-700">{selectedPkg.recebido_por || selectedPkg.porter_name || selectedPkg.registrar?.full_name || 'Portaria'}</span>
              </p>
              {selectedPkg.status === 'delivered' && (
                <>
                  <p className="text-xs text-zinc-500">
                    Retirado em: <span className="font-semibold text-zinc-700">{formatSafeDateTime(selectedPkg.delivered_at)}</span>
                  </p>
                  <p className="text-xs text-zinc-500">
                    Retirado por: <span className="font-semibold text-zinc-700">{selectedPkg.delivered_to_name || 'Morador'}</span>
                  </p>
                  <p className="text-xs text-zinc-500">
                    Baixa por: <span className="font-semibold text-zinc-700">{selectedPkg.entregue_por || 'Portaria'}</span>
                  </p>
                </>
              )}
            </div>

            <button 
              className="w-full bg-emerald-600 text-white py-4 rounded-xl font-bold hover:bg-emerald-700 transition-all" 
              onClick={() => setSelectedPkg(null)}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
