import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, CheckCircle, AlertCircle, Loader2, Package, X, ZoomIn, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../lib/supabase';
import { Package as PackageType } from '../types';

const Retirada = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [packageData, setPackageData] = useState<any>(null);
  const [allPackages, setAllPackages] = useState<any[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    const fetchPackage = async () => {
      if (!token) {
        setError('Acesso inválido ou expirado');
        setLoading(false);
        return;
      }

      try {
        // Busca todas as encomendas no Supabase usando o pickup_token
        // Incluímos o join com moradores e condominiums para pegar os nomes reais
        const { data, error: supabaseError } = await supabase
          .from('packages')
          .select('*, moradores(*), condominiums(*)')
          .eq('pickup_token', token);

        if (supabaseError) throw supabaseError;

        if (!data || data.length === 0) {
          setError('Acesso inválido ou expirado');
          return;
        }

        setAllPackages(data);
        // Usamos a primeira para dados de morador/condomínio que são comuns
        setPackageData(data[0]);
      } catch (err: any) {
        console.error('Erro ao buscar encomenda:', err);
        setError('Acesso inválido ou expirado');
      } finally {
        setLoading(false);
      }
    };

    fetchPackage();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-6">
        <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mb-4" />
        <p className="text-zinc-500 font-medium">Carregando...</p>
      </div>
    );
  }

  if (error || !packageData) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6">
          <AlertCircle className="w-10 h-10" />
        </div>
        <h1 className="text-2xl font-bold text-zinc-900 mb-2">Acesso inválido ou expirado</h1>
        <p className="text-zinc-500 max-w-xs">O link que você acessou não é válido ou a encomenda já foi processada.</p>
      </div>
    );
  }

  const isDelivered = packageData.status === 'delivered';
  const resident = packageData.moradores;
  const condo = packageData.condominiums;

  // Extrai todas as fotos válidas das encomendas do lote
  const photos = allPackages
    .map((p, idx) => ({
      id: p.id || `photo_${idx}`,
      url: p.photo_url,
      number: idx + 1,
      carrier: p.carrier || p.transportadora
    }))
    .filter((item): item is { id: string; url: string; number: number; carrier?: string } => 
      typeof item.url === 'string' && item.url.trim().length > 0 && item.url.startsWith('http')
    );

  const getUnitDisplay = () => {
    // 1. Prioridade: Dados do morador vinculado
    if (resident) {
      const type = resident.unit_type || '';
      const num = resident.unidade || resident.unit_number || '';
      const block = resident.block || resident.bloco || '';
      
      if (num && num !== 'Não informada') {
        let display = num;
        if (type && type.toLowerCase() !== 'unidade') {
          display = `${type} ${num}`;
        }
        if (block) {
          display += ` - ${block}`;
        }
        return display;
      }
    }

    // 2. Segunda prioridade: Dados da própria encomenda (unit_number)
    const pkgUnit = packageData.unit_number || '';
    const pkgType = packageData.unit_type || '';
    const pkgBlock = packageData.block || packageData.bloco || '';

    if (pkgUnit && pkgUnit !== 'Não informada') {
      let display = pkgUnit;
      if (pkgType && pkgType.toLowerCase() !== 'unidade') {
        display = `${pkgType} ${pkgUnit}`;
      }
      if (pkgBlock) {
        display += ` - ${pkgBlock}`;
      }
      return display;
    }

    return 'Não informada';
  };

  return (
    <div className="min-h-screen bg-zinc-100 flex flex-col items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-white rounded-[32px] shadow-2xl overflow-hidden border border-zinc-200"
      >
        {/* Top Header */}
        <div className="bg-emerald-600 p-6 text-white text-center">
          <p className="text-xs font-bold uppercase tracking-widest opacity-80 mb-1">{condo?.name || 'Condomínio'}</p>
          <h1 className="text-xl font-bold">Retirada de Encomenda</h1>
        </div>

        <div className="p-8 flex flex-col items-center">
          {/* Resident Info */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-zinc-900">{resident?.nome || 'Morador'}</h2>
            <p className="text-zinc-500 font-medium">
              Unidade: {getUnitDisplay()}
            </p>
          </div>

          {/* Large Code Display */}
          <div className={`w-full py-10 rounded-[24px] flex flex-col items-center justify-center mb-8 border-2 ${isDelivered ? 'bg-zinc-50 border-zinc-200' : 'bg-emerald-50 border-emerald-100 shadow-inner'}`}>
            <span className={`text-[10px] font-bold uppercase tracking-[0.3em] mb-2 ${isDelivered ? 'text-emerald-600' : 'text-red-600'}`}>
              CÓDIGO DE RETIRADA {allPackages.length > 1 ? 'ÚNICO' : ''}
            </span>
            <span className={`text-7xl font-black tracking-tighter font-mono ${isDelivered ? 'text-emerald-500 line-through' : 'text-red-700'}`}>
              {packageData.pickup_code}
            </span>
            
            {allPackages.length > 1 && !isDelivered && (
              <div className="mt-6 flex flex-col items-center gap-1">
                <div className="px-4 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-full uppercase tracking-wider shadow-lg shadow-emerald-900/20">
                  {allPackages.length} Encomendas
                </div>
                <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest mt-1 opacity-70">Disponíveis para retirada</p>
              </div>
            )}
          </div>

          {/* Status Badge */}
          <div className={`flex items-center gap-2 px-6 py-3 rounded-full mb-6 ${isDelivered ? 'bg-zinc-100 text-zinc-600' : 'bg-emerald-100 text-emerald-700 shadow-sm'}`}>
            {isDelivered ? (
              <>
                <CheckCircle className="w-5 h-5" />
                <span className="text-sm font-bold uppercase tracking-widest">Retirada Concluída</span>
              </>
            ) : (
              <>
                <Clock className="w-5 h-5" />
                <span className="text-sm font-bold uppercase tracking-widest">Aguardando na Portaria</span>
              </>
            )}
          </div>

          {/* Galeria de Fotos das Encomendas */}
          {photos.length > 0 && (
            <div className="w-full mb-8">
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-xs font-bold text-zinc-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-emerald-600" />
                  {photos.length > 1 ? `Fotos do Lote (${photos.length} Volumes)` : 'Foto da Encomenda'}
                </span>
                <span className="text-[10px] text-zinc-400 font-medium">Toque para ampliar</span>
              </div>

              {photos.length === 1 ? (
                <div 
                  onClick={() => setSelectedImage(photos[0].url)}
                  className="relative group cursor-pointer overflow-hidden rounded-2xl border border-zinc-200 shadow-sm bg-zinc-100 aspect-[4/3] flex items-center justify-center"
                >
                  <img 
                    src={photos[0].url} 
                    alt="Foto da encomenda" 
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="bg-white/90 backdrop-blur-sm text-zinc-800 text-xs font-bold py-1.5 px-3 rounded-full flex items-center gap-1 shadow-lg">
                      <ZoomIn className="w-3.5 h-3.5" /> Ampliar
                    </span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {photos.map((photo) => (
                    <div 
                      key={photo.id}
                      onClick={() => setSelectedImage(photo.url)}
                      className="relative group cursor-pointer overflow-hidden rounded-2xl border border-zinc-200 shadow-sm bg-zinc-100 aspect-[4/3] flex items-center justify-center"
                    >
                      <img 
                        src={photo.url} 
                        alt={`Volume ${photo.number}`} 
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        Vol. {photo.number}
                      </div>
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="bg-white/90 backdrop-blur-sm text-zinc-800 text-[11px] font-bold py-1 px-2.5 rounded-full flex items-center gap-1 shadow-lg">
                          <ZoomIn className="w-3 h-3" /> Ver
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Instructions */}
          {!isDelivered ? (
            <div className="text-center space-y-2">
              <p className="text-zinc-600 font-medium">Apresente este código na portaria</p>
              <p className="text-zinc-400 text-xs">O porteiro irá validar este código para entregar sua encomenda.</p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-zinc-400 text-xs italic">Esta encomenda já foi entregue ao morador.</p>
            </div>
          )}
        </div>

        {/* Footer Branding */}
        <div className="p-4 bg-zinc-50 border-t border-zinc-100 text-center">
          <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Encomendas Inteligentes</p>
        </div>
      </motion.div>

      {/* Modal de Zoom de Imagem */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedImage(null)}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 cursor-pointer"
          >
            <button 
              type="button"
              onClick={(e) => { e.stopPropagation(); setSelectedImage(null); }}
              className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-all cursor-pointer"
            >
              <X className="w-7 h-7" />
            </button>
            <motion.img 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              src={selectedImage} 
              alt="Foto ampliada" 
              className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl border border-white/10"
              onClick={(e) => e.stopPropagation()}
              referrerPolicy="no-referrer"
            />
            <p className="text-white/60 text-xs mt-4">Toque em qualquer lugar fora da imagem para fechar</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Retirada;
