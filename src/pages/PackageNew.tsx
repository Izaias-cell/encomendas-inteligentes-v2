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
  ZapOff
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Profile, Morador, CondominiumSettings } from '../types';
import toast from 'react-hot-toast';
import { logAction } from '../services/auditService';
import { getRawTextFromImage } from '../services/geminiService';
import { parseLabelText } from '../services/labelParser';
import { findMatchingResidents, ScoredResident } from '../services/residentMatcher';
import { formatResidentAddress } from '../lib/residentUtils';
import { motion, AnimatePresence } from 'motion/react';
import { generatePickupCode, prepareWhatsAppNotification, sendWhatsAppMessage } from '../services/whatsappService';

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
  const [condoSettings, setCondoSettings] = useState<CondominiumSettings | null>(null);
  const [isAmbiguous, setIsAmbiguous] = useState(false);
  const [foundPartialData, setFoundPartialData] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Lendo dados...');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Fetch settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      if (!user?.condominium_id) return;
      const { data } = await supabase
        .from('condominium_settings')
        .select('*')
        .eq('condominium_id', user.condominium_id)
        .maybeSingle();
      if (data) setCondoSettings(data);
    };
    fetchSettings();
  }, [user?.condominium_id]);

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

  const processingRef = useRef(false);

  const processImage = async (base64: string) => {
    if (processingRef.current) return;
    processingRef.current = true;

    const startTime = Date.now();
    setStep('analyzing');
    setLoading(true);
    setStatusMessage('Lendo etiqueta...');
    
    try {
      let finalBase64 = base64;

      // 1. Otimização: Compressão agressiva para OCR (mais rápido)
      try {
        const { compressImage } = await import('../lib/imageUtils');
        // Reduzimos o tamanho para 800px para ser mais rápido no upload/processamento
        finalBase64 = await compressImage(base64, 800, 0.6); 
      } catch (err) {
        console.warn('Falha ao comprimir imagem:', err);
      }

      // 2. Upload em segundo plano (não bloqueante)
      const uploadPromise = (async () => {
        try {
          const res = await fetch(base64);
          const blob = await res.blob();
          const file = new File([blob], "package_original.jpg", { type: "image/jpeg" });
          const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
          const filePath = `package-photos/${fileName}`;
          
          const { error: uploadError } = await supabase.storage
            .from('packages')
            .upload(filePath, file);

          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage
              .from('packages')
              .getPublicUrl(filePath);
            setPhotoUrl(publicUrl);
          }
        } catch (storageErr) {
          console.warn("Storage error:", storageErr);
        }
      })();

      setPhotoUrl(finalBase64);

      // 3. Timeout de 5 segundos para a operação total
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), 5000)
      );

      // 4. Fluxo de Processamento Direto e Rápido
      const analysisPromise = (async () => {
        // A. Captura de Texto Bruto (OCR Simples)
        const rawText = await getRawTextFromImage(finalBase64);
        
        if (!rawText || rawText.length < 3) {
          throw new Error("Nenhum texto legível encontrado.");
        }

        // B. Extração Direta (Sem interpretação complexa)
        const parsedData = parseLabelText(rawText);

        if (parsedData.recipientName) setRecipientName(parsedData.recipientName);
        if (parsedData.unitNumber) setUnitNumber(parsedData.unitNumber);

        // C. Cruzamento Simples com Cadastro
        let foundMatch = false;
        if ((parsedData.recipientName || parsedData.unitNumber) && user?.condominium_id) {
          const matches = await findMatchingResidents(
            user.condominium_id,
            parsedData.unitNumber,
            parsedData.recipientName
          );

          if (matches.length > 0) {
            const topMatch = matches[0];
            setMatchingResidents(matches.slice(0, 5));
            
            // Match forte: Seleciona direto
            if (topMatch.score >= 150) {
              setRecipientName(topMatch.resident.nome);
              setUnitNumber(topMatch.resident.unidade);
              setUnitType(topMatch.resident.unit_type || '');
              handleSelectResident(topMatch.resident);
              setStatusMessage('Morador identificado');
              foundMatch = true;
            } else {
              // Match parcial: Sugere confirmação
              setStatusMessage('Confirme o morador');
              setSearchTerm(parsedData.recipientName || parsedData.unitNumber || '');
            }
          } else {
            // Sem match: Preenche busca para ajuste manual
            setSearchTerm(parsedData.recipientName || parsedData.unitNumber || '');
          }
        }

        // Estado para mensagem de confirmação parcial
        if (!parsedData.recipientName && !parsedData.unitNumber) {
          setFoundPartialData(false);
          toast.error("Não foi possível identificar dados na etiqueta.");
        } else if (!foundMatch) {
          setFoundPartialData(true);
        } else {
          setFoundPartialData(false);
        }

        return true;
      })();

      // Executa com limite de tempo
      try {
        await Promise.race([analysisPromise, timeoutPromise]);
      } catch (raceErr: any) {
        if (raceErr.message === 'TIMEOUT') {
          console.warn("[PERF] Timeout de 5s atingido. Mostrando resultados parciais.");
          // Se deu timeout, o que foi setado nos states (recipientName, unitNumber) será mostrado
        } else {
          throw raceErr;
        }
      }

      await uploadPromise;
      setStep('confirmation');
    } catch (err: any) {
      console.error("[DEBUG OCR] Erro no processamento:", err);
      setStep('confirmation'); 
      if (err.message === "Nenhum texto legível encontrado.") {
        toast.error("Não foi possível ler a etiqueta automaticamente.");
      }
    } finally {
      setLoading(false);
      processingRef.current = false;
      console.log(`[PERF] Tempo total de processamento: ${Date.now() - startTime}ms`);
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
        if (searchTerm.length < 2) {
          setResidents([]);
          setMatchingResidents([]);
        }
        return;
      }

      // Intelligent search: Use the matcher even for manual typing
      const matches = await findMatchingResidents(
        user?.condominium_id || '',
        searchTerm, // Try as unit
        searchTerm, // Try as name
        { full_string: searchTerm } // Try as full string
      );

      if (matches.length > 0) {
        setMatchingResidents(matches);
        
        // Check for ambiguity
        const strongCandidates = matches.filter(m => m.score >= 120);
        if (strongCandidates.length > 1) {
          setIsAmbiguous(true);
        } else {
          setIsAmbiguous(false);
          // Auto-select if extremely high confidence (exact match)
          const topMatch = matches[0];
          if (topMatch.score >= 180 && searchTerm.length >= 3) {
            handleSelectResident(topMatch.resident);
            toast.success(`Morador encontrado: ${topMatch.resident.nome}`, { icon: '🔍' });
          }
        }
      } else {
        setMatchingResidents([]);
        setIsAmbiguous(false);
      }
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
    setIsAmbiguous(false);
  };

  const handleClearResident = () => {
    setSelectedResident(null);
    // Não limpamos recipientName e unitNumber para que o porteiro possa ver o que o OCR leu
    setSearchTerm('');
    setMatchingResidents([]);
    setIsAmbiguous(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStep('analyzing');
    setLoading(true);
    setStatusMessage('Lendo nome...');
    
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        let base64 = reader.result as string;

        // Otimização: Redimensionar e comprimir antes de enviar para IA
        try {
          const { compressImage } = await import('../lib/imageUtils');
          base64 = await compressImage(base64, 900, 0.65);
        } catch (err) {
          console.warn('Falha ao comprimir imagem:', err);
        }

        setPhotoUrl(base64);
        processImage(base64); // Reutiliza a lógica otimizada
      };
      reader.readAsDataURL(file);
    } catch (error: any) {
      toast.error('Erro ao carregar foto: ' + error.message);
      setStep('camera');
      setLoading(false);
    }
  };

  const resetForm = () => {
    setStep('camera');
    setSelectedResident(null);
    setRecipientName('');
    setUnitNumber('');
    setUnitType('');
    setCarrier('');
    setTrackingNumber('');
    setNotes('');
    setPhotoUrl('');
    setSearchTerm('');
    setMatchingResidents([]);
    setPickupCode(generatePickupCode());
    setIsAmbiguous(false);
    setFoundPartialData(false);
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

      // 0. Verificar se o morador já tem encomendas pendentes para agrupar
      const { data: existingPackages } = await supabase
        .from('packages')
        .select('id, pickup_code, pickup_token')
        .eq('recipient_id', selectedResident.id)
        .eq('status', 'received')
        .order('received_at', { ascending: false });

      const hasExisting = existingPackages && existingPackages.length > 0;
      
      // Tenta encontrar um token e código já existentes no grupo
      const existingToken = existingPackages?.find(p => p.pickup_token)?.pickup_token;
      const existingCode = existingPackages?.find(p => p.pickup_code)?.pickup_code;

      const finalPickupCode = existingCode || pickupCode;
      const finalPickupToken = existingToken || (Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15));
      const totalPackages = (existingPackages?.length || 0) + 1;

      // Se houver encomendas existentes, garantir que todas tenham o mesmo token e código
      if (hasExisting) {
        await supabase
          .from('packages')
          .update({ 
            pickup_code: finalPickupCode, 
            pickup_token: finalPickupToken 
          })
          .eq('recipient_id', selectedResident.id)
          .eq('status', 'received');
      }

      // 1. Preparar mensagem de WhatsApp
      const whatsappMessage = prepareWhatsAppNotification(
        selectedResident,
        condoName || 'Condomínio',
        finalPickupCode,
        notes,
        finalPickupToken,
        totalPackages
      );

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
        pickup_code: finalPickupCode,
        pickup_token: finalPickupToken,
        pickup_qr_code: 'active',
        qr_code_generated_at: new Date().toISOString(),
        status: 'received',
        whatsapp_status: whatsappMessage ? 'pendente' : 'no_recipient',
        whatsapp_message: whatsappMessage
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

      if (!newPackage) {
        toast.error('Erro ao recuperar encomenda salva');
        setLoading(false);
        return;
      }

      // 3. Notificação via WhatsApp (Execução imediata se possível)
      if (selectedResident.telefone && whatsappMessage) {
        if (condoSettings?.whatsapp_mode === 'api_automatica') {
          try {
            const result = await sendWhatsAppMessage(selectedResident.telefone, whatsappMessage, user.condominium_id, {
              api_url: condoSettings.api_url,
              api_token: condoSettings.api_token,
              instance_id: condoSettings.instance_id,
              whatsapp_provider: condoSettings.whatsapp_provider
            });
            
            if (result.status_envio === 'sucesso') {
              const now = new Date().toISOString();
              await supabase
                .from('packages')
                .update({ 
                  whatsapp_status: 'enviado', 
                  last_notification_at: now,
                  whatsapp_sent_at: now,
                  notification_mode: 'api'
                })
                .eq('id', newPackage.id);
            }
          } catch (err) {
            console.error('Erro no envio automático:', err);
          }
        } else if (condoSettings?.whatsapp_mode === 'manual_assistido') {
          // Se for manual assistido, abre o link em nova aba
          const phone = selectedResident.telefone.replace(/\D/g, '');
          const formattedPhone = phone.startsWith('55') ? phone : `55${phone}`;
          const encodedMessage = encodeURIComponent(whatsappMessage);
          window.open(`https://wa.me/${formattedPhone}?text=${encodedMessage}`, '_blank');
        }
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

      toast.success('Encomenda registrada com sucesso!');
      resetForm();
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
              <h2 className="text-2xl font-bold text-gray-900 mb-2">{statusMessage}</h2>
              <p className="text-gray-500">Processando informações da etiqueta para agilizar seu trabalho.</p>
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

                      {/* Partial Data Found Message */}
                      {foundPartialData && !selectedResident && (
                        <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center gap-3">
                          <Info className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                          <p className="text-xs font-medium text-indigo-800">
                            Identificamos dados parciais. Por favor, confirme o morador abaixo.
                          </p>
                        </div>
                      )}

                      {/* Ambiguity Warning */}
                      {isAmbiguous && !selectedResident && (
                        <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl flex items-center gap-3 animate-pulse">
                          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                          <p className="text-xs font-medium text-amber-800">
                            Mais de um morador encontrado, selecione o correto
                          </p>
                        </div>
                      )}

                      {/* Search Results / Intelligent Suggestions */}
                      {matchingResidents.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs font-medium text-indigo-600 uppercase tracking-wider px-1">
                            <Sparkles className="w-3 h-3" />
                            Busca Inteligente
                          </div>
                          <div className="grid gap-2">
                            {matchingResidents.slice(0, 5).map(({ resident, score }) => (
                              <button
                                key={resident.id}
                                type="button"
                                onClick={() => handleSelectResident(resident)}
                                className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl hover:bg-indigo-50 hover:border-indigo-200 transition-all group shadow-sm"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-indigo-50 rounded-full flex items-center justify-center border border-indigo-100">
                                    <User className="w-5 h-5 text-indigo-600" />
                                  </div>
                                  <div className="text-left">
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium text-gray-900">{resident.nome}</p>
                                      {score >= 150 && (
                                        <span className="bg-emerald-100 text-emerald-700 text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider">Forte</span>
                                      )}
                                    </div>
                                    <p className="text-xs text-gray-500">
                                      {formatResidentAddress(resident)}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <CheckCircle className="w-5 h-5 text-gray-200 group-hover:text-indigo-400" />
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

        {/* Success Modal with QR Code removed for continuous flow */}
      </div>
    </div>
  );
}
