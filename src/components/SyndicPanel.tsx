import React, { useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, Package, Users, BarChart3, Bell, Settings, 
  Search, Filter, Download, MoreVertical, CheckCircle, XCircle, 
  Clock, Phone, Home, Calendar, ArrowUpRight, ArrowDownRight,
  AlertCircle, RefreshCw, Trash2, Edit2, Eye, UserPlus,
  TrendingUp, Truck, Mail, MessageSquare, User, LogOut, QrCode,
  Shield, FileText, History, Camera, ArrowLeft
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area
} from 'recharts';
import { subDays, startOfDay, endOfDay, isWithinInterval, parseISO } from 'date-fns';
import { formatDate, formatSafeDateTime, formatSafeDate } from '../lib/dateUtils';
import { formatResidentAddress, formatPackageUnit } from '../lib/residentUtils';
import { ptBR } from 'date-fns/locale';
import { supabase } from '../lib/supabase';
import { Profile, Package as PackageType, Notification, MessageLog, WhatsAppConversation, CondominiumSettings } from '../types';
import { toast } from 'react-hot-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';



import ProfileList from '../pages/ProfileList';
import ProfileNew from '../pages/ProfileNew';
import PackageNew from '../pages/PackageNew';
import CondominiumNew from '../pages/CondominiumNew';
import UserManagement from '../pages/UserManagement';
import AuditLogs from '../pages/AuditLogs';

// --- Shared UI Components ---

const Card = ({ children, className = '' }: any) => (
  <div className={`bg-white rounded-2xl border border-zinc-100 shadow-sm p-6 ${className}`}>
    {children}
  </div>
);

const Button = ({ children, onClick, variant = 'primary', loading = false, className = '', disabled = false, size = 'md', ...props }: any) => {
  const variants: any = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-700',
    secondary: 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200',
    outline: 'border border-zinc-200 text-zinc-600 hover:bg-zinc-50',
    danger: 'bg-red-500 text-white hover:bg-red-600',
    ghost: 'text-zinc-500 hover:bg-zinc-100',
    success: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
  };

  const sizes: any = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base'
  };

  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`rounded-xl font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
};

const Badge = ({ children, variant = 'gray' }: any) => {
  const variants: any = {
    gray: 'bg-zinc-100 text-zinc-600',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
    red: 'bg-red-100 text-red-700'
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${variants[variant]}`}>
      {children}
    </span>
  );
};

const Input = ({ className = '', ...props }: any) => (
  <input
    className={`w-full px-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all ${className}`}
    {...props}
  />
);

const Modal = ({ isOpen, onClose, title, children }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-zinc-100 flex justify-between items-center">
          <h3 className="text-xl font-bold text-zinc-900">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
            <XCircle className="w-6 h-6 text-zinc-400" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  );
};

// --- Dashboard Component ---

