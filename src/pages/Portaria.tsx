import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Package, Profile, Morador } from '../types';
import { 
  Package as PackageIcon, 
  Plus, 
  Loader2, 
  Search, 
  Users, 
  CheckCircle, 
  Clock, 
  User, 
  Home, 
  Truck, 
  Calendar,
  QrCode,
  ArrowRight,
  X,
  Check,
  Hash,
  Keyboard,
  Phone,
  Building2,
  Smartphone,
  AlertCircle,
  UserPlus,
  Edit,
  Save,
  MessageSquare,
  Camera,
  Eye,
  Trash2,
  MoreVertical,
  Power,
  Send,
  Zap,
  Layers,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatDate, formatSafeDateTime } from '../lib/dateUtils';
import { getResidentAddressLines, formatPackageUnit } from '../lib/residentUtils';
import { ptBR } from 'date-fns/locale';
import { getCurrentPorter, setManualPorter, clearManualPorter } from '../lib/porterUtils';

import toast from 'react-hot-toast';
import { registrarAuditoria } from '../services/auditService';
import { Html5Qrcode } from 'html5-qrcode';
import { motion, AnimatePresence } from 'motion/react';
import { sendWhatsAppMessage, getWhatsAppLink, generatePickupCode, prepareWhatsAppNotification } from '../services/whatsappService';
import { CondominiumSettings } from '../types';

import PackageItem from '../components/portaria/PackageItem';
import ResidentCard from '../components/portaria/ResidentCard';

interface PortariaProps {
  user: Profile;
}

