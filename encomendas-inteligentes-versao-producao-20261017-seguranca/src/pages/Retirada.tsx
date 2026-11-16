import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { Clock, CheckCircle, AlertCircle, Loader2, Package, X, ZoomIn, Camera, Truck, QrCode, ChevronLeft, ChevronRight } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';
import { Package as PackageType } from '../types';

const KNOWN_CARRIERS = [
  'Shopee',
  'Mercado Livre',
  'Amazon',
  'Correios',
  'TikTok Shop',
  'Shein',
  'Magalu',
  'Jadlog',
  'Loggi'
];

const extractKnownCarrier = (notes?: string): string => {
  if (!notes) return '';
  const lower = notes.toLowerCase();
  const found = KNOWN_CARRIERS.find(c => lower.includes(c.toLowerCase()));
  return found || '';
};

const Retirada = () => {
  const [searchParams] = useSearchParams();
  const { token: pathToken } = useParams<{ token?: string }>();
  // Suporta /retirada/:token, /retirada?token=xyz, /retirada?t=xyz e /retirada?code=1234
  const token = pathToken || searchParams.get('token') || searchParams.get('t') || searchParams.get('code');
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresVerification, setRequiresVerification] = useState(false);
  const [condoPreviewName, setCondoPreviewName] = useState('');
  const [verificationInput, setVerificationInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [packageData, setPackageData] = useState<any>(null);
  const [allPackages, setAllPackages] = useState<any[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0);
  const [activeCardPhotoIndex, setActiveCardPhotoIndex] = useState<number>(0);

  // Refs para controle de gestos touch (SWIPE horizontal sem travar rolagem vertical)
  const cardTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const cardTouchMovedRef = useRef<boolean>(false);
  const modalTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const modalTouchMovedRef = useRef<boolean>(false);

  useEffect(() => {
    const fetchPackage = async () => {
      if (!token) {
        setError('Acesso inválido ou expirado');
        setLoading(false);
        return;
      }

      try {
        const cleanToken = token.trim();

        // Registro isolado e seguro de homologação (imagens fictícias, sem dados pessoais, sem alterar o banco)
        if (cleanToken === 'homologacao-demo' || cleanToken === 'demo-retirada' || cleanToken === 'teste-homologacao') {
          const mockPackage1 = {
            id: 'pkg-homologacao-001',
            pickup_code: '4829',
            pickup_token: cleanToken,
            status: 'received',
            unit_number: '101',
            block: 'Bloco A',
            unit_type: 'Apartamento',
            carrier: 'Shopee',
            moradores: {
              nome: 'Morador Homologação',
              unidade: '101',
              bloco: 'Bloco A'
            },
            condominiums: {
              name: 'Residencial Homologação'
            },
            photo_url: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?w=800&auto=format&fit=crop&q=80'
          };
          const mockPackage2 = {
            id: 'pkg-homologacao-002',
            pickup_code: '4829',
            pickup_token: cleanToken,
            status: 'received',
            unit_number: '101',
            block: 'Bloco A',
            unit_type: 'Apartamento',
            carrier: 'Shopee',
            moradores: {
              nome: 'Morador Homologação',
              unidade: '101',
              bloco: 'Bloco A'
            },
            condominiums: {
              name: 'Residencial Homologação'
            },
            photo_url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&auto=format&fit=crop&q=80'
          };
          setAllPackages([mockPackage1, mockPackage2]);
          setPackageData(mockPackage1);
          setLoading(false);
          return;
        }

        // 1. Consulta exclusivamente o endpoint seguro do backend (sem expor PII nem permitir enumeração por código curto)
        const response = await fetch(`/api/portal/package/${encodeURIComponent(cleanToken)}`, {
          headers: { 'Accept': 'application/json' }
        });

        const payload = await response.json().catch(() => null);

        if (payload?.requiresVerification) {
          setRequiresVerification(true);
          setCondoPreviewName(payload?.condominium?.name || '');
          setError(null);
          return;
        }

        if (!response.ok || !payload?.valid || !payload?.package) {
          setError('Acesso inválido ou expirado');
          return;
        }

        const primaryPkg = payload.package;
        const groupedPackages = Array.isArray(payload.allPackages) && payload.allPackages.length > 0
          ? payload.allPackages
          : [primaryPkg];

        setAllPackages(groupedPackages);
        setPackageData(primaryPkg);
      } catch (err: any) {
        console.error('Erro ao buscar encomenda:', err);
        setError('Acesso inválido ou expirado');
      } finally {
        setLoading(false);
      }
    };

    fetchPackage();
  }, [token]);

  const handleVerifyLegacyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !verificationInput.trim()) {
      setVerificationError('Informe sua unidade ou os 4 últimos dígitos do telefone.');
      return;
    }

    setVerifying(true);
    setVerificationError(null);
    try {
      const response = await fetch('/api/portal/verify-legacy-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          code: token.trim(),
          verificationInput: verificationInput.trim()
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.valid || !payload?.package) {
        setVerificationError(payload?.error || 'Não foi possível validar os dados informados.');
        return;
      }

      const primaryPkg = payload.package;
      const groupedPackages = Array.isArray(payload.allPackages) && payload.allPackages.length > 0
        ? payload.allPackages
        : [primaryPkg];

      setRequiresVerification(false);
      setAllPackages(groupedPackages);
      setPackageData(primaryPkg);
    } catch {
      setVerificationError('Erro ao verificar dados. Tente novamente.');
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-6">
        <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mb-4" />
        <p className="text-zinc-500 font-medium">Carregando...</p>
      </div>
    );
  }

  if (requiresVerification && !packageData) {
    return (
      <div className="min-h-screen bg-zinc-100 flex flex-col items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-white rounded-[32px] shadow-2xl overflow-hidden border border-zinc-200"
        >
          <div className="bg-emerald-600 p-6 text-white text-center">
            <p className="text-xs font-bold uppercase tracking-widest opacity-80 mb-1">
              {condoPreviewName || 'Condomínio'}
            </p>
            <h1 className="text-xl font-bold">Confirmação de Segurança</h1>
          </div>

          <form onSubmit={handleVerifyLegacyCode} className="p-8 space-y-5">
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold text-zinc-900">
                Para visualizar sua encomenda, confirme um dado do cadastro:
              </p>
              <p className="text-xs text-zinc-500">
                Digite o número da sua unidade (ex: 101) ou os 4 últimos dígitos do telefone cadastrado.
              </p>
            </div>

            {verificationError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs font-medium text-red-700 text-center">
                {verificationError}
              </div>
            )}

            <input
              type="text"
              value={verificationInput}
              onChange={(e) => setVerificationInput(e.target.value)}
              placeholder="Unidade ou 4 últimos dígitos do telefone"
              className="w-full px-4 py-3.5 rounded-2xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-center font-bold text-zinc-900"
              autoFocus
            />

            <button
              type="submit"
              disabled={verifying}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3.5 rounded-2xl font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {verifying && <Loader2 className="w-4 h-4 animate-spin" />}
              {verifying ? 'Verificando...' : 'Visualizar Encomenda'}
            </button>
          </form>
        </motion.div>
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


  // PARTE 1: Normalização de URL e extração de fotos físicas ÚNICAS/DISTINTAS
  // Remove parâmetros de cache/query string (?t=..., &token=...), fragmentos (#...) e trata maiúsculas/barras para que a mesma foto não seja duplicada
  const normalizePhotoUrl = (rawUrl?: string | null): string => {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    const trimmed = rawUrl.trim();
    if (!trimmed.startsWith('http')) return '';
    const withoutQuery = trimmed.split('?')[0].split('#')[0].trim();
    try {
      const parsed = new URL(withoutQuery);
      return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${decodeURIComponent(parsed.pathname).replace(/\/+$/, '')}`;
    } catch {
      return withoutQuery.replace(/\/+$/, '');
    }
  };

  const seenUrls = new Set<string>();
  const photos: { id: string; url: string; number: number; carrier?: string }[] = [];

  allPackages.forEach((p, idx) => {
    const rawUrl = p.photo_url;
    const cleanUrlKey = normalizePhotoUrl(rawUrl);
    if (cleanUrlKey) {
      if (!seenUrls.has(cleanUrlKey)) {
        seenUrls.add(cleanUrlKey);
        photos.push({
          id: p.id || `photo_${idx}`,
          url: rawUrl, // preserva a URL original para exibição
          number: photos.length + 1,
          carrier: p.carrier || p.transportadora
        });
      }
    }
  });

  // Gestos de toque (SWIPE horizontal) no carrossel de fotos do card
  const handleCardTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      cardTouchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      cardTouchMovedRef.current = false;
    }
  };

  const handleCardTouchMove = (e: React.TouchEvent) => {
    if (!cardTouchStartRef.current || e.touches.length !== 1) return;
    const diffX = cardTouchStartRef.current.x - e.touches[0].clientX;
    const diffY = cardTouchStartRef.current.y - e.touches[0].clientY;
    if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
      cardTouchMovedRef.current = true;
    }
  };

  const handleCardTouchEnd = (e: React.TouchEvent) => {
    if (!cardTouchStartRef.current) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const diffX = cardTouchStartRef.current.x - endX;
    const diffY = cardTouchStartRef.current.y - endY;
    const threshold = 40;

    // Apenas se o movimento for predominantemente horizontal e superior ao limiar
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > threshold) {
      if (diffX > 0) {
        // Deslizar para a esquerda -> Avança para a próxima foto (se não estiver na última)
        if (activeCardPhotoIndex < photos.length - 1) {
          setActiveCardPhotoIndex(prev => prev + 1);
        }
      } else {
        // Deslizar para a direita -> Retorna para a foto anterior (se não estiver na primeira)
        if (activeCardPhotoIndex > 0) {
          setActiveCardPhotoIndex(prev => prev - 1);
        }
      }
    }
    cardTouchStartRef.current = null;
  };

  // Gestos de toque (SWIPE horizontal) no modal de zoom
  const handleModalTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      modalTouchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      modalTouchMovedRef.current = false;
    }
  };

  const handleModalTouchMove = (e: React.TouchEvent) => {
    if (!modalTouchStartRef.current || e.touches.length !== 1) return;
    const diffX = modalTouchStartRef.current.x - e.touches[0].clientX;
    const diffY = modalTouchStartRef.current.y - e.touches[0].clientY;
    if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
      modalTouchMovedRef.current = true;
    }
  };

  const handleModalTouchEnd = (e: React.TouchEvent) => {
    if (!modalTouchStartRef.current) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const diffX = modalTouchStartRef.current.x - endX;
    const diffY = modalTouchStartRef.current.y - endY;
    const threshold = 40;

    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > threshold) {
      if (diffX > 0) {
        // Deslizar para a esquerda -> Próxima foto
        if (selectedImageIndex < photos.length - 1) {
          const nextIdx = selectedImageIndex + 1;
          setSelectedImageIndex(nextIdx);
          setSelectedImage(photos[nextIdx].url);
        }
      } else {
        // Deslizar para a direita -> Foto anterior
        if (selectedImageIndex > 0) {
          const prevIdx = selectedImageIndex - 1;
          setSelectedImageIndex(prevIdx);
          setSelectedImage(photos[prevIdx].url);
        }
      }
    }
    modalTouchStartRef.current = null;
  };

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
    <div className="min-h-screen bg-zinc-100 flex flex-col items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
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
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-zinc-900">{resident?.nome || 'Morador'}</h2>
            <p className="text-zinc-500 font-medium">
              Unidade: {getUnitDisplay()}
            </p>
          </div>

          {/* Transportadora / Loja Entregadora */}
          {(() => {
            const pkgs = allPackages.length > 0 ? allPackages : (packageData ? [packageData] : []);
            const carriers = Array.from(new Set(
              pkgs.map(p => p.carrier || p.transportadora || extractKnownCarrier(p.notes)).filter(Boolean)
            ));
            if (carriers.length === 0) return null;
            return (
              <div className="flex flex-col items-center justify-center gap-1.5 mb-6">
                <span className="text-[10px] font-bold text-zinc-400 tracking-widest uppercase">
                  Transportadora / Loja
                </span>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {carriers.map((cName: string) => (
                    <div key={cName} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 border border-blue-100 shadow-xs">
                      <Truck className="w-4 h-4 text-blue-600 shrink-0" />
                      <span>{cName.toUpperCase()}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Status Badge */}
          <div className={`flex items-center gap-2 px-5 py-2 rounded-full mb-6 ${isDelivered ? 'bg-zinc-100 text-zinc-600' : 'bg-emerald-100 text-emerald-700 shadow-xs'}`}>
            {isDelivered ? (
              <>
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold uppercase tracking-wider">Retirada Concluída</span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold uppercase tracking-wider">Aguardando na Portaria</span>
              </>
            )}
          </div>

          {/* 1. Código Numérico de Retirada & 2. QR Code (Imediatamente abaixo do código numérico) */}
          <div className={`w-full py-8 px-4 rounded-[24px] flex flex-col items-center justify-center mb-6 border-2 ${isDelivered ? 'bg-zinc-50 border-zinc-200' : 'bg-emerald-50 border-emerald-100 shadow-inner'}`}>
            <span className={`text-[10px] font-bold uppercase tracking-[0.3em] mb-2 ${isDelivered ? 'text-emerald-600' : 'text-red-600'}`}>
              CÓDIGO DE RETIRADA
            </span>
            <span className={`text-7xl font-black tracking-tighter font-mono ${isDelivered ? 'text-emerald-500 line-through' : 'text-red-700'}`}>
              {packageData.pickup_code}
            </span>

            {/* QR CODE REUTILIZANDO O MECANISMO DO ADMIN (PackageList): Payload JSON { id, code, token } e size 200 */}
            {(() => {
              if (isDelivered) return null;

              const qrPayload = JSON.stringify({
                id: packageData.id,
                code: packageData.pickup_code,
                token: packageData.pickup_token || token || ''
              });

              return (
                <div className="mt-6 flex flex-col items-center">
                  <div className="p-4 bg-white rounded-2xl border-2 border-emerald-200/80 shadow-xs inline-flex items-center justify-center">
                    <QRCodeSVG
                      value={qrPayload}
                      size={200}
                      level="M"
                      includeMargin={true}
                    />
                  </div>
                  <p className="text-[11px] font-semibold text-emerald-800/80 mt-3 uppercase tracking-wider text-center">
                    Apresente para a câmera da portaria
                  </p>
                </div>
              );
            })()}
          </div>

          {/* Galeria de Fotos das Encomendas (Deduplicação Real + Setas + Swipe Horizontal) */}
          {photos.length > 0 && (
            <div className="w-full mb-8">
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-xs font-bold text-zinc-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-emerald-600" />
                  Fotografia da Encomenda
                </span>
                <span className="text-[10px] text-zinc-400 font-medium">Toque para ampliar</span>
              </div>

              {photos.length === 1 ? (
                /* Caso com apenas 1 fotografia real: Exibe imagem única sem setas e sem repetição */
                <div
                  onClick={() => {
                    setSelectedImage(photos[0].url);
                    setSelectedImageIndex(0);
                  }}
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
                /* Caso com 2 ou mais fotografias distintas: Carrossel com Foto Única Ativa + Setas Tácteis + Swipe */
                <div 
                  className="relative group overflow-hidden rounded-2xl border border-zinc-200 shadow-sm bg-zinc-950 aspect-[4/3] flex items-center justify-center select-none"
                  style={{ touchAction: 'pan-y' }}
                  onTouchStart={handleCardTouchStart}
                  onTouchMove={handleCardTouchMove}
                  onTouchEnd={handleCardTouchEnd}
                  onTouchCancel={() => { cardTouchStartRef.current = null; }}
                >
                  {/* Imagem ativa com transição suave e toque para zoom */}
                  <motion.div
                    key={activeCardPhotoIndex}
                    initial={{ opacity: 0.8 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0.8 }}
                    onClick={() => {
                      if (cardTouchMovedRef.current) return;
                      setSelectedImage(photos[activeCardPhotoIndex]?.url || photos[0].url);
                      setSelectedImageIndex(activeCardPhotoIndex);
                    }}
                    className="w-full h-full cursor-pointer flex items-center justify-center"
                  >
                    <img
                      src={photos[activeCardPhotoIndex]?.url || photos[0].url}
                      alt="Foto da encomenda"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-black/15 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                      <span className="bg-white/90 backdrop-blur-sm text-zinc-800 text-xs font-bold py-1.5 px-3 rounded-full flex items-center gap-1 shadow-lg">
                        <ZoomIn className="w-3.5 h-3.5" /> Ampliar
                      </span>
                    </div>
                  </motion.div>

                  {/* Seta Esquerda (Foto Anterior - desabilitada na primeira foto) */}
                  <button
                    type="button"
                    disabled={activeCardPhotoIndex === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (activeCardPhotoIndex > 0) {
                        setActiveCardPhotoIndex(prev => prev - 1);
                      }
                    }}
                    className={`absolute left-2.5 p-2.5 rounded-full bg-black/60 hover:bg-black/85 text-white border border-white/20 backdrop-blur-sm transition-all shadow-xl min-w-[48px] min-h-[48px] flex items-center justify-center z-20 ${
                      activeCardPhotoIndex === 0
                        ? 'opacity-25 cursor-not-allowed pointer-events-none'
                        : 'cursor-pointer active:scale-95'
                    }`}
                    title="Foto anterior"
                    aria-label="Foto anterior"
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </button>

                  {/* Seta Direita (Próxima Foto - desabilitada na última foto) */}
                  <button
                    type="button"
                    disabled={activeCardPhotoIndex === photos.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (activeCardPhotoIndex < photos.length - 1) {
                        setActiveCardPhotoIndex(prev => prev + 1);
                      }
                    }}
                    className={`absolute right-2.5 p-2.5 rounded-full bg-black/60 hover:bg-black/85 text-white border border-white/20 backdrop-blur-sm transition-all shadow-xl min-w-[48px] min-h-[48px] flex items-center justify-center z-20 ${
                      activeCardPhotoIndex === photos.length - 1
                        ? 'opacity-25 cursor-not-allowed pointer-events-none'
                        : 'cursor-pointer active:scale-95'
                    }`}
                    title="Próxima foto"
                    aria-label="Próxima foto"
                  >
                    <ChevronRight className="w-6 h-6" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Status when delivered */}
          {isDelivered && (
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

      {/* Modal de Zoom de Imagem com Swipe / Drag Horizontal (Item 3) */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedImage(null)}
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-4 cursor-pointer select-none touch-pan-y"
          >
            {/* Botão Fechar no canto superior */}
            <button 
              type="button"
              onClick={(e) => { e.stopPropagation(); setSelectedImage(null); }}
              className="absolute top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] text-white/80 hover:text-white p-2.5 rounded-full bg-white/10 hover:bg-white/20 transition-all cursor-pointer min-w-[44px] min-h-[44px] flex items-center justify-center z-50 shadow-lg"
              title="Fechar"
            >
              <X className="w-7 h-7" />
            </button>

            {/* Imagem Ampliada com Suporte a Gesto Swipe/Drag Horizontal e Botões de Navegação (Item 6) */}
            <div 
              className="relative max-w-full max-h-[80vh] flex items-center justify-center overflow-visible select-none" 
              style={{ touchAction: 'pan-y' }}
              onTouchStart={handleModalTouchStart}
              onTouchMove={handleModalTouchMove}
              onTouchEnd={handleModalTouchEnd}
              onTouchCancel={() => { modalTouchStartRef.current = null; }}
              onClick={(e) => e.stopPropagation()}
            >
              <motion.img 
                key={selectedImage}
                initial={{ opacity: 0.7, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0.7, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 350, damping: 28 }}
                src={selectedImage} 
                alt={`Foto ${selectedImageIndex + 1}`} 
                className="max-w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl border border-white/10"
                referrerPolicy="no-referrer"
              />

              {/* Botão Foto Anterior (desabilitado na primeira foto) */}
              {photos.length > 1 && (
                <button
                  type="button"
                  disabled={selectedImageIndex === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (selectedImageIndex > 0) {
                      const prevIndex = selectedImageIndex - 1;
                      setSelectedImageIndex(prevIndex);
                      setSelectedImage(photos[prevIndex].url);
                    }
                  }}
                  className={`absolute left-2 sm:-left-16 p-3 rounded-full bg-black/60 hover:bg-black/80 text-white/90 hover:text-white border border-white/20 backdrop-blur-sm transition-all shadow-2xl min-w-[48px] min-h-[48px] flex items-center justify-center z-50 ${
                    selectedImageIndex === 0
                      ? 'opacity-25 cursor-not-allowed pointer-events-none'
                      : 'cursor-pointer active:scale-95'
                  }`}
                  title="Foto anterior"
                  aria-label="Foto anterior"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
              )}

              {/* Botão Foto Seguinte (desabilitado na última foto) */}
              {photos.length > 1 && (
                <button
                  type="button"
                  disabled={selectedImageIndex === photos.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (selectedImageIndex < photos.length - 1) {
                      const nextIndex = selectedImageIndex + 1;
                      setSelectedImageIndex(nextIndex);
                      setSelectedImage(photos[nextIndex].url);
                    }
                  }}
                  className={`absolute right-2 sm:-right-16 p-3 rounded-full bg-black/60 hover:bg-black/80 text-white/90 hover:text-white border border-white/20 backdrop-blur-sm transition-all shadow-2xl min-w-[48px] min-h-[48px] flex items-center justify-center z-50 ${
                    selectedImageIndex === photos.length - 1
                      ? 'opacity-25 cursor-not-allowed pointer-events-none'
                      : 'cursor-pointer active:scale-95'
                  }`}
                  title="Foto seguinte"
                  aria-label="Foto seguinte"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              )}
            </div>

            <p className="text-white/60 text-xs mt-4">
              {photos.length > 1 ? 'Use as setas ou deslize para os lados para trocar de foto • Toque fora para fechar' : 'Toque fora da imagem para fechar'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Retirada;