const Dashboard = ({ user, residents = [], logs = [], systemStatus }: any) => {
  const [stats, setStats] = useState({
    receivedToday: 0,
    pending: 0,
    deliveredToday: 0,
    notificationsSent: 0,
    failedWhatsApp: 0,
    residentsCount: 0,
    qrRetrievals: 0,
    manualRetrievals: 0,
    lastPackage: null as any
  });
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, [user.condominium_id]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const today = formatDate(new Date(), 'yyyy-MM-dd');
      
      // Fetch all packages to calculate stats
      const { data: packages, error } = await supabase
        .from('packages')
        .select('*, package_id:id, recipient_name:recipient_name_raw, unit_label:unit_number')
        .eq('condominium_id', user.condominium_id);

      if (error) {
        console.error('Erro RPC stats:', error);
      }

      const pkgs = packages || [];
      
      const statsData = {
        receivedToday: pkgs.filter((p: any) => {
          if (!p.received_at) return false;
          try {
            return formatDate(p.received_at, 'yyyy-MM-dd') === today;
          } catch { return false; }
        }).length,
        pending: pkgs.filter((p: any) => !p.delivered_at || p.status !== 'delivered').length,
        deliveredToday: pkgs.filter((p: any) => {
          if (!p.delivered_at) return false;
          try {
            return (p.delivered_at || p.status === 'delivered') && 
                   formatDate(p.delivered_at, 'yyyy-MM-dd') === today;
          } catch { return false; }
        }).length,
        notificationsSent: (logs || []).filter((l: any) => l.status_envio === 'sucesso' || l.status === 'sent').length,
        failedWhatsApp: (logs || []).filter((l: any) => l.status_envio === 'erro' || l.status === 'failed').length,
        residentsCount: (residents || []).length,
        qrRetrievals: pkgs.filter((p: any) => p.delivery_method === 'qr_code').length,
        manualRetrievals: pkgs.filter((p: any) => p.delivery_method === 'manual' || (p.status === 'delivered' && !p.delivery_method)).length,
        lastPackage: pkgs[0]
      };

      const newChartData = Array.from({ length: 7 }).map((_, i) => {
        const date = subDays(new Date(), 6 - i);
        const dateStr = formatDate(date, 'yyyy-MM-dd');
        return {
          name: formatDate(date, 'dd/MM'),
          recebidas: pkgs.filter((p: any) => {
            if (!p.received_at) return false;
            try {
              return formatDate(p.received_at, 'yyyy-MM-dd') === dateStr;
            } catch { return false; }
          }).length,
          retiradas: pkgs.filter((p: any) => {
            if (!p.delivered_at) return false;
            try {
              return formatDate(p.delivered_at, 'yyyy-MM-dd') === dateStr;
            } catch { return false; }
          }).length
        };
      });

      setStats(statsData);
      setChartData(newChartData);
    } catch (err) {
      console.error('Erro ao buscar estatísticas:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="flex justify-center p-12"><RefreshCw className="w-8 h-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="space-y-6">
      {systemStatus && (!systemStatus?.whatsapp?.configured || !systemStatus?.supabase?.serviceRole) && (
        <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-900">Configuração Incompleta</p>
            <p className="text-xs text-amber-700">
              {systemStatus?.whatsapp && !systemStatus.whatsapp.configured && "• WhatsApp Cloud API não configurado. Notificações serão simuladas.\n"}
              {systemStatus?.supabase && !systemStatus.supabase.serviceRole && "• Service Role Key ausente. Algumas funções de segurança avançada estão limitadas."}
            </p>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-emerald-50 border-emerald-100">
          <div className="flex justify-between items-start mb-2">
            <div className="p-2 bg-emerald-100 rounded-xl text-emerald-600">
              <Package className="w-5 h-5" />
            </div>
            <Badge variant="emerald">Hoje</Badge>
          </div>
          <p className="text-emerald-600 text-xs font-bold uppercase tracking-wider">Recebidas</p>
          <h3 className="text-3xl font-bold text-zinc-900">{stats.receivedToday}</h3>
        </Card>

        <Card className="bg-amber-50 border-amber-100">
          <div className="flex justify-between items-start mb-2">
            <div className="p-2 bg-amber-100 rounded-xl text-amber-600">
              <Clock className="w-5 h-5" />
            </div>
            <Badge variant="amber">Total</Badge>
          </div>
          <p className="text-amber-600 text-xs font-bold uppercase tracking-wider">Pendentes</p>
          <h3 className="text-3xl font-bold text-zinc-900">{stats.pending}</h3>
        </Card>

        <Card className="bg-blue-50 border-blue-100">
          <div className="flex justify-between items-start mb-2">
            <div className="p-2 bg-blue-100 rounded-xl text-blue-600">
              <CheckCircle className="w-5 h-5" />
            </div>
            <Badge variant="blue">Hoje</Badge>
          </div>
          <p className="text-blue-600 text-xs font-bold uppercase tracking-wider">Retiradas</p>
          <h3 className="text-3xl font-bold text-zinc-900">{stats.deliveredToday}</h3>
        </Card>

        <Card className="bg-zinc-50 border-zinc-100">
          <div className="flex justify-between items-start mb-2">
            <div className="p-2 bg-zinc-200 rounded-xl text-zinc-600">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <p className="text-zinc-500 text-xs font-bold uppercase tracking-wider">Moradores</p>
          <h3 className="text-3xl font-bold text-zinc-900">{stats.residentsCount}</h3>
        </Card>

        <Card className="bg-indigo-50 border-indigo-100 lg:col-span-2">
          <div className="flex justify-between items-center mb-4">
            <div className="p-2 bg-indigo-100 rounded-xl text-indigo-600">
              <QrCode className="w-5 h-5" />
            </div>
            <Badge variant="blue">Método de Retirada</Badge>
          </div>
          <div className="flex items-end justify-between gap-8">
            <div className="flex-1">
              <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-indigo-600 mb-1">
                <span>QR Code</span>
                <span>{Math.round((stats.qrRetrievals / (stats.qrRetrievals + stats.manualRetrievals || 1)) * 100)}%</span>
              </div>
              <div className="h-2 bg-indigo-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-indigo-600 transition-all duration-1000" 
                  style={{ width: `${(stats.qrRetrievals / (stats.qrRetrievals + stats.manualRetrievals || 1)) * 100}%` }}
                />
              </div>
              <p className="text-xs text-zinc-500 mt-2 font-medium">{stats.qrRetrievals} retiradas</p>
            </div>
            <div className="flex-1">
              <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">
                <span>Manual</span>
                <span>{Math.round((stats.manualRetrievals / (stats.qrRetrievals + stats.manualRetrievals || 1)) * 100)}%</span>
              </div>
              <div className="h-2 bg-zinc-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-zinc-500 transition-all duration-1000" 
                  style={{ width: `${(stats.manualRetrievals / (stats.qrRetrievals + stats.manualRetrievals || 1)) * 100}%` }}
                />
              </div>
              <p className="text-xs text-zinc-500 mt-2 font-medium">{stats.manualRetrievals} retiradas</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <h3 className="font-bold text-zinc-900 mb-6">Volume de Encomendas (Últimos 7 dias)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorRec" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#71717a'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#71717a'}} />
                <Tooltip 
                  contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                />
                <Area type="monotone" dataKey="recebidas" stroke="#10b981" fillOpacity={1} fill="url(#colorRec)" strokeWidth={3} />
                <Area type="monotone" dataKey="retiradas" stroke="#3b82f6" fillOpacity={0} strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h3 className="font-bold text-zinc-900 mb-6">Status de Notificações</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-emerald-700 uppercase">Sucesso</p>
                  <p className="text-lg font-bold text-emerald-900">{stats.notificationsSent}</p>
                </div>
              </div>
              <ArrowUpRight className="w-5 h-5 text-emerald-400" />
            </div>

            <div className="flex items-center justify-between p-3 bg-red-50 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center text-red-600">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-red-700 uppercase">Falhas</p>
                  <p className="text-lg font-bold text-red-900">{stats.failedWhatsApp}</p>
                </div>
              </div>
              <ArrowDownRight className="w-5 h-5 text-red-400" />
            </div>

            <div className="pt-4 border-t border-zinc-100">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">Última Encomenda</h4>
              {stats.lastPackage ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-500">
                    <Package className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{stats.lastPackage.recipient_name}</p>
                    <p className="text-xs text-zinc-500">
                      {formatPackageUnit(stats.lastPackage)} • {formatSafeDateTime(stats.lastPackage.received_at)}
                    </p>
                    <p className="text-[10px] text-zinc-400 mt-0.5">Por: {stats.lastPackage.porter?.full_name || 'Portaria'}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-zinc-400 italic">Nenhuma registrada</p>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

// --- Packages Component ---

const PackagesList = ({ user }: any) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<any | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [pkgForDelivery, setPkgForDelivery] = useState<any | null>(null);
  const [deliveryPhoto, setDeliveryPhoto] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [isDeliverySuccess, setIsDeliverySuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const uploadDeliveryPhoto = async (base64: string) => {
    try {
      const res = await fetch(base64);
      const blob = await res.blob();
      const file = new File([blob], `delivery_${Date.now()}.jpg`, { type: "image/jpeg" });
      const fileName = `${Math.random()}.jpg`;
      const filePath = `delivery-photos/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('packages')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('packages')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (err) {
      console.error("Erro no upload da foto:", err);
      throw err;
    }
  };

  const handleConfirmDelivery = async (method: 'manual' | 'qr_code' | 'photo' | 'code' = 'manual') => {
    if (!pkgForDelivery) return;
    
    const hasCodeInput = confirmationCode.trim().length > 0;
    const hasPhoto = !!deliveryPhoto;
    const isQrCode = pkgForDelivery.delivery_method === 'qr_code';
    
    // Regra: se não houver QR nem código → exigir foto para confirmar
    if (!isQrCode && !hasCodeInput && !hasPhoto) {
      toast.error("Foto obrigatória: Esta encomenda não possui QR Code nem código informado.");
      return;
    }

    setActionLoading(true);
    try {
      let finalPhotoUrl = pkgForDelivery.photo_url;
      let finalMethod = method;

      if (deliveryPhoto) {
        finalPhotoUrl = await uploadDeliveryPhoto(deliveryPhoto);
        finalMethod = 'photo';
      } else if (finalMethod === 'manual' && (pkgForDelivery.pickup_code || confirmationCode)) {
        // Se for manual mas tiver código de retirada, salva como 'code'
        finalMethod = 'code';
      }

      const { data: { user: authUser } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('packages')
        .update({ 
          status: 'delivered', 
          delivered_at: new Date().toISOString(),
          ...(authUser?.id ? { delivered_by: authUser.id } : {}),
          delivery_method: finalMethod,
          delivery_photo_url: finalPhotoUrl
        })
        .eq('id', pkgForDelivery.package_id);
      
      if (error) throw error;
      setIsDeliverySuccess(true);
      fetchPackages();
      
      // Auto close after 2 seconds
      setTimeout(() => {
        setIsDeliveryModalOpen(false);
        setIsDeliverySuccess(false);
        setPkgForDelivery(null);
        setDeliveryPhoto(null);
        setConfirmationCode('');
      }, 2000);
    } catch (err) {
      toast.error("Erro ao processar entrega");
    } finally {
      setActionLoading(false);
    }
  };

  const [counts, setCounts] = useState({ all: 0, pending: 0, delivered: 0 });

  const fetchPackages = async () => {
    if (!user?.condominium_id) return;
    setLoading(true);
    setError(false);
    try {
      // Fetch all packages to ensure consistency with Dashboard stats
      const { data, error } = await supabase
        .from('packages')
        .select('*, package_id:id, recipient_name:recipient_name_raw, unit_label:unit_number')
        .eq('condominium_id', user.condominium_id)
        .order('received_at', { ascending: false });

      if (error) throw error;

      const allData = data || [];
      const pendingData = allData.filter(p => !p.delivered_at || p.status !== 'delivered');
      const deliveredData = allData.filter(p => p.status === 'delivered' || p.delivered_at);

      setCounts({
        all: allData.length,
        pending: pendingData.length,
        delivered: deliveredData.length
      });

      // Set the packages for the current active tab
      if (filterStatus === 'all') setPackages(allData);
      else if (filterStatus === 'pending') setPackages(pendingData);
      else if (filterStatus === 'delivered') setPackages(deliveredData);

    } catch (err) {
      console.error('Erro ao buscar encomendas:', err);
      setError(true);
      let errorMsg = "Erro ao carregar encomendas";
      if (filterStatus === 'pending') errorMsg = "Erro ao carregar encomendas pendentes";
      if (filterStatus === 'delivered') errorMsg = "Erro ao carregar encomendas retiradas";
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPackages();
  }, [filterStatus, user.condominium_id]);

  const getDeliveryMethodLabel = (method?: string) => {
    switch (method) {
      case 'manual': return 'MANUAL';
      case 'qr_code': return 'QR CODE';
      case 'code':
      case 'pickup_code': return 'CÓDIGO';
      case 'photo':
      case 'foto': return 'RETIRADA COM FOTO';
      default: return '-';
    }
  };

  const filtered = packages.filter((p: any) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      (p.recipient_name || '').toLowerCase().includes(searchLower) ||
      (p.unit_label || '').toLowerCase().includes(searchLower) ||
      (p.carrier || '').toLowerCase().includes(searchLower) ||
      (p.pickup_code || '').toLowerCase().includes(searchLower) ||
      (p.tracking_code || '').toLowerCase().includes(searchLower)
    );
  });

  const handleResendNotification = async (pkg: any) => {
    setActionLoading(true);
    try {
      const { data: resident } = await supabase
        .from('moradores')
        .select('telefone, nome')
        .eq('id', pkg.recipient_id)
        .maybeSingle();

      if (!resident?.telefone) {
        throw new Error("Morador não encontrado ou sem telefone cadastrado");
      }

      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/notify-resident', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          phone: resident.telefone, 
          residentName: pkg.recipient_name,
          unitNumber: formatPackageUnit(pkg),
          carrier: pkg.carrier,
          packageId: pkg.package_id
        })
      });

      if (!response.ok) throw new Error("Falha ao enviar notificação");
      
      toast.success("Notificação reenviada com sucesso!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao reenviar");
    } finally {
      setActionLoading(false);
    }
  };

  const handleExportCSV = () => {
    if (filtered.length === 0) {
      toast.error("Nenhuma encomenda para exportar");
      return;
    }

    // CSV Headers
    const headers = [
      "Nome do Morador",
      "Unidade",
      "Tipo da Encomenda",
      "Data de Recebimento",
      "Data de Retirada",
      "Status",
      "Forma de Retirada"
    ];

    // CSV Rows
    const rows = filtered.map(pkg => [
      pkg.recipient_name || "",
      formatPackageUnit(pkg) || "",
      pkg.notes || "Encomenda",
      formatSafeDateTime(pkg.received_at) || "",
      pkg.delivered_at ? formatSafeDateTime(pkg.delivered_at) : "",
      pkg.status === 'delivered' ? 'Retirada' : 'Pendente',
      getDeliveryMethodLabel(pkg.delivery_method)
    ]);

    // Combine headers and rows
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell.toString().replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    // Create a blob and download
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "historico_encomendas.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success(`${filtered.length} encomendas exportadas!`);
  };

  const handleExportPDF = () => {
    if (filtered.length === 0) {
      toast.error("Nenhuma encomenda para exportar");
      return;
    }

    const doc = new jsPDF();
    
    // Título do PDF
    doc.setFontSize(18);
    doc.text("Relatório de Encomendas", 14, 22);
    
    // Data de geração
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Gerado em: ${formatSafeDateTime(new Date().toISOString())}`, 14, 30);

    // Tabela de dados
    const tableColumn = [
      "Morador",
      "Unidade",
      "Tipo",
      "Recebimento",
      "Retirada",
      "Status",
      "Método"
    ];

    const tableRows = filtered.map(pkg => [
      pkg.recipient_name || "",
      formatPackageUnit(pkg) || "",
      pkg.notes || "Encomenda",
      formatSafeDate(pkg.received_at) || "",
      pkg.delivered_at ? formatSafeDate(pkg.delivered_at) : "-",
      pkg.status === 'delivered' ? 'Retirada' : 'Pendente',
      getDeliveryMethodLabel(pkg.delivery_method)
    ]);

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 35,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255] }, // Emerald-600
      alternateRowStyles: { fillColor: [244, 244, 245] } // Zinc-100
    });

    doc.save("historico_encomendas.pdf");
    toast.success(`${filtered.length} encomendas exportadas para PDF!`);
  };

  const handleDelete = async (pkg: any) => {
    if (!confirm("Tem certeza que deseja excluir este registro permanentemente?")) return;
    
    setActionLoading(true);
    try {
      const { error } = await supabase.from('packages').delete().eq('id', pkg.package_id);
      if (error) throw error;
      toast.success("Registro excluído!");
      fetchPackages();
      setIsModalOpen(false);
    } catch (err) {
      toast.error("Erro ao excluir");
    } finally {
      setActionLoading(false);
    }
  };

  const displayData = filtered;

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <Input
            placeholder="Buscar encomenda..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
          <Button 
            variant={filterStatus === 'all' ? 'primary' : 'outline'} 
            size="sm" 
            onClick={() => setFilterStatus('all')}
          >
            Todas ({counts.all})
          </Button>
          <Button 
            variant={filterStatus === 'pending' ? 'primary' : 'outline'} 
            size="sm" 
            onClick={() => setFilterStatus('pending')}
          >
            Pendentes ({counts.pending})
          </Button>
          <Button 
            variant={filterStatus === 'delivered' ? 'primary' : 'outline'} 
            size="sm" 
            onClick={() => setFilterStatus('delivered')}
          >
            Retiradas ({counts.delivered})
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleExportCSV}
            className="ml-auto flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Exportar histórico
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleExportPDF}
            className="flex items-center gap-2"
          >
            <FileText className="w-4 h-4" />
            Baixar PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {loading ? (
          <div className="col-span-full bg-white rounded-2xl border border-zinc-100 shadow-sm py-12 flex flex-col items-center justify-center">
            <RefreshCw className="w-8 h-8 animate-spin text-emerald-600 mb-2" />
            <p className="text-sm text-zinc-500">Carregando encomendas...</p>
          </div>
        ) : error ? (
          <div className="col-span-full bg-white rounded-2xl border border-zinc-100 shadow-sm py-12 flex flex-col items-center justify-center">
            <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
            <p className="text-sm text-zinc-500 font-bold">
              {filterStatus === 'pending' ? 'Erro ao carregar encomendas pendentes' : 
               filterStatus === 'delivered' ? 'Erro ao carregar encomendas retiradas' : 
               'Erro ao carregar encomendas'}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={fetchPackages}>Tentar Novamente</Button>
          </div>
        ) : displayData.length === 0 ? (
          <div className="col-span-full bg-white rounded-2xl border border-zinc-100 shadow-sm py-12 flex flex-col items-center justify-center">
            <Package className="w-8 h-8 text-zinc-300 mb-2" />
            <p className="text-sm text-zinc-500">
              {filterStatus === 'pending' ? 'Nenhuma encomenda pendente encontrada' : 
               filterStatus === 'delivered' ? 'Nenhuma encomenda retirada encontrada' : 
               'Nenhuma encomenda encontrada'}
            </p>
          </div>
        ) : (
          displayData.map((pkg: any) => (
            <div key={pkg.package_id} className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-4 hover:shadow-md transition-all group relative flex flex-col">
              {/* Linha 1: Nome do morador (destaque) */}
              <div className="mb-0.5">
                <h4 className="font-bold text-zinc-900 text-base truncate" title={pkg.recipient_name}>
                  {pkg.recipient_name}
                </h4>
              </div>

              {/* Linha 2: Unidade */}
              <div className="mb-3">
                <p className="text-sm text-zinc-500 font-medium">
                  {formatPackageUnit(pkg)}
                </p>
              </div>

              {/* Linha 3: Código de retirada + Status (lado a lado) */}
              <div className="flex items-center justify-between mb-3 bg-zinc-50 p-2.5 rounded-xl">
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Código</span>
                  <span className="font-mono text-sm font-bold text-emerald-600">{pkg.pickup_code || '-'}</span>
                </div>
                <Badge variant={pkg.status === 'delivered' ? 'gray' : 'amber'}>
                  {pkg.status === 'delivered' ? 'Retirada' : 'Pendente'}
                </Badge>
              </div>

              {/* Linha 4: Recebido e Retirada (lado a lado) */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Recebido</span>
                  <span className="text-xs text-zinc-700 font-semibold">{formatSafeDate(pkg.received_at)}</span>
                  <span className="text-[10px] text-zinc-400">{formatSafeDateTime(pkg.received_at).split(' ')[1]}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Retirada</span>
                  {pkg.delivered_at ? (
                    <>
                      <span className="text-xs text-emerald-600 font-bold">{formatSafeDate(pkg.delivered_at)}</span>
                      <span className="text-[10px] text-emerald-500/70">{formatSafeDateTime(pkg.delivered_at).split(' ')[1]}</span>
                    </>
                  ) : (
                    <span className="text-xs text-zinc-300 italic">Pendente</span>
                  )}
                </div>
              </div>

              {/* Linha 5: Transportadora */}
              <div className="flex items-center gap-2 mb-3 text-zinc-600">
                <Truck className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-xs font-medium truncate">{pkg.carrier || 'Não informada'}</span>
              </div>

              {/* Linha 6: Forma de retirada (QR ou código) */}
              <div className="mt-auto pt-3 border-t border-zinc-100 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {pkg.delivery_method === 'qr_code' ? (
                    <QrCode className="w-3.5 h-3.5 text-indigo-500" />
                  ) : pkg.delivery_method === 'photo' || pkg.delivery_method === 'foto' ? (
                    <Camera className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Mail className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                  <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                    {getDeliveryMethodLabel(pkg.delivery_method)}
                  </span>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-1.5">
                  <button 
                    onClick={() => { setSelectedPackage(pkg); setIsModalOpen(true); }}
                    className="p-1.5 hover:bg-zinc-100 rounded-lg text-zinc-400 hover:text-zinc-600 transition-colors"
                    title="Ver detalhes"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  {pkg.status !== 'delivered' && (
                    <button 
                      onClick={() => { setPkgForDelivery(pkg); setIsDeliveryModalOpen(true); }}
                      disabled={actionLoading}
                      className="p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-500 hover:text-emerald-600 transition-colors disabled:opacity-50"
                      title="Marcar como retirada"
                    >
                      <CheckCircle className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title="Detalhes da Encomenda"
      >
        {selectedPackage && (
          <div className="space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">ID da Encomenda</label>
                <p className="text-xs font-mono text-zinc-500">{selectedPackage.package_id}</p>
              </div>
              <Badge variant={(selectedPackage.status === 'delivered' || selectedPackage.delivered_at) ? 'gray' : 'amber'}>
                {(selectedPackage.status === 'delivered' || selectedPackage.delivered_at) ? 'Retirada' : 'Pendente'}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">Morador</label>
                <p className="font-bold text-zinc-900">{selectedPackage.recipient_name}</p>
                <p className="text-sm text-zinc-500">
                  {formatPackageUnit(selectedPackage)}
                </p>
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">Transportadora</label>
                <p className="font-bold text-zinc-900">{selectedPackage.carrier}</p>
                <div className="mt-2 space-y-2">
                  {selectedPackage.tracking_code && (
                    <div className="flex flex-col">
                      <span className="text-[9px] font-bold text-zinc-400 tracking-widest uppercase">Código da etiqueta</span>
                      <p className="text-xs font-mono text-zinc-600">{selectedPackage.tracking_code}</p>
                    </div>
                  )}
                  <div className="flex flex-col">
                    <span className="text-[9px] font-bold text-zinc-400 tracking-widest uppercase">Código de retirada</span>
                    <p className="text-sm font-mono text-zinc-900 font-bold">{selectedPackage.pickup_code || 'Sem código'}</p>
                  </div>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">Registrado por</label>
                <p className="text-sm text-zinc-900">{selectedPackage.registered_by_name || 'Portaria'}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">Em {formatSafeDateTime(selectedPackage.received_at)}</p>
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">Status Atual</label>
                {(selectedPackage.status === 'delivered' || selectedPackage.delivered_at) ? (
                  <div className="space-y-1">
                    <p className="text-xs text-zinc-600">
                      Retirada em {formatSafeDateTime(selectedPackage.delivered_at)}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Forma: {getDeliveryMethodLabel(selectedPackage.delivery_method)}
                    </p>
                    {selectedPackage.delivered_by_name && (
                      <p className="text-xs text-zinc-400 italic">
                        Baixa por: {selectedPackage.delivered_by_name}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-amber-600 font-bold">Aguardando retirada</p>
                )}
              </div>
            </div>

            <div className="p-4 bg-zinc-50 rounded-2xl space-y-3">
              <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Ações de Notificação</h4>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-zinc-900">WhatsApp Cloud API</p>
                  <p className="text-xs text-zinc-500">Reenviar notificação para o morador</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleResendNotification(selectedPackage)} loading={actionLoading}>
                  Reenviar
                </Button>
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-zinc-100">
              {selectedPackage.status !== 'delivered' && (
                <Button 
                  className="flex-1" 
                  onClick={() => { setPkgForDelivery(selectedPackage); setIsDeliveryModalOpen(true); }} 
                  loading={actionLoading}
                >
                  Entregar Agora
                </Button>
              )}
              <Button variant="danger" size="sm" onClick={() => handleDelete(selectedPackage)} loading={actionLoading}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal 
        isOpen={isDeliveryModalOpen} 
        onClose={() => { 
          if (!isDeliverySuccess) {
            setIsDeliveryModalOpen(false); 
          }
        }} 
        title={isDeliverySuccess ? "" : "Confirmar Entrega"}
      >
        {pkgForDelivery && (
          <div className="space-y-6">
            {/* DEBUG INFO */}
            <div className="bg-zinc-900 text-[10px] text-zinc-400 p-2 rounded-lg font-mono mb-4">
              <p>Component: SyndicPanel (PackagesList)</p>
              <p>Flow: {pkgForDelivery.delivery_method === 'qr_code' ? 'qr_code' : pkgForDelivery.pickup_code ? 'pickup_code' : 'manual'}</p>
              <p>Method: {pkgForDelivery.delivery_method || 'null'}</p>
              <p>Code: {pkgForDelivery.pickup_code || 'null'}</p>
              <p>Condition: {(pkgForDelivery.delivery_method !== 'qr_code' && !pkgForDelivery.pickup_code) ? 'TRUE (PHOTO REQ)' : 'FALSE'}</p>
            </div>

            {isDeliverySuccess ? (
              <div className="flex flex-col items-center justify-center py-8 space-y-6 animate-in fade-in zoom-in duration-300">
                <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 shadow-sm">
                  <CheckCircle className="w-14 h-14" />
                </div>
                <div className="text-center space-y-2">
                  <h3 className="text-2xl font-bold text-zinc-900">Entrega Confirmada!</h3>
                  <p className="text-sm text-zinc-500">A baixa foi registrada com sucesso.</p>
                </div>
                <div className="w-full pt-4">
                  <Button 
                    variant="outline" 
                    className="w-full py-6 text-base font-bold border-2"
                    onClick={() => {
                      setIsDeliveryModalOpen(false);
                      setIsDeliverySuccess(false);
                      setPkgForDelivery(null);
                      setDeliveryPhoto(null);
                      setConfirmationCode('');
                    }}
                  >
                    Escanear outro
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Morador</p>
                  <p className="font-bold text-zinc-900">{pkgForDelivery.recipient_name}</p>
                  <p className="text-sm text-zinc-500">{formatPackageUnit(pkgForDelivery)}</p>
                </div>

                {!deliveryPhoto && (
                  <div className="space-y-4">
                    {pkgForDelivery.delivery_method !== 'qr_code' && !pkgForDelivery.pickup_code ? (
                      <div className="space-y-4">
                        <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 flex items-start gap-3">
                          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm font-bold text-amber-900">Foto Obrigatória</p>
                            <p className="text-xs text-amber-700">Esta encomenda não possui QR Code ou código. É necessário registrar uma foto para confirmar a retirada.</p>
                          </div>
                        </div>
                        
                        <input 
                          type="file" 
                          accept="image/*" 
                          capture="environment" 
                          className="hidden" 
                          ref={fileInputRef}
                          onChange={handleFileChange}
                        />
                        <Button 
                          onClick={() => fileInputRef.current?.click()}
                          variant="primary"
                          className="w-full py-6 text-lg font-bold shadow-lg shadow-emerald-100"
                        >
                          <Camera className="w-6 h-6" />
                          CONFIRMAR RETIRADA COM FOTO
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Código de Retirada (Opcional)</label>
                          <Input 
                            placeholder="Digite o código se houver"
                            value={confirmationCode}
                            onChange={(e: any) => setConfirmationCode(e.target.value)}
                          />
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                          <Button 
                            onClick={() => handleConfirmDelivery('manual')}
                            variant="outline"
                            className="w-full py-4"
                            loading={actionLoading}
                          >
                            <CheckCircle className="w-5 h-5" />
                            Confirmar Entrega Manual
                          </Button>
                          <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                              <span className="w-full border-t border-zinc-100" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                              <span className="bg-white px-2 text-zinc-400 font-bold">ou</span>
                            </div>
                          </div>
                          <input 
                            type="file" 
                            accept="image/*" 
                            capture="environment" 
                            className="hidden" 
                            ref={fileInputRef}
                            onChange={handleFileChange}
                          />
                          <Button 
                            onClick={() => fileInputRef.current?.click()}
                            variant="primary"
                            className="w-full py-4"
                          >
                            <Camera className="w-5 h-5" />
                            📸 Tirar foto com encomenda
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {deliveryPhoto && (
                  <div className="space-y-4">
                    <div className="relative aspect-video bg-zinc-100 rounded-2xl overflow-hidden border border-zinc-200">
                      <img src={deliveryPhoto} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex gap-3">
                      <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="flex-1">Refazer</Button>
                      <Button 
                        variant="primary" 
                        onClick={() => handleConfirmDelivery('photo')} 
                        className="flex-1"
                        loading={actionLoading}
                      >
                        Confirmar foto
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

const ResidentsList = ({ user, residents = [], onUpdate }: any) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingResident, setEditingResident] = useState<any>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [residentToDeactivate, setResidentToDeactivate] = useState<any>(null);
  const [formData, setFormData] = useState({
    nome: '',
    unidade: '',
    telefone: '',
    ativo: true,
    unit_type: '',
    block: '',
    lote: '',
    street: ''
  });

  const filtered = (residents || []).filter((r: any) => 
    (r.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.unidade?.includes(searchTerm))
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editingResident) {
        const { error } = await supabase
          .from('moradores')
          .update(formData)
          .eq('id', editingResident.id);
        if (error) throw error;
        toast.success("Morador atualizado!");
      } else {
        const { error } = await supabase
          .from('moradores')
          .insert([{ ...formData, condominium_id: user.condominium_id }]);
        if (error) throw error;
        toast.success("Morador cadastrado!");
      }
      onUpdate();
      setIsModalOpen(false);
      setEditingResident(null);
      setFormData({ nome: '', unidade: '', telefone: '', ativo: true, unit_type: '', block: '', lote: '', street: '' });
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: string, currentStatus: boolean) => {
    setResidentToDeactivate({ id, currentStatus });
    setIsConfirmOpen(true);
  };

  const confirmDeactivation = async () => {
    if (!residentToDeactivate) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('moradores')
        .update({ ativo: !residentToDeactivate.currentStatus })
        .eq('id', residentToDeactivate.id);

      if (!error) {
        toast.success(`Morador ${residentToDeactivate.currentStatus ? 'desativado' : 'reativado'}`);
        onUpdate();
      } else {
        toast.error("Erro ao alterar status");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro inesperado");
    } finally {
      setLoading(false);
      setIsConfirmOpen(false);
      setResidentToDeactivate(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-2xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white" 
            placeholder="Buscar morador..." 
          />
        </div>
        <Button onClick={() => { setEditingResident(null); setFormData({ nome: '', unidade: '', telefone: '', ativo: true, unit_type: '', block: '', lote: '', street: '' }); setIsModalOpen(true); }}>
          <UserPlus className="w-4 h-4" />
          Novo Morador
        </Button>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-100">
                <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest">Nome</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest">Unidade</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest">Telefone</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {filtered.map((res: any) => (
                <tr key={res.id} className={`hover:bg-zinc-50 transition-colors group ${!res.ativo ? 'opacity-60 grayscale' : ''}`}>
                  <td className="px-6 py-4 font-bold text-zinc-900">{res.nome}</td>
                  <td className="px-6 py-4 text-sm text-zinc-600">{formatResidentAddress(res)}</td>
                  <td className="px-6 py-4 text-sm text-zinc-600">{res.telefone}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${res.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-200 text-zinc-600'}`}>
                      {res.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => { 
                          setEditingResident(res); 
                          setFormData({ 
                            nome: res.nome, 
                            unidade: res.unidade, 
                            telefone: res.telefone, 
                            ativo: res.ativo ?? true, 
                            unit_type: res.unit_type || '', 
                            block: res.block || res.bloco || '', 
                            lote: res.lote || '',
                            street: res.street || '' 
                          }); 
                          setIsModalOpen(true); 
                        }}
                        title="Editar"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      {(user.role === 'sindico' || user.role === 'admin') && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className={res.ativo ? "text-red-500 hover:bg-red-50" : "text-emerald-500 hover:bg-emerald-50"} 
                          onClick={() => handleDelete(res.id, res.ativo ?? true)}
                          title={res.ativo ? "Desativar" : "Reativar"}
                        >
                          {res.ativo ? <Trash2 className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                          <span className="ml-1 text-[10px] font-bold uppercase">
                            {res.ativo ? 'Inativar' : 'Ativar'}
                          </span>
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={editingResident ? "Editar Morador" : "Cadastrar Morador"}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Nome Completo</label>
            <input 
              required
              value={formData.nome}
              onChange={(e) => setFormData({...formData, nome: e.target.value})}
              className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Tipo de Unidade</label>
              <select 
                value={formData.unit_type}
                onChange={(e) => setFormData({...formData, unit_type: e.target.value})}
                className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
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
              <label className="block text-sm font-medium text-zinc-700 mb-1">Número da Unidade</label>
              <input 
                required
                value={formData.unidade}
                onChange={(e) => setFormData({...formData, unidade: e.target.value})}
                className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Bloco / Torre</label>
              <input 
                value={formData.block}
                onChange={(e) => setFormData({...formData, block: e.target.value})}
                className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Ex: Bloco B"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Lote / Quadra</label>
              <input 
                value={formData.lote}
                onChange={(e) => setFormData({...formData, lote: e.target.value})}
                className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Ex: Lote 4"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Rua / Endereço</label>
              <input 
                value={formData.street}
                onChange={(e) => setFormData({...formData, street: e.target.value})}
                className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Ex: Rua das Palmeiras"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Telefone (WhatsApp)</label>
            <input 
              required
              value={formData.telefone}
              onChange={(e) => setFormData({...formData, telefone: e.target.value})}
              className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="5511999999999"
            />
          </div>
          <div className="flex items-center gap-2">
            <input 
              type="checkbox"
              id="active"
              checked={formData.ativo}
              onChange={(e) => setFormData({...formData, ativo: e.target.checked})}
              className="w-4 h-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500" 
            />
            <label htmlFor="active" className="text-sm font-medium text-zinc-700">Morador Ativo</label>
          </div>
          <Button type="submit" className="w-full py-3" loading={loading}>
            {editingResident ? 'Salvar Alterações' : 'Cadastrar Morador'}
          </Button>
        </form>
      </Modal>

      <Modal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        title={residentToDeactivate?.currentStatus ? "Desativar Morador" : "Reativar Morador"}
      >
        <div className="space-y-6 text-center">
          <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center ${residentToDeactivate?.currentStatus ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
            {residentToDeactivate?.currentStatus ? <Trash2 className="w-8 h-8" /> : <RefreshCw className="w-8 h-8" />}
          </div>
          <div>
            <p className="text-zinc-600">
              Deseja {residentToDeactivate?.currentStatus ? 'desativar' : 'reativar'} este morador?
            </p>
            {!residentToDeactivate?.currentStatus && (
              <p className="text-xs text-zinc-400 mt-2">Ele voltará a aparecer nas buscas da portaria.</p>
            )}
            {residentToDeactivate?.currentStatus && (
              <p className="text-xs text-zinc-400 mt-2">Ele não aparecerá mais nas buscas da portaria, mas o histórico será mantido.</p>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setIsConfirmOpen(false)}>Cancelar</Button>
            <Button 
              variant={residentToDeactivate?.currentStatus ? "danger" : "primary"} 
              className="flex-1" 
              onClick={confirmDeactivation}
              loading={loading}
            >
              Confirmar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

// --- Reports Component ---

const Reports = ({ packages = [] }: any) => {
  const pkgs = packages || [];
  const carrierData = pkgs.reduce((acc: any, p: any) => {
    acc[p.carrier] = (acc[p.carrier] || 0) + 1;
    return acc;
  }, {});

  const pieData = Object.entries(carrierData).map(([name, value]) => ({ name, value }));
  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

  const unitData = pkgs.reduce((acc: any, p: any) => {
    acc[p.unit_number] = (acc[p.unit_number] || 0) + 1;
    return acc;
  }, {});

  const barData = Object.entries(unitData)
    .map(([name, value]) => ({ name: `Apto ${name}`, value: value as number }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <h3 className="font-bold text-zinc-900 mb-6 flex items-center gap-2">
          <Truck className="w-5 h-5 text-emerald-600" />
          Encomendas por Transportadora
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <h3 className="font-bold text-zinc-900 mb-6 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          Unidades com Maior Volume
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f4f4f5" />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
              <Tooltip cursor={{fill: 'transparent'}} />
              <Bar dataKey="value" fill="#3b82f6" radius={[0, 10, 10, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
};

// --- Notifications Component ---

const NotificationsPanel = ({ logs = [], onUpdate }: any) => {
  const [searchTerm, setSearchTerm] = useState('');
  
  const filtered = (logs || []).filter((l: any) => 
    (l.telefone || '').includes(searchTerm) || 
    (l.status || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (l.status_envio || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-2xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white" 
            placeholder="Buscar por telefone..." 
          />
        </div>
        <Button variant="outline" onClick={onUpdate}>
          <RefreshCw className="w-4 h-4" />
          Atualizar Logs
        </Button>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-100">
                <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest">Destinatário</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest">Data / Hora</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-zinc-400 uppercase tracking-widest">Erro API</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {filtered.map((log: any) => (
                <tr key={log.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-zinc-400" />
                      <p className="text-sm font-medium text-zinc-900">{log.telefone}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-600">
                    {formatDate(log.data_envio, 'dd/MM HH:mm:ss')}
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={(log.status_envio === 'sucesso' || log.status === 'sent') ? 'emerald' : 'red'}>
                      {(log.status_envio === 'sucesso' || log.status === 'sent') ? 'Enviado' : 'Falha'}
                    </Badge>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-xs text-red-500 max-w-xs truncate" title={log.erro_api}>
                      {log.erro_api || '-'}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

// --- Settings Component ---

const SettingsPanel = ({ user, systemStatus }: any) => {
  const [condo, setCondo] = useState<any>(null);
  const [settings, setSettings] = useState<CondominiumSettings | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const { data: condoData } = await supabase.from('condominiums').select('*').eq('id', user.condominium_id).single();
    setCondo(condoData);

    const { data: settingsData } = await supabase.from('condominium_settings').select('*').eq('condominium_id', user.condominium_id).maybeSingle();
    if (settingsData) {
      setSettings(settingsData);
    } else {
      // Default settings
      setSettings({
        id: '',
        condominium_id: user.condominium_id,
        notification_template: '📦 Nova encomenda recebida\n\nOlá, {{name}}\n\nUma encomenda chegou para sua unidade {{unit}}.\n\nVocê já pode retirar na portaria.',
        reminder_48h_enabled: true,
        reminder_72h_enabled: true,
        contact_phone: ''
      });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Update condo name/address
      await supabase.from('condominiums').update({ name: condo.name, address: condo.address }).eq('id', condo.id);

      // Upsert settings
      const { error } = await supabase.from('condominium_settings').upsert({
        ...settings,
        condominium_id: user.condominium_id
      }, { onConflict: 'condominium_id' });

      if (error) throw error;
      toast.success("Configurações salvas!");
    } catch (err) {
      toast.error("Erro ao salvar");
    } finally {
      setLoading(false);
    }
  };

  if (!condo || !settings) return <div className="flex justify-center p-12"><RefreshCw className="w-8 h-8 animate-spin text-emerald-600" /></div>;

  return (
    <Card className="max-w-2xl mx-auto">
      {systemStatus && !systemStatus?.whatsapp?.configured && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-center gap-3">
          <Phone className="w-5 h-5 text-amber-600" />
          <p className="text-xs text-amber-800 font-medium">
            O WhatsApp ainda não foi configurado no servidor. As mensagens abaixo são apenas modelos para quando o serviço for ativado.
          </p>
        </div>
      )}
      <form onSubmit={handleSave} className="space-y-6">
        <div className="space-y-4">
          <h3 className="font-bold text-zinc-900 flex items-center gap-2">
            <Home className="w-5 h-5 text-emerald-600" />
            Dados do Condomínio
          </h3>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Nome do Condomínio</label>
              <input 
                value={condo.name}
                onChange={(e) => setCondo({...condo, name: e.target.value})}
                className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Endereço</label>
              <input 
                value={condo.address}
                onChange={(e) => setCondo({...condo, address: e.target.value})}
                className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-6 border-t border-zinc-100">
          <h3 className="font-bold text-zinc-900 flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-500" />
            Notificações & Lembretes
          </h3>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Template de Mensagem (WhatsApp)</label>
            <textarea 
              rows={4}
              value={settings.notification_template}
              onChange={(e) => setSettings({...settings, notification_template: e.target.value})}
              className="w-full px-4 py-2 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            />
            <p className="text-[10px] text-zinc-400 mt-1 uppercase font-bold">Variáveis: {"{{name}}"}, {"{{unit}}"}, {"{{carrier}}"}</p>
          </div>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-3 cursor-pointer group">
              <input 
                type="checkbox" 
                checked={settings.reminder_48h_enabled}
                onChange={(e) => setSettings({...settings, reminder_48h_enabled: e.target.checked})}
                className="w-5 h-5 rounded-lg border-zinc-300 text-emerald-600 focus:ring-emerald-500" 
              />
              <span className="text-sm text-zinc-700 group-hover:text-zinc-900 transition-colors">Ativar lembrete automático após 48h</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer group">
              <input 
                type="checkbox" 
                checked={settings.reminder_72h_enabled}
                onChange={(e) => setSettings({...settings, reminder_72h_enabled: e.target.checked})}
                className="w-5 h-5 rounded-lg border-zinc-300 text-emerald-600 focus:ring-emerald-500" 
              />
              <span className="text-sm text-zinc-700 group-hover:text-zinc-900 transition-colors">Ativar lembrete automático após 72h</span>
            </label>
          </div>
        </div>

        <Button type="submit" className="w-full py-3" loading={loading}>
          Salvar Configurações
        </Button>
      </form>
    </Card>
  );
};

// --- Main Syndic Panel Component ---

export default function SyndicPanel({ user, onLogout }: { user: Profile; onLogout: () => void }) {
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [residents, setResidents] = useState<Profile[]>([]);
  const [logs, setLogs] = useState<MessageLog[]>([]);
  const [condoName, setCondoName] = useState('');
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Determine active tab from URL
  const getActiveTab = () => {
    const path = location.pathname;
    if (path.includes('/packages')) return 'packages';
    if (path.includes('/residents')) return 'residents';
    if (path.includes('/reports')) return 'reports';
    if (path.includes('/notifications')) return 'notifications';
    if (path.includes('/settings')) return 'settings';
    if (path.includes('/profiles')) return 'profiles';
    if (path.includes('/users')) return 'users';
    if (path.includes('/audit')) return 'audit';
    return 'dashboard';
  };

  const activeTab = getActiveTab();

  useEffect(() => {
    if (user && user.must_change_password && location.pathname !== '/change-password') {
      navigate('/change-password');
      return;
    }
    fetchInitialData();
    checkSystemStatus();
  }, [user, location.pathname]);

  const checkSystemStatus = async () => {
    try {
      const response = await fetch('/api/system-status');
      const data = await response.json();
      setSystemStatus(data);
    } catch (err) {
      console.warn("Erro ao verificar status do sistema:", err);
    }
  };

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      // Fetch Condo Name
      const { data: condo } = await supabase.from('condominiums').select('name').eq('id', user.condominium_id).single();
      if (condo) setCondoName(condo.name);

      // Fetch Residents
      const { data: res } = await supabase
        .from('moradores')
        .select('*')
        .eq('condominium_id', user.condominium_id)
        .order('nome');
      if (res) setResidents(res);

      // Fetch Logs
      const { data: messageLogs } = await supabase
        .from('message_logs')
        .select('*')
        .eq('condominium_id', user.condominium_id)
        .order('data_envio', { ascending: false })
        .limit(100);
      if (messageLogs) setLogs(messageLogs);

    } catch (err) {
      console.error("Erro ao carregar dados do síndico:", err);
    } finally {
      setLoading(false);
    }
  };

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'packages', label: 'Encomendas', icon: Package },
    { id: 'residents', label: 'Moradores', icon: Users },
    { id: 'reports', label: 'Relatórios', icon: FileText },
    { id: 'notifications', label: 'Notificações', icon: Bell },
    { id: 'settings', label: 'Configurações', icon: Settings },
    ...(user.role === 'admin' ? [
      { id: 'profiles', label: 'Perfis', icon: UserPlus },
      { id: 'users', label: 'Usuários', icon: Shield },
      { id: 'audit', label: 'Auditoria', icon: History }
    ] : user.role === 'sindico' ? [
      { id: 'users', label: 'Usuários', icon: Shield }
    ] : []),
  ];

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50">
      <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col md:flex-row">
      {/* Sidebar / Mobile Nav */}
      <aside className="w-full md:w-64 bg-white border-r border-zinc-100 flex flex-col h-auto md:h-screen sticky top-0 z-40">
        <div className="p-6 border-b border-zinc-50">
          <div className="flex items-center justify-between mb-4">
            {user.role === 'admin' && (
              <button 
                onClick={() => navigate('/portaria')}
                className="p-2 hover:bg-zinc-100 rounded-xl text-zinc-500 transition-all flex items-center gap-2"
                title="Alternar para Portaria"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="text-[10px] font-bold uppercase">Portaria</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 mb-1 cursor-pointer" onClick={() => navigate('/dashboard')}>
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
              <Package className="w-5 h-5" />
            </div>
            <h1 className="font-bold text-zinc-900 truncate">{condoName || 'Portaria'}</h1>
          </div>
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Painel do Síndico</p>
        </div>

        <nav className="flex-1 p-4 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(`/${item.id === 'dashboard' ? 'dashboard' : item.id}`)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all whitespace-nowrap md:whitespace-normal ${
                activeTab === item.id 
                  ? 'bg-emerald-50 text-emerald-700 font-bold' 
                  : 'text-zinc-500 hover:bg-zinc-50'
              }`}
            >
              <item.icon className={`w-5 h-5 ${activeTab === item.id ? 'text-emerald-600' : 'text-zinc-400'}`} />
              <span className="text-sm">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-zinc-50 hidden md:block">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 bg-zinc-100 rounded-full flex items-center justify-center text-zinc-500">
              <User className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-zinc-900 truncate">{user.full_name}</p>
              <p className="text-xs text-zinc-500 truncate">
                {user.role === 'admin' ? 'Administrador' : 'Síndico'}
              </p>
            </div>
          </div>
          <Button variant="ghost" className="w-full justify-start text-red-500 hover:bg-red-50" onClick={onLogout}>
            <LogOut className="w-4 h-4" />
            Sair
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 sm:p-8 overflow-y-auto">
        <header className="flex justify-between items-center mb-8 md:hidden">
          <h2 className="text-xl font-bold text-zinc-900">{menuItems.find(m => m.id === activeTab)?.label}</h2>
          <Button variant="ghost" size="sm" onClick={onLogout}><LogOut className="w-5 h-5 text-red-500" /></Button>
        </header>

        <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-500">
          <Routes>
            <Route path="/dashboard" element={<Dashboard user={user} residents={residents} logs={logs} systemStatus={systemStatus} />} />
            <Route path="/packages" element={<PackagesList user={user} />} />
            <Route path="/residents" element={<ResidentsList user={user} residents={residents} onUpdate={fetchInitialData} />} />
            <Route path="/reports" element={<Reports packages={packages} />} />
            <Route path="/notifications" element={<NotificationsPanel logs={logs} onUpdate={fetchInitialData} />} />
            <Route path="/settings" element={<SettingsPanel user={user} systemStatus={systemStatus} />} />
            <Route path="/profiles" element={<ProfileList user={user} />} />
            <Route path="/profiles/new" element={<ProfileNew user={user} />} />
            <Route path="/users" element={<UserManagement user={user} />} />
            <Route path="/audit" element={<AuditLogs user={user} />} />
            <Route path="/condominiums/new" element={<CondominiumNew user={user} onUpdateUser={() => {}} />} />
            <Route path="/" element={<Navigate to="/dashboard" />} />
            <Route path="*" element={<Navigate to="/dashboard" />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
