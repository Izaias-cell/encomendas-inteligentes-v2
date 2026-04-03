import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Package, Profile } from '../types';
import { Package as PackageIcon, Plus, Loader2, Search, User, Home, Truck, Calendar, CheckCircle, Clock, QrCode, Hash, MessageSquare, ArrowRight } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatDate, formatSafeDateTime } from '../lib/dateUtils';
import { formatResidentAddress, formatPackageUnit } from '../lib/residentUtils';
import { ptBR } from 'date-fns/locale';

interface PackageListProps {
  user: Profile;
}

export default function PackageList({ user }: PackageListProps) {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  const [selectedPkg, setSelectedPkg] = useState<Package | null>(null);

  useEffect(() => {
    fetchPackages();
  }, [user.condominium_id, user.id]);

  const fetchPackages = async () => {
    if (!user.condominium_id) return;
    try {
      const { data, error } = await supabase
        .from('packages')
        .select('*, package_id:id, recipient_name:recipient_name_raw, unit_label:unit_number')
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

  const filteredPackages = packages.filter((p: any) => 
    p.recipient_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.unit_label?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.carrier?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.tracking_code?.toLowerCase().includes(searchTerm.toLowerCase())
  );

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

  const getWhatsAppBadge = (status: string) => {
    const variants: any = {
      pending: 'text-amber-500',
      sent: 'text-blue-500',
      delivered: 'text-emerald-500',
      read: 'text-emerald-600',
      failed: 'text-red-500',
      error: 'text-red-500',
      no_recipient: 'text-zinc-400'
    };
    const labels: any = {
      pending: 'Pendente',
      sent: 'Enviado',
      delivered: 'Entregue',
      read: 'Lido',
      failed: 'Falhou',
      error: 'Erro',
      no_recipient: 'Sem destinatário'
    };
    
    if (!status) return null;

    return (
      <div className="flex items-center gap-1.5" title={`WhatsApp: ${labels[status] || status}`}>
        <MessageSquare className={`w-3.5 h-3.5 ${variants[status] || 'text-zinc-400'}`} />
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tight">
          {labels[status] || status}
        </span>
      </div>
    );
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
          placeholder="Buscar por destinatário, unidade ou transportadora..."
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
                <div className="w-12 h-12 bg-zinc-50 text-emerald-600 rounded-2xl flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                  <PackageIcon className="w-6 h-6" />
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
                <h3 className="text-xl font-bold text-zinc-900">{pkg.recipient_name}</h3>
                {getWhatsAppBadge(pkg.whatsapp_status)}
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-zinc-500 text-sm">
                  <Home className="w-4 h-4 flex-shrink-0" />
                  <p className="font-medium">{formatPackageUnit(pkg)}</p>
                </div>
                <div className="flex items-center gap-3 text-zinc-500 text-sm">
                  <Truck className="w-4 h-4 flex-shrink-0" />
                  <p>{pkg.carrier}</p>
                </div>
                <div className="mt-4 pt-4 border-t border-zinc-50 space-y-3">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-zinc-400 tracking-widest uppercase">
                      Código de retirada
                    </span>
                    <p className={`font-mono text-sm font-bold ${pkg.status === 'delivered' ? 'text-zinc-500' : 'text-emerald-600'}`}>{pkg.pickup_code || '-'}</p>
                  </div>

                  {pkg.tracking_code && (
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-zinc-400 tracking-widest uppercase">
                        Etiqueta
                      </span>
                      <p className="font-mono text-sm text-zinc-900 font-bold truncate" title={pkg.tracking_code}>{pkg.tracking_code}</p>
                    </div>
                  )}
                </div>
                <div className="space-y-1 pt-2 border-t border-zinc-50/50">
                  <div className="flex items-center gap-2 text-zinc-500 text-[11px]">
                    <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                    <p>Recebido em: <span className="font-medium text-zinc-700">{formatSafeDateTime(pkg.received_at)}</span></p>
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
                      <p>Forma: <span className="font-bold uppercase">{!pkg.delivery_method ? '-' : (pkg.delivery_method === 'photo' || pkg.delivery_method === 'foto' ? 'RETIRADA COM FOTO' : (pkg.delivery_method === 'qr_code' ? 'QR CODE' : (pkg.delivery_method === 'code' ? 'CÓDIGO' : 'MANUAL')))}</span></p>
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

            <div className="text-left bg-zinc-50 p-4 rounded-xl mb-6">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Detalhes</p>
              <p className="text-sm font-bold text-zinc-900">{selectedPkg.carrier}</p>
              <p className="text-xs text-zinc-500">Recebido em {formatSafeDateTime(selectedPkg.received_at)}</p>
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
