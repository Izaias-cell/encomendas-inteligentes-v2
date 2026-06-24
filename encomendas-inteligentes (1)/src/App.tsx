import React, { useState, useRef, useEffect } from 'react';
import { Camera, Package, User, LayoutDashboard, LogOut, Bell, CheckCircle, Search, Loader2, Plus, Phone, Home, History, QrCode, X, RefreshCw, AlertTriangle, Check, ArrowLeft, Keyboard, XCircle, Users, UserPlus, Edit2, Shield } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';
import { supabase } from './lib/supabase';
import { ptBR } from 'date-fns/locale';
import { formatDate, formatSafeDateTime } from './lib/dateUtils';
import { formatPackageUnit } from './lib/residentUtils';
import { motion, AnimatePresence } from 'motion/react';

import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';

import { Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom';
import ResidentPortal from './components/ResidentPortal';
import Retirada from './pages/Retirada';
import { analyzePackageLabel } from './services/geminiService';
import { findMatchingResidents } from './services/residentMatcher';

// --- Pages ---
import Dashboard from './pages/Dashboard';
import CondominiumList from './pages/CondominiumList';
import CondominiumNew from './pages/CondominiumNew';
import SelectCondominium from './pages/SelectCondominium';
import ProfileList from './pages/ProfileList';
import ProfileNew from './pages/ProfileNew';
import UserManagement from './pages/UserManagement';
import PackageList from './pages/PackageList';
import PackageNew from './pages/PackageNew';
import Portaria from './pages/Portaria';
import Settings from './pages/Settings';
import ChangePassword from './pages/ChangePassword';

// --- Types ---
import { Role, Profile, Package as PackageType, ScoredResident } from './types';
import SyndicPanel from './components/SyndicPanel';



import { normalizeRole } from './lib/authUtils';
import { getCurrentPorter } from './lib/porterUtils';

// --- Components ---

const Button = ({ children, onClick, variant = 'primary', loading = false, className = '', disabled = false, ...props }: any) => {
  const variants: any = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-700',
    secondary: 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200',
    outline: 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50',
    danger: 'bg-red-500 text-white hover:bg-red-600',
    ghost: 'text-zinc-500 hover:bg-zinc-100'
  };

  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`px-4 py-2 rounded-xl font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
};

const Card = ({ children, className = '' }: any) => (
  <div className={`bg-white rounded-2xl border border-zinc-100 shadow-sm p-6 ${className}`}>
    {children}
  </div>
);

const Badge = ({ children, variant = 'gray' }: any) => {
  const variants: any = {
    gray: 'bg-zinc-100 text-zinc-600',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700'
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${variants[variant]}`}>
      {children}
    </span>
  );
};

const Modal = ({ isOpen, onClose, title, children }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-6 border-b border-zinc-100">
          <h3 className="text-xl font-bold text-zinc-900">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors">
            <XCircle className="w-6 h-6 text-zinc-400" />
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
};

// --- Pages ---

