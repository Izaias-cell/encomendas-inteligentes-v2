import React, { useEffect, useState, useRef } from 'react';
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
  Zap
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatDate, formatSafeDateTime } from '../lib/dateUtils';
import { getResidentAddressLines, formatPackageUnit } from '../lib/residentUtils';
import { ptBR } from 'date-fns/locale';

import toast from 'react-hot-toast';
import { logAction } from '../services/auditService';
import { Html5Qrcode } from 'html5-qrcode';
import { motion, AnimatePresence } from 'motion/react';
import { sendWhatsAppMessage, getWhatsAppLink } from '../services/whatsappService';
import { CondominiumSettings } from '../types';

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
  const [showRegister, setShowRegister] = useState(false);
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

  const fetchPendingNotices = async () => {
    if (!user?.condominium_id) return;
    
    try {
      // Migration: Set whatsapp_status to 'pendente' for all received packages that have null or 'pending' status
      // This ensures old received packages show up in the counter once, and then can be handled.
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
      
      setBatchPackages(data || []);
      setPendingNoticesCount(data?.length || 0);
    } catch (error) {
      console.error('Erro ao buscar avisos pendentes:', error);
    }
  };

  const getWhatsAppBadge = (status: string) => {
    const variants: any = {
      pending: 'text-amber-500',
      pendente: 'text-amber-500',
      sent: 'text-blue-500',
      enviado: 'text-blue-600',
      delivered: 'text-emerald-500',
      read: 'text-emerald-600',
      failed: 'text-red-500',
      error: 'text-red-500',
      no_recipient: 'text-zinc-400'
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

    return (
      <div className="flex items-center gap-1.5" title={`WhatsApp: ${labels[status] || status}`}>
        <MessageSquare className={`w-3.5 h-3.5 ${variants[status] || 'text-zinc-400'}`} />
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tight">
          {labels[status] || status}
        </span>
      </div>
    );
  };

  // QR Scanning State
  const [isScanning, setIsScanning] = useState(false);
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

  const anim = (props: any) => condoSettings?.light_mode_enabled ? {} : props;

  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

  useEffect(() => {
    fetchData();
    fetchPendingNotices();
  }, [user.condominium_id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'residents') {
      setActiveTab('residents');
    }
  }, [window.location.search]);

  useEffect(() => {
    if (isScanning && !qrPackage) {
      startScanning();
    } else {
      stopScanning();
    }
    return () => stopScanning();
  }, [isScanning, qrPackage]);

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
        
        if (resident?.telefone && pkg.whatsapp_message) {
          try {
            const result = await sendWhatsAppMessage(resident.telefone, pkg.whatsapp_message, user.condominium_id, {
              api_url: condoSettings.api_url,
              api_token: condoSettings.api_token,
              instance_id: condoSettings.instance_id,
              whatsapp_provider: condoSettings.whatsapp_provider
            });
            
            if (result.status_envio === 'sucesso') {
              const now = new Date().toISOString();
              const { error: updateError } = await supabase
                .from('packages')
                .update({ 
                  whatsapp_status: 'enviado', 
                  last_notification_at: now,
                  whatsapp_sent_at: now,
                  notification_mode: 'api'
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
            await logAction(
              user.id,
              user.condominium_id,
              'WHATSAPP_FALLBACK',
              'packages',
              pkg.id,
              { mode: 'api' },
              { mode: 'manual', error: error instanceof Error ? error.message : String(error) }
            );

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
      
      // Automatically confirm delivery after a short delay to show the found package
      setTimeout(() => {
        handleDeliver(data.package_id, scanMethod);
      }, 1500);
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
    unit_type: '',
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

  const handleSaveResident = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      
      const moradorData = {
        nome: residentForm.full_name,
        unidade: residentForm.unidade,
        unit_type: residentForm.unit_type,
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
      fetchData();
    } catch (error: any) {
      console.error('Erro ao salvar morador:', error);
      toast.error('Erro ao salvar morador: ' + error.message);
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

      await logAction(
        user.id,
        user.condominium_id,
        'DELETE_RESIDENT',
        'moradores',
        residentToDelete.id,
        residentToDelete,
        { ativo: false }
      );

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

      await logAction(
        user.id,
        user.condominium_id,
        newStatus ? 'ACTIVATE_RESIDENT' : 'DEACTIVATE_RESIDENT',
        'moradores',
        resident.id,
        resident,
        { ativo: newStatus }
      );

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
      
      const isLightMode = settingsData?.light_mode_enabled ?? true;
      setCondoSettings(settingsData);

      // Busca encomendas e moradores respeitando o modo leve
      let pkgQuery = supabase
        .from('packages')
        .select('*, package_id:id, recipient_name:recipient_name_raw, unit_label:unit_number')
        .eq('condominium_id', user.condominium_id)
        .order('received_at', { ascending: false });

      // No modo leve, limitamos a carga inicial de encomendas para melhorar performance
      if (isLightMode) {
        pkgQuery = pkgQuery.limit(100);
      }

      const [pkgResult, resResult] = await Promise.all([
        pkgQuery,
        supabase
          .from('moradores')
          .select('*')
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

      // Se o modo leve estiver ativado, comprimimos a imagem antes do upload
      if (condoSettings?.light_mode_enabled) {
        try {
          const { compressImage } = await import('../lib/imageUtils');
          finalBase64 = await compressImage(base64, 800, 0.6);
        } catch (err) {
          console.warn('Falha ao comprimir imagem, enviando original:', err);
        }
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
            handleDeliver(pkgId, 'foto', photoData);
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

  const handleDeliver = async (pkgId: string, method: 'manual' | 'qr_code' | 'photo' | 'foto' | 'code' | 'CÓDIGO' = 'manual', photoOverride?: string) => {
    if (!pkgId) {
      toast.error('ID da encomenda não encontrado');
      return;
    }

    try {
      setQrScanStatus('validating');
      
      // Obter o usuário logado
      const { data: authData } = await supabase.auth.getUser();
      const authUser = authData?.user;
      
      const photoToUse = photoOverride || deliveryPhoto;
      
      let finalPhotoUrl = null;
      let finalMethod = method;

      // Se houver foto, faz o upload primeiro
      if (photoToUse && photoToUse.startsWith('data:')) {
        try {
          finalPhotoUrl = await uploadDeliveryPhoto(photoToUse);
          finalMethod = 'foto';
        } catch (uploadErr: any) {
          console.error("Erro no upload da foto:", uploadErr);
          throw new Error(`Erro no upload da foto: ${uploadErr.message}`);
        }
      } else if (finalMethod === 'manual' && qrPackage?.pickup_code) {
        // Se for manual mas tiver código de retirada, salva como 'CÓDIGO'
        finalMethod = 'CÓDIGO';
      } else if (finalMethod === 'code') {
        finalMethod = 'CÓDIGO';
      }

      // Atualizar o status da encomenda no Supabase
      // Se houver pickup_token, damos baixa em TODAS as encomendas pendentes com esse token
      const isJointDelivery = !!(qrPackage?.isGroup || (qrPackage?.pickup_token && packages.filter(p => p.pickup_token === qrPackage.pickup_token && p.status === 'received').length > 1));
      
      const updateQuery = supabase
        .from('packages')
        .update({ 
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          delivery_method: finalMethod,
          ...(authUser?.id ? { delivered_by: authUser.id } : {}),
          pickup_qr_code: 'used',
          delivered_to_name: 'Morador (Confirmado)',
          ...(finalPhotoUrl ? { delivery_photo_url: finalPhotoUrl } : {}),
          ...(isJointDelivery ? { notes: 'Retirada conjunta com foto' } : {})
        });

      if (qrPackage?.pickup_token) {
        updateQuery.eq('pickup_token', qrPackage.pickup_token).eq('status', 'received');
      } else if (qrPackage?.pickup_code) {
        // Fallback para código se não houver token (legado)
        updateQuery.eq('pickup_code', qrPackage.pickup_code).eq('status', 'received').eq('recipient_id', qrPackage.recipient_id);
      } else {
        updateQuery.eq('id', pkgId);
      }

      const { error: updateError } = await updateQuery;

      if (updateError) {
        console.error("Erro no update do banco:", updateError);
        throw updateError;
      }
      
      // Log de auditoria
      try {
        await logAction(
          user.id,
          user.condominium_id,
          'DELIVER_PACKAGE',
          'packages',
          pkgId,
          { status: 'received', method, token: qrPackage?.pickup_token, joint: isJointDelivery },
          { status: 'delivered', method: finalMethod, note: isJointDelivery ? 'Retirada conjunta com foto' : undefined }
        );
      } catch (logErr) {
        console.warn("Erro ao registrar log de auditoria:", logErr);
      }

      // Sucesso!
      setIsDeliverySuccess(true);
      toast.success('Entrega confirmada com sucesso');
      
      // Atualiza o estado local para refletir a mudança na lista
      setPackages(prev => prev.map((p: any) => {
        const isMatchByToken = qrPackage?.pickup_token && p.pickup_token === qrPackage.pickup_token;
        const isMatchByCode = !qrPackage?.pickup_token && qrPackage?.pickup_code && p.pickup_code === qrPackage.pickup_code && p.recipient_id === qrPackage.recipient_id;
        const isMatchById = p.id === pkgId || p.package_id === pkgId;
        
        const isMatch = (isMatchByToken || isMatchByCode || isMatchById) && p.status === 'received';
        
        return isMatch
          ? { ...p, status: 'delivered', delivered_at: new Date().toISOString(), delivery_method: finalMethod } 
          : p;
      }));
      
      fetchPendingNotices();
      
      // Fecha o modal automaticamente após 2 segundos
      setTimeout(() => {
        setIsScanning(false);
        setQrPackage(null);
        setQrScanStatus('idle');
        setIsDeliverySuccess(false);
        setDeliveryPhoto(null);
        pendingPackageRef.current = null;
      }, 2000);

    } catch (error: any) {
      console.error('Erro detalhado ao entregar encomenda:', error);
      // Mostra o erro real para o usuário para diagnóstico
      toast.error(`Erro ao confirmar entrega: ${error.message || 'Erro desconhecido'}`);
      
      // Volta para o estado de sucesso (preview) para permitir tentar novamente
      setQrScanStatus('success');
      
      // Retorna false para indicar falha e evitar qualquer comportamento padrão
      return false;
    }
  };

  const pendingPackages = packages.filter(p => !p.delivered_at || p.status !== 'delivered');
  const deliveredPackages = packages.filter(p => p.delivered_at || p.status === 'delivered');

  const [selectedGroup, setSelectedGroup] = useState<any>(null);
  const [viewPhotoUrl, setViewPhotoUrl] = useState<string | null>(null);

  const getFilteredPackages = () => {
    let basePackages = packages;
    if (activeTab === 'pending') basePackages = pendingPackages;
    if (activeTab === 'delivered') basePackages = deliveredPackages;

    const filtered = basePackages.filter((p: any) => 
      p.recipient_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.unit_label?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.carrier?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.tracking_code?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Agrupamento para abas Pendentes e Retiradas
    if (activeTab === 'pending' || activeTab === 'delivered') {
      const groups: { [key: string]: any[] } = {};
      filtered.forEach(pkg => {
        // Agrupar por pickup_token (ou pickup_code como fallback)
        const key = pkg.pickup_token || pkg.pickup_code || pkg.id;
        if (!groups[key]) groups[key] = [];
        groups[key].push(pkg);
      });

      return Object.values(groups).map(group => {
        if (group.length === 1) return group[0];
        
        // Retorna um objeto "virtual" de grupo
        return {
          ...group[0],
          isGroup: true,
          packages: group,
          count: group.length
        };
      });
    }

    return filtered;
  };

  const filteredPackages = getFilteredPackages();

  const filteredResidents = residents.filter(r => 
    r.ativo && (
      r.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.unidade?.toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  return (
  <>
    {showRegister ? (
      <div>
        {/* TELA DE REGISTRAR ENCOMENDA */}
      </div>
    ) : (
      <div className="max-w-6xl mx-auto p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Painel da Portaria</h1>
          <p className="text-zinc-500">Gestão operacional de encomendas e moradores</p>
        </div>
        <div className="flex flex-wrap gap-3 w-full md:w-auto">
          <button
            onClick={() => {
              setRetrievalMethod('qr_code');
              setIsScanning(true);
            }}
            className="flex-1 md:flex-none bg-white text-zinc-900 px-6 py-4 rounded-2xl font-bold hover:bg-zinc-50 transition-all flex items-center justify-center gap-3 border border-zinc-200 shadow-sm"
          >
            <QrCode className="w-6 h-6 text-emerald-600" />
            Ler QR Code
          </button>
          <button
            onClick={() => navigate('/packages/new')}
            className="flex-1 md:flex-none bg-emerald-600 text-white px-6 py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-200"
          >
            <Plus className="w-6 h-6" />
            Registrar Encomenda
          </button>
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-zinc-100 rounded-2xl mb-8 w-fit overflow-x-auto max-w-full">
        <button 
          onClick={() => setActiveTab('pending')}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'pending' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <Clock className="w-5 h-5" />
          Pendentes ({pendingPackages.length})
        </button>
        <button 
          onClick={() => setActiveTab('delivered')}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'delivered' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <CheckCircle className="w-5 h-5" />
          Retiradas ({deliveredPackages.length})
        </button>
        <button 
          onClick={() => setActiveTab('all')}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'all' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <PackageIcon className="w-5 h-5" />
          Todas ({packages.length})
        </button>
        <button 
          onClick={() => setActiveTab('residents')}
          className={`px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'residents' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <Users className="w-5 h-5" />
          MORADORES ({residents.length})
        </button>
      </div>

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
            onClick={() => navigate('/profiles/new')}
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
              <div key={pkg.package_id} className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-6 hover:shadow-md transition-all group">
                <div className="flex justify-between items-start mb-4">
                  <div className="w-12 h-12 bg-zinc-50 text-emerald-600 rounded-2xl flex items-center justify-center group-hover:bg-emerald-100 transition-colors relative">
                    <PackageIcon className="w-6 h-6" />
                    {pkg.isGroup && (
                      <span className="absolute -top-2 -right-2 bg-emerald-600 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
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
                      <p className={`font-mono text-sm font-bold ${pkg.status === 'delivered' ? 'text-zinc-500' : 'text-emerald-600'}`}>
                        {pkg.pickup_code || '-'}
                      </p>
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
                    onClick={() => {
                      pendingPackageRef.current = pkg;
                      setQrPackage(pkg);
                      setRetrievalMethod('manual');
                      setIsScanning(true);
                      setQrScanStatus('validating');
                      
                      // Abre a câmera diretamente
                      fileInputRef.current?.click();
                    }}
                    disabled={pkg.status === 'delivered'}
                    className={`col-span-2 py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-3 text-base shadow-lg ${pkg.status === 'delivered' ? 'bg-zinc-50 text-zinc-400 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-900/20'}`}
                  >
                    <Camera className={`w-5 h-5 ${pkg.status === 'delivered' ? 'hidden' : ''}`} />
                    {pkg.status === 'delivered' ? 'Entregue' : (pkg.isGroup ? 'ENTREGAR TODAS' : 'ENTREGAR COM FOTO')}
                  </button>
                  {pkg.isGroup && (
                    <button 
                      onClick={() => setSelectedGroup(pkg)}
                      className="col-span-2 bg-zinc-50 text-zinc-500 py-3 rounded-xl font-bold hover:bg-zinc-100 transition-all flex items-center justify-center gap-2 text-sm"
                    >
                      <PackageIcon className="w-4 h-4" />
                      Ver itens do grupo
                    </button>
                  )}
                  <button 
                    onClick={() => {
                      setRetrievalMethod('qr_code');
                      setIsScanning(true);
                      setQrPackage(null);
                      setQrScanStatus('idle');
                    }}
                    className="col-span-2 bg-zinc-100 text-zinc-600 py-4 rounded-2xl font-bold hover:bg-zinc-900 hover:text-white transition-all flex items-center justify-center gap-3 text-base"
                  >
                    <QrCode className="w-5 h-5" />
                    Escanear QR Code
                  </button>
                </div>
              </div>
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
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <h2 className="text-3xl font-bold text-zinc-900">MORADORES ({residents.length})</h2>
          </div>

          {filteredResidents.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredResidents.map((resident) => (
                <div key={resident.id} className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-6 hover:shadow-md transition-all group relative">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-12 h-12 bg-zinc-50 text-emerald-600 rounded-2xl flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                      <User className="w-6 h-6" />
                    </div>
                    <div className="flex gap-2 items-center">
                      {!resident.ativo && (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700">
                          Inativo
                        </span>
                      )}
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700">
                        Morador
                      </span>
                      <div className="relative">
                        <button
                          onClick={() => setActiveResidentMenu(activeResidentMenu === resident.id ? null : resident.id)}
                          className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-all"
                          title="Ações"
                        >
                          <MoreVertical className="w-5 h-5" />
                        </button>

                        {activeResidentMenu === resident.id && (
                          <>
                            <div 
                              className="fixed inset-0 z-10" 
                              onClick={() => setActiveResidentMenu(null)}
                            />
                            <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-zinc-100 py-2 z-20 overflow-hidden animate-in fade-in zoom-in duration-200 origin-top-right">
                              <button
                                onClick={() => {
                                  handleEditResident(resident);
                                  setActiveResidentMenu(null);
                                }}
                                className="w-full px-4 py-3 text-left text-sm font-bold text-zinc-700 hover:bg-zinc-50 flex items-center gap-3 transition-colors"
                              >
                                <Edit className="w-4 h-4 text-emerald-600" />
                                Editar Morador
                              </button>

                              {(user.role === 'admin' || user.role === 'sindico') && (
                                <>
                                  <button
                                    onClick={() => toggleResidentStatus(resident)}
                                    className={`w-full px-4 py-3 text-left text-sm font-bold flex items-center gap-3 transition-colors ${resident.ativo ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`}
                                  >
                                    <Power className="w-4 h-4" />
                                    {resident.ativo ? 'Desativar Morador' : 'Ativar Morador'}
                                  </button>

                                  <div className="h-px bg-zinc-100 my-1" />

                                  <button
                                    onClick={() => {
                                      handleDeleteResident(resident);
                                      setActiveResidentMenu(null);
                                    }}
                                    className="w-full px-4 py-3 text-left text-sm font-bold text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    Excluir Morador
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <h3 className="text-xl font-bold text-zinc-900 mb-4">{resident.nome}</h3>
                  
                  <div className="space-y-3">
                    <div className="flex flex-col gap-1 text-zinc-500 text-sm">
                      {getResidentAddressLines(resident).map((line, idx) => (
                        <div key={idx} className="flex items-center gap-3">
                          {idx === 0 ? <Home className="w-4 h-4 flex-shrink-0 text-emerald-600" /> : 
                           idx === 1 ? <Building2 className="w-4 h-4 flex-shrink-0 text-emerald-600" /> :
                           <Building2 className="w-4 h-4 flex-shrink-0 text-emerald-600 opacity-0" />}
                          <p className="font-medium text-zinc-700">{line}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 text-zinc-500 text-sm">
                      <Smartphone className="w-4 h-4 flex-shrink-0 text-emerald-600" />
                      <p><span className="font-bold text-zinc-700">Contato:</span> {resident.telefone || 'Não informado'}</p>
                    </div>
                  </div>
                </div>
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
                  {retrievalMethod === 'manual' ? 'Confirmação de Entrega' : 'Escanear QR Code'}
                </h3>
                <p className="text-zinc-400 text-xs">
                  {retrievalMethod === 'manual' ? 'Registre uma foto para confirmar a retirada' : 'Aponte a câmera para o código da encomenda'}
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
                    <div className="relative w-full aspect-square bg-zinc-900 rounded-3xl overflow-hidden shadow-2xl border border-white/10">
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
                    </div>

                    <div className="mt-8 w-full space-y-4">
                      {!showManualInput ? (
                        <button 
                          onClick={() => setShowManualInput(true)}
                          className="w-full py-4 bg-white/5 hover:bg-white/10 text-white rounded-2xl flex items-center justify-center gap-2 transition-all border border-white/10"
                        >
                          <Keyboard className="w-5 h-5" />
                          Digitar código manualmente
                        </button>
                      ) : (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-zinc-900 p-4 rounded-2xl border border-white/10 w-full"
                        >
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Código da Encomenda</label>
                          <div className="flex gap-2">
                            <input 
                              value={manualToken}
                              onChange={(e) => setManualToken(e.target.value)}
                              placeholder="Ex: abc123xyz"
                              className="flex-1 bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 text-white outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                            <button 
                              onClick={handleManualToken}
                              disabled={!manualToken.trim() || loading}
                              className="bg-emerald-600 text-white p-3 rounded-xl disabled:opacity-50"
                            >
                              <Check className="w-6 h-6" />
                            </button>
                          </div>
                          <button 
                            onClick={() => setShowManualInput(false)}
                            className="mt-3 text-zinc-500 text-xs hover:text-white"
                          >
                            Voltar para câmera
                          </button>
                        </motion.div>
                      )}
                    </div>
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
                                  handleDeliver(qrPackage.package_id, retrievalMethod);
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
                <button onClick={() => setViewQrPackage(null)} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
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
