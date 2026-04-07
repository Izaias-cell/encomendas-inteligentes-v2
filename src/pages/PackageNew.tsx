import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Package, 
  User, 
  Building2, 
  Truck, 
  Camera, 
  Save, 
  ArrowLeft, 
  Search, 
  Loader2, 
  CheckCircle, 
  X, 
  FileText,
  Sparkles,
  AlertCircle,
  Hash,
  Info,
  Zap,
  ZapOff,
  Copy,
  MessageCircle
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Profile, Morador } from '../types';
import toast from 'react-hot-toast';
import { logAction } from '../services/auditService';
import { analyzePackageLabel } from '../services/geminiService';
import { findMatchingResidents, ScoredResident } from '../services/residentMatcher';
import { formatResidentAddress } from '../lib/residentUtils';
import { motion, AnimatePresence } from 'motion/react';
import { generatePickupCode, prepareWhatsAppNotification, sendWhatsAppMessage } from '../services/whatsappService';
import { QRCodeSVG } from 'qrcode.react';

interface PackageNewProps {
  user: Profile;
}

type Step = 'camera' | 'analyzing' | 'confirmation' | 'manual';

const QUICK_OBSERVATIONS = [
  'Caixa frágil',
  'Pacote grande',
  'Envelope',
  'Alimento/Perecível',
  'Geladeira',
  'Mercado Livre'
];