const LoginPage = ({ onLogin }: any) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      if (!email || !password || (isSignup && !fullName)) {
        throw new Error("Preencha todos os campos");
      }

      if (isSignup) {
        const { data: signupData, error: signupError } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            data: {
              full_name: fullName
            }
          }
        });
        if (signupError) throw signupError;
        if (!signupData.user) throw new Error("Erro ao criar conta");

        // Create initial profile via backend API to bypass RLS
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Sessão não iniciada após signup');

        const profileResponse = await fetch('/api/auth/create-profile', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            fullName,
            role: 'admin' // First user is admin by default in this flow
          })
        });

        const profileResult = await profileResponse.json();
        if (!profileResponse.ok) throw new Error(profileResult.error || 'Erro ao criar perfil');
        
        if (profileResult.profile.active === false) {
          await supabase.auth.signOut();
          throw new Error("Sua conta está inativa. Entre em contato com o administrador.");
        }

        onLogin(profileResult.profile);
        toast.success("Conta criada com sucesso!");
      } else {
        const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
        
        if (authError) {
          if (authError.message === 'Invalid login credentials') {
            throw new Error("E-mail ou senha incorretos");
          }
          throw authError;
        }

        if (!data.user) throw new Error("Usuário não encontrado");

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .maybeSingle();
        
        if (profileError) throw profileError;

        if (!profile) {
          // If user exists in Auth but not in Profiles, allow them to create a profile
          // For now, we'll just throw an error as per original logic, 
          // but in a real app we'd redirect to profile creation.
          throw new Error("Sua conta não possui um perfil vinculado.");
        }

        if (profile.active === false) {
          await supabase.auth.signOut();
          throw new Error("Sua conta está inativa. Entre em contato com o administrador.");
        }
        
        const role = normalizeRole(profile.role);
        console.log("ROLE USUÁRIO:", role);

        onLogin(profile);
        toast.success(`Bem-vindo, ${profile.full_name.split(' ')[0]}!`);

        // Redirecionamento imediato após login
        if (role === 'porteiro') {
          navigate('/portaria');
        } else if (role === 'sindico') {
          navigate('/dashboard');
        } else if (role === 'admin') {
          navigate('/dashboard');
        }
      }
    } catch (err: any) {
      const message = err.message || "Erro na autenticação";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  // Mock login for demo if no supabase keys or for quick preview
  const mockLogin = (role: Role) => {
    onLogin({
      id: '00000000-0000-0000-0000-000000000001',
      full_name: role === 'porteiro' ? 'Porteiro Silva' : role === 'sindico' ? 'Síndico Oliveira' : 'Administrador',
      email: role === 'porteiro' ? 'porteiro@demo.com' : role === 'sindico' ? 'sindico@demo.com' : 'admin@demo.com',
      role,
      condominium_id: '00000000-0000-0000-0000-000000000000',
      unit_number: '402'
    });
    
    if (role === 'porteiro') {
      navigate('/portaria');
    } else if (role === 'sindico') {
      navigate('/sindico');
    } else {
      navigate('/dashboard');
    }
  };

  const isSupabaseConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-4">
      <Card className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Package className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900">Encomendas Inteligentes</h1>
          <p className="text-zinc-500">Gestão inteligente de encomendas para condomínios</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
            <Bell className="w-4 h-4 shrink-0" />
            <div className="flex-1">
              <span className="font-bold block mb-0.5">{error}</span>
              {error.includes("fetch") && (
                <span className="text-[11px] opacity-90 block mt-1">
                  Dica: Esse erro geralmente ocorre por falta de chaves Supabase conectadas. Use um dos botões abaixo para acessar em Modo Demo imediatamente!
                </span>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          {isSignup && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Nome Completo</label>
              <input 
                type="text" 
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" 
                placeholder="Seu nome completo" 
                required={isSignup}
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">E-mail</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" 
              placeholder="seu@email.com" 
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Senha</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all" 
              placeholder="••••••••" 
              required
            />
          </div>
          <Button type="submit" className="w-full py-3" loading={loading}>
            {loading ? (isSignup ? 'Criando conta...' : 'Entrando...') : (isSignup ? 'Criar Conta' : 'Entrar')}
          </Button>
          
          <div className="text-center">
            <button 
              type="button"
              onClick={() => setIsSignup(!isSignup)}
              className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
            >
              {isSignup ? 'Já tem uma conta? Entre aqui' : 'Não tem uma conta? Cadastre-se'}
            </button>
          </div>
        </form>


      </Card>
    </div>
  );
};

const PorteiroDashboard = ({ user }: { user: Profile }) => {
  const [step, setStep] = useState<'list' | 'camera' | 'confirm' | 'qr_scan' | 'residents'>('list');
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [residents, setResidents] = useState<Profile[]>([]);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [analyzedData, setAnalyzedData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [qrPackage, setQrPackage] = useState<PackageType | null>(null);
  const [qrScanStatus, setQrScanStatus] = useState<'idle' | 'scanning' | 'validating' | 'success' | 'error'>('idle');
  const [manualToken, setManualToken] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [recentRetrievals, setRecentRetrievals] = useState<PackageType[]>([]);
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [notes, setNotes] = useState('');
  const [showNotesOptions, setShowNotesOptions] = useState(false);
  const [showAdvancedUnit, setShowAdvancedUnit] = useState(false);
  const [matchingResidents, setMatchingResidents] = useState<ScoredResident[]>([]);
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(null);
  const [isResidentModalOpen, setIsResidentModalOpen] = useState(false);
  const [deliveryPhoto, setDeliveryPhoto] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [residentFormData, setResidentFormData] = useState({
    full_name: '',
    unit_number: '',
    unit_type: '',
    block: '',
    tower: '',
    complement: '',
    phone: '',
    role: 'resident' as const,
    active: true
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const qrScannerRef = useRef<Html5Qrcode | null>(null);
  const isTransitioningRef = useRef(false);
  const stepRef = useRef(step);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const safeStopScanner = async () => {
    if (isTransitioningRef.current) {
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
          // ignore
        }
        qrScannerRef.current = null;
      } catch (err) {
        console.error("Failed to stop scanner", err);
      } finally {
        isTransitioningRef.current = false;
      }
    }
  };

  useEffect(() => {
    fetchPackages();
    fetchRecentRetrievals();
    checkSystemStatus();
    fetchResidents();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setDeliveryPhoto(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const fetchResidents = async () => {
    let query = supabase
      .from('profiles')
      .select('*')
      .eq('condominium_id', user.condominium_id)
      .eq('role', 'resident');
    
    // Porteiro only sees active residents
    if (user.role === 'porteiro') {
      query = query.eq('active', true);
    }
    
    const { data } = await query.order('full_name');
    if (data) setResidents(data);
  };

  const UNIT_SYNONYMS: Record<string, string> = {
    'APTO': 'AP',
    'APARTAMENTO': 'AP',
    'CS': 'CASA',
    'BL': 'BLOCO',
    'TR': 'TORRE'
  };

  const standardizeUnitText = (text: string) => {
    if (!text) return '';
    
    let normalized = text.toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
      .replace(/[^A-Z0-9\s]/g, ' '); // Replace special chars with space

    // Insert spaces before/after keywords if joined
    const keywords = ['LOTE', 'CASA', 'AP', 'BLOCO', 'TORRE', 'APTO', 'APARTAMENTO'];
    keywords.forEach(kw => {
      // Keyword preceded by something that isn't a space
      const regex1 = new RegExp(`([^\\s])(${kw})`, 'gi');
      normalized = normalized.replace(regex1, '$1 $2');
      // Keyword followed by something that isn't a space or digit
      const regex2 = new RegExp(`(${kw})([^\\s\\d])`, 'gi');
      normalized = normalized.replace(regex2, '$1 $2');
    });

    normalized = normalized
      .replace(/([A-Z])(\d)/g, '$1 $2') // Separate letters from numbers: LOTE4 -> LOTE 4
      .replace(/(\d)([A-Z])/g, '$1 $2') // Separate numbers from letters: 101A -> 101 A
      .replace(/\s+/g, ' ') // Remove duplicate spaces
      .trim();

    // Replace synonyms
    Object.entries(UNIT_SYNONYMS).forEach(([syn, std]) => {
      const regex = new RegExp(`\\b${syn}\\b`, 'g');
      normalized = normalized.replace(regex, std);
    });

    return normalized;
  };

  const normalizeUnit = (unit: string) => {
    if (!unit) return '';
    return unit.toLowerCase()
      .replace(/\s+/g, '')
      .replace(/apartamento|apto|ap/g, 'ap')
      .replace(/casa|cs/g, 'casa')
      .replace(/lote/g, 'lote')
      .replace(/bloco|bl/g, 'bloco')
      .replace(/torre|tr/g, 'torre')
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  };

  const normalizeName = (name: string) => {
    if (!name) return '';
    return name.toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
      .replace(/[^A-Z\s]/g, ' ') // Remove non-letters
      .replace(/\s+/g, ' ') // Single spaces
      .trim();
  };

  const getLevenshteinDistance = (a: string, b: string): number => {
    const matrix = Array.from({ length: a.length + 1 }, () =>
      Array.from({ length: b.length + 1 }, () => 0)
    );

    for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[a.length][b.length];
  };

  const findMatchingResidentsInternal = async (unit_number: string, name: string, details?: any) => {
    if (!unit_number && !name && !details) {
      setMatchingResidents([]);
      setSelectedResidentId(null);
      return;
    }

    const matches = await findMatchingResidents(user.condominium_id, unit_number, name, details);
    
    if (matches.length > 0) {
      setMatchingResidents(matches);
      
      // Auto-select ONLY if high confidence (score >= 180)
      if (matches[0].score >= 180) {
        setSelectedResidentId(matches[0].resident.id);
      } else {
        setSelectedResidentId(null);
      }
    } else {
      setMatchingResidents([]);
      setSelectedResidentId(null);
    }
  };

  useEffect(() => {
    if (step === 'confirm' && (analyzedData?.unitNumber || analyzedData?.unitDetails)) {
      findMatchingResidentsInternal(analyzedData.unitNumber, analyzedData.recipientName, analyzedData.unitDetails);
    }
  }, [step, analyzedData?.unitNumber, analyzedData?.recipientName, analyzedData?.unitDetails]);

  const checkSystemStatus = async () => {
    try {
      const response = await fetch('/api/system-status');
      const data = await response.json();
      setSystemStatus(data);
    } catch (err) {
      console.warn("Erro ao verificar status do sistema:", err);
    }
  };

  const handleSaveResident = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const finalData = { ...residentFormData };
      if (!finalData.unit_number) {
        const parts = [];
        if (finalData.block) parts.push(`BLOCO-${finalData.block}`);
        if (finalData.tower) parts.push(`TORRE-${finalData.tower}`);
        if (finalData.unit_type) parts.push(finalData.unit_type.toUpperCase());
        finalData.unit_number = parts.join('-').toUpperCase();
      }

      if (editingResidentId) {
        const { error } = await supabase
          .from('profiles')
          .update(finalData)
          .eq('id', editingResidentId);
        if (error) throw error;
        toast.success("Morador atualizado!");
      } else {
        const { error } = await supabase
          .from('profiles')
          .insert([{ 
            ...finalData, 
            condominium_id: user.condominium_id 
          }]);
        if (error) throw error;
        toast.success("Morador cadastrado com sucesso!");
      }
      fetchResidents();
      setIsResidentModalOpen(false);
      setEditingResidentId(null); 
      setResidentFormData({ 
        full_name: '', 
        unit_number: '', 
        unit_type: '',
        block: '',
        tower: '',
        complement: '',
        phone: '', 
        role: 'resident',
        active: true
      });
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setLoading(false);
    }
  };

  const [editingResidentId, setEditingResidentId] = useState<string | null>(null);

  // Auto-generate unit from structured fields
  useEffect(() => {
    const { unit_type, block, tower, complement } = residentFormData;
    
    // Only generate if at least one detail is present to avoid overwriting legacy data unnecessarily
    if (unit_type || block || tower || complement) {
      const parts = [];
      if (block) parts.push(`BLOCO-${block.trim().toUpperCase()}`);
      if (tower) parts.push(`TORRE-${tower.trim().toUpperCase()}`);
      
      if (unit_type) {
        parts.push(unit_type.trim().toUpperCase());
      }
      
      if (complement) parts.push(complement.trim().toUpperCase());
      
      const generated = parts.join('-').replace(/-+/g, '-');
      
      if (generated !== residentFormData.unit_number) {
        setResidentFormData(prev => ({ ...prev, unit_number: generated }));
      }
    }
  }, [
    residentFormData.unit_type, 
    residentFormData.block, 
    residentFormData.tower, 
    residentFormData.complement
  ]);

  useEffect(() => {
    if (step === 'qr_scan') {
      const startScanner = async () => {
        if (isTransitioningRef.current || stepRef.current !== 'qr_scan') return;
        try {
          isTransitioningRef.current = true;
          const html5QrCode = new Html5Qrcode("qr-reader");
          const config = { fps: 10, qrbox: { width: 250, height: 250 } };

          await html5QrCode.start(
            { facingMode: "environment" }, 
            config, 
            onScanSuccess,
            () => {} // Empty error callback
          );
          
          if (stepRef.current !== 'qr_scan') {
            try {
              if (html5QrCode.isScanning) {
                await html5QrCode.stop();
              }
              html5QrCode.clear();
            } catch (e) {
              // ignore
            }
            return;
          }
          
          qrScannerRef.current = html5QrCode;
        } catch (err) {
          console.error("Failed to start scanner", err);
          toast.error("Erro ao iniciar câmera");
        } finally {
          isTransitioningRef.current = false;
        }
      };

      startScanner();

      return () => {
        safeStopScanner();
      };
    }
  }, [step]);

  const onScanSuccess = async (decodedText: string) => {
    if (loading || qrScanStatus === 'validating') return;
    setQrScanStatus('validating');
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('packages')
        .select('*, package_id:id, unit_label:unit_number')
        .eq('condominium_id', user.condominium_id)
        .or(`pickup_token.eq.${decodedText},pickup_code.eq.${decodedText},id.eq.${decodedText}`)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setQrScanStatus('error');
        toast.error("QR Code inválido ou de outro condomínio");
        return;
      }

      if (data.status === 'delivered') {
        setQrScanStatus('error');
        toast.error("Esta encomenda já foi retirada");
        return;
      }

      if (data.pickup_qr_code === 'used') {
        setQrScanStatus('error');
        toast.error("Este QR Code já foi utilizado");
        return;
      }

      setQrPackage(data);
      setQrScanStatus('success');
      
      await safeStopScanner();
      
      // Automatically confirm delivery after a short delay to show the found package
      setTimeout(() => {
        confirmQrRetrieved();
      }, 1500);
    } catch (err) {
      setQrScanStatus('error');
      toast.error("Erro ao validar QR Code");
    } finally {
      setLoading(false);
    }
  };

  const handleManualToken = async () => {
    if (!manualToken.trim()) return;
    onScanSuccess(manualToken.trim());
  };

  const fetchRecentRetrievals = async () => {
    const { data } = await supabase
      .from('packages')
      .select('*')
      .eq('condominium_id', user.condominium_id)
      .eq('status', 'delivered')
      .order('delivered_at', { ascending: false })
      .limit(5);
    if (data) setRecentRetrievals(data);
  };

  const onScanFailure = (error: any) => {
    // Silently ignore scan failures
  };

  const confirmQrRetrieved = async () => {
    if (!qrPackage) return;
    setLoading(true);
    try {
      // Obter o usuário logado para capturar o ID se disponível (opcional)
      const { data: { user: authUser } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('packages')
        .update({ 
          status: 'delivered', 
          delivered_at: new Date().toISOString(),
          delivered_by: authUser?.id || user.id,
          entregue_por: (getCurrentPorter() && getCurrentPorter() !== 'Selecione o Porteiro') ? getCurrentPorter() : user.full_name,
          pickup_qr_code: 'used',
          delivered_to_name: 'Morador (Confirmado)',
          ...(deliveryPhoto ? { delivery_photo_url: deliveryPhoto } : {})
        })
        .eq('id', qrPackage.id);

      if (error) throw error;

      // Log retrieval
      await supabase.from('retrieval_logs').insert([{
        package_id: qrPackage.id,
        porter_id: user.id,
        condominium_id: user.condominium_id,
        delivery_method: 'qr_code',
        token_used: qrPackage.pickup_token,
        status: 'success'
      }]);

      toast.success("Retirada confirmada com sucesso!");
      setQrScanStatus('success');
      setTimeout(() => {
        setStep('list');
        setQrPackage(null);
        setQrScanStatus('idle');
        setDeliveryPhoto(null);
        fetchPackages();
        fetchRecentRetrievals();
      }, 2000);
    } catch (err) {
      toast.error("Erro ao confirmar retirada");
    } finally {
      setLoading(false);
    }
  };

  const fetchPackages = async () => {
    if (!user?.condominium_id) return;
    const { data, error } = await supabase
      .from('packages')
      .select('*, registrar:received_by(full_name), package_id:id, unit_label:unit_number')
      .eq('condominium_id', user.condominium_id)
      .order('created_at', { ascending: false });
    
    if (data) setPackages(data);
  };

  const startCamera = async () => {
    // Pré-carrega o stream antes de mudar o passo para evitar tela preta
    try {
      let stream: MediaStream;
      
      try {
        // Tenta primeiro modo environment (traseira)
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          } 
        });
      } catch (err) {
        // Fallback para qualquer câmera
        console.warn("Retrying with any camera...");
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: true 
        });
      }

      setStep('camera');
      // Pequeno delay para garantir que o elemento video está montado
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 100);
    } catch (err) {
      console.error("Erro ao acessar câmera:", err);
      toast.error("Não foi possível acessar a câmera. Ative as permissões ou se estiver no chat, clique para abrir o app em uma nova aba!");
    }
  };

  const capture = async () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (!context) return;

      // Otimização: Redimensionar imagem para OCR (max 1100px)
      const maxDim = 1100;
      let width = videoRef.current.videoWidth;
      let height = videoRef.current.videoHeight;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = (maxDim / width) * height;
          width = maxDim;
        } else {
          width = (maxDim / height) * width;
          height = maxDim;
        }
      }

      canvasRef.current.width = width;
      canvasRef.current.height = height;
      
      // Feedback visual imediato
      setLoading(true);
      setLoadingMessage("Capturando...");

      context.drawImage(videoRef.current, 0, 0, width, height);
      
      // Comprimir mais a imagem para envio rápido (qualidade 0.7)
      const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.7);
      setCapturedImage(dataUrl);
      
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      
      analyze(dataUrl);
    }
  };

  const analyze = async (image: string) => {
    setLoading(true);
    setLoadingMessage("Identificando morador...");
    try {
      // Otimização: analyzePackageLabel já foi importado no topo
      const data = await analyzePackageLabel(image);
      
      if (!data) {
        throw new Error("Não foi possível extrair dados da imagem");
      }

      setLoadingMessage("Processando dados...");
      
      // Se a confiança for muito baixa na unidade, deixa vazio para preenchimento manual
      let unitNumber = (data.unitDetails?.confidence > 0.8) ? standardizeUnitText(data.unitDetails.full_string) : '';
      
      // Geração automática se o campo principal falhar mas houver detalhes estruturados
      if (!unitNumber && data.unitDetails?.confidence > 0.6) {
        const parts = [];
        if (data.unitDetails.block) parts.push(`BLOCO-${data.unitDetails.block}`);
        if (data.unitDetails.tower) parts.push(`TORRE-${data.unitDetails.tower}`);
        if (data.unitDetails.type) parts.push(data.unitDetails.type.toUpperCase());
        if (data.unitDetails.number) parts.push(data.unitDetails.number);
        unitNumber = standardizeUnitText(parts.join(' '));
      }

      const processedData = {
        recipientName: data.recipientName?.value || '',
        recipientNameConfidence: data.recipientName?.confidence || 0,
        unitNumber: unitNumber,
        unitDetails: data.unitDetails || null,
        carrier: data.carrier?.value || '',
        carrierConfidence: data.carrier?.confidence || 0,
        trackingNumber: data.trackingNumber?.value || '',
        trackingNumberConfidence: data.trackingNumber?.confidence || 0,
        street: data.street?.value || '',
        streetConfidence: data.street?.confidence || 0
      };
      
      setAnalyzedData(processedData);
      setStep('confirm');
    } catch (err) {
      toast.error("Erro ao analisar etiqueta");
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  const savePackage = async () => {
    setLoading(true);
    try {
      let photoUrl = null;

      // 1. Upload da foto
      if (capturedImage) {
        try {
          // Converter base64 para Blob de forma robusta
          const res = await fetch(capturedImage);
          const blob = await res.blob();
          
          // Nome de arquivo único para evitar colisões
          const fileName = `package_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('packages')
            .upload(fileName, blob, {
              contentType: 'image/jpeg',
              cacheControl: '3600',
              upsert: false
            });
          
          if (uploadError) {
            console.error("Erro no upload Supabase:", uploadError);
            // Não interrompe o fluxo se o storage falhar, apenas loga
          } else {
            const { data: { publicUrl } } = supabase.storage.from('packages').getPublicUrl(fileName);
            photoUrl = publicUrl;
          }
        } catch (storageErr: any) {
          console.warn("Storage não configurado ou erro no upload:", storageErr);
          // Não interrompe o fluxo principal se a foto falhar
        }
      }

      // 2. Salvar no Supabase (Sempre persiste primeiro)
      const qrToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      
      // Obter o usuário logado para capturar o ID se disponível (opcional)
      const { data: { user: authUser } } = await supabase.auth.getUser();

      const { data: pkg, error } = await supabase
        .from('packages')
        .insert([{
          condominium_id: user.condominium_id,
          unit_number: analyzedData?.unitNumber || '',
          unit_type: analyzedData?.unitDetails?.type || null,
          block: analyzedData?.unitDetails?.block || null,
          tower: analyzedData?.unitDetails?.tower || null,
          complement: analyzedData?.unitDetails?.complement || null,
          carrier: analyzedData?.carrier || '',
          tracking_code: analyzedData?.trackingNumber || '',
          photo_url: photoUrl,
          status: 'received',
          whatsapp_notified: true,
          whatsapp_sent: true,
          notified_at: new Date().toISOString(),
          received_by: user.id,
          recebido_por: (getCurrentPorter() && getCurrentPorter() !== 'Selecione o Porteiro') ? getCurrentPorter() : user.full_name,
          porter_name: (getCurrentPorter() && getCurrentPorter() !== 'Selecione o Porteiro') ? getCurrentPorter() : user.full_name,
          ...(authUser?.id ? { registered_by: authUser.id } : {}),
          notes: notes || null,
          pickup_token: qrToken,
          pickup_qr_code: 'active',
          qr_code_generated_at: new Date().toISOString(),
          whatsapp_status: 'pending'
        }])
        .select()
        .single();

      if (error) throw error;

      // 3. Notificar via WhatsApp
      let whatsappNotConfigured = false;
      
      // Busca o perfil do morador selecionado ou tenta encontrar um se não houver seleção
      let targetResident = matchingResidents.find(r => r.resident.id === selectedResidentId)?.resident;
      
      if (!targetResident && matchingResidents.length === 1) {
        targetResident = matchingResidents[0].resident;
      }

      if (targetResident?.phone) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const response = await fetch('/api/notify-resident', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token}`
            },
            body: JSON.stringify({
              phone: targetResident.phone, 
              residentName: targetResident.full_name,
              unitNumber: analyzedData.unitNumber,
              carrier: analyzedData.carrier,
              trackingNumber: analyzedData.trackingNumber,
              packageId: pkg.id,
              condominiumId: user.condominium_id
            })
          });
          
          const result = await response.json();
          if (result.notConfigured) {
            whatsappNotConfigured = true;
            // Atualiza status para indicar que falta configuração
            await supabase.from('packages').update({ 
              whatsapp_status: 'pending_configuration' 
            }).eq('id', pkg.id);
          }
        } catch (notifyErr) {
          console.warn("Erro ao notificar:", notifyErr);
        }
      } else {
        console.warn("Nenhum morador com telefone encontrado para notificação.");
        // Se não houver telefone, marca como falha de notificação (sem destinatário)
        await supabase.from('packages').update({ 
          whatsapp_status: 'no_recipient' 
        }).eq('id', pkg.id);
      }

      if (whatsappNotConfigured) {
        toast.success("Encomenda salva. WhatsApp ainda não configurado.");
      } else {
        toast.success("Encomenda registrada com sucesso!");
      }
      
      setStep('list');
      setNotes('');
      setShowNotesOptions(false);
      fetchPackages();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setLoading(false);
    }
  };

  const markAsDelivered = async (pkgId: string) => {
    const pkg = packages.find(p => p.id === pkgId);
    if (!pkg) return;

    // Obter o usuário logado para capturar o ID se disponível (opcional)
    const { data: { user: authUser } } = await supabase.auth.getUser();

    const { error } = await supabase
      .from('packages')
      .update({ 
        status: 'delivered', 
        delivered_at: new Date().toISOString(),
        delivered_by: authUser?.id || user.id,
        entregue_por: (getCurrentPorter() && getCurrentPorter() !== 'Selecione o Porteiro') ? getCurrentPorter() : user.full_name,
        delivered_to_name: 'Morador (Manual)'
      })
      .eq('id', pkgId);
    
    if (!error) {
      // Log retrieval
      await supabase.from('retrieval_logs').insert([{
        package_id: pkgId,
        porter_id: user.id,
        condominium_id: user.condominium_id,
        delivery_method: 'manual',
        status: 'success'
      }]);

      toast.success("Entrega confirmada!");
      fetchPackages();
    }
  };

  const resendNotification = async (pkg: PackageType) => {
    setLoading(true);
    try {
      const { data: residentProfile } = await supabase
        .from('profiles')
        .select('phone, full_name')
        .eq('unit_number', pkg.unit_number)
        .eq('condominium_id', user.condominium_id)
        .eq('role', 'resident')
        .maybeSingle();

      if (residentProfile?.phone) {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch('/api/notify-resident', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`
          },
          body: JSON.stringify({
            phone: residentProfile.phone, 
            residentName: residentProfile.full_name,
            unitNumber: pkg.unit_number,
            carrier: pkg.carrier,
            trackingNumber: pkg.tracking_code,
            packageId: pkg.id
          })
        });

        const result = await response.json();
        if (result.notConfigured) {
          toast.error("WhatsApp ainda não configurado.");
        } else {
          toast.success("Notificação reenviada!");
        }
        fetchPackages();
      } else {
        toast.error("Morador não encontrado");
      }
    } catch (err) {
      toast.error("Erro ao reenviar");
    } finally {
      setLoading(false);
    }
  };

  const filteredPackages = packages.filter((p: any) => 
    (p.moradores?.nome || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.unit_label?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {step === 'list' && (
        <>
          <div className="mb-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
                <LayoutDashboard className="w-6 h-6 text-emerald-600" />
                Painel da Portaria
              </h2>
              
              {systemStatus && (
                <div className="flex items-center gap-3 bg-white p-2 px-3 rounded-2xl border border-zinc-100 shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${systemStatus.whatsapp.configured ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">WhatsApp</span>
                  </div>
                  <div className="w-px h-4 bg-zinc-100" />
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${systemStatus.supabase.serviceRole ? 'bg-emerald-500' : 'bg-zinc-300'}`} />
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Segurança</span>
                  </div>
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <button 
                onClick={startCamera} 
                className="md:col-span-2 bg-emerald-600 text-white rounded-3xl p-6 flex items-center justify-center gap-4 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 active:scale-95"
              >
                <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                  <Camera className="w-6 h-6" />
                </div>
                <div className="text-left">
                  <p className="text-lg font-bold leading-tight">Registrar Encomenda</p>
                  <p className="text-emerald-100 text-xs">Abrir câmera e escanear</p>
                </div>
              </button>

              <button 
                onClick={() => setStep('qr_scan')} 
                className="md:col-span-2 bg-zinc-900 text-white rounded-3xl p-6 flex items-center justify-center gap-4 hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200 active:scale-95"
              >
                <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center">
                  <QrCode className="w-6 h-6" />
                </div>
                <div className="text-left">
                  <p className="text-lg font-bold leading-tight">Escanear QR Code</p>
                  <p className="text-zinc-400 text-xs">Retirada instantânea</p>
                </div>
              </button>

              <button 
                onClick={() => setStep('residents')} 
                className="md:col-span-2 bg-white text-zinc-900 border border-zinc-200 rounded-3xl p-6 flex items-center justify-center gap-4 hover:bg-zinc-50 transition-all shadow-sm active:scale-95"
              >
                <div className="w-12 h-12 bg-zinc-100 rounded-full flex items-center justify-center">
                  <Users className="w-6 h-6 text-zinc-600" />
                </div>
                <div className="text-left">
                  <p className="text-lg font-bold leading-tight">Moradores</p>
                  <p className="text-zinc-500 text-xs">Ver e cadastrar moradores</p>
                </div>
              </button>

              <Card className="bg-white p-4 flex flex-col justify-center">
                <p className="text-zinc-500 text-xs font-bold uppercase tracking-wider mb-1">Hoje</p>
                <p className="text-2xl font-bold text-zinc-900">
                  {packages.filter(p => {
                    if (!p.received_at) return false;
                    try {
                      return formatDate(p.received_at, 'yyyy-MM-dd') === formatDate(new Date(), 'yyyy-MM-dd');
                    } catch (e) {
                      return false;
                    }
                  }).length}
                </p>
              </Card>

              <Card className="bg-white p-4 flex flex-col justify-center">
                <p className="text-zinc-500 text-xs font-bold uppercase tracking-wider mb-1">Pendentes</p>
                <p className="text-2xl font-bold text-amber-600">{packages.filter(p => p.status !== 'delivered').length}</p>
              </Card>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-zinc-900">Histórico de Recebimento</h3>
              </div>
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white" 
                  placeholder="Buscar morador ou unidade..." 
                />
              </div>
            </div>

            {filteredPackages.length === 0 && (
              <div className="text-center py-12 text-zinc-400 bg-white rounded-2xl border border-dashed border-zinc-200">
                <Package className="w-12 h-12 mx-auto mb-2 opacity-20" />
                <p>Nenhuma encomenda registrada</p>
              </div>
            )}

            <div className="grid gap-3">
              {filteredPackages.map((pkg: any) => (
                <Card key={pkg.package_id} className="flex items-center justify-between p-4 hover:border-emerald-200 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${pkg.status === 'delivered' ? 'bg-zinc-100 text-zinc-400' : 'bg-emerald-50 text-emerald-600'}`}>
                      <Package className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-zinc-900 text-sm">{pkg.moradores?.nome || 'Morador'}</h4>
                        {pkg.status !== 'delivered' && (
                          <div className="flex items-center gap-1">
                            {pkg.whatsapp_status === 'sent' && <CheckCircle className="w-3 h-3 text-emerald-500" title="Enviado" />}
                            {pkg.whatsapp_status === 'failed' && <Bell className="w-3 h-3 text-red-500" title="Falha no envio" />}
                            {pkg.whatsapp_status === 'delivered' && <CheckCircle className="w-3 h-3 text-blue-500" title="Entregue" />}
                            {pkg.whatsapp_status === 'read' && <CheckCircle className="w-3 h-3 text-blue-700" title="Lido" />}
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500">
                        {formatPackageUnit(pkg)} • {pkg.carrier} {pkg.tracking_code && `• ${pkg.tracking_code}`}
                      </p>
                      {pkg.notes && (
                        <div className="mt-1 flex items-start gap-1.5">
                          <div className="w-1 h-1 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                          <p className="text-[10px] text-amber-700 italic leading-tight">{pkg.notes}</p>
                        </div>
                      )}
                      <p className="text-[10px] text-zinc-400 mt-1">
                        Registrado por: {pkg.recebido_por || pkg.porter_name || pkg.registrar?.full_name || 'Desconhecido'} • {formatSafeDateTime(pkg.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {pkg.status === 'delivered' ? (
                      <Badge variant="gray">Entregue</Badge>
                    ) : (
                      <>
                        {pkg.whatsapp_status === 'failed' && (
                          <Button variant="ghost" size="sm" className="text-xs text-red-600 p-1" onClick={() => resendNotification(pkg)}>
                            <Plus className="w-3 h-3 rotate-45" /> Reenviar
                          </Button>
                        )}
                        <Button variant="outline" size="sm" className="text-xs py-1 h-8" onClick={() => markAsDelivered(pkg.package_id)}>Entregar</Button>
                      </>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}

      {step === 'residents' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <button onClick={() => setStep('list')} className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 transition-colors">
              <ArrowLeft className="w-5 h-5" />
              Voltar ao Painel
            </button>
            <Button onClick={() => { 
              setEditingResidentId(null); 
              setResidentFormData({ 
                full_name: '', 
                unit_number: '', 
                unit_type: '',
                block: '',
                tower: '',
                complement: '',
                phone: '', 
                role: 'resident',
                active: true
              }); 
              setIsResidentModalOpen(true); 
            }}>
              <UserPlus className="w-4 h-4" />
              Novo Morador
            </Button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-2xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white" 
              placeholder="Buscar morador..." 
            />
          </div>

          <div className="grid gap-3">
            {residents.filter(r => r.full_name.toLowerCase().includes(searchTerm.toLowerCase()) || r.unit_number?.includes(searchTerm)).map(res => (
              <Card key={res.id} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-500">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-zinc-900 text-sm">{res.full_name}</h4>
                    <p className="text-xs text-zinc-500">Unidade {res.unit_number} • {res.phone}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { 
                  setEditingResidentId(res.id); 
                  setResidentFormData({ 
                    full_name: res.full_name, 
                    unit_number: res.unit_number || '', 
                    unit_type: res.unit_type || '',
                    block: res.block || '',
                    tower: res.tower || '',
                    complement: res.complement || '',
                    phone: res.phone || '', 
                    role: 'resident',
                    active: res.active ?? true
                  }); 
                  setIsResidentModalOpen(true); 
                }}>
                  <Edit2 className="w-4 h-4" />
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}

      {step === 'qr_scan' && (
        <div className="fixed inset-0 bg-zinc-950 z-50 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="p-6 flex justify-between items-center bg-zinc-900/50 backdrop-blur-md border-b border-white/5">
            <div>
              <h3 className="text-white text-xl font-bold">Escanear QR Code</h3>
              <p className="text-zinc-400 text-xs">Aponte a câmera para o código do morador</p>
            </div>
            <button 
              type="button"
              onClick={async (e) => { 
                e.preventDefault();
                await safeStopScanner();
                setStep('list'); 
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
                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Código do Token</label>
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

              {qrPackage && qrScanStatus !== 'success' && (
                <motion.div 
                  key="confirmation"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="w-full max-w-sm"
                >
                  <Card className="p-8 text-center bg-white border-none shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-2 bg-emerald-500" />
                    
                    <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                      <CheckCircle className="w-10 h-10" />
                    </div>
                    
                    <h3 className="text-2xl font-bold text-zinc-900 mb-1">Encomenda Localizada!</h3>
                    <p className="text-zinc-500 text-sm mb-8">Confirme os dados antes de entregar.</p>

                    <div className="text-left space-y-4 mb-8">
                      <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Morador</p>
                        <p className="text-lg font-bold text-zinc-900">{qrPackage.moradores?.nome || 'Morador'}</p>
                        <p className="text-sm text-zinc-500">{formatPackageUnit(qrPackage)}</p>
                      </div>

                      <div className="mt-2 space-y-3">
                        <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Recebido em</p>
                          <p className="text-sm font-bold text-zinc-900">{formatSafeDateTime(qrPackage.created_at)}</p>
                        </div>
                      </div>

                      <div className="mt-2 space-y-2">
                        {qrPackage.tracking_code && (
                          <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                            <p className="text-[10px] font-bold text-zinc-400 tracking-widest uppercase mb-1">Código da etiqueta</p>
                            <p className="text-sm font-bold text-zinc-900">{qrPackage.tracking_code}</p>
                          </div>
                        )}
                        <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                          <p className="text-[10px] font-bold text-zinc-400 tracking-widest uppercase mb-1">Código de retirada</p>
                          <p className="text-sm font-bold text-zinc-900">{qrPackage.pickup_code || 'Sem código'}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3">
                      <Button 
                        className="w-full py-5 rounded-2xl font-bold text-lg shadow-xl shadow-emerald-100" 
                        onClick={() => confirmQrRetrieved()} 
                        loading={loading}
                      >
                        Confirmar Retirada
                      </Button>
                      
                      <button 
                        onClick={() => { setQrPackage(null); setQrScanStatus('idle'); setDeliveryPhoto(null); }}
                        className="w-full py-4 text-zinc-400 hover:text-zinc-600 font-bold transition-colors"
                      >
                        Escanear outro
                      </button>
                    </div>
                  </Card>
                </motion.div>
              )}

              {qrScanStatus === 'error' && (
                <motion.div 
                  key="error"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="w-full max-w-sm"
                >
                  <Card className="p-8 text-center bg-white border-none shadow-2xl">
                    <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
                      <AlertTriangle className="w-10 h-10" />
                    </div>
                    <h3 className="text-2xl font-bold text-zinc-900 mb-1">Ops! Algo deu errado</h3>
                    <p className="text-zinc-500 text-sm mb-8">O QR Code é inválido, expirou ou já foi utilizado.</p>
                    <Button 
                      className="w-full py-4 rounded-2xl font-bold bg-zinc-900 hover:bg-zinc-800" 
                      onClick={() => { setQrScanStatus('idle'); setQrPackage(null); }}
                    >
                      Tentar Novamente
                    </Button>
                  </Card>
                </motion.div>
              )}

              {qrScanStatus === 'success' && (
                <motion.div 
                  key="success"
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center justify-center text-center"
                >
                  <div className="w-32 h-32 bg-emerald-500 rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(16,185,129,0.5)] mb-8">
                    <Check className="w-20 h-20 text-white" />
                  </div>
                  <h3 className="text-3xl font-bold text-white mb-2">Sucesso!</h3>
                  <p className="text-emerald-400 font-medium">Retirada confirmada com sucesso</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Recent History Footer */}
          {!qrPackage && qrScanStatus === 'idle' && recentRetrievals.length > 0 && (
            <motion.div 
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              className="bg-zinc-900/80 backdrop-blur-xl p-6 border-t border-white/5 max-h-64 overflow-y-auto"
            >
              <h4 className="text-zinc-400 text-[10px] font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                <History className="w-3 h-3" />
                Retiradas Recentes
              </h4>
              <div className="space-y-3">
                {recentRetrievals.map(pkg => (
                  <div key={pkg.id} className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-emerald-500/10 text-emerald-500 rounded-lg flex items-center justify-center">
                        <Check className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{pkg.moradores?.nome || 'Morador'}</p>
                        <p className="text-[10px] text-zinc-500">{formatPackageUnit(pkg)} • {formatSafeDateTime(pkg.delivered_at)}</p>
                      </div>
                    </div>
                    <Badge variant="emerald">OK</Badge>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      )}

      {step === 'camera' && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="absolute top-6 left-6 z-10">
            <Button variant="ghost" className="text-white hover:bg-white/10" onClick={() => setStep('list')}>
              Cancelar
            </Button>
          </div>
          
          <div className="relative flex-1 flex items-center justify-center overflow-hidden">
            <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
            
            {/* Visual Guide Overlay */}
            <div className="relative z-10 w-72 h-48 border-2 border-white/50 rounded-2xl flex items-center justify-center">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-500 rounded-tl-lg"></div>
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-500 rounded-tr-lg"></div>
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-500 rounded-bl-lg"></div>
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-500 rounded-br-lg"></div>
              <p className="text-white/80 text-xs font-bold uppercase tracking-widest text-center px-4">Enquadre a etiqueta aqui</p>
            </div>
          </div>

          <canvas ref={canvasRef} className="hidden" />
          
          <div className="p-10 flex justify-center bg-zinc-900">
            <button 
              onClick={capture} 
              disabled={loading}
              className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-90 transition-transform disabled:opacity-50"
            >
              <div className="w-16 h-16 bg-white rounded-full shadow-lg" />
            </button>
          </div>

          {loading && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-20 flex flex-col items-center justify-center text-white">
              <Loader2 className="w-12 h-12 animate-spin text-emerald-500 mb-4" />
              <p className="text-lg font-bold animate-pulse">{loadingMessage || 'Processando...'}</p>
            </div>
          )}
        </div>
      )}

      {step === 'confirm' && (
        <div className="max-w-md mx-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
          <Card className="overflow-hidden p-0 border-none shadow-2xl">
            <div className="bg-emerald-600 p-6 text-white">
              <h3 className="text-xl font-bold">Confirmar Dados</h3>
              <p className="text-emerald-100 text-sm">Revise as informações da etiqueta</p>
            </div>
            
            <div className="p-6 space-y-6">
              {capturedImage && (
                <div className="relative group">
                  <img src={capturedImage} className="w-full rounded-2xl border border-zinc-100 h-40 object-cover" />
                  <button 
                    onClick={() => setStep('camera')}
                    className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-bold rounded-2xl"
                  >
                    Tirar outra foto
                  </button>
                </div>
              )}
              
              <div className="space-y-4">
                <div className="relative">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest absolute left-3 top-2">Destinatário</label>
                  <input 
                    value={analyzedData?.recipientName || ''} 
                    onChange={(e) => setAnalyzedData({...analyzedData, recipientName: e.target.value})}
                    className={`w-full pt-7 pb-3 px-3 border rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-bold text-zinc-900 ${analyzedData?.recipientNameConfidence < 0.7 ? 'bg-amber-50 border-amber-200' : 'border-zinc-200'}`} 
                  />
                  {analyzedData?.recipientNameConfidence < 0.7 && (
                    <span className="absolute right-3 top-2 text-[10px] font-bold text-amber-600 uppercase">Verificar</span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="relative">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest absolute left-3 top-2">Unidade</label>
                    <input 
                      value={analyzedData?.unitNumber || ''} 
                      onChange={(e) => setAnalyzedData({...analyzedData, unitNumber: e.target.value})}
                      className={`w-full pt-7 pb-3 px-3 border rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all font-bold text-zinc-900 ${analyzedData?.unitNumberConfidence < 0.8 ? 'bg-amber-50 border-amber-200' : 'border-zinc-200'}`} 
                      placeholder="Ex: 402"
                    />
                    {analyzedData?.unitNumberConfidence < 0.8 && (
                      <span className="absolute right-3 top-2 text-[10px] font-bold text-amber-600 uppercase">?</span>
                    )}
                  </div>
                  <div className="relative">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest absolute left-3 top-2">Transportadora</label>
                    <input 
                      value={analyzedData?.carrier || ''} 
                      onChange={(e) => setAnalyzedData({...analyzedData, carrier: e.target.value})}
                      className="w-full pt-7 pb-3 px-3 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none font-bold text-zinc-900" 
                    />
                  </div>
                </div>

                <button 
                  onClick={() => setShowAdvancedUnit(!showAdvancedUnit)}
                  className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-1 hover:text-emerald-700 transition-colors"
                >
                  {showAdvancedUnit ? 'Ocultar detalhes da unidade' : 'Ver detalhes da unidade'}
                  <Plus className={`w-3 h-3 transition-transform ${showAdvancedUnit ? 'rotate-45' : ''}`} />
                </button>

                {showAdvancedUnit && (
                  <div className="grid grid-cols-2 gap-3 p-4 bg-zinc-50 rounded-2xl border border-zinc-100 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="relative">
                      <label className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest absolute left-2 top-1">Tipo</label>
                      <input 
                        value={analyzedData?.unitDetails?.type || ''} 
                        onChange={(e) => setAnalyzedData({...analyzedData, unitDetails: {...analyzedData.unitDetails, type: e.target.value}})}
                        className="w-full pt-4 pb-1 px-2 border-b border-zinc-200 bg-transparent outline-none text-xs font-bold text-zinc-900"
                        placeholder="Ex: AP"
                      />
                    </div>
                    <div className="relative">
                      <label className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest absolute left-2 top-1">Número</label>
                      <input 
                        value={analyzedData?.unitDetails?.number || ''} 
                        onChange={(e) => setAnalyzedData({...analyzedData, unitDetails: {...analyzedData.unitDetails, number: e.target.value}})}
                        className="w-full pt-4 pb-1 px-2 border-b border-zinc-200 bg-transparent outline-none text-xs font-bold text-zinc-900"
                        placeholder="Ex: 101"
                      />
                    </div>
                    <div className="relative">
                      <label className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest absolute left-2 top-1">Bloco</label>
                      <input 
                        value={analyzedData?.unitDetails?.block || ''} 
                        onChange={(e) => setAnalyzedData({...analyzedData, unitDetails: {...analyzedData.unitDetails, block: e.target.value}})}
                        className="w-full pt-4 pb-1 px-2 border-b border-zinc-200 bg-transparent outline-none text-xs font-bold text-zinc-900"
                      />
                    </div>
                    <div className="relative">
                      <label className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest absolute left-2 top-1">Torre</label>
                      <input 
                        value={analyzedData?.unitDetails?.tower || ''} 
                        onChange={(e) => setAnalyzedData({...analyzedData, unitDetails: {...analyzedData.unitDetails, tower: e.target.value}})}
                        className="w-full pt-4 pb-1 px-2 border-b border-zinc-200 bg-transparent outline-none text-xs font-bold text-zinc-900"
                      />
                    </div>
                  </div>
                )}

                <div className="relative">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest absolute left-3 top-2">Rastreio (Opcional)</label>
                  <input 
                    value={analyzedData?.trackingNumber || ''} 
                    onChange={(e) => setAnalyzedData({...analyzedData, trackingNumber: e.target.value})}
                    className="w-full pt-7 pb-3 px-3 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none font-bold text-zinc-900" 
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block px-1">Observações (Opcional)</label>
                  
                  {!showNotesOptions ? (
                    <button 
                      onClick={() => setShowNotesOptions(true)}
                      className={`w-full p-4 rounded-2xl border border-dashed flex items-center justify-between transition-all ${
                        notes ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={`w-4 h-4 ${notes ? 'text-amber-500' : 'text-zinc-400'}`} />
                        <span className="text-sm font-bold">{notes || 'Adicionar observação rápida'}</span>
                      </div>
                      <Plus className="w-4 h-4" />
                    </button>
                  ) : (
                    <div className="bg-zinc-50 rounded-2xl border border-zinc-100 p-2 grid grid-cols-1 gap-1 animate-in fade-in slide-in-from-top-2 duration-200">
                      {[
                        'Encomenda frágil',
                        'Volume grande',
                        'Caixa danificada',
                        'Recebido com avaria',
                        'Retirar com documento',
                        'Entregar depois',
                        'Entrega urgente'
                      ].map((option) => (
                        <button
                          key={option}
                          onClick={() => {
                            setNotes(notes === option ? '' : option);
                            setShowNotesOptions(false);
                          }}
                          className={`w-full p-3 rounded-xl text-left text-xs font-bold transition-all flex items-center justify-between ${
                            notes === option 
                              ? 'bg-amber-100 text-amber-700' 
                              : 'hover:bg-white text-zinc-600'
                          }`}
                        >
                          {option}
                          {notes === option && <Check className="w-3 h-3" />}
                        </button>
                      ))}
                      <button 
                        onClick={() => setShowNotesOptions(false)}
                        className="w-full p-2 text-[10px] font-bold text-zinc-400 uppercase tracking-widest hover:text-zinc-600 transition-colors mt-1"
                      >
                        Fechar lista
                      </button>
                    </div>
                  )}
                </div>

                {/* Resident Selection */}
                <div className="space-y-3 pt-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Morador Destinatário</label>
                    {matchingResidents.length > 0 && (
                      <span className="text-[10px] font-bold text-emerald-600 uppercase">
                        {matchingResidents.length} encontrado(s)
                      </span>
                    )}
                  </div>
                  
                  {matchingResidents.length > 0 ? (
                    <div className="space-y-2">
                      {matchingResidents.slice(0, 3).map(({ resident, score }) => (
                        <button
                          key={resident.id}
                          onClick={() => setSelectedResidentId(resident.id)}
                          className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center justify-between group ${
                            selectedResidentId === resident.id 
                              ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' 
                              : 'border-zinc-100 bg-zinc-50 hover:bg-zinc-100'
                          }`}
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-sm font-bold text-zinc-900">{resident.full_name}</p>
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
                            <p className="text-[10px] text-zinc-500">
                              Unidade: {resident.unit} {resident.phone ? `• ${resident.phone}` : '• Sem telefone'}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right hidden group-hover:block">
                              <p className="text-[8px] text-zinc-400 font-bold uppercase">Score</p>
                              <p className="text-[10px] font-bold text-zinc-600">{Math.round(score)}</p>
                            </div>
                            {selectedResidentId === resident.id && (
                              <CheckCircle className="w-5 h-5 text-emerald-600" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : analyzedData?.unitNumber ? (
                    <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 text-amber-700 text-xs flex items-center gap-3">
                      <AlertTriangle className="w-5 h-5 shrink-0" />
                      <p>Nenhum morador cadastrado para a unidade {analyzedData.unitNumber}.</p>
                    </div>
                  ) : (
                    <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-100 text-zinc-500 text-xs text-center">
                      Informe a unidade para buscar moradores.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="px-1">
                  {systemStatus?.whatsapp.configured ? (
                    <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-600 uppercase mb-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      WhatsApp Ativo
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-[10px] font-bold text-amber-600 uppercase mb-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      WhatsApp não configurado (Apenas salvar)
                    </div>
                  )}
                </div>
                <Button 
                  className="w-full py-4 rounded-2xl text-lg font-bold shadow-lg shadow-emerald-100" 
                  onClick={savePackage} 
                  loading={loading}
                  disabled={matchingResidents.length > 1 && !selectedResidentId}
                >
                  {matchingResidents.length > 1 && !selectedResidentId ? 'Selecione um morador' : 'Salvar e Notificar'}
                </Button>
                <Button 
                  variant="ghost" 
                  className="w-full" 
                  onClick={() => {
                    setStep('list');
                    setShowNotesOptions(false);
                  }}
                  disabled={loading}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      <Modal 
        isOpen={isResidentModalOpen} 
        onClose={() => setIsResidentModalOpen(false)} 
        title={editingResidentId ? "Editar Morador" : "Cadastrar Morador"}
      >
        <form onSubmit={handleSaveResident} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Nome Completo</label>
            <input 
              required
              value={residentFormData.full_name}
              onChange={(e) => setResidentFormData({...residentFormData, full_name: e.target.value})}
              className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Ex: João Silva"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Unidade (Identificador)</label>
              <input 
                value={residentFormData.unit_number}
                onChange={(e) => setResidentFormData({...residentFormData, unit_number: e.target.value})}
                className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-zinc-50 font-semibold"
                placeholder="Gerado automaticamente..."
              />
              <p className="text-[9px] text-zinc-400 mt-1 px-1 italic">Este campo é usado para buscas e notificações.</p>
            </div>

            <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 space-y-4 col-span-2">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Detalhes da Unidade (Opcional)</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-medium text-zinc-500 mb-1">Tipo</label>
                  <input 
                    value={residentFormData.unit_type || ''}
                    onChange={(e) => setResidentFormData({...residentFormData, unit_type: e.target.value})}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="Ex: AP, Casa"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-zinc-500 mb-1">Bloco</label>
                  <input 
                    value={residentFormData.block || ''}
                    onChange={(e) => setResidentFormData({...residentFormData, block: e.target.value})}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-zinc-500 mb-1">Torre</label>
                  <input 
                    value={residentFormData.tower || ''}
                    onChange={(e) => setResidentFormData({...residentFormData, tower: e.target.value})}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Telefone (WhatsApp)</label>
              <input 
                required
                value={residentFormData.phone}
                onChange={(e) => setResidentFormData({...residentFormData, phone: e.target.value})}
                className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="5511999999999"
              />
            </div>
          </div>
          <Button type="submit" className="w-full py-3" loading={loading}>
            {editingResidentId ? 'Salvar Alterações' : 'Cadastrar Morador'}
          </Button>
        </form>
      </Modal>
    </div>
  );
};

const ResidentDashboard = ({ user }: { user: Profile }) => {
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<PackageType | null>(null);

  useEffect(() => {
    const fetchMyPackages = async () => {
      const { data } = await supabase
        .from('packages')
        .select('*')
        .eq('unit_number', user.unidade)
        .eq('condominium_id', user.condominium_id)
        .order('received_at', { ascending: false });
      if (data) setPackages(data);
    };
    fetchMyPackages();
  }, [user.unidade]);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-zinc-900">Olá, {user.full_name.split(' ')[0]}!</h2>
        <p className="text-zinc-500">Acompanhe suas encomendas da Unidade {user.unidade}</p>
      </div>

      <div className="space-y-4">
        {packages.length === 0 && (
          <div className="text-center py-12 text-zinc-400 bg-white rounded-2xl border border-dashed border-zinc-200">
            <Package className="w-12 h-12 mx-auto mb-2 opacity-20" />
            <p>Nenhuma encomenda encontrada</p>
          </div>
        )}
        {packages.map(pkg => (
          <Card key={pkg.id} className={`flex items-center justify-between p-4 ${pkg.status !== 'delivered' ? 'cursor-pointer hover:border-emerald-200' : ''}`} onClick={() => pkg.status !== 'delivered' && setSelectedPkg(pkg)}>
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${pkg.status === 'delivered' ? 'bg-zinc-100 text-zinc-400' : 'bg-emerald-100 text-emerald-600'}`}>
                <Package className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold text-zinc-900">{pkg.carrier}</p>
                <p className="text-xs text-zinc-500">
                  {pkg.received_at ? formatDate(pkg.received_at, "dd/MM 'às' HH:mm", { locale: ptBR }) : 'Data desconhecida'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {pkg.status !== 'delivered' && pkg.pickup_token && (
                <div className="w-8 h-8 bg-zinc-100 rounded-lg flex items-center justify-center text-zinc-600">
                  <QrCode className="w-5 h-5" />
                </div>
              )}
              <Badge variant={pkg.status === 'delivered' ? 'gray' : 'emerald'}>
                {pkg.status === 'delivered' ? 'Retirado' : 'Na Portaria'}
              </Badge>
            </div>
          </Card>
        ))}
      </div>

      {selectedPkg && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in duration-300">
          <Card className="max-w-sm w-full p-8 text-center animate-in zoom-in-95 duration-300">
            <h3 className="text-xl font-bold mb-2">QR Code de Retirada</h3>
            <p className="text-zinc-500 text-sm mb-6">Apresente este código na portaria para retirar sua encomenda.</p>
            
            <div className="bg-white p-4 rounded-2xl border-2 border-zinc-100 inline-block mb-6">
              <QRCodeSVG value={selectedPkg.pickup_token || ''} size={200} />
            </div>

            <div className="text-left bg-zinc-50 p-4 rounded-xl mb-6">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Detalhes</p>
              <p className="text-sm font-bold text-zinc-900">{selectedPkg.carrier}</p>
              <p className="text-xs text-zinc-500">Recebido em {formatDate(selectedPkg.received_at, "dd/MM 'às' HH:mm", { locale: ptBR })}</p>
            </div>

            <Button className="w-full py-4 rounded-xl font-bold" onClick={() => setSelectedPkg(null)}>
              Fechar
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
};

const SindicoDashboard = ({ user, onLogout, onUpdateUser }: { user: Profile, onLogout: () => void, onUpdateUser: (user: Profile) => void }) => {
  return <SyndicPanel user={user} onLogout={onLogout} onUpdateUser={onUpdateUser} />;
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();
          
          if (profile) {
            if (profile.active === false) {
              await supabase.auth.signOut();
              setUser(null);
            } else {
              setUser(profile);
            }
          } else {
            // Sessão ativa mas sem perfil? Desloga por segurança
            await supabase.auth.signOut();
          }
        }
      } catch (err) {
        console.error("Erro ao verificar sessão:", err);
      } finally {
        setLoading(false);
      }
    };
    checkUser();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const handleUpdateUser = (updatedUser: Profile) => {
    setUser(updatedUser);
  };

  return (
    <Routes>
      <Route path="/portal/:token" element={<ResidentPortal />} />
      <Route path="/retirada" element={<Retirada />} />
      <Route path="/retirada/:token" element={<Retirada />} />
      <Route path="/change-password" element={user ? <ChangePassword onUpdateUser={handleUpdateUser} /> : <Navigate to="/" />} />
      <Route path="/select-condominium" element={
        user ? (
          user.condominium_id ? <Navigate to="/dashboard" /> : <SelectCondominium user={user} onUpdateUser={handleUpdateUser} />
        ) : <Navigate to="/" />
      } />
      <Route path="*" element={
        (() => {
          const role = normalizeRole(user?.role);
          // Only use SindicoDashboard as a wrapper if it's NOT a specific route handled by AppLayout routes
          // Actually, let's simplify: AppLayout should always handle the main structure, 
          // and the Routes inside AppLayout should decide which component to show.
          return <AppLayout user={user} loading={loading} setUser={setUser} handleLogout={handleLogout} />;
        })()
      } />
    </Routes>
  );
}

const AppLayout = ({ user, loading, setUser, handleLogout }: any) => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Role-based initial redirection
    const allowedPaths = ['/select-condominium', '/condominiums/new', '/change-password'];
    if (!loading && user && !user.condominium_id && !allowedPaths.includes(location.pathname)) {
      navigate('/select-condominium');
      return;
    }

    if (!loading && user && user.must_change_password && location.pathname !== '/change-password') {
      navigate('/change-password');
      return;
    }

    if (!loading && user && user.condominium_id) {
      const role = normalizeRole(user.role);
      console.log("ROLE USUÁRIO (Layout):", role);

      // Proteção de rotas e redirecionamento automático
      if (location.pathname === '/' || location.pathname === '/dashboard') {
        if (role === 'porteiro') {
          navigate('/portaria');
        } else if (role === 'sindico') {
          navigate('/sindico');
        } else if (role === 'admin') {
          navigate('/dashboard');
        }
      }

      // Impedir que porteiro acesse /sindico ou /dashboard
      if (role === 'porteiro' && (location.pathname === '/sindico' || location.pathname === '/dashboard')) {
        navigate('/portaria');
      }
      
      // Impedir que síndico acesse /portaria
      if (role === 'sindico' && location.pathname === '/portaria') {
        navigate('/sindico');
      }
    }
  }, [user, loading, navigate, location.pathname]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50">
      <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
    </div>
  );

  if (!user) return <LoginPage onLogin={setUser} />;

  return (
    <div className="min-h-screen bg-zinc-50">
      <nav className="bg-white border-b border-zinc-200 px-6 py-4 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            {normalizeRole(user.role) === 'admin' && (
              <button 
                onClick={() => navigate('/dashboard')}
                className="p-2 hover:bg-zinc-100 rounded-xl text-zinc-500 transition-all flex items-center gap-2"
                title="Voltar para Painel Admin"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="text-xs font-bold uppercase hidden sm:inline">Admin</span>
              </button>
            )}
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => {
              const role = normalizeRole(user.role);
              if (role === 'porteiro') navigate('/portaria');
              else if (role === 'sindico') navigate('/sindico');
              else navigate('/dashboard');
            }}>
              <div className="w-8 h-8 bg-emerald-600 text-white rounded-lg flex items-center justify-center">
                <Package className="w-5 h-5" />
              </div>
              <span className="font-bold text-lg hidden sm:inline">Portaria Inteligente</span>
            </div>
            
            {/* Desktop Nav Links */}
            {(() => {
              const role = normalizeRole(user.role);
              return (role === 'porteiro' || role === 'sindico' || role === 'admin') && (
                <div className="hidden md:flex items-center gap-1 ml-8">
                  <button 
                    onClick={() => {
                      if (role === 'porteiro') navigate('/portaria');
                      else if (role === 'sindico') navigate('/sindico');
                      else navigate('/dashboard');
                    }}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                      location.pathname === '/portaria' || location.pathname === '/sindico' || location.pathname === '/dashboard'
                        ? 'bg-emerald-50 text-emerald-600' 
                        : 'text-zinc-500 hover:bg-zinc-50'
                    }`}
                  >
                    Início
                  </button>
                  {role === 'porteiro' && (
                    <button 
                      onClick={() => navigate('/portaria')}
                      className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                        location.pathname === '/portaria' && !new URLSearchParams(location.search).get('tab')
                          ? 'bg-emerald-50 text-emerald-600' 
                          : 'text-zinc-500 hover:bg-zinc-50'
                      }`}
                    >
                      Encomendas
                    </button>
                  )}
                  <button 
                    onClick={() => {
                      if (role === 'porteiro') navigate('/portaria?tab=residents');
                      else if (role === 'sindico') navigate('/sindico?tab=residents');
                      else navigate('/profiles');
                    }}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                      (location.pathname === '/portaria' && new URLSearchParams(location.search).get('tab') === 'residents') || 
                      (location.pathname === '/sindico' && new URLSearchParams(location.search).get('tab') === 'residents') ||
                      location.pathname === '/profiles'
                        ? 'bg-emerald-50 text-emerald-600' 
                        : 'text-zinc-500 hover:bg-zinc-50'
                    }`}
                  >
                    Moradores
                  </button>
                  {role === 'admin' && (
                    <button 
                      onClick={() => navigate('/users')}
                      className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                        location.pathname === '/users'
                          ? 'bg-emerald-50 text-emerald-600' 
                          : 'text-zinc-500 hover:bg-zinc-50'
                      }`}
                    >
                      Usuários
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-bold text-zinc-900">{user.full_name}</p>
              <p className="text-xs text-zinc-500 uppercase tracking-wider">
                {(() => {
                  const role = normalizeRole(user.role);
                  return role === 'porteiro' ? 'Portaria' : role === 'sindico' ? 'Síndico' : role === 'admin' ? 'Admin' : `Unidade`;
                })()}
              </p>
            </div>
            <button onClick={handleLogout} className="p-2 text-zinc-400 hover:text-red-500 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      <main className="pb-20">
        <Routes>
          <Route path="/dashboard" element={
            (() => {
              const role = normalizeRole(user.role);
              if (role === 'porteiro') return <Navigate to="/portaria" />;
              if (role === 'sindico') return <Navigate to="/sindico" />;
              return <Dashboard user={user} />;
            })()
          } />
          <Route path="/sindico/*" element={
            (() => {
              const role = normalizeRole(user.role);
              return role === 'sindico' || role === 'admin' ? <SindicoDashboard user={user} onLogout={handleLogout} onUpdateUser={setUser} /> : <Navigate to="/dashboard" />
            })()
          } />
          <Route path="/portaria" element={
            (() => {
              const role = normalizeRole(user.role);
              return role === 'porteiro' || role === 'admin' ? <Portaria user={user} /> : <Navigate to="/dashboard" />
            })()
          } />
          <Route path="/condominiums" element={<CondominiumList />} />
          <Route path="/condominiums/new" element={<CondominiumNew user={user} onUpdateUser={setUser} />} />
          <Route path="/profiles" element={<ProfileList user={user} />} />
          <Route path="/profiles/new" element={<ProfileNew user={user} />} />
          <Route path="/users" element={<UserManagement user={user} />} />
          <Route path="/packages" element={<PackageList user={user} />} />
          <Route path="/packages/new" element={<PackageNew user={user} />} />
          <Route path="/settings" element={
            (() => {
              const role = normalizeRole(user.role);
              return role === 'admin' ? <Settings user={user} /> : <Navigate to="/dashboard" />;
            })()
          } />
          
          <Route path="/" element={
            (() => {
              const role = normalizeRole(user.role);
              if (role === 'porteiro') return <Navigate to="/portaria" />;
              if (role === 'sindico') return <Navigate to="/sindico" />;
              return <Navigate to="/dashboard" />;
            })()
          } />
          <Route path="*" element={
            (() => {
              const role = normalizeRole(user.role);
              if (role === 'porteiro') return <Navigate to="/portaria" />;
              if (role === 'sindico') return <Navigate to="/sindico" />;
              return <Navigate to="/dashboard" />;
            })()
          } />
        </Routes>
      </main>

      {/* Bottom Navigation for Porter/Sindico/Admin */}
      {(() => {
        const role = normalizeRole(user.role);
        return (role === 'porteiro' || role === 'sindico' || role === 'admin') && (
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-zinc-200 px-6 py-3 z-40 sm:hidden">
            <div className="flex justify-around items-center">
              <button 
                onClick={() => {
                  if (role === 'porteiro') navigate('/portaria');
                  else if (role === 'sindico') navigate('/sindico');
                  else navigate('/dashboard');
                }}
                className={`flex flex-col items-center gap-1 ${
                  location.pathname === '/portaria' || location.pathname === '/sindico' || location.pathname === '/dashboard' ? 'text-emerald-600' : 'text-zinc-400'
                }`}
              >
                <LayoutDashboard className="w-6 h-6" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Início</span>
              </button>
              {role === 'porteiro' && (
                <button 
                  onClick={() => navigate('/portaria')}
                  className={`flex flex-col items-center gap-1 ${
                  location.pathname === '/portaria' && !new URLSearchParams(location.search).get('tab') ? 'text-zinc-800' : 'text-zinc-400'
                }`}
                >
                  <Package className="w-6 h-6" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Portaria</span>
                </button>
              )}
              <button 
                onClick={() => {
                  if (role === 'porteiro') navigate('/portaria?tab=residents');
                  else if (role === 'sindico') navigate('/sindico?tab=residents');
                  else navigate('/profiles');
                }}
                className={`flex flex-col items-center gap-1 ${
                  (location.pathname === '/portaria' && new URLSearchParams(location.search).get('tab') === 'residents') || 
                  (location.pathname === '/sindico' && new URLSearchParams(location.search).get('tab') === 'residents') ||
                  location.pathname === '/profiles' ? 'text-blue-600' : 'text-zinc-400'
                }`}
              >
                <Users className="w-6 h-6" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Moradores</span>
              </button>
              {role === 'admin' && (
                <button 
                  onClick={() => navigate('/users')}
                  className={`flex flex-col items-center gap-1 ${
                    location.pathname === '/users' ? 'text-zinc-800' : 'text-zinc-400'
                  }`}
                >
                  <Shield className="w-6 h-6" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Usuários</span>
                </button>
              )}
            </div>
          </div>
        );
      })()}
      
      <Toaster position="bottom-right" />
    </div>
  );
}