export default function Portaria({ user }: PortariaProps) {
  const [packages, setPackages] = useState<Package[]>([]);
  const [residents, setResidents] = useState<Morador[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'pending' | 'delivered' | 'all' | 'residents'>('pending');
  const [activeResidentMenu, setActiveResidentMenu] = useState<string | null>(null);
  const navigate = useNavigate();

  // Batch WhatsApp State
  const [isBatchSending, setIsBatchSending] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [pendingNoticesCount, setPendingNoticesCount] = useState(0);
  const [condoSettings, setCondoSettings] = useState<CondominiumSettings | null>(null);
  const [batchMode, setBatchMode] = useState<'api' | 'manual'>('api');
  const [batchStep, setBatchStep] = useState<'confirm' | 'sending' | 'manual_list' | 'finished'>('confirm');
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [manualIndex, setManualIndex] = useState(0);
  const [batchPackages, setBatchPackages] = useState<Package[]>([]);
  const [condoName, setCondoName] = useState('');
  const [currentPorter, setCurrentPorter] = useState(getCurrentPorter());
  const [showPorterModal, setShowPorterModal] = useState(false);

  // Notificar Todos queue state
  const [isNotifyingAll, setIsNotifyingAll] = useState(false);
  const [notifyQueue, setNotifyQueue] = useState<any[]>([]);
  const [notifyIndex, setNotifyIndex] = useState(0);
  const [isWaitingForFocus, setIsWaitingForFocus] = useState(false);
  const [modoEnvio, setModoEnvio] = useState<'individual' | 'batch' | null>(null);

  const fetchCondoName = async () => {
    if (!user.condominium_id) return;
    try {
      const { data, error } = await supabase
        .from('condominiums')
        .select('name')
        .eq('id', user.condominium_id)
        .maybeSingle();
      
      if (error) throw error;
      if (data) setCondoName(data.name);
    } catch (error) {
      console.error('Erro ao buscar nome do condomínio:', error);
    }
  };

  const fetchPendingNotices = async () => {
    if (!user?.condominium_id) return;
    
    try {
      // Migration: Set whatsapp_status to 'pendente' for all received packages that have null or 'pending' status
      await Promise.all([
        supabase
          .from('packages')
          .update({ whatsapp_status: 'pendente' })
          .eq('condominium_id', user.condominium_id)
          .eq('status', 'received')
          .is('whatsapp_status', null),
        supabase
          .from('packages')
          .update({ whatsapp_status: 'pendente' })
          .eq('condominium_id', user.condominium_id)
          .eq('status', 'received')
          .eq('whatsapp_status', 'pending')
      ]);

      const { data, error } = await supabase
        .from('packages')
        .select('*, package_id:id, recipient_name:recipient_name_raw, unit_label:unit_number')
        .eq('condominium_id', user.condominium_id)
        .eq('whatsapp_status', 'pendente') // Strict as requested
        .order('received_at', { ascending: false });

      if (error) throw error;
      
      const packagesData = data || [];
      setBatchPackages(packagesData);

      // Requisito: contar moradores/unidades pendentes, não quantidade total de encomendas
      const uniqueResidents = Array.from(new Set(packagesData.filter(p => p.recipient_id).map(p => p.recipient_id))).length;
      setPendingNoticesCount(uniqueResidents);
    } catch (error) {
      console.error('Erro ao buscar avisos pendentes:', error);
    }
  };

  const [individualNotifyData, setIndividualNotifyData] = useState<any>(null);

  const getWhatsAppBadge = (status: string, pkg?: any) => {
    const variants: any = {
      pending: 'text-amber-500 bg-amber-50 border-amber-200',
      pendente: 'text-amber-500 bg-amber-50 border-amber-200',
      sent: 'text-blue-500 bg-blue-50 border-blue-200',
      enviado: 'text-blue-600 bg-blue-50 border-blue-200',
      delivered: 'text-emerald-500 bg-emerald-50 border-emerald-200',
      read: 'text-emerald-600 bg-emerald-50 border-emerald-200',
      failed: 'text-red-500 bg-red-50 border-red-200',
      error: 'text-red-500 bg-red-50 border-red-200',
      no_recipient: 'text-zinc-400 bg-zinc-50 border-zinc-200'
    };
    const labels: any = {
      pending: 'Pendente',
      pendente: 'Pendente',
      sent: 'Enviado',
      enviado: 'Enviado',
      delivered: 'Entregue',
      read: 'Lido',
      failed: 'Falhou',
      error: 'Erro',
      no_recipient: 'Sem destinatário'
    };
    
    if (!status) return null;

    const isPending = status === 'pendente' || status === 'pending';

    return (
      <button 
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pkg && isPending) {
            setIndividualNotifyData(pkg);
          }
        }}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${variants[status] || 'text-zinc-400 bg-zinc-50 border-zinc-200'} ${isPending ? 'hover:scale-105 active:scale-95 cursor-pointer shadow-sm' : 'cursor-default'}`} 
        title={isPending ? 'Clique para notificar morador' : `WhatsApp: ${labels[status] || status}`}
      >
        <MessageSquare className="w-3.5 h-3.5" />
        <span className="text-[10px] font-bold uppercase tracking-tight">
          {labels[status] || status}
        </span>
      </button>
    );
  };

  // QR Scanning State
  const [isScanning, setIsScanning] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [qrScanStatus, setQrScanStatus] = useState<'idle' | 'scanning' | 'validating' | 'success' | 'error'>('idle');
  const [qrPackage, setQrPackage] = useState<Package | null>(null);
  const [viewQrPackage, setViewQrPackage] = useState<Package | null>(null);
  const [retrievalMethod, setRetrievalMethod] = useState<'qr_code' | 'manual'>('qr_code');
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [deliveryPhoto, setDeliveryPhoto] = useState<string | null>(null);
  const [isDeliverySuccess, setIsDeliverySuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingPackageRef = useRef<Package | null>(null);
  const qrScannerRef = useRef<Html5Qrcode | null>(null);
  const isTransitioningRef = useRef(false);
  const isScanningRef = useRef(false);
  const successAudioRef = useRef<HTMLAudioElement | null>(null);

  const anim = (props: any) => props;

  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

  // Pré-carregamento do som de confirmação para dispositivos móveis
  useEffect(() => {
    console.log('[Áudio] Iniciando pré-carregamento do áudio de sucesso...');
    try {
      successAudioRef.current = new Audio('/sounds/success.mp3');
      successAudioRef.current.preload = 'auto';
      successAudioRef.current.volume = 0.6;
      successAudioRef.current.load();
      console.log('[Áudio] Áudio de sucesso carregado e pronto para uso');
    } catch (err) {
      console.error('[Áudio] Erro ao pré-carregar áudio:', err);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchPendingNotices();
    fetchCondoName();
  }, [user.condominium_id]);

  // Requisito: Alerta sonoro removido conforme solicitação

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'residents') {
      setActiveTab('residents');
    }
  }, [window.location.search]);

  useEffect(() => {
    if (isScanning && !qrPackage && !showManualInput && cameraStarted) {
      startScanning();
    } else {
      stopScanning();
    }
    return () => stopScanning();
  }, [isScanning, qrPackage, showManualInput, cameraStarted]);

  // Handle focus return for navigation logic
  useEffect(() => {
    const handleFocus = () => {
      // Flow for Batch Sending
      if (modoEnvio === 'batch' && isWaitingForFocus) {
        setIsWaitingForFocus(false);
        
        // Progress to next item in batch
        setTimeout(() => {
          if (notifyIndex + 1 < notifyQueue.length) {
            setNotifyIndex(prev => prev + 1);
          } else {
            // Batch Finished
            setNotifyIndex(notifyQueue.length);
            setIsNotifyingAll(false);
            setModoEnvio(null);
            toast.success('Notificações concluídas!', { icon: '✅', duration: 4000 });
            fetchData();
            fetchPendingNotices();
          }
        }, 100); // Reduzido de 1000ms para 100ms para fluxo super rápido
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [modoEnvio, isWaitingForFocus, notifyIndex, notifyQueue.length]);

  const handleNotifyAll = () => {
    // Collect all pending packages needing notification
    const pendentesAviso = packages.filter(p => 
      p.status === 'received' && 
      (p.whatsapp_status === 'pendente' || p.whatsapp_status === 'pending' || !p.whatsapp_status)
    );

    if (pendentesAviso.length === 0) {
      toast.error('Nenhuma encomenda pendente de aviso encontrada.');
      return;
    }

    // Determine mode
    const apiActive = condoSettings?.whatsapp_mode === 'api_automatica' && 
                     condoSettings?.api_url && 
                     condoSettings?.api_token;

    if (apiActive) {
      // Use existing batch send flow (preserved intact)
      handleBatchSend();
      return;
    }

    // Manual flow grouping logic (aggregated by resident)
    const groups: { [key: string]: any } = {};
    pendentesAviso.forEach(pkg => {
      const residentId = pkg.recipient_id;
      if (!residentId) return;
      if (!groups[residentId]) {
        groups[residentId] = {
          resident: residents.find(r => r.id === residentId),
          packages: []
        };
      }
      groups[residentId].packages.push(pkg);
    });

    const queue = Object.values(groups).filter(g => g.resident && g.resident.telefone);
    
    if (queue.length === 0) {
      toast.error('Nenhuma encomenda possui morador com telefone válido.');
      return;
    }

    setNotifyQueue(queue);
    setNotifyIndex(0);
    setIsNotifyingAll(true);
    setModoEnvio('batch');
    setIsWaitingForFocus(false);
  };

  const handleSendQueueItem = async () => {
    const current = notifyQueue[notifyIndex];
    if (!current || !current.resident) return;

    // Garante que existe código de retirada para o grupo
    let groupCode = current.packages.find((p: any) => p.pickup_code)?.pickup_code;
    let groupToken = current.packages.find((p: any) => p.pickup_token)?.pickup_token;

    if (!groupCode) groupCode = generatePickupCode();
    if (!groupToken) groupToken = Math.random().toString(36).substring(2, 15);

    const message = prepareWhatsAppNotification(
      current.resident,
      condoName,
      groupCode,
      undefined,
      groupToken,
      current.packages.length,
      'disponivel',
      undefined,
      undefined,
      current.packages[0]?.photo_url // Usa a foto da primeira encomenda do grupo
    ) || `Olá, ${current.resident.nome}! Você possui encomendas na portaria. Código: ${groupCode}`;

    const link = getWhatsAppLink(current.resident.telefone, message, current.packages[0]?.photo_url);

    // Update status in background for all packages in this group
    const now = new Date().toISOString();
    try {
      const pkgIds = current.packages.map((p: any) => p.id);
      await supabase
        .from('packages')
        .update({ 
          whatsapp_status: 'enviado', 
          last_notification_at: now,
          whatsapp_sent_at: now,
          notification_mode: 'manual_mass',
          whatsapp_message: message,
          pickup_code: groupCode,
          pickup_token: groupToken
        })
        .in('id', pkgIds);
      
      setPackages(prev => prev.map(p => pkgIds.includes(p.id) ? { ...p, whatsapp_status: 'enviado', whatsapp_sent_at: now, pickup_code: groupCode } : p));
      fetchPendingNotices();
    } catch (e) {
      console.error('Erro ao atualizar status do lote:', e);
    }

    window.open(link, '_blank');
    setIsWaitingForFocus(true);
  };

  const skipQueueItem = () => {
    if (notifyIndex + 1 < notifyQueue.length) {
      setNotifyIndex(prev => prev + 1);
    } else {
      setNotifyIndex(notifyQueue.length);
    }
  };

  const handleBatchSend = async () => {
    if (batchPackages.length === 0) return;

    const mode = condoSettings?.whatsapp_mode === 'api_automatica' ? 'api' : 'manual';
    setBatchMode(mode);
    setBatchProgress({ current: 0, total: batchPackages.length });
    setManualIndex(0);

    if (mode === 'api') {
      // Validar configuração
      if (!condoSettings?.api_url || !condoSettings?.api_token) {
        toast.error('API não configurada. Usando envio manual.');
        setBatchMode('manual');
        setBatchStep('manual_list');
        return;
      }

      setBatchStep('sending');
      setIsBatchSending(true);
      
      let successCount = 0;
      let errorCount = 0;
      let fallbackTriggered = false;

      for (let i = 0; i < batchPackages.length; i++) {
        const pkg = batchPackages[i];
        setBatchProgress(prev => ({ ...prev, current: i + 1 }));

        const resident = residents.find(r => r.id === pkg.recipient_id);
        
        if (resident?.telefone) {
          try {
            // Garante que existe código de retirada
            let pCode = pkg.pickup_code;
            let pToken = pkg.pickup_token;
            if (!pCode) pCode = generatePickupCode();
            if (!pToken) pToken = Math.random().toString(36).substring(2, 15);

            const finalMessage = prepareWhatsAppNotification(
              resident,
              condoName,
              pCode,
              pkg.carrier,
              pToken,
              1,
              'disponivel',
              undefined,
              undefined,
              pkg.photo_url
            ) || pkg.whatsapp_message || `Olá, ${resident.nome}! Sua encomenda chegou na portaria. Código: ${pCode}`;

            const result = await sendWhatsAppMessage(resident.telefone, finalMessage, user.condominium_id, {
              api_url: condoSettings.api_url,
              api_token: condoSettings.api_token,
              instance_id: condoSettings.instance_id,
              whatsapp_provider: condoSettings.whatsapp_provider,
              photo_url: pkg.photo_url
            });
            
            if (result.status_envio === 'sucesso') {
              const now = new Date().toISOString();
              const { error: updateError } = await supabase
                .from('packages')
                .update({ 
                  whatsapp_status: 'enviado', 
                  last_notification_at: now,
                  whatsapp_sent_at: now,
                  notification_mode: 'api',
                  whatsapp_message: finalMessage,
                  pickup_code: pCode,
                  pickup_token: pToken
                })
                .eq('id', pkg.id);
              
              if (updateError) throw updateError;
              successCount++;
            } else {
              throw new Error(result.error || 'Erro na resposta da API');
            }
          } catch (error) {
            console.error('Falha na API:', error);
            toast.error('Falha na API. Mudando para envio manual assistido.');
            fallbackTriggered = true;
            
            // Log fallback
            await registrarAuditoria({
              condominio_id: user.condominium_id || '',
              usuario_id: user.id,
              usuario_nome: user.full_name,
              usuario_perfil: user.role,
              tipo_evento: 'WHATSAPP_FALLBACK',
              acao: 'UPDATE',
              tabela_afetada: 'encomendas',
              registro_id: pkg.id,
              descricao: `Fallback no envio de WhatsApp para Encomenda ${pkg.id}`,
              metodo: 'API_FALLBACK',
              dados_antes: { mode: 'api' },
              dados_depois: { mode: 'manual', error: error instanceof Error ? error.message : String(error) }
            });

            break; // Interromper envio automático
          }
        } else {
          const { error: updateError } = await supabase
            .from('packages')
            .update({ 
              whatsapp_status: resident?.telefone ? 'error' : 'no_recipient'
            })
            .eq('id', pkg.id);
          
          if (updateError) console.error('Erro ao atualizar status de erro:', updateError);
          errorCount++;
        }
      }

      setIsBatchSending(false);
      
      if (fallbackTriggered) {
        setBatchMode('manual');
        setBatchStep('manual_list');
      } else {
        if (successCount > 0) toast.success(`${successCount} avisos enviados via API!`);
        if (errorCount > 0) toast.error(`${errorCount} avisos falharam.`);
        setShowBatchModal(false);
      }
      fetchData();
      fetchPendingNotices();
    } else {
      setBatchStep('manual_list');
    }
  };

  const handleManualSent = async (pkgId: string) => {
    try {
      const now = new Date().toISOString();
      await supabase
        .from('packages')
        .update({ 
          whatsapp_status: 'enviado', 
          last_notification_at: now,
          whatsapp_sent_at: now,
          notification_mode: 'manual'
        })
        .eq('id', pkgId);
      
      setPackages(prev => prev.map(p => p.id === pkgId ? { ...p, whatsapp_status: 'enviado', whatsapp_sent_at: now } : p));
      fetchPendingNotices();
      toast.success('Status atualizado!');
      
      if (manualIndex + 1 >= batchPackages.length) {
        setBatchStep('finished');
      } else {
        setManualIndex(prev => prev + 1);
      }
    } catch (error) {
      toast.error('Erro ao atualizar status');
    }
  };

  const handleSkipManual = () => {
    if (manualIndex + 1 >= batchPackages.length) {
      setBatchStep('finished');
    } else {
      setManualIndex(prev => prev + 1);
    }
  };

  const startScanning = async () => {
    if (isTransitioningRef.current || !isScanningRef.current) return;
    try {
      isTransitioningRef.current = true;
      setQrScanStatus('scanning');
      const scanner = new Html5Qrcode("qr-reader");
      
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };
      await scanner.start(
        { facingMode: "environment" },
        config,
        onScanSuccess,
        onScanFailure
      );
      
      if (!isScanningRef.current) {
        try {
          if (scanner.isScanning) {
            await scanner.stop();
          }
          scanner.clear();
        } catch (e) {
          // ignore
        }
        return;
      }
      
      qrScannerRef.current = scanner;
    } catch (err) {
      console.error("Erro ao iniciar câmera:", err);
      toast.error("Não foi possível acessar a câmera");
      setIsScanning(false);
    } finally {
      isTransitioningRef.current = false;
    }
  };

  const stopScanning = async () => {
    if (isTransitioningRef.current) {
      // If transitioning, wait a bit and try again or just skip if it's already stopping
      // For simplicity, we'll just wait for the current transition to finish
      let attempts = 0;
      while (isTransitioningRef.current && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
    }

    if (qrScannerRef.current) {
      try {
        isTransitioningRef.current = true;
        if (qrScannerRef.current.isScanning) {
          await qrScannerRef.current.stop();
        }
        try {
          qrScannerRef.current.clear();
        } catch (e) {
          // ignore clear errors if already cleared
        }
        qrScannerRef.current = null;
      } catch (err) {
        console.error("Erro ao parar câmera:", err);
      } finally {
        isTransitioningRef.current = false;
      }
    }
  };

  const onScanSuccess = async (decodedText: string, resultOrMethod?: any) => {
    try {
      const scanMethod: 'qr_code' | 'code' = (resultOrMethod === 'code') ? 'code' : 'qr_code';
      const cleanText = decodedText.trim();
      setQrScanStatus('validating');
      await stopScanning();

      let searchId = '';
      let searchCode = '';
      let searchToken = '';

      // Try to parse as JSON
      try {
        const parsed = JSON.parse(cleanText);
        if (parsed && typeof parsed === 'object') {
          searchId = parsed.id || '';
          searchCode = parsed.code || '';
          searchToken = parsed.token || '';
        } else {
          // Not an object, treat as raw text
          searchToken = cleanText;
          searchCode = cleanText;
          searchId = cleanText;
        }
      } catch (e) {
        // Not a valid JSON, treat as raw text
        searchToken = cleanText;
        searchCode = cleanText;
        searchId = cleanText;
      }

      // Construct OR query parts
      const orParts = [];
      if (searchToken) orParts.push(`pickup_token.eq."${searchToken}"`);
      if (searchCode) orParts.push(`pickup_code.eq."${searchCode}"`);
      
      // Only add ID search if it looks like a valid UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (searchId && uuidRegex.test(searchId)) {
        orParts.push(`id.eq."${searchId}"`);
      }

      if (orParts.length === 0) {
        toast.error('Conteúdo do QR Code inválido');
        setQrScanStatus('error');
        setTimeout(() => {
          setQrScanStatus('scanning');
          startScanning();
        }, 2000);
        return;
      }

      // The QR code contains the package ID, token or 4-digit pickup code
      const { data: packagesFound, error: rpcError } = await supabase
        .from('packages')
        .select('*, package_id:id, recipient_name:recipient_name_raw, unit_label:unit_number')
        .eq('condominium_id', user.condominium_id)
        .or(orParts.join(','))
        .eq('status', 'received');

      if (rpcError) {
        console.error("Erro ao buscar encomenda por QR:", rpcError);
        toast.error('Erro na busca: ' + rpcError.message);
        setQrScanStatus('error');
        setTimeout(() => {
          setQrScanStatus('scanning');
          startScanning();
        }, 2000);
        return;
      }

      if (!packagesFound || packagesFound.length === 0) {
        setQrScanStatus('error');
        toast.error('Encomenda não encontrada');
        setTimeout(() => {
          setQrScanStatus('scanning');
          startScanning();
        }, 2000);
        return;
      }

      const data = packagesFound[0];
      setQrPackage(data);
      setQrScanStatus('success');
      
      // Requisito: passar o objeto diretamente para o handleDeliver para evitar estado "stale" e garantir baixa coletiva
      setTimeout(() => {
        handleDeliver(data.package_id || data.id, scanMethod, undefined, data);
      }, 50);
    } catch (err) {
      console.error("Erro ao processar QR:", err);
      setQrScanStatus('error');
    }
  };

  const onScanFailure = (error: any) => {
    // Ignore scan failures as they happen frequently during scanning
  };

  const handleManualToken = async () => {
    if (!manualToken.trim()) return;
    await onScanSuccess(manualToken.trim(), 'code');
  };

  const [editingResident, setEditingResident] = useState<Morador | null>(null);
  const [isAddingResident, setIsAddingResident] = useState(false);
  const [residentToDelete, setResidentToDelete] = useState<Morador | null>(null);
  const [residentForm, setResidentForm] = useState({
    full_name: '',
    phone: '',
    unit_type: localStorage.getItem('last_resident_unit_type') || 'Casa',
    unidade: '',
    block: '',
    street: '',
    tower: '',
    complement: ''
  });

  const openNewResidentModal = () => {
    setEditingResident(null);
    setResidentForm({
      full_name: '',
      phone: '',
      unit_type: '',
      unidade: '',
      block: '',
      street: '',
      tower: '',
      complement: ''
    });
    setIsAddingResident(true);
  };

  const handleEditResident = (resident: Morador) => {
    setEditingResident(resident);
    setResidentForm({
      full_name: resident.nome || '',
      phone: resident.telefone || '',
      unit_type: resident.unit_type || '',
      unidade: resident.unidade || '',
      block: resident.block || resident.bloco || '',
      street: resident.street || '',
      tower: resident.lote || '',
      complement: resident.observacoes || ''
    });
  };

  useEffect(() => {
    // REQUISITO: Corrigir banco de dados para registros existentes (Casa vs Apto)
    const fixDatabaseRecords = async () => {
      if (!user?.condominium_id) return;
      const key = `db_fixed_${user.condominium_id}`;
      if (localStorage.getItem(key)) return;

      try {
        // Corrigir registros 'apto' para 'Casa' ou 'Apartamento' se possível
        // Mas o pedido é específico: 'apto' -> 'casa' se for o caso
        // Aqui vamos seguir a instrução literal: update moradores set tipo_residencia = 'casa' where tipo_residencia = 'apto'
        // Mas como usamos 'unit_type', o comando no supabase seria:
        const { error } = await supabase
          .from('moradores')
          .update({ unit_type: 'Casa' })
          .eq('condominium_id', user.condominium_id)
          .eq('unit_type', 'apto');
        
        if (!error) {
          localStorage.setItem(key, 'true');
          console.log('Base de moradores corrigida com sucesso.');
          fetchData();
        }
      } catch (err) {
        console.error('Erro ao corrigir base:', err);
      }
    };

    if (user?.role === 'admin' || user?.role === 'sindico') {
      fixDatabaseRecords();
    }
  }, [user]);

  const handleSaveResident = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      
      const unitTypeToSave = residentForm.unit_type || 'Casa';
      localStorage.setItem('last_resident_unit_type', unitTypeToSave);

      const moradorData = {
        nome: residentForm.full_name,
        unidade: residentForm.unidade,
        unit_type: unitTypeToSave,
        block: residentForm.block,
        bloco: residentForm.block,
        street: residentForm.street,
        lote: residentForm.tower,
        telefone: residentForm.phone,
        observacoes: residentForm.complement,
        condominium_id: user.condominium_id,
        ativo: true
      };

      if (editingResident) {
        const { error } = await supabase
          .from('moradores')
          .update(moradorData)
          .eq('id', editingResident.id);

        if (error) throw error;
        toast.success('Morador atualizado com sucesso!');
      } else {
        const { error } = await supabase
          .from('moradores')
          .insert([moradorData]);

        if (error) throw error;
        toast.success('Morador cadastrado com sucesso!');
      }
      
      setEditingResident(null);
      setIsAddingResident(false);
      setResidentForm({
        full_name: '',
        phone: '',
        unit_type: unitTypeToSave,
        unidade: '',
        block: '',
        street: '',
        tower: '',
        complement: ''
      });
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar morador:', error);
      toast.error('Erro ao salvar morador: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleIndividualNotifySend = async () => {
    if (!individualNotifyData) return;
    const pkg = individualNotifyData;
    const resident = residents.find(r => r.id === pkg.recipient_id);
    
    if (!resident) {
      toast.error('Morador não encontrado');
      return;
    }

    try {
      setLoading(true);
      
      // Busca todas as encomendas pendentes do morador para notificar juntas
      const moradorPackages = packages.filter(p => 
        p.recipient_id === resident.id && 
        (p.status === 'received' || p.status === 'pending') &&
        (p.whatsapp_status === 'pendente' || p.whatsapp_status === 'pending' || !p.whatsapp_status)
      );

      // Garante pickup_code/token
      let pickupCode = pkg.pickup_code;
      if (!pickupCode) pickupCode = generatePickupCode();
      const pickupToken = pkg.pickup_token || Math.random().toString(36).substring(2, 8).toUpperCase();

      const message = prepareWhatsAppNotification(
        resident,
        condoName || 'Condomínio',
        pickupCode,
        undefined,
        pickupToken,
        moradorPackages.length || 1,
        'disponivel',
        undefined,
        undefined,
        pkg.photo_url // Foto da encomenda clicada
      );

      if (!message) throw new Error('Não foi possível preparar a mensagem');

      const whatsappLink = getWhatsAppLink(resident.telefone, message, pkg.photo_url);
      window.open(whatsappLink, '_blank');

      // Atualiza status no banco
      const pkgIds = moradorPackages.map(p => p.id);
      const { error } = await supabase
        .from('packages')
        .update({ 
          whatsapp_status: 'enviado',
          whatsapp_message: message,
          pickup_code: pickupCode,
          pickup_token: pickupToken,
          notified_at: new Date().toISOString()
        })
        .in('id', pkgIds);

      if (error) throw error;

      toast.success('Notificação iniciada!');
      setIndividualNotifyData(null);
      fetchData();
      fetchPendingNotices();
    } catch (err: any) {
      toast.error('Erro ao notificar: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteResident = (resident: Morador) => {
    setResidentToDelete(resident);
  };

  const confirmDeleteResident = async () => {
    if (!residentToDelete) return;

    try {
      setLoading(true);
      
      // Soft delete: inativa o morador na tabela moradores
      const { error: errorMorador } = await supabase
        .from('moradores')
        .update({ ativo: false })
        .eq('id', residentToDelete.id);

      if (errorMorador) throw errorMorador;

      // Também tenta inativar na tabela profiles caso exista um usuário vinculado
      await supabase
        .from('profiles')
        .update({ active: false })
        .eq('id', residentToDelete.id);

      await registrarAuditoria({
        condominio_id: user.condominium_id || '',
        usuario_id: user.id,
        usuario_nome: user.full_name,
        usuario_perfil: user.role,
        tipo_evento: 'MORADOR_DESATIVADO',
        acao: 'UPDATE',
        tabela_afetada: 'moradores',
        registro_id: residentToDelete.id,
        descricao: `Morador desativado/excluído: ${residentToDelete.nome}`,
        metodo: 'MANUAL',
        dados_antes: residentToDelete,
        dados_depois: { ativo: false }
      });

      toast.success('Morador excluído com sucesso!');
      setResidentToDelete(null);
      fetchData();
    } catch (error: any) {
      console.error('Erro ao excluir morador:', error);
      toast.error('Erro ao excluir morador: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleResidentStatus = async (resident: Morador) => {
    try {
      setLoading(true);
      const newStatus = !resident.ativo;
      
      const { error } = await supabase
        .from('moradores')
        .update({ ativo: newStatus })
        .eq('id', resident.id);

      if (error) throw error;

      await registrarAuditoria({
        condominio_id: user.condominium_id || '',
        usuario_id: user.id,
        usuario_nome: user.full_name,
        usuario_perfil: user.role,
        tipo_evento: newStatus ? 'MORADOR_ATIVADO' : 'MORADOR_DESATIVADO',
        acao: 'UPDATE',
        tabela_afetada: 'moradores',
        registro_id: resident.id,
        descricao: `Morador ${newStatus ? 'ativado' : 'desativado'}: ${resident.nome}`,
        metodo: 'MANUAL',
        dados_antes: resident,
        dados_depois: { ativo: newStatus }
      });

      toast.success(`Morador ${newStatus ? 'ativado' : 'desativado'} com sucesso!`);
      fetchData();
    } catch (error: any) {
      console.error('Erro ao alterar status do morador:', error);
      toast.error('Erro ao alterar status: ' + error.message);
    } finally {
      setLoading(false);
      setActiveResidentMenu(null);
    }
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

  const fetchData = async () => {
    if (!user?.condominium_id) return;
    
    try {
      setLoading(true);
      
      // Primeiro busca as configurações para saber se o modo leve está ativado
      const { data: settingsData } = await supabase
        .from('condominium_settings')
        .select('*')
        .eq('condominium_id', user.condominium_id)
        .maybeSingle();
      
      setCondoSettings(settingsData);
 
       // Busca encomendas e moradores
       let pkgQuery = supabase
         .from('packages')
         .select('*, package_id:id, recipient_name:recipient_name_raw, unit_label:unit_number')
         .eq('condominium_id', user.condominium_id)
         .order('received_at', { ascending: false });
 
       const [pkgResult, resResult] = await Promise.all([
        pkgQuery,
        supabase
          .from('moradores')
          .select('id, nome, unidade, unit_type, telefone, block, street, ativo')
          .eq('condominium_id', user.condominium_id)
          .eq('ativo', true)
          .order('nome')
      ]);

      if (pkgResult.error) {
        console.error('Erro ao buscar encomendas:', pkgResult.error);
      } else {
        setPackages(pkgResult.data || []);
      }

      if (resResult.error) {
        console.error('Erro ao buscar moradores:', resResult.error);
      } else {
        setResidents(resResult.data || []);
      }

      // Só mostramos erro se ambos falharem
      if (pkgResult.error && resResult.error) {
        toast.error('Erro ao carregar dados da portaria');
      }

    } catch (error) {
      console.error('Erro ao buscar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const uploadDeliveryPhoto = async (base64: string) => {
    try {
      let finalBase64 = base64;

      // Compressão obrigatória para reduzir peso no mobile
      try {
        const { compressImage } = await import('../lib/imageUtils');
        finalBase64 = await compressImage(base64, 800, 0.6);
      } catch (err) {
        console.warn('Falha ao comprimir imagem, enviando original:', err);
      }

      // Converter base64 para Blob
      const res = await fetch(finalBase64);
      const blob = await res.blob();
      
      // Nome de arquivo único para evitar colisões
      const fileName = `delivery_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;

      // Upload para a raiz do bucket 'packages' (mais seguro)
      const { error: uploadError } = await supabase.storage
        .from('packages')
        .upload(fileName, blob, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error("Erro no upload Supabase:", uploadError);
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('packages')
        .getPublicUrl(fileName);

      if (!publicUrl) throw new Error("Não foi possível gerar a URL pública da foto");

      return publicUrl;
    } catch (err: any) {
      console.error("Erro detalhado no upload da foto:", err);
      throw new Error(err.message || "Falha ao enviar imagem para o servidor");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Ensure modal is open and in validating state immediately
      setIsScanning(true);
      setQrScanStatus('validating');
      setIsDeliverySuccess(false);
      
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const photoData = reader.result as string;
          setDeliveryPhoto(photoData);
          
          // Inicia salvamento automático após tirar a foto
          const pkgId = qrPackage?.package_id || qrPackage?.id;
          if (pkgId) {
            handleDeliver(pkgId, 'foto', photoData, qrPackage || undefined);
          } else {
            setQrScanStatus('success');
          }
        } catch (err) {
          console.error("Erro no processamento da foto:", err);
          // Em caso de erro, mantém o modal aberto no estado de sucesso
          setQrScanStatus('success');
          toast.error('Erro ao processar foto. Tente novamente');
        }
      };
      reader.onerror = () => {
        setQrScanStatus('success');
        toast.error('Erro ao ler arquivo da foto.');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDeliver = async (pkgId: string, method: 'manual' | 'qr_code' | 'photo' | 'foto' | 'code' | 'CÓDIGO' = 'manual', photoOverride?: string, packageData?: Package) => {
    if (!pkgId) {
      toast.error('ID da encomenda não encontrado');
      return;
    }

    // Usar dados passados ou do estado
    const activePackage = packageData || qrPackage;

    try {
      setQrScanStatus('validating');
      
      const { data: authData } = await supabase.auth.getUser();
      const authUser = authData?.user;
      
      const photoToUse = photoOverride || deliveryPhoto;
      let finalPhotoUrl = null;
      let finalMethod = method;

      if (photoToUse && photoToUse.startsWith('data:')) {
        try {
          finalPhotoUrl = await uploadDeliveryPhoto(photoToUse);
          finalMethod = 'foto';
        } catch (uploadErr: any) {
          console.error("Erro no upload da foto:", uploadErr);
          throw new Error(`Erro no upload da foto: ${uploadErr.message}`);
        }
      } else if (finalMethod === 'manual' && activePackage?.pickup_code) {
        finalMethod = 'CÓDIGO';
      } else if (finalMethod === 'code' || finalMethod === 'CÓDIGO') {
        finalMethod = 'CÓDIGO';
      }

      // REQUISITO CRÍTICO: Buscar TODOS os registros com o mesmo código/token para baixa coletiva
      let idsToUpdate: string[] = [pkgId];
      let pickupToken = activePackage?.pickup_token;
      let pickupCode = activePackage?.pickup_code;

      const { data: relatedPackages } = await supabase
        .from('packages')
        .select('id')
        .eq('condominium_id', user.condominium_id)
        .in('status', ['received', 'pending'])
        .or(pickupToken ? `pickup_token.eq.${pickupToken}` : `pickup_code.eq.${pickupCode},recipient_id.eq.${activePackage?.recipient_id}`);

      if (relatedPackages && relatedPackages.length > 0) {
        idsToUpdate = relatedPackages.map(p => p.id);
      }

      const { error: updateError } = await supabase
        .from('packages')
        .update({ 
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          delivery_method: finalMethod,
          ...(authUser?.id ? { delivered_by: authUser.id } : {}),
          entregue_por: currentPorter,
          pickup_qr_code: 'used',
          delivered_to_name: 'Morador (Confirmado)',
          ...(finalPhotoUrl ? { delivery_photo_url: finalPhotoUrl } : {}),
          notes: idsToUpdate.length > 1 ? 'Retirada coletiva via código' : undefined
        })
        .in('id', idsToUpdate);

      if (updateError) throw updateError;

      // REGISTRAR AUDITORIA PARA CADA ENCOMENDA ENTREGUE
      try {
        const currentMethod = finalMethod as string;
        const metodoTraduzido = 
          currentMethod === 'qr_code' ? 'QR' : 
          (currentMethod === 'CÓDIGO' || currentMethod === 'code' || currentMethod === 'manual') ? 'CODIGO' : 'FOTO';

        const residentData = residents.find(r => r.id === activePackage?.recipient_id);

        for (const pkgToAuditId of idsToUpdate) {
          const descSuffix = idsToUpdate.length > 1 ? ' (Retirada Coletiva)' : '';
          
          await registrarAuditoria({
            condominio_id: user.condominium_id || '',
            usuario_id: user.id,
            usuario_nome: user.full_name,
            usuario_perfil: user.role,
            tipo_evento: 'ENCOMENDA_ENTREGUE',
            acao: 'UPDATE',
            tabela_afetada: 'encomendas',
            registro_id: pkgToAuditId,
            descricao: `Encomenda entregue via ${metodoTraduzido} para ${residentData?.full_name || residentData?.nome || 'Morador'} - ${residentData?.unidade || 'N/A'}${descSuffix}`,
            metodo: metodoTraduzido
          });
        }
      } catch (logErr) {
        console.warn('Erro ao registrar auditoria de entrega:', logErr);
      }

      // VALIDAR SE AINDA EXISTE PENDENTE COM ESSE CÓDIGO (Anti-Update-Gap)
      const { data: remainingPending } = await supabase
        .from('packages')
        .select('id')
        .eq('condominium_id', user.condominium_id)
        .in('status', ['received', 'pending'])
        .or(pickupToken ? `pickup_token.eq.${pickupToken}` : `pickup_code.eq.${pickupCode},recipient_id.eq.${activePackage?.recipient_id}`);

      if (remainingPending && remainingPending.length > 0) {
        throw new Error('Algumas encomendas ainda constam como pendentes. Tente novamente.');
      }

      // Notificar morador sobre a retirada
      try {
        const residentToNotify = residents.find(r => r.id === activePackage?.recipient_id);
        if (residentToNotify) {
          const retiroMsg = prepareWhatsAppNotification(
            residentToNotify,
            condoName,
            pickupCode || '',
            undefined,
            pickupToken || '',
            idsToUpdate.length,
            'retirada',
            currentPorter,
            new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          );

          if (retiroMsg && condoSettings?.whatsapp_mode === 'api_automatica' && condoSettings?.api_url && condoSettings?.api_token) {
            //
           // sendWhatsAppMessage(
          // residentToNotify.telefone, 
         //  retiroMsg, 
         //  user.condominium_id, 
          // {
             // api_url: condoSettings.api_url,
             // api_token: condoSettings.api_token,
            //  instance_id: condoSettings.instance_id,
            //  whatsapp_provider: condoSettings.whatsapp_provider
            // }
          //  ).catch(err => console.error("Erro ao enviar notificação de retirada:", err));
          }
        }
      } catch (notifyErr) {
        console.warn("Erro ao processar notificação de retirada:", notifyErr);
      }
      
      const deliveredCount = idsToUpdate.length;

      // Som de confirmação de baixa - Abordagem otimizada para Celular (Mobile)
      console.log('[Baixa] Tentando tocar som de sucesso...');
      if (successAudioRef.current) {
        try {
          successAudioRef.current.currentTime = 0;
          successAudioRef.current.play().then(() => {
            console.log('[Baixa] Som de sucesso reproduzido com sucesso');
          }).catch((err) => {
            console.error('[Baixa] Erro ao reproduzir som (Promessa rejeitada):', err);
          });
        } catch (e) {
          console.error('[Baixa] Erro crítico ao tentar tocar áudio:', e);
        }
      } else {
        console.warn('[Baixa] Instância de áudio não encontrada no momento do toque');
      }

      // Aguardar o som iniciar antes de mostrar sucesso e resetar interface
    setTimeout(() => {
      setIsDeliverySuccess(true);
      toast.success(`${deliveredCount} ${deliveredCount === 1 ? 'encomenda entregue' : 'encomendas entregues'} com sucesso`, { duration: 2500 });
      
      if (method === 'code' || method === 'CÓDIGO' || method === 'manual') {
        setManualToken('');
      }

      // Resetar rigorosamente estados de notificação para garantir que nada redirecione ou abra abas
      setModoEnvio(null);
      setIsNotifyingAll(false);
      setIsWaitingForFocus(false);
      setIndividualNotifyData(null);
      setShowBatchModal(false);
      setNotifyQueue([]);
      setNotifyIndex(0);
      
      // Atualizar dados e garantir que permaneça na aba de pendentes
      setQrPackage(null);
      setViewQrPackage(null);
      setQrScanStatus('idle');
      fetchData(); 
      setActiveTab('pending');
      
      // Manter o estado de sucesso visual por 2 segundos antes de fechar o modal e resetar variáveis de UI
      setTimeout(() => {
        setIsScanning(false);
        setIsDeliverySuccess(false);
        setDeliveryPhoto(null);
        setManualToken('');
        setShowManualInput(false);
        setCameraStarted(false);
      }, 2000);
    }, 50);

    } catch (error: any) {
      console.error('Erro ao entregar encomenda:', error);
      toast.error(`Erro: ${error.message || 'Falha ao confirmar entrega'}`);
      setQrScanStatus('success');
      return false;
    }
  };

  const pendingPackages = useMemo(() => packages.filter(p => p.status !== 'delivered'), [packages]);
  const deliveredPackages = useMemo(() => packages.filter(p => p.status === 'delivered'), [packages]);

  const [selectedGroup, setSelectedGroup] = useState<any>(null);
  const [viewPhotoUrl, setViewPhotoUrl] = useState<string | null>(null);
  const [viewGroupPhotos, setViewGroupPhotos] = useState<any[] | null>(null);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);

  const filteredPackages = useMemo(() => {
    let basePackages = packages;
    if (activeTab === 'pending') basePackages = pendingPackages;
    if (activeTab === 'delivered') basePackages = deliveredPackages;

    const term = searchTerm.toLowerCase();
    const filtered = basePackages.filter((p: any) => 
      !term || 
      p.recipient_name?.toLowerCase().includes(term) ||
      p.unit_label?.toLowerCase().includes(term) ||
      p.carrier?.toLowerCase().includes(term) ||
      p.tracking_code?.toLowerCase().includes(term)
    );

    // Agrupamento para abas Pendentes e Retiradas
    if (activeTab === 'pending' || activeTab === 'delivered') {
      const groups: { [key: string]: any[] } = {};
      
      for (let i = 0; i < filtered.length; i++) {
        const pkg = filtered[i];
        const key = pkg.pickup_token || pkg.pickup_code || pkg.id;
        if (!groups[key]) groups[key] = [];
        groups[key].push(pkg);
      }

      return Object.values(groups).map(group => {
        if (group.length === 1) return group[0];
        
        return {
          ...group[0],
          isGroup: true,
          packages: group,
          count: group.length
        };
      });
    }

    return filtered;
  }, [packages, activeTab, searchTerm, pendingPackages, deliveredPackages]);

  const filteredResidents = useMemo(() => residents.filter(r => 
    r.ativo && (
      !searchTerm ||
      r.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.unidade?.toLowerCase().includes(searchTerm.toLowerCase())
    )
  ), [residents, searchTerm]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-zinc-900 uppercase">PAINEL DA PORTARIA</h1>
          <div className="flex items-center justify-between gap-8 mt-1 border-b border-zinc-100 pb-2">
            <p className="text-zinc-500 font-medium truncate max-w-[60%] md:max-w-none">{condoName}</p>
            <button 
              onClick={() => setShowPorterModal(true)}
              className={`flex items-center gap-2.5 text-[10px] md:text-xs font-semibold uppercase tracking-widest flex-shrink-0 whitespace-nowrap px-3 py-1.5 rounded-xl border transition-all active:scale-95 ${
                currentPorter === 'Selecione o Porteiro' 
                  ? 'bg-amber-50 text-amber-600 border-amber-200 animate-pulse' 
                  : 'text-zinc-400 hover:bg-zinc-50 border-transparent hover:border-zinc-100'
              }`}
              title="Trocar Porteiro"
            >
              <User className={`w-4 h-4 ${currentPorter === 'Selecione o Porteiro' ? 'text-amber-500' : ''}`} />
              <span>Porteiro: {currentPorter}</span>
            </button>
          </div>
          <p className="text-zinc-400 text-sm mt-2 flex items-center justify-between">
            <span>Agilidade no registro, recebimento e entrega!</span>
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-zinc-300">
              <Zap className={`w-3 h-3 ${condoSettings?.whatsapp_mode === 'api_automatica' ? 'text-emerald-400' : 'text-zinc-300'}`} />
              MODO: {condoSettings?.whatsapp_mode === 'api_automatica' ? 'AUTOMÁTICO (API)' : 'MANUAL'}
            </span>
          </p>
        </div>
          <div className="flex flex-wrap gap-3 w-full md:w-auto">
          <div className="flex flex-1 md:flex-none gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setRetrievalMethod('manual');
                setShowManualInput(true);
                setIsScanning(true);
              }}
              className="w-full md:w-auto flex-1 bg-white text-zinc-900 px-6 py-4 rounded-2xl font-bold hover:bg-zinc-50 transition-all flex items-center justify-center gap-3 border border-zinc-200 shadow-sm"
            >
              <Hash className="w-6 h-6 text-emerald-600" />
              CÓDIGO DE RETIRADA
            </button>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              navigate('/packages/new');
            }}
            className="flex-1 md:flex-none bg-emerald-600 text-white px-6 py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-200"
          >
            <Plus className="w-6 h-6" />
            Registrar Encomenda
          </button>
          {activeTab === 'pending' && pendingNoticesCount > 0 && (
            <motion.button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                handleNotifyAll();
              }}
              animate={{ 
                boxShadow: ["0 0 0 0px rgba(24,24,27,0)", "0 0 0 10px rgba(24,24,27,0.1)", "0 0 0 0px rgba(24,24,27,0)"],
                scale: [1, 1.02, 1]
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut"
              }}
              className="flex-1 md:flex-none bg-zinc-900 text-white px-6 py-4 rounded-2xl font-bold hover:bg-zinc-800 transition-all flex items-center justify-center gap-3 shadow-lg shadow-zinc-200"
            >
              <Zap className="w-5 h-5 text-amber-400" />
              Notificar todos
            </motion.button>
          )}
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-zinc-100 rounded-2xl mb-8 w-fit overflow-x-auto max-w-full">
        <button 
          type="button"
          onClick={(e) => { e.preventDefault(); setActiveTab('pending'); }}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'pending' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <Clock className="w-5 h-5" />
          Pendentes ({pendingPackages.length})
        </button>
        <button 
          type="button"
          onClick={(e) => { e.preventDefault(); setActiveTab('delivered'); }}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'delivered' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <CheckCircle className="w-5 h-5" />
          Retiradas ({deliveredPackages.length})
        </button>
        <button 
          type="button"
          onClick={(e) => { e.preventDefault(); setActiveTab('all'); }}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'all' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <PackageIcon className="w-5 h-5" />
          Todas ({packages.length})
        </button>
        <button 
          type="button"
          onClick={(e) => { e.preventDefault(); setActiveTab('residents'); }}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'residents' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <Users className="w-5 h-5" />
          MORADORES ({residents.length})
        </button>
      </div>

      {activeTab === 'residents' && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 mb-8 flex flex-wrap gap-8">
          <div>
            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">Total de Moradores</p>
            <p className="text-2xl font-bold text-emerald-900">{residents.length}</p>
          </div>
          <div className="w-px h-10 bg-emerald-200 hidden sm:block" />
          <div>
            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">Total de Casas</p>
            <p className="text-2xl font-bold text-emerald-900">
              {new Set(residents.filter(r => r.unidade).map(r => `${r.unidade}-${r.block || ''}-${r.street || ''}`)).size}
            </p>
          </div>
        </div>
      )}

      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-4 rounded-2xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all bg-white"
          placeholder={activeTab !== 'residents' ? "Buscar por destinatário, unidade ou transportadora..." : "Buscar morador por nome ou unidade..."}
        />
      </div>

      {activeTab === 'residents' && (user.role === 'admin' || user.role === 'porteiro') && (
        <div className="flex justify-end mb-6">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              navigate('/profiles/new');
            }}
            className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
          >
            <UserPlus className="w-5 h-5" />
            Adicionar Morador
          </button>
        </div>
      )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
          </div>
        ) : activeTab !== 'residents' ? (
          filteredPackages.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredPackages.map((pkg: any) => (
                <PackageItem
                  key={pkg.package_id || pkg.id}
                  pkg={pkg}
                  getWhatsAppBadge={getWhatsAppBadge}
                  getDeliveryMethodLabel={getDeliveryMethodLabel}
                  onDeliverWithPhoto={(p) => {
                    pendingPackageRef.current = p;
                    setQrPackage(p);
                    setRetrievalMethod('manual');
                    setIsScanning(true);
                    setQrScanStatus('validating');
                    fileInputRef.current?.click();
                  }}
                  onCodeRetrieval={() => {
                    setRetrievalMethod('manual');
                    setShowManualInput(true);
                    setIsScanning(true);
                    setQrPackage(null);
                    setQrScanStatus('idle');
                  }}
                  onViewPhotos={(p) => {
                    const photos = p.packages
                      .filter((item: any) => item.photo_url)
                      .map((item: any) => ({
                        url: item.photo_url,
                        carrier: item.carrier,
                        received_at: item.received_at
                      }));
                    
                    if (photos.length > 0) {
                      setViewGroupPhotos(photos);
                    } else {
                      toast.error('Nenhuma etiqueta com foto neste grupo');
                    }
                  }}
                  onViewLabel={(url) => setViewPhotoUrl(url)}
                  handleDeliver={handleDeliver}
                  setQrPackage={setQrPackage}
                />
              ))}
            </div>
          ) : (
          <div className="text-center py-20 bg-white rounded-[3rem] border-2 border-dashed border-zinc-100">
            <div className="w-20 h-20 bg-zinc-50 text-zinc-300 rounded-full flex items-center justify-center mx-auto mb-6">
              <PackageIcon className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Nenhuma encomenda encontrada</h3>
            <p className="text-zinc-500">Tente buscar por outro termo ou mude o filtro.</p>
          </div>
        )
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
            <h2 className="text-3xl font-bold text-zinc-900 uppercase">Moradores ({residents.length})</h2>
          </div>

          {filteredResidents.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredResidents.map((resident) => (
                <ResidentCard
                  key={resident.id}
                  resident={resident}
                  activeResidentMenu={activeResidentMenu}
                  setActiveResidentMenu={setActiveResidentMenu}
                  onEdit={handleEditResident}
                  onDelete={handleDeleteResident}
                  onToggleStatus={toggleResidentStatus}
                  userRole={user.role}
                />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-zinc-100 p-20 text-center">
              <div className="w-20 h-20 bg-zinc-50 text-zinc-300 rounded-full flex items-center justify-center mx-auto mb-6">
                <Users className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">Nenhum morador encontrado</h3>
              <p className="text-zinc-500">Tente buscar por outro nome ou unidade.</p>
            </div>
          )}
        </div>
      )}

      {/* Modal de Foto Individual */}
      {viewPhotoUrl && !viewGroupPhotos && (
        <div className="fixed inset-0 bg-black/90 z-[70] flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-300">
          <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center">
            <button 
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setViewPhotoUrl(null);
              }}
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
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setViewPhotoUrl(null);
                }}
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

      {/* Gallery Modal for Group Photos */}
      <AnimatePresence>
        {viewGroupPhotos && (
          <div className="fixed inset-0 bg-black/95 z-[70] flex flex-col backdrop-blur-sm overflow-hidden">
            <div className="p-6 flex justify-between items-center bg-black/50 border-b border-white/10">
              <div>
                <h3 className="text-white text-xl font-bold uppercase tracking-tight">Etiquetas do Grupo</h3>
                <p className="text-zinc-400 text-xs">{viewGroupPhotos.length} fotos disponíveis</p>
              </div>
              <button 
                onClick={() => {
                  setViewGroupPhotos(null);
                  setViewPhotoUrl(null);
                }}
                className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-12 custom-scrollbar">
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 max-w-7xl mx-auto">
                {viewGroupPhotos.map((photo, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    onClick={() => {
                      setViewPhotoUrl(photo.url);
                      setCurrentPhotoIndex(idx);
                    }}
                    className="group cursor-pointer"
                  >
                    <div className="relative aspect-[3/4] bg-zinc-900 rounded-3xl overflow-hidden border border-white/10 shadow-lg group-hover:scale-[1.02] transition-transform duration-300">
                      <img 
                        src={photo.url} 
                        alt={`Etiqueta ${idx + 1}`}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                        <p className="text-white text-xs font-bold">{photo.carrier}</p>
                        <p className="text-zinc-300 text-[10px]">{formatSafeDateTime(photo.received_at)}</p>
                      </div>
                      <div className="absolute top-3 right-3 bg-white/20 backdrop-blur-md p-2 rounded-xl opacity-0 group-hover:opacity-100 transition-all">
                        <Eye className="w-4 h-4 text-white" />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Sub-modal Zoom for the gallery */}
            <AnimatePresence>
              {viewPhotoUrl && viewGroupPhotos && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/98 z-[80] flex flex-col items-center justify-center p-4 md:p-12"
                >
                  <div className="absolute top-6 left-6 flex items-center gap-4 text-white">
                    <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div>
                      <p className="font-bold text-lg">{viewGroupPhotos[currentPhotoIndex].carrier}</p>
                      <p className="text-zinc-500 text-xs">{formatSafeDateTime(viewGroupPhotos[currentPhotoIndex].received_at)}</p>
                    </div>
                  </div>

                  <button 
                    onClick={() => setViewPhotoUrl(null)}
                    className="absolute top-6 right-6 w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors z-[90]"
                  >
                    <X className="w-6 h-6" />
                  </button>

                  <div className="relative w-full h-full flex items-center justify-center group/nav">
                    {/* Previous Button */}
                    <button 
                      onClick={() => {
                        const newIndex = (currentPhotoIndex - 1 + viewGroupPhotos.length) % viewGroupPhotos.length;
                        setCurrentPhotoIndex(newIndex);
                        setViewPhotoUrl(viewGroupPhotos[newIndex].url);
                      }}
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-16 h-16 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-white transition-all backdrop-blur-md opacity-40 group-hover/nav:opacity-100 hover:scale-110"
                    >
                      <ChevronLeft className="w-8 h-8" />
                    </button>

                    {/* Next Button */}
                    <button 
                      onClick={() => {
                        const newIndex = (currentPhotoIndex + 1) % viewGroupPhotos.length;
                        setCurrentPhotoIndex(newIndex);
                        setViewPhotoUrl(viewGroupPhotos[newIndex].url);
                      }}
                      className="absolute right-0 top-1/2 -translate-y-1/2 w-16 h-16 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center text-white transition-all backdrop-blur-md opacity-40 group-hover/nav:opacity-100 hover:scale-110"
                    >
                      <ChevronRight className="w-8 h-8" />
                    </button>

                    <div className="max-w-5xl w-full h-full flex flex-col items-center justify-center">
                      <motion.img 
                        key={currentPhotoIndex}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        src={viewPhotoUrl} 
                        alt="Zoom da etiqueta"
                        className="max-w-full max-h-[85vh] object-contain rounded-3xl shadow-[0_0_100px_rgba(0,0,0,0.5)] border-4 border-white/10"
                        referrerPolicy="no-referrer"
                      />
                      
                      <div className="mt-8 flex items-center gap-3">
                        {viewGroupPhotos.map((_, i) => (
                          <div 
                            key={i} 
                            className={`h-1.5 rounded-full transition-all duration-300 ${i === currentPhotoIndex ? 'w-8 bg-emerald-500' : 'w-2 bg-white/20'}`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </AnimatePresence>

      {/* Notificar Todos Modal (Manual Queue) */}
      <AnimatePresence>
        {isNotifyingAll && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[2.5rem] p-8 max-w-lg w-full shadow-2xl relative overflow-hidden"
            >
              {/* Progress Bar */}
              <div className="absolute top-0 left-0 h-1.5 bg-zinc-100 w-full">
                <motion.div 
                  className="h-full bg-emerald-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${(notifyIndex / notifyQueue.length) * 100}%` }}
                />
              </div>

              {notifyIndex < notifyQueue.length ? (
                <div className="space-y-6 pt-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest block mb-1">Fila de Notificação</span>
                      <h3 className="text-2xl font-bold text-zinc-900">Avisar Moradores</h3>
                    </div>
                    <div className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-lg text-xs font-bold ring-1 ring-emerald-100">
                      {notifyIndex + 1} de {notifyQueue.length}
                    </div>
                  </div>

                  <div className="p-6 bg-zinc-50 rounded-2xl border border-zinc-100 text-center space-y-3">
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm mx-auto mb-2 ring-1 ring-zinc-100">
                      <User className="w-8 h-8" />
                    </div>
                    <h4 className="text-xl font-bold text-zinc-900">{notifyQueue[notifyIndex].resident.nome}</h4>
                    <p className="text-sm text-zinc-500 flex items-center justify-center gap-2">
                       <Smartphone className="w-4 h-4" />
                       {notifyQueue[notifyIndex].resident.telefone}
                    </p>
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-[10px] font-bold uppercase tracking-wider">
                      <Clock className="w-3 h-3" />
                      {notifyQueue[notifyIndex].packages.length} Encomendas Pendentes
                    </div>
                  </div>

                  <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100/50">
                    <p className="text-xs text-emerald-800 font-medium italic">
                      "Olá, {notifyQueue[notifyIndex].resident.nome}! Você possui {notifyQueue[notifyIndex].packages.length} {notifyQueue[notifyIndex].packages.length > 1 ? 'encomendas disponíveis' : 'encomenda disponível'} para retirada na portaria."
                    </p>
                  </div>

                  {isWaitingForFocus ? (
                    <div className="py-8 text-center space-y-4">
                      <div className="flex flex-col items-center gap-3">
                        <div className="relative">
                          <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
                          <Smartphone className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 text-emerald-600" />
                        </div>
                        <p className="font-bold text-zinc-900 animate-pulse">Aguardando retorno do WhatsApp...</p>
                        <p className="text-xs text-zinc-500">Ao retornar ao app, passaremos para o próximo automaticamente.</p>
                      </div>
                      <div className="flex flex-col gap-2">
                         <button 
                          onClick={() => setIsWaitingForFocus(false)}
                          className="w-full text-emerald-600 font-bold text-sm py-2 hover:underline"
                        >
                          Clique aqui caso não avance sozinho
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <button
                        autoFocus
                        onClick={handleSendQueueItem}
                        className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-3 animate-in fade-in zoom-in duration-300"
                      >
                        <Send className="w-5 h-5" />
                        ENVIAR WHATSAPP AGORA
                      </button>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={skipQueueItem}
                          className="py-3 bg-zinc-100 text-zinc-600 rounded-xl font-bold hover:bg-zinc-200 transition-all text-sm"
                        >
                          Pular este
                        </button>
                        <button
                          onClick={() => {
                            setIsNotifyingAll(false);
                            setModoEnvio(null);
                          }}
                          className="py-3 text-red-600 font-bold hover:bg-red-50 rounded-xl transition-all text-sm"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 text-center space-y-6">
                  <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                    <CheckCircle className="w-12 h-12" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-bold text-zinc-900">Notificações concluídas!</h3>
                    <p className="text-zinc-500">Todos os moradores da fila foram avisados.</p>
                  </div>
                  <button
                    onClick={() => {
                        setIsNotifyingAll(false);
                        fetchData();
                    }}
                    className="w-full bg-zinc-900 text-white py-4 rounded-2xl font-bold hover:bg-zinc-800 transition-all"
                  >
                    Fechar
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal de Confirmação de Envio em Lote */}
      <AnimatePresence>
        {showBatchModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
            <motion.div
              {...anim({
                initial: { opacity: 0, scale: 0.95, y: 20 },
                animate: { opacity: 1, scale: 1, y: 0 },
                exit: { opacity: 0, scale: 0.95, y: 20 }
              })}
              className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 text-center flex-shrink-0">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${batchMode === 'api' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                  <MessageSquare className="w-10 h-10" />
                </div>
                
                <h3 className="text-2xl font-bold text-zinc-900 mb-2">
                  {batchStep === 'manual_list' ? 'Envio Manual Assistido' : 
                   batchStep === 'finished' ? 'Envio Concluído' : 'Enviar avisos em lote'}
                </h3>
                <p className="text-zinc-500 mb-4">
                  {batchStep === 'manual_list' 
                    ? `Siga o fluxo sequencial para enviar as mensagens.`
                    : batchStep === 'finished'
                    ? 'Todos os avisos foram processados com sucesso.'
                    : `Você tem ${pendingNoticesCount} mensagens pendentes para enviar.`}
                </p>

                {batchStep === 'manual_list' && (
                  <div className="mb-6">
                    <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden">
                      <motion.div 
                        className="bg-emerald-600 h-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${((manualIndex + 1) / batchPackages.length) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs font-bold text-zinc-400 mt-2 uppercase tracking-widest">
                      Mensagem {manualIndex + 1} de {batchPackages.length}
                    </p>
                  </div>
                )}

                {batchStep === 'sending' && (
                  <div className="mb-6">
                    <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden">
                      <motion.div 
                        className="bg-emerald-600 h-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs font-bold text-zinc-400 mt-2 uppercase tracking-widest">
                      Enviando via API... {batchProgress.current}/{batchProgress.total}
                    </p>
                  </div>
                )}
              </div>

              {batchStep === 'manual_list' && (
                <div className="flex-1 overflow-y-auto px-8 pb-8">
                  {(() => {
                    const pkg = batchPackages[manualIndex];
                    if (!pkg) return null;
                    const resident = residents.find(r => r.id === pkg.recipient_id);
                    
                    return (
                      <motion.div 
                        key={pkg.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-zinc-50 p-8 rounded-[2rem] border border-zinc-100 text-center"
                      >
                        <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-4 border border-zinc-100">
                          <User className="w-8 h-8 text-emerald-600" />
                        </div>
                        <h4 className="text-xl font-bold text-zinc-900 mb-1">{pkg.recipient_name}</h4>
                        <p className="text-zinc-500 mb-4">{formatPackageUnit(pkg)}</p>
                        
                        {pkg.carrier && (
                          <div className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-full border border-zinc-100 text-xs font-bold text-zinc-600 mb-6">
                            <Truck className="w-3.5 h-3.5 text-blue-500" />
                            {pkg.carrier.toUpperCase()}
                          </div>
                        )}

                        <div className="grid grid-cols-1 gap-3">
                          <a
                            href={getWhatsAppLink(resident?.telefone || '', pkg.whatsapp_message || '')}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => handleManualSent(pkg.id)}
                            className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-200"
                          >
                            <Send className="w-6 h-6" />
                            ENVIAR PRÓXIMO
                          </a>
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              onClick={handleSkipManual}
                              className="bg-white text-zinc-600 py-4 rounded-2xl font-bold border border-zinc-200 hover:bg-zinc-50 transition-all"
                            >
                              PULAR
                            </button>
                            <button
                              onClick={() => {
                                setShowBatchModal(false);
                                setBatchStep('confirm');
                              }}
                              className="bg-white text-red-500 py-4 rounded-2xl font-bold border border-zinc-200 hover:bg-red-50 transition-all"
                            >
                              CANCELAR
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })()}
                </div>
              )}

              {batchStep === 'finished' && (
                <div className="p-8 pt-0 flex-shrink-0">
                  <button
                    onClick={() => {
                      setShowBatchModal(false);
                      setBatchStep('confirm');
                    }}
                    className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
                  >
                    FECHAR
                  </button>
                </div>
              )}

              <div className="p-8 pt-0 flex-shrink-0">
                <div className="grid grid-cols-1 gap-3">
                  {batchStep === 'confirm' && (
                    <button
                      onClick={handleBatchSend}
                      disabled={isBatchSending}
                      className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-200"
                    >
                      {condoSettings?.whatsapp_mode === 'api_automatica' ? (
                        <>
                          <Zap className="w-5 h-5" />
                          INICIAR ENVIO AUTOMÁTICO
                        </>
                      ) : (
                        <>
                          <Send className="w-5 h-5" />
                          INICIAR ENVIO MANUAL
                        </>
                      )}
                    </button>
                  )}
                  
                  <button
                    onClick={() => {
                      setShowBatchModal(false);
                      setBatchStep('confirm');
                    }}
                    disabled={isBatchSending}
                    className="w-full bg-zinc-100 text-zinc-600 py-4 rounded-2xl font-bold hover:bg-zinc-200 transition-all disabled:opacity-50"
                  >
                    {batchStep === 'manual_list' ? 'FECHAR' : 'CANCELAR'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal de Notificação Individual */}
      <AnimatePresence>
        {individualNotifyData && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden p-8"
            >
              <div className="text-center mb-8">
                <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Smartphone className="w-10 h-10" />
                </div>
                <h3 className="text-2xl font-bold text-zinc-900 mb-2">Notificar Morador</h3>
                <p className="text-zinc-500">Confirme os dados antes de enviar</p>
              </div>

              <div className="bg-zinc-50 p-6 rounded-3xl border border-zinc-100 space-y-4 mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-zinc-400 border border-zinc-100">
                    <User className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Morador</p>
                    <p className="font-bold text-zinc-900">{individualNotifyData.recipient_name}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-zinc-400 border border-zinc-100">
                    <Home className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Unidade</p>
                    <p className="font-bold text-zinc-900">{formatPackageUnit(individualNotifyData)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-emerald-600 border border-zinc-100">
                    <PackageIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Encomendas Pendentes</p>
                    <p className="font-bold text-zinc-900">
                      {packages.filter(p => p.recipient_id === individualNotifyData.recipient_id && (p.status === 'received' || p.status === 'pending') && (p.whatsapp_status === 'pendente' || !p.whatsapp_status)).length} item(s)
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleIndividualNotifySend}
                  disabled={loading}
                  className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-200 flex items-center justify-center gap-3"
                >
                  {loading ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : (
                    <>
                      <Send className="w-6 h-6" />
                      Enviar aviso via WhatsApp
                    </>
                  )}
                </button>
                <button
                  onClick={() => setIndividualNotifyData(null)}
                  className="w-full py-4 text-zinc-500 font-bold hover:bg-zinc-100 rounded-2xl transition-all"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Input de arquivo oculto para captura de foto de entrega */}
      <input 
        type="file" 
        accept="image/*" 
        capture="environment" 
        className="hidden" 
        ref={fileInputRef}
        onChange={handleFileChange}
      />

      {/* Modal de Cadastro/Edição de Morador */}
      {(isAddingResident || editingResident) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
          <motion.div
            {...anim({
              initial: { opacity: 0, scale: 0.95, y: 20 },
              animate: { opacity: 1, scale: 1, y: 0 }
            })}
            className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden"
          >
            <div className="p-8">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-zinc-900">
                    {editingResident ? 'Editar Morador' : 'Novo Morador'}
                  </h3>
                  <p className="text-zinc-500">Preencha os dados do morador</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setIsAddingResident(false);
                    setEditingResident(null);
                  }}
                  className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
                >
                  <X className="w-6 h-6 text-zinc-400" />
                </button>
              </div>

              <form onSubmit={handleSaveResident} className="space-y-6">
                <div>
                  <label className="block text-sm font-bold text-zinc-700 mb-2 uppercase tracking-wider">
                    Nome Completo
                  </label>
                  <input
                    type="text"
                    required
                    value={residentForm.full_name}
                    onChange={(e) => setResidentForm({ ...residentForm, full_name: e.target.value })}
                    className="w-full px-5 py-4 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-emerald-500 focus:ring-0 transition-all outline-none font-medium"
                    placeholder="Ex: João Silva"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-zinc-700 mb-2 uppercase tracking-wider">
                      Tipo de Unidade
                    </label>
                    <select
                      value={residentForm.unit_type}
                      onChange={(e) => setResidentForm({ ...residentForm, unit_type: e.target.value })}
                      className="w-full px-5 py-4 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-emerald-500 focus:ring-0 transition-all outline-none font-medium"
                    >
                      <option value="">Selecione o tipo</option>
                      <option value="Apartamento">Apartamento</option>
                      <option value="Casa">Casa</option>
                      <option value="Sobrado">Sobrado</option>
                      <option value="Lote">Lote</option>
                      <option value="Sala">Sala</option>
                      <option value="Outro">Outro</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-zinc-700 mb-2 uppercase tracking-wider">
                      Número da Unidade
                    </label>
                    <input
                      type="text"
                      required
                      value={residentForm.unidade}
                      onChange={(e) => setResidentForm({ ...residentForm, unidade: e.target.value })}
                      className="w-full px-5 py-4 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-emerald-500 focus:ring-0 transition-all outline-none font-medium"
                      placeholder="Ex: 101"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-zinc-700 mb-2 uppercase tracking-wider">
                      Bloco / Torre (Opcional)
                    </label>
                    <input
                      type="text"
                      value={residentForm.block}
                      onChange={(e) => setResidentForm({ ...residentForm, block: e.target.value })}
                      className="w-full px-5 py-4 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-emerald-500 focus:ring-0 transition-all outline-none font-medium"
                      placeholder="Ex: Bloco B"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-zinc-700 mb-2 uppercase tracking-wider">
                      Rua / Endereço Interno (Opcional)
                    </label>
                    <input
                      type="text"
                      value={residentForm.street}
                      onChange={(e) => setResidentForm({ ...residentForm, street: e.target.value })}
                      className="w-full px-5 py-4 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-emerald-500 focus:ring-0 transition-all outline-none font-medium"
                      placeholder="Ex: Rua das Palmeiras"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-zinc-700 mb-2 uppercase tracking-wider">
                    Telefone
                  </label>
                  <input
                    type="tel"
                    required
                    value={residentForm.phone}
                    onChange={(e) => setResidentForm({ ...residentForm, phone: e.target.value })}
                    className="w-full px-5 py-4 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-emerald-500 focus:ring-0 transition-all outline-none font-medium"
                    placeholder="(00) 00000-0000"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-5 bg-emerald-600 text-white rounded-2xl font-bold text-lg hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                >
                  {loading ? (
                    <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Save className="w-6 h-6" />
                      {editingResident ? 'Salvar Alterações' : 'Cadastrar Morador'}
                    </>
                  )}
                </button>
              </form>
            </div>
          </motion.div>
        </div>
      )}

      {/* Modal de Seleção de Porteiro */}
      <AnimatePresence>
        {showPorterModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-8">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold text-zinc-900">Selecionar Porteiro</h3>
                  <button onClick={() => setShowPorterModal(false)} className="p-2 hover:bg-zinc-100 rounded-full transition-colors text-zinc-400">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="grid grid-cols-1 gap-3">
                  {['Marcos', 'Izaias', 'Bruno', 'Marisa', 'Outro'].map((porter) => (
                    <button
                      key={porter}
                      onClick={() => {
                        setCurrentPorter(porter);
                        setManualPorter(porter);
                        setShowPorterModal(false);
                        toast.success(`Porteiro alterado para ${porter}`);
                      }}
                      className={`w-full py-4 px-6 rounded-2xl font-bold transition-all text-left flex items-center justify-between border ${
                        currentPorter === porter 
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                          : 'bg-zinc-50 border-zinc-100 text-zinc-600 hover:bg-zinc-100 hover:border-zinc-200'
                      }`}
                    >
                      {porter}
                      {currentPorter === porter && <Check className="w-5 h-5" />}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setShowPorterModal(false)}
                  className="w-full mt-6 py-4 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal de Confirmação de Exclusão de Morador */}
      <AnimatePresence>
        {residentToDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Trash2 className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-zinc-900 mb-2">Excluir Morador?</h3>
                <p className="text-zinc-500 mb-8">
                  Tem certeza que deseja excluir <strong>{residentToDelete.nome}</strong>? 
                  Ele não será removido permanentemente, apenas ocultado da lista ativa.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setResidentToDelete(null)}
                    className="py-3 px-4 bg-zinc-100 text-zinc-600 rounded-xl font-bold hover:bg-zinc-200 transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmDeleteResident}
                    disabled={loading}
                    className="py-3 px-4 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200 disabled:opacity-50"
                  >
                    {loading ? 'Excluindo...' : 'Sim, Excluir'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {selectedGroup && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] max-w-lg w-full p-8 shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-2xl font-bold text-zinc-900">Itens do Grupo</h3>
                <p className="text-zinc-500">Encomendas para {selectedGroup.recipient_name}</p>
              </div>
              <button 
                onClick={() => setSelectedGroup(null)}
                className="w-10 h-10 bg-zinc-50 text-zinc-400 rounded-full flex items-center justify-center hover:bg-zinc-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2 mb-8 custom-scrollbar">
              {selectedGroup.packages.map((pkg: any, idx: number) => (
                <div key={pkg.id || idx} className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 flex items-center gap-4">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-emerald-600 shadow-sm">
                    <PackageIcon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-zinc-900 truncate">{pkg.carrier}</p>
                    <p className="text-xs text-zinc-500">Recebido em {formatSafeDateTime(pkg.received_at)}</p>
                    {pkg.tracking_code && (
                      <p className="text-[10px] font-mono text-zinc-400 mt-1 truncate">Etiqueta: {pkg.tracking_code}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button 
              onClick={() => {
                const pkg = selectedGroup;
                setSelectedGroup(null);
                pendingPackageRef.current = pkg;
                setQrPackage(pkg);
                setRetrievalMethod('manual');
                setIsScanning(true);
                setQrScanStatus('validating');
                fileInputRef.current?.click();
              }}
              className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-3"
            >
              <Camera className="w-5 h-5" />
              ENTREGAR TODAS ({selectedGroup.count})
            </button>
          </div>
        </div>
      )}

      {/* QR Scanner Modal */}
      <AnimatePresence>
        {isScanning && (
          <div className="fixed inset-0 bg-zinc-950/90 z-50 flex flex-col overflow-hidden backdrop-blur-sm">
            {/* Header */}
            <div className="p-6 flex justify-between items-center bg-zinc-900/50 backdrop-blur-md border-b border-white/5">
              <div>
                <h3 className="text-white text-xl font-bold">
                  {qrPackage ? 'Confirmação de Entrega' : 'CÓDIGO DE RETIRADA'}
                </h3>
                <p className="text-zinc-400 text-xs">
                  {qrPackage ? 'Registre uma foto para confirmar a retirada' : 'Digite o código de 4 dígitos enviado ao morador'}
                </p>
              </div>
              <button 
                type="button"
                onClick={async (e) => { 
                  e.preventDefault();
                  await stopScanning();
                  setIsScanning(false); 
                  setQrPackage(null); 
                  setQrScanStatus('idle'); 
                  setShowManualInput(false);
                  setManualToken('');
                  setCameraStarted(false);
                }}
                className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 relative flex flex-col items-center justify-center p-6">
              <AnimatePresence mode="wait">
                {!qrPackage && qrScanStatus !== 'success' && (
                  <motion.div 
                    key="scanner"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full max-w-sm flex flex-col items-center"
                  >
                    {showManualInput ? (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full flex flex-col items-center"
                      >
                        <div className="bg-zinc-900/50 p-8 rounded-[32px] border border-white/10 w-full shadow-2xl backdrop-blur-md">
                          <div className="flex justify-between items-center mb-6">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] block">Código de Retirada</label>
                            <button 
                              onClick={() => setShowManualInput(false)}
                              className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-emerald-500 transition-all border border-white/5"
                              title="Usar QR Code"
                            >
                              <QrCode className="w-6 h-6" />
                            </button>
                          </div>
                          
                          <div className="relative w-full">
                            <input 
                              autoFocus
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={4}
                              value={manualToken}
                              onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, '');
                                setManualToken(val);
                                if (val.length === 4) {
                                  onScanSuccess(val, 'code');
                                }
                              }}
                              placeholder="0000"
                              className="w-full bg-zinc-800/50 border-2 border-white/10 rounded-3xl px-4 py-12 text-white text-7xl font-black tracking-[0.3em] text-center outline-none focus:border-emerald-500 focus:ring-8 focus:ring-emerald-500/10 transition-all placeholder:text-zinc-800 shadow-2xl"
                            />
                            <div className="mt-10 flex flex-col items-center gap-2">
                               <p className="text-emerald-500 text-sm font-black uppercase tracking-[0.2em]">Pronto para digitar</p>
                               <p className="text-zinc-500 text-[10px] font-medium uppercase tracking-widest">O campo limpa automaticamente após o uso</p>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ) : (
                      <div className="relative w-full aspect-square bg-zinc-900 rounded-3xl overflow-hidden shadow-2xl border border-white/10 flex flex-col items-center justify-center">
                        {cameraStarted ? (
                          <>
                            <div id="qr-reader" className="w-full h-full"></div>
                            
                            {/* Scanner Frame Overlay */}
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                              <div className="w-64 h-64 relative">
                                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-500 rounded-tl-lg"></div>
                                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-500 rounded-tr-lg"></div>
                                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-500 rounded-bl-lg"></div>
                                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-500 rounded-br-lg"></div>
                                
                                {/* Scanning Line Animation */}
                                <motion.div 
                                  animate={{ top: ['0%', '100%', '0%'] }}
                                  transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                                  className="absolute left-0 right-0 h-0.5 bg-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                                />
                              </div>
                            </div>

                            {/* Validating Overlay */}
                            {qrScanStatus === 'validating' && (
                              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-white">
                                <Loader2 className="w-12 h-12 animate-spin text-emerald-500 mb-4" />
                                <p className="font-bold">Validando código...</p>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="flex flex-col items-center p-8 text-center">
                            <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-6 border border-white/10">
                              <QrCode className="w-12 h-12 text-emerald-500" />
                            </div>
                            <h4 className="text-white text-lg font-bold mb-2">Leitor de QR Code</h4>
                            <p className="text-zinc-500 text-sm mb-8">Clique no botão abaixo para ativar a câmera e escanear o código.</p>
                            <button 
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCameraStarted(true);
                              }}
                              className="bg-emerald-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/40 flex items-center gap-3"
                            >
                              <Camera className="w-5 h-5" />
                              ATIVAR CÂMERA
                            </button>
                          </div>
                        )}
                        
                        <button 
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowManualInput(true);
                          }}
                          className="absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 bg-black/60 hover:bg-black/80 text-white rounded-xl flex items-center gap-2 transition-all border border-white/10 backdrop-blur-md text-sm font-bold"
                        >
                          <Keyboard className="w-4 h-4" />
                          Digitar Código
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}

                {qrPackage && (
                  <motion.div 
                    key="confirmation"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full max-w-sm"
                  >
                    <div className="bg-zinc-900 rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
                          {isDeliverySuccess ? (
                            <div className="p-12 flex flex-col items-center justify-center space-y-6 animate-in fade-in zoom-in duration-300">
                              <div className="w-24 h-24 bg-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center shadow-sm">
                                <CheckCircle className="w-14 h-14" />
                              </div>
                              <div className="text-center space-y-2">
                                <h3 className="text-2xl font-bold text-white">Entrega confirmada com sucesso</h3>
                                <p className="text-sm text-zinc-400">A baixa foi registrada com sucesso.</p>
                              </div>
                            </div>
                      ) : qrScanStatus === 'validating' ? (
                        <div className="p-12 flex flex-col items-center justify-center space-y-6">
                          <Loader2 className="w-12 h-12 animate-spin text-emerald-500" />
                          <div className="text-center space-y-2">
                            <h3 className="text-xl font-bold text-white">Salvando entrega...</h3>
                            <p className="text-sm text-zinc-400">Registrando baixa no sistema.</p>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="p-6 border-b border-white/5 bg-emerald-500/10">
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex items-center gap-3 text-emerald-500">
                                <CheckCircle className="w-6 h-6" />
                                <span className="font-bold uppercase tracking-wider text-xs">Encomenda Localizada</span>
                              </div>
                              <button 
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setQrPackage(null);
                                  setQrScanStatus('idle');
                                  setIsScanning(false);
                                  setDeliveryPhoto(null);
                                }}
                                className="p-1 hover:bg-white/10 rounded-lg text-zinc-400"
                              >
                                <X className="w-5 h-5" />
                              </button>
                            </div>
                            <h4 className="text-white text-2xl font-bold">{qrPackage.recipient_name}</h4>
                          </div>
                          
                          <div className="p-6 space-y-4">
                            <div className="flex items-center gap-4 text-zinc-400">
                              <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                                <Home className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">Unidade</p>
                                <p className="text-white font-medium">{formatPackageUnit(qrPackage)}</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-4 text-zinc-400">
                              <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                                <Truck className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">Transportadora</p>
                                <p className="text-white font-medium">{qrPackage.carrier}</p>
                              </div>
                            </div>

                            {deliveryPhoto && (
                              <div className="space-y-2">
                                <p className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">Foto da Retirada</p>
                                <div className="relative aspect-video bg-white/5 rounded-2xl overflow-hidden border border-white/10">
                                  <img src={deliveryPhoto} className="w-full h-full object-cover" />
                                </div>
                                <button 
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    fileInputRef.current?.click();
                                  }}
                                  className="text-xs text-emerald-500 font-bold hover:underline"
                                >
                                  Refazer foto
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="p-6 bg-white/5 flex flex-col gap-3">
                            {qrPackage.delivery_method !== 'qr_code' && !qrPackage.pickup_code ? (
                              <div className="space-y-4">
                                {!deliveryPhoto ? (
                                  <>
                                    <div className="bg-amber-500/10 p-4 rounded-2xl border border-amber-500/20 flex items-start gap-3">
                                      <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                                      <div>
                                        <p className="text-sm font-bold text-amber-500">Foto Obrigatória</p>
                                        <p className="text-xs text-amber-500/70">Esta encomenda não possui QR Code ou código. É necessário registrar uma foto para confirmar a retirada.</p>
                                      </div>
                                    </div>
                                    <button 
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        fileInputRef.current?.click();
                                      }}
                                      className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-900/20"
                                    >
                                      <Camera className="w-5 h-5" />
                                      TIRAR FOTO PARA ENTREGA
                                    </button>
                                  </>
                                ) : (
                                    <div className="flex flex-col gap-3">
                                      <button 
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          fileInputRef.current?.click();
                                        }}
                                        className="w-full py-4 bg-zinc-800 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all"
                                      >
                                        <Camera className="w-5 h-5" />
                                        Tirar outra foto
                                      </button>
                                      <p className="text-[10px] text-zinc-500 text-center uppercase font-bold tracking-widest">
                                        Salvamento automático ativado
                                      </p>
                                    </div>
                                )}
                              </div>
                            ) : (
                               <button 
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (qrPackage) {
                                    handleDeliver(qrPackage.package_id || qrPackage.id, retrievalMethod, undefined, qrPackage);
                                  }
                                }}
                                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-900/20"
                              >
                                <Check className="w-5 h-5" />
                                Confirmar Retirada
                              </button>
                            )}
                            
                            <button 
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                setQrPackage(null); 
                                setQrScanStatus('scanning'); 
                                startScanning(); 
                                setDeliveryPhoto(null);
                              }}
                              className="w-full py-4 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-bold transition-all"
                            >
                              Escanear outro
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* View QR Modal (For Testing) */}
      <AnimatePresence>
        {viewQrPackage && (
          <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-6 backdrop-blur-sm">
            <motion.div 
              {...anim({
                initial: { scale: 0.9, opacity: 0 },
                animate: { scale: 1, opacity: 1 },
                exit: { scale: 0.9, opacity: 0 }
              })}
              className="bg-white rounded-[2.5rem] max-w-sm w-full p-8 text-center shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-zinc-900">QR Code da Encomenda</h3>
                <button 
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setViewQrPackage(null);
                  }}
                  className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-zinc-400" />
                </button>
              </div>
              
              <p className="text-zinc-500 text-sm mb-6">Use este QR Code para testar o leitor de portaria.</p>
              
              <div className="bg-zinc-50 p-6 rounded-3xl border-2 border-dashed border-zinc-200 mb-6">
                <div className="bg-white p-4 rounded-2xl shadow-sm inline-block mb-4">
                  <QRCodeSVG 
                    value={JSON.stringify({
                      id: viewQrPackage.id,
                      code: viewQrPackage.pickup_code,
                      token: viewQrPackage.pickup_token
                    })} 
                    size={200} 
                  />
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Código de Retirada</span>
                  <span className="text-2xl font-black text-emerald-600 tracking-widest">{viewQrPackage.pickup_code}</span>
                </div>
              </div>

              <div className="text-left bg-zinc-50 p-4 rounded-xl mb-6">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Destinatário</p>
                <p className="text-sm font-bold text-zinc-900">{viewQrPackage.recipient_name}</p>
                <p className="text-xs text-zinc-500">{formatPackageUnit(viewQrPackage)}</p>
              </div>

              <button 
                className="w-full bg-zinc-900 text-white py-4 rounded-xl font-bold hover:bg-zinc-800 transition-all" 
                onClick={() => setViewQrPackage(null)}
              >
                Fechar
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