export default function PackageNew({ user }: PackageNewProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [step, setStep] = useState<Step>('camera');
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [residents, setResidents] = useState<Morador[]>([]);
  const [selectedResident, setSelectedResident] = useState<Morador | null>(null);
  const [matchingResidents, setMatchingResidents] = useState<ScoredResident[]>([]);
  
  const [recipientName, setRecipientName] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [unitType, setUnitType] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [pickupCode, setPickupCode] = useState('');
  const [condoName, setCondoName] = useState('');
  const [allCondoResidents, setAllCondoResidents] = useState<Morador[]>([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastSavedPackage, setLastSavedPackage] = useState<any>(null);
  const [currentMessage, setCurrentMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Auto-trigger camera on mount
  useEffect(() => {
    if (step === 'camera' && !photoUrl && !cameraActive) {
      startCamera();
    }
    return () => stopCamera();
  }, [step, photoUrl]);

  // Fetch all residents for AI context
  useEffect(() => {
    const fetchAllResidents = async () => {
      if (!user?.condominium_id) return;
      const { data, error } = await supabase
        .from('moradores')
        .select('nome, unidade')
        .eq('condominium_id', user.condominium_id)
        .eq('ativo', true);
      
      if (!error && data) {
        setAllCondoResidents(data as Morador[]);
      }
    };
    
    const fetchCondoName = async () => {
      if (!user?.condominium_id) return;
      const { data, error } = await supabase
        .from('condominiums')
        .select('name')
        .eq('id', user.condominium_id)
        .single();
      
      if (!error && data) {
        setCondoName(data.name);
      }
    };

    fetchAllResidents();
    fetchCondoName();
  }, [user?.condominium_id]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' }, 
        audio: false 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch (err) {
      console.error("Erro ao acessar câmera:", err);
      toast.error("Não foi possível acessar a câmera. Use o modo manual.");
      setStep('manual');
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setCameraActive(false);
      setFlashOn(false);
    }
  };

  const toggleFlash = async () => {
    if (!videoRef.current || !videoRef.current.srcObject) return;
    
    const stream = videoRef.current.srcObject as MediaStream;
    const track = stream.getVideoTracks()[0];
    
    if (!track.getCapabilities) {
      toast.error("Seu navegador não suporta controle de flash");
      return;
    }

    try {
      const capabilities = track.getCapabilities() as any;
      if (!capabilities || !capabilities.torch) {
        toast.error("Flash não suportado neste dispositivo");
        return;
      }
      
      const newFlashState = !flashOn;
      await track.applyConstraints({
        advanced: [{ torch: newFlashState }]
      } as any);
      setFlashOn(newFlashState);
    } catch (err) {
      console.error("Erro ao alternar flash:", err);
      toast.error("Flash não disponível");
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const context = canvas.getContext('2d');
    if (context) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg');
      stopCamera();
      processImage(base64);
    }
  };

  const processImage = async (base64: string) => {
    setStep('analyzing');
    setLoading(true);
    
    try {
      // 1. Convert base64 to blob for upload
      const res = await fetch(base64);
      const blob = await res.blob();
      const file = new File([blob], "package.jpg", { type: "image/jpeg" });

      // 2. Upload to Supabase (Opcional)
      const fileName = `${Math.random()}.jpg`;
      const filePath = `package-photos/${fileName}`;

      // Set photoUrl to base64 as a fallback for preview and if upload fails
      setPhotoUrl(base64);

      try {
        const { error: uploadError } = await supabase.storage
          .from('packages')
          .upload(filePath, file);

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from('packages')
            .getPublicUrl(filePath);
          setPhotoUrl(publicUrl);
        } else {
          console.warn("Upload error:", uploadError);
        }
      } catch (storageErr) {
        console.warn("Storage error:", storageErr);
      }

      // 3. Analyze with Gemini
      const residentList = allCondoResidents.map(r => `${r.nome} - ${r.unidade}`);
      const data = await analyzePackageLabel(base64, residentList);
      if (data) {
        if (data.carrier?.value) {
          setCarrier(data.carrier.value);
        }
        if (data.trackingNumber?.value) {
          setTrackingNumber(data.trackingNumber.value);
        }
        
        // Store raw values from OCR
        const ocrName = data.recipientName?.value || '';
        const ocrUnit = data.unitDetails?.number || data.unitDetails?.full_string || '';
        const ocrType = data.unitDetails?.type || '';
        
        setRecipientName(ocrName);
        setUnitNumber(ocrUnit);
        setUnitType(ocrType);

        if (user?.condominium_id) {
          // Rule 1 & 2: Try to find by unit number first
          // ONLY auto-select if we have BOTH unit and name match or very high confidence
          const matches = await findMatchingResidents(
            user.condominium_id,
            data.unitDetails?.full_string || '',
            ocrName,
            data.unitDetails
          );
          
          if (matches.length > 0) {
            // Filter: only show top 3 and only if score >= 50
            const filteredMatches = matches
              .filter(m => m.score >= 50)
              .slice(0, 3);
            
            setMatchingResidents(filteredMatches);
            
            // Auto-select ONLY if extremely high confidence (e.g., 180+)
            // This usually means exact name match + unit match
            if (filteredMatches.length > 0 && filteredMatches[0].score >= 180) {
              handleSelectResident(filteredMatches[0].resident);
            }
          }
        }
      }
      setStep('confirmation');
    } catch (err) {
      console.error("Erro no processamento:", err);
      setStep('manual');
    } finally {
      setLoading(false);
    }
  };

  // Generate 4-digit code on mount
  useEffect(() => {
    const code = generatePickupCode();
    setPickupCode(code);
  }, []);

  // Pre-fill if resident is passed via state
  useEffect(() => {
    if (location.state?.resident) {
      handleSelectResident(location.state.resident);
      setStep('manual'); // If coming from resident card, go to manual/form
    }
  }, [location.state]);

  // Search residents
  useEffect(() => {
    const searchResidents = async () => {
      if (searchTerm.length < 2 || selectedResident) {
        if (searchTerm.length < 2) setResidents([]);
        return;
      }

      const { data, error } = await supabase
        .from('moradores')
        .select('*')
        .eq('condominium_id', user?.condominium_id)
        .or(`nome.ilike.%${searchTerm}%,unidade.ilike.%${searchTerm}%`)
        .limit(5);

      if (error) {
        console.error('Error searching residents:', error);
        return;
      }

      setResidents(data || []);
    };

    const timer = setTimeout(searchResidents, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, user?.condominium_id, selectedResident]);

  const handleSelectResident = (resident: Morador) => {
    setSelectedResident(resident);
    setRecipientName(resident.nome || '');
    setUnitNumber(resident.unidade || '');
    // Prioritize resident data if it exists, otherwise keep current unitType (from OCR)
    if (resident.unit_type) {
      setUnitType(resident.unit_type);
    } else if (!unitType) {
      setUnitType('');
    }
    setSearchTerm(resident.nome || '');
    setResidents([]);
    setMatchingResidents([]);
  };

  const handleClearResident = () => {
    setSelectedResident(null);
    // Não limpamos recipientName e unitNumber para que o porteiro possa ver o que o OCR leu
    setSearchTerm('');
    setMatchingResidents([]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStep('analyzing');
    setLoading(true);
    try {
      // 1. Upload to Supabase (Opcional - não trava o fluxo se o bucket não existir)
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `package-photos/${fileName}`;

      try {
        const { error: uploadError } = await supabase.storage
          .from('packages')
          .upload(filePath, file);

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from('packages')
            .getPublicUrl(filePath);
          setPhotoUrl(publicUrl);
        } else {
          console.warn("Erro no upload (bucket pode não existir):", uploadError.message);
        }
      } catch (storageErr) {
        console.warn("Storage error:", storageErr);
      }

      // 2. Analyze with Gemini
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        try {
          const residentList = allCondoResidents.map(r => `${r.nome} - ${r.unidade}`);
          const data = await analyzePackageLabel(base64, residentList);
          if (data) {
            if (data.carrier?.value) {
              setCarrier(data.carrier.value);
            }
            if (data.trackingNumber?.value) {
              setTrackingNumber(data.trackingNumber.value);
            }
            
            const ocrName = data.recipientName?.value || '';
            const ocrUnit = data.unitDetails?.number || data.unitDetails?.full_string || '';
            const ocrType = data.unitDetails?.type || '';
            
            setRecipientName(ocrName);
            setUnitNumber(ocrUnit);
            setUnitType(ocrType);

            // Try to find matching residents
            if (user?.condominium_id) {
              const matches = await findMatchingResidents(
                user.condominium_id,
                data.unitDetails?.full_string || '',
                ocrName,
                data.unitDetails
              );
              
              if (matches.length > 0) {
                const filteredMatches = matches
                  .filter(m => m.score >= 50)
                  .slice(0, 3);
                setMatchingResidents(filteredMatches);
                // Auto-select ONLY if extremely high confidence
                if (filteredMatches.length > 0 && filteredMatches[0].score >= 180) {
                  handleSelectResident(filteredMatches[0].resident);
                }
              }
            }
          }
          setStep('confirmation');
        } catch (err) {
          console.error("Erro na análise Gemini:", err);
          setStep('manual');
        } finally {
          setLoading(false);
        }
      };
      reader.readAsDataURL(file);

    } catch (error: any) {
      toast.error('Erro ao carregar foto: ' + error.message);
      setStep('camera');
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedResident || !user) {
      toast.error('Selecione um morador para continuar');
      return;
    }

    setLoading(true);
    try {
      // Obter o usuário logado para capturar o ID se disponível (opcional)
      const { data: { user: authUser } } = await supabase.auth.getUser();

      // 1. Preparar mensagem de WhatsApp
      

      // 2. Salvar a encomenda no Supabase
      const packageData = {
        condominium_id: user.condominium_id,
        recipient_id: selectedResident.id,
        recipient_name_raw: recipientName || selectedResident.nome,
        unit_number: unitNumber || selectedResident.unidade || '',
        unit_type: unitType || selectedResident.unit_type || '',
        unit_number_val: selectedResident.unidade,
        block: selectedResident.block || selectedResident.bloco,
        tower: selectedResident.tower || selectedResident.lote,
        complement: selectedResident.observacoes,
        carrier,
        tracking_code: trackingNumber,
        notes,
        photo_url: photoUrl,
        received_by: user.id,
        received_at: new Date().toISOString(),
        created_by: user.id,
        ...(authUser?.id ? { registered_by: authUser.id } : {}),
        pickup_code: pickup_code,
        pickup_token: pickup_token,
        pickup_qr_code: 'active',
        qr_code_generated_at: new Date().toISOString(),
        status: 'received',
        whatsapp_status: null,
whatsapp_message: null,
      };

      const { data: newPackage, error: insertError } = await supabase
        .from('packages')
        .insert([packageData])
        .select()
        .single();

      if (insertError) {
        console.error('Erro ao inserir encomenda:', insertError);
        toast.error('Erro ao salvar encomenda: ' + (insertError.message || 'Erro desconhecido'));
        setLoading(false);
        return;
      }
const whatsappMessage = prepareWhatsAppNotification(
  selectedResident,
  condoName || 'Condomínio',
  pickup_code,
  pickup_token,
  notes
);

if (newPackage) {
  await supabase
    .from('packages')
    .update({
      whatsapp_status: whatsappMessage ? 'pending' : null,
      whatsapp_message: whatsappMessage
    })
    .eq('id', newPackage.id);
}
      if (!newPackage) {
        toast.error('Erro ao recuperar encomenda salva');
        setLoading(false);
        return;
      }

      // 3. Abrir WhatsApp via wa.me (Link Direto)
      // Tenta abrir o WhatsApp imediatamente após o sucesso do insert
      if (selectedResident.telefone && whatsappMessage) {
        setCurrentMessage(whatsappMessage);
        const phone = selectedResident.telefone.replace(/\D/g, '');
        const formattedPhone = phone.startsWith('55') ? phone : `55${phone}`;
        const encodedMessage = encodeURIComponent(whatsappMessage);
        const whatsappUrl = `https://wa.me/${formattedPhone}?text=${encodedMessage}`;
        
        // Tenta abrir o WhatsApp automaticamente
        try {
          window.open(whatsappUrl, '_blank');
        } catch (popupErr) {
          console.warn('Popup bloqueado pelo navegador:', popupErr);
          toast('WhatsApp bloqueado. Use o botão no modal de sucesso.', { icon: 'ℹ️' });
        }
        
        // Atualizar status no banco como 'pending' (aguardando envio manual)
        await supabase
          .from('packages')
          .update({ 
            whatsapp_status: 'pending',
            last_notification_at: new Date().toISOString()
          })
          .eq('id', newPackage.id);
      }

      // Log action
      try {
        await logAction(
          user.id, 
          user.condominium_id || '', 
          'package_received', 
          'package', 
          newPackage.id, 
          null, 
          {
            recipient: selectedResident.nome,
            unit: selectedResident.unidade,
            carrier,
            pickup_code: newPackage.pickup_code || pickupCode
          }
        );
      } catch (logErr) {
        console.warn('Erro ao logar ação:', logErr);
      }

      setLastSavedPackage(newPackage);
      setShowSuccessModal(true);
      toast.success('Encomenda salva com sucesso!');
    } catch (error: any) {
      toast.error('Erro inesperado: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleObservation = (obs: string) => {
    if (notes.includes(obs)) {
      setNotes(notes.replace(obs, '').replace(/,\s*,/, ',').replace(/^,\s*/, '').replace(/,\s*$/, '').trim());
    } else {
      setNotes(notes ? `${notes}, ${obs}` : obs);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
          <button 
            onClick={() => navigate('/portaria')}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">
            {step === 'camera' ? 'Capturar Encomenda' : 
             step === 'analyzing' ? 'Processando...' : 
             'Confirmar Dados'}
          </h1>
          <div className="w-10" />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {step === 'camera' && (
            <motion.div
              key="camera"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
                <div className="aspect-[3/4] bg-gray-900 flex flex-col items-center justify-center relative">
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    className="w-full h-full object-cover"
                  />
                  {cameraActive && (
                    <button
                      onClick={toggleFlash}
                      className="absolute top-4 right-4 p-3 bg-black/50 backdrop-blur-sm rounded-full text-white hover:bg-black/70 transition-colors z-20"
                      type="button"
                    >
                      {flashOn ? <Zap className="w-6 h-6 text-yellow-400 fill-yellow-400" /> : <ZapOff className="w-6 h-6" />}
                    </button>
                  )}
                  <div className="absolute inset-0 border-2 border-white/30 pointer-events-none m-8 rounded-2xl" />
                  <div className="absolute bottom-8 left-0 right-0 flex justify-center px-8 gap-4">
                    <button
                      onClick={capturePhoto}
                      className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-transform"
                    >
                      <div className="w-16 h-16 border-4 border-gray-900 rounded-full" />
                    </button>
                  </div>

                  <canvas ref={canvasRef} className="hidden" />
                </div>
                
                <div className="p-6 bg-gray-50 flex items-center justify-between">
                  <button
                    onClick={() => setStep('manual')}
                    className="text-gray-500 font-medium hover:text-gray-700 flex items-center gap-2"
                  >
                    <FileText className="w-5 h-5" />
                    Entrada Manual
                  </button>
                  <div className="flex items-center gap-2 text-indigo-600 font-semibold">
                    <Sparkles className="w-5 h-5" />
                    IA Ativa
                  </div>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex gap-3">
                <Info className="w-5 h-5 text-amber-600 shrink-0" />
                <p className="text-sm text-amber-800">
                  Certifique-se de que o nome do morador e a unidade estejam bem visíveis na foto.
                </p>
              </div>
            </motion.div>
          )}

          {step === 'analyzing' && (
            <motion.div
              key="analyzing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20 text-center"
            >
              <div className="relative mb-8">
                <div className="w-24 h-24 border-4 border-indigo-100 rounded-full" />
                <div className="w-24 h-24 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin absolute inset-0" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-10 h-10 text-indigo-600" />
                </div>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Lendo etiqueta...</h2>
              <p className="text-gray-500">A IA está identificando o morador e os dados da entrega.</p>
            </motion.div>
          )}

          {(step === 'confirmation' || step === 'manual') && (
            <motion.div
              key="form"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {/* Photo Preview */}
              {photoUrl && (
                <div className="relative rounded-2xl overflow-hidden aspect-video bg-gray-100 border border-gray-200 shadow-sm">
                  <img 
                    src={photoUrl} 
                    alt="Encomenda" 
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-4">
                    <div className="flex items-center gap-2 text-white">
                      <Camera className="w-4 h-4" />
                      <span className="text-xs font-medium">Foto capturada</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setStep('camera'); }}
                    className="absolute top-2 right-2 p-2 bg-white/90 backdrop-blur-sm rounded-full shadow-lg hover:bg-white transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-600" />
                  </button>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Resident Selection */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center">
                        <User className="w-5 h-5 text-indigo-600" />
                      </div>
                      <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Morador</h2>
                    </div>
                    {selectedResident && (
                      <button
                        type="button"
                        onClick={handleClearResident}
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-700"
                      >
                        ALTERAR
                      </button>
                    )}
                  </div>

                  {!selectedResident ? (
                    <div className="space-y-4">
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <Search className="h-5 w-5 text-gray-400" />
                        </div>
                        <input
                          type="text"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="Buscar por nome ou unidade..."
                          className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                        />
                      </div>

                      {/* Search Results */}
                      {residents.length > 0 && (
                        <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-50">
                          {residents.map((resident) => (
                            <button
                              key={resident.id}
                              type="button"
                              onClick={() => handleSelectResident(resident)}
                              className="w-full px-4 py-3 text-left hover:bg-indigo-50 transition-colors flex items-center justify-between"
                            >
                              <div>
                                <p className="font-medium text-gray-900">{resident.nome}</p>
                                <p className="text-sm text-gray-500">
                                  {formatResidentAddress(resident)}
                                </p>
                              </div>
                              <CheckCircle className="w-5 h-5 text-gray-200" />
                            </button>
                          ))}
                        </div>
                      )}

                      {/* AI Suggestions */}
                      {matchingResidents.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs font-medium text-indigo-600 uppercase tracking-wider px-1">
                            <Sparkles className="w-3 h-3" />
                            Sugestões da IA
                          </div>
                          <div className="grid gap-2">
                            {matchingResidents.slice(0, 3).map(({ resident, score }) => (
                              <button
                                key={resident.id}
                                type="button"
                                onClick={() => handleSelectResident(resident)}
                                className="flex items-center justify-between p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl hover:bg-indigo-50 transition-colors group"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center border border-indigo-100 shadow-sm">
                                    <User className="w-5 h-5 text-indigo-600" />
                                  </div>
                                  <div className="text-left">
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium text-gray-900">{resident.nome}</p>
                                      {score >= 180 && (
                                        <span className="bg-emerald-100 text-emerald-700 text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider">Alta Confiança</span>
                                      )}
                                      {score >= 100 && score < 180 && (
                                        <span className="bg-blue-100 text-blue-700 text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider">Média</span>
                                      )}
                                      {score < 100 && (
                                        <span className="bg-amber-100 text-amber-700 text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider">Baixa</span>
                                      )}
                                    </div>
                                    <p className="text-xs text-indigo-600 font-medium">
                                      {formatResidentAddress(resident)}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                                    {Math.round(score)}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100 flex items-center gap-4">
                      <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center border-2 border-indigo-200 shadow-sm">
                        <User className="w-7 h-7 text-indigo-600" />
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 text-lg">{selectedResident.nome}</h3>
                        <p className="text-indigo-600 font-medium">
                          {formatResidentAddress(selectedResident)}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">{selectedResident.telefone}</p>
                      </div>
                      <div className="ml-auto">
                        <CheckCircle className="w-6 h-6 text-green-500" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Package Details */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
                      <Package className="w-5 h-5 text-emerald-600" />
                    </div>
                    <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Dados da Entrega</h2>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tipo de Unidade
                      </label>
                      <select
                        value={unitType}
                        onChange={(e) => setUnitType(e.target.value)}
                        className="block w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-white"
                      >
                        <option value="">Selecione o tipo</option>
                        <option value="Apartamento">Apartamento</option>
                        <option value="Casa">Casa</option>
                        <option value="Lote">Lote</option>
                        <option value="Sala">Sala</option>
                        <option value="Bloco">Bloco</option>
                        <option value="Outro">Outro</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        CÓDIGO DE ETIQUETA
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <Hash className="h-5 w-5 text-gray-400" />
                        </div>
                        <input
                          type="text"
                          value={trackingNumber}
                          onChange={(e) => setTrackingNumber(e.target.value)}
                          placeholder="Ex: BR255238373823T"
                          className="block w-full pl-10 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-gray-400">
                        Identificado automaticamente pela IA. Você pode corrigir se necessário.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Transportadora
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <Truck className="h-5 w-5 text-gray-400" />
                        </div>
                        <input
                          type="text"
                          value={carrier}
                          onChange={(e) => setCarrier(e.target.value)}
                          placeholder="Ex: Correios, Loggi, Mercado Livre..."
                          className="block w-full pl-10 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Observações Rápidas
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {QUICK_OBSERVATIONS.map((obs) => (
                          <button
                            key={obs}
                            type="button"
                            onClick={() => toggleObservation(obs)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                              notes.includes(obs)
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {obs}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Outras Observações
                      </label>
                      <div className="relative">
                        <div className="absolute top-3 left-3 pointer-events-none">
                          <FileText className="h-5 w-5 text-gray-400" />
                        </div>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={2}
                          placeholder="Digite aqui..."
                          className="block w-full pl-10 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Pickup Code Info */}
                <div className="bg-indigo-900 rounded-2xl p-6 text-white shadow-lg shadow-indigo-200">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Hash className="w-5 h-5 text-indigo-300" />
                      <span className="text-sm font-semibold uppercase tracking-wider">Código de Retirada</span>
                    </div>
                    <span className="text-xs bg-white/20 px-2 py-1 rounded-full">Gerado Automaticamente</span>
                  </div>
                  <div className="flex items-center justify-center gap-4">
                    {pickupCode.split('').map((digit, i) => (
                      <div key={i} className="w-12 h-16 bg-white/10 rounded-xl flex items-center justify-center text-3xl font-bold border border-white/20">
                        {digit}
                      </div>
                    ))}
                  </div>
                  <p className="text-center text-xs text-indigo-200 mt-4">
                    Este código será enviado ao morador via WhatsApp junto com o QR Code.
                  </p>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={loading || !selectedResident}
                  className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold shadow-xl shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3"
                >
                  {loading ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : (
                    <>
                      <Save className="w-6 h-6" />
                      Salvar e Notificar Morador
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success Modal with QR Code */}
        <AnimatePresence>
          {showSuccessModal && lastSavedPackage && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 backdrop-blur-sm">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-[2.5rem] max-w-sm w-full p-8 text-center shadow-2xl"
              >
                <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-10 h-10" />
                </div>
                
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Encomenda Registrada!</h3>
                <p className="text-gray-500 mb-8">A encomenda para <span className="font-semibold text-gray-900">{selectedResident?.nome}</span> foi salva com sucesso.</p>
                
                <div className="bg-gray-50 p-6 rounded-3xl border-2 border-dashed border-gray-200 mb-8">
                  <div className="bg-white p-4 rounded-2xl shadow-sm inline-block mb-4">
                    <QRCodeSVG 
                      value={JSON.stringify({
                        id: lastSavedPackage.id,
                        code: lastSavedPackage.pickup_code,
                        token: lastSavedPackage.pickup_token
                      })} 
                      size={180} 
                    />
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Código de Retirada</span>
                    <span className="text-3xl font-black text-indigo-600 tracking-widest">{lastSavedPackage.pickup_code}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  {selectedResident?.telefone && (
                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        onClick={() => {
                          const phone = selectedResident.telefone.replace(/\D/g, '');
                          const formattedPhone = phone.startsWith('55') ? phone : `55${phone}`;
                          const encodedMessage = encodeURIComponent(currentMessage);
                          window.open(`https://wa.me/${formattedPhone}?text=${encodedMessage}`, '_blank');
                        }}
                        className="flex items-center justify-center gap-2 bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
                      >
                        <MessageCircle className="w-5 h-5" />
                        WhatsApp
                      </button>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(currentMessage);
                          toast.success('Mensagem copiada!');
                        }}
                        className="flex items-center justify-center gap-2 bg-gray-100 text-gray-700 py-4 rounded-2xl font-bold hover:bg-gray-200 transition-all"
                      >
                        <Copy className="w-5 h-5" />
                        Copiar
                      </button>
                    </div>
                  )}
                  <button 
                    onClick={() => navigate('/portaria')}
                    className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                  >
                    Ir para Portaria
                  </button>
                  <button 
                    onClick={() => {
                      setShowSuccessModal(false);
                      setLastSavedPackage(null);
                      setSelectedResident(null);
                      setRecipientName('');
                      setUnitNumber('');
                      setUnitType('');
                      setCarrier('');
                      setTrackingNumber('');
                      setNotes('');
                      setPhotoUrl('');
                      setStep('manual');
                      // Regenerate code for next one
                      setPickupCode(generatePickupCode());
                    }}
                    className="w-full bg-gray-100 text-gray-600 py-4 rounded-2xl font-bold hover:bg-gray-200 transition-all"
                  >
                    Registrar Outra
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
