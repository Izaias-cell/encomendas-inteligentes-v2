import React from 'react';
import { Package as PackageIcon, Home, Truck, Clock, CheckCircle, ArrowRight, Camera, Hash, Layers, MessageSquare } from 'lucide-react';
import { Package } from '../../types';
import { formatSafeDateTime } from '../../lib/dateUtils';
import { formatPackageUnit } from '../../lib/residentUtils';

interface PackageItemProps {
  pkg: any;
  getWhatsAppBadge: (status: string) => React.ReactNode;
  getDeliveryMethodLabel: (method?: string) => string;
  onDeliverWithPhoto: (pkg: any) => void;
  onCodeRetrieval: () => void;
  onViewPhotos?: (pkg: any) => void;
  onViewLabel?: (url: string) => void;
  handleDeliver: (id: string, method: any, photo?: string, data?: any) => void;
  setQrPackage: (pkg: any) => void;
}

const PackageItem: React.FC<PackageItemProps> = ({ 
  pkg, 
  getWhatsAppBadge, 
  getDeliveryMethodLabel,
  onDeliverWithPhoto,
  onCodeRetrieval,
  onViewPhotos,
  onViewLabel,
  handleDeliver,
  setQrPackage
}) => {
  return (
    <div className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-6 hover:shadow-md transition-all group">
      <div className="flex justify-between items-start mb-4">
        <div className="w-12 h-12 bg-zinc-50 text-emerald-600 rounded-2xl flex items-center justify-center group-hover:bg-emerald-100 transition-colors relative overflow-hidden">
          {pkg.photo_url ? (
            <img 
              src={pkg.photo_url} 
              alt="Etiqueta" 
              className="w-full h-full object-cover rounded-2xl"
              referrerPolicy="no-referrer"
            />
          ) : (
            <PackageIcon className="w-6 h-6" />
          )}
          {pkg.isGroup && (
            <span className="absolute -top-1 -right-1 bg-emerald-600 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-sm z-10">
              {pkg.count}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${pkg.status === 'delivered' ? 'bg-zinc-100 text-zinc-600' : 'bg-amber-100 text-amber-700'}`}>
            {pkg.status === 'delivered' 
              ? (pkg.isGroup ? `${pkg.count} Retiradas` : 'Retirada') 
              : (pkg.isGroup ? `${pkg.count} Pendentes` : 'Pendente')}
          </span>
        </div>
      </div>
      
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-zinc-900">{pkg.recipient_name}</h3>
        {getWhatsAppBadge(pkg.whatsapp_status)}
      </div>
      
      <div className="space-y-3 mb-6">
        <div className="flex items-center gap-3 text-zinc-500 text-sm">
          <Home className="w-4 h-4 flex-shrink-0" />
          <p className="font-medium">{formatPackageUnit(pkg)}</p>
        </div>
        {!pkg.isGroup && (
          <div className="flex items-center gap-3 text-zinc-500 text-sm">
            <Truck className="w-4 h-4 flex-shrink-0" />
            <p>{pkg.carrier}</p>
          </div>
        )}
        
        {pkg.isGroup && (
          <div className="bg-zinc-50 rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Transportadoras:</p>
            <div className="flex flex-wrap gap-2">
              {Array.from(new Set(pkg.packages.map((p: any) => p.carrier))).map((c: any, i) => (
                <span key={i} className="text-[11px] bg-white border border-zinc-200 px-2 py-0.5 rounded-md text-zinc-600 font-medium">{c}</span>
              ))}
            </div>
          </div>
        )}
        
        <div className="mt-4 pt-4 border-t border-zinc-50 space-y-3">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-zinc-400 tracking-widest uppercase">
              {pkg.isGroup ? 'Código único de retirada' : 'Código de retirada'}
            </span>
            <button
              onClick={() => {
                if (pkg.status === 'delivered') return;
                setQrPackage(pkg);
                handleDeliver(pkg.package_id || pkg.id, 'code', undefined, pkg);
              }}
              className={`font-mono text-2xl font-black tracking-wider text-left transition-all ${pkg.status === 'delivered' ? 'text-zinc-400 cursor-default' : 'text-emerald-600 hover:text-emerald-700 hover:scale-105 active:scale-95'}`}
              title={pkg.status === 'delivered' ? '' : 'Clique para dar baixa usando este código'}
              disabled={pkg.status === 'delivered'}
            >
              {pkg.pickup_code || '-'}
            </button>
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
                onViewLabel?.(pkg.photo_url);
              }}
              className="w-full mt-2 py-2 bg-zinc-50 text-zinc-600 rounded-xl text-xs font-bold hover:bg-zinc-100 transition-all flex items-center justify-center gap-2 border border-zinc-100"
            >
              <Camera className="w-3.5 h-3.5" />
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

      <div className="grid grid-cols-2 gap-3">
        <button 
          type="button"
          onClick={() => onDeliverWithPhoto(pkg)}
          disabled={pkg.status === 'delivered'}
          className={`col-span-2 py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-3 text-base shadow-lg ${pkg.status === 'delivered' ? 'bg-zinc-50 text-zinc-400 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-900/20'}`}
        >
          <Camera className={`w-5 h-5 ${pkg.status === 'delivered' ? 'hidden' : ''}`} />
          {pkg.status === 'delivered' ? 'Entregue' : (pkg.isGroup ? 'ENTREGAR TODAS' : 'ENTREGAR COM FOTO')}
        </button>
        {pkg.isGroup && (
          <button 
            onClick={() => onViewPhotos?.(pkg)}
            className="col-span-2 bg-zinc-50 text-emerald-600 py-3 rounded-xl font-bold hover:bg-emerald-50 transition-all flex items-center justify-center gap-2 text-sm border border-emerald-100/50"
          >
            <Layers className="w-4 h-4" />
            Ver etiquetas
          </button>
        )}
        <div className="col-span-2 flex gap-2">
          <button 
            onClick={onCodeRetrieval}
            className="flex-1 bg-zinc-100 text-zinc-600 py-4 rounded-2xl font-bold hover:bg-zinc-900 hover:text-white transition-all flex items-center justify-center gap-3 text-base"
          >
            <Hash className="w-5 h-5" />
            CÓDIGO
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(PackageItem);
