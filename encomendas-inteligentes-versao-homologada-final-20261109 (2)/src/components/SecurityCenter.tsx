import React, { useState, useEffect } from 'react';
import { 
  Shield, ShieldAlert, ShieldCheck, Laptop, Smartphone, Globe, AlertTriangle, 
  AlertCircle, Ban, Bell, CheckCircle, Trash2, RefreshCw, LogOut, Mail, 
  Phone, Clock, Key, Eye, EyeOff, Check, X, ShieldX, Play, Zap, Info,
  Search, Sliders, Monitor, MapPin, User, ChevronRight, MessageSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import { 
  Profile, SecurityDevice, SecurityAccessAttempt, SecurityAccessLog, 
  SecurityAlert, SecuritySettingsConfig 
} from '../types';

interface SecurityCenterProps {
  user: Profile;
  onOpenCenter?: () => void;
}

// Initial Mock Seed Data
const DEFAULT_DEVICES: SecurityDevice[] = [
  {
    id: 'dev-001',
    user_id: '00000000-0000-0000-0000-000000000001',
    user_name: 'Administrador Principal',
    user_role: 'admin',
    device_id: 'FP-WIN-88392-ADMIN',
    model: 'Dell XPS 15 (Windows 11)',
    system_os: 'Windows NT 10.0; Win64; x64',
    status: 'authorized',
    ip: '191.185.12.105',
    city: 'Curitiba',
    country: 'Brasil',
    last_accessed_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    authorized_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'dev-002',
    user_id: '00000000-0000-0000-0000-000000000002',
    user_name: 'Porteiro Silva',
    user_role: 'porteiro',
    device_id: 'FP-IPAD-09123-PORTARIA',
    model: 'iPad Air 5 (iOS 17)',
    system_os: 'iPadOS 17.4',
    status: 'authorized',
    ip: '177.34.82.201',
    city: 'Curitiba',
    country: 'Brasil',
    last_accessed_at: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    authorized_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'dev-003',
    user_id: '00000000-0000-0000-0000-000000000003',
    user_name: 'Síndico Oliveira',
    user_role: 'sindico',
    device_id: 'FP-APL-76293-SIND',
    model: 'Apple iPhone 15 Pro Max',
    system_os: 'iOS 17.5',
    status: 'authorized',
    ip: '189.92.10.45',
    city: 'Pinhais',
    country: 'Brasil',
    last_accessed_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    authorized_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
  }
];

const DEFAULT_PENDING_DEVICES: SecurityDevice[] = [
  {
    id: 'dev-pending-001',
    user_id: 'user-092-mock',
    user_name: 'Porteiro Auxiliar Jorge',
    user_role: 'porteiro',
    device_id: 'FP-AND-11029-PORTAUX',
    model: 'Samsung Galaxy S24 Ultra',
    system_os: 'Android 14; OneUI 6.1',
    status: 'pending',
    ip: '186.233.15.89',
    city: 'Araucária',
    country: 'Brasil',
    last_accessed_at: new Date(Date.now() - 15 * 60 * 1000).toISOString()
  }
];

const DEFAULT_ATTEMPTS: SecurityAccessAttempt[] = [
  {
    id: 'att-001',
    login_used: 'john.doe@email.com',
    ip: '179.221.43.12',
    city: 'Curitiba',
    country: 'Brasil',
    device: 'Chrome / macOS 14.2',
    created_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    status: 'permitido'
  },
  {
    id: 'att-002',
    login_used: 'sindico@demo.com',
    ip: '190.102.23.44',
    city: 'Buenos Aires',
    country: 'Argentina',
    device: 'Safari / iOS 17',
    created_at: new Date(Date.now() - 45 * 1000 * 60).toISOString(),
    status: 'bloqueado' // International Block Case
  },
  {
    id: 'att-003',
    login_used: 'admin@demo.com',
    ip: '45.143.20.102',
    city: 'Kiev',
    country: 'Ucrânia',
    device: 'Firefox / Linux x86_64',
    created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    status: 'bloqueado' // Suspicious admin/international block
  },
  {
    id: 'att-004',
    login_used: 'porteiro_sub@demo.com',
    ip: '186.233.15.89',
    city: 'Araucária',
    country: 'Brasil',
    device: 'Galaxy S24 Ultra',
    created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    status: 'pendente' // Pending approval
  }
];

const DEFAULT_LOGS: SecurityAccessLog[] = [
  {
    id: 'slog-001',
    user_name: 'Administrador Principal',
    user_role: 'admin',
    ip: '191.185.12.105',
    city: 'Curitiba',
    country: 'Brasil',
    device: 'Dell XPS 15 (Windows 11)',
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString()
  },
  {
    id: 'slog-002',
    user_name: 'Porteiro Silva',
    user_role: 'porteiro',
    ip: '177.34.82.201',
    city: 'Curitiba',
    country: 'Brasil',
    device: 'iPad Air 5 (iOS 17)',
    created_at: new Date(Date.now() - 12 * 60 * 1000).toISOString()
  },
  {
    id: 'slog-003',
    user_name: 'Síndico Oliveira',
    user_role: 'sindico',
    ip: '189.92.10.45',
    city: 'Pinhais',
    country: 'Brasil',
    device: 'Apple iPhone 15 Pro Max',
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
  }
];

const DEFAULT_ALERTS: SecurityAlert[] = [
  {
    id: 'alt-001',
    event_type: 'bloqueio_internacional',
    title: 'Bloqueio Internacional Ativo',
    description: 'Tentativa de login bloqueada automaticamente proveniente de Buenos Aires, Argentina (IP: 190.102.23.44)',
    device_name: 'Safari / iOS 17',
    user_name: 'sindico@demo.com',
    city: 'Buenos Aires',
    ip: '190.102.23.44',
    created_at: new Date(Date.now() - 45 * 1000 * 60).toISOString(),
    read: false,
    critical: true
  },
  {
    id: 'alt-002',
    event_type: 'novo_dispositivo',
    title: 'Dispositivo Pendente de Autorização',
    description: 'Um novo dispositivo solicitou acesso ao sistema. Requer aprovação manual.',
    device_name: 'Galaxy S24 Ultra',
    user_name: 'Porteiro Auxiliar Jorge',
    city: 'Araucária',
    ip: '186.233.15.89',
    created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    read: false,
    critical: false
  }
];

const DEFAULT_SETTINGS: SecuritySettingsConfig = {
  alerts_push_enabled: true,
  alerts_email_enabled: true,
  alerts_critical_enabled: true,
  primary_email: 'admin@condominiointeligente.com',
  secondary_email: 'suporte@segurancamaxima.com.br',
  whatsapp_admin: '5541999998888',
  primary_device_id: 'FP-WIN-88392-ADMIN',
  primary_device_name: 'Dell XPS 15 (Windows 11)',
  max_simultaneous_sessions: 3,
  session_timeout_minutes: 60,
  critical_alert_mode_active: true
};

export default function SecurityCenter({ user, onOpenCenter }: SecurityCenterProps) {
  // Navigation inside security center
  const [activeTab, setActiveTab] = useState<'dashboard' | 'authorized' | 'pending' | 'attempts' | 'logs' | 'settings'>('dashboard');

  // Search terms
  const [searchTerm, setSearchTerm] = useState('');

  // Persistent States
  const [devices, setDevices] = useState<SecurityDevice[]>(() => {
    const saved = localStorage.getItem('encomendas_sec_devices');
    return saved ? JSON.parse(saved) : DEFAULT_DEVICES;
  });

  const [pendingDevices, setPendingDevices] = useState<SecurityDevice[]>(() => {
    const saved = localStorage.getItem('encomendas_sec_pending');
    return saved ? JSON.parse(saved) : DEFAULT_PENDING_DEVICES;
  });

  const [attempts, setAttempts] = useState<SecurityAccessAttempt[]>(() => {
    const saved = localStorage.getItem('encomendas_sec_attempts');
    return saved ? JSON.parse(saved) : DEFAULT_ATTEMPTS;
  });

  const [logs, setLogs] = useState<SecurityAccessLog[]>(() => {
    const saved = localStorage.getItem('encomendas_sec_logs');
    return saved ? JSON.parse(saved) : DEFAULT_LOGS;
  });

  const [alerts, setAlerts] = useState<SecurityAlert[]>(() => {
    const saved = localStorage.getItem('encomendas_sec_alerts');
    return saved ? JSON.parse(saved) : DEFAULT_ALERTS;
  });

  const [secSettings, setSecSettings] = useState<SecuritySettingsConfig>(() => {
    const saved = localStorage.getItem('encomendas_sec_settings');
    return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
  });

  // Simulator parameters & controls
  const [showSimulator, setShowSimulator] = useState(false);
  const [activePushNotification, setActivePushNotification] = useState<SecurityAlert | null>(null);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [isLockingEverything, setIsLockingEverything] = useState(false);

  // Sync to localstorage
  useEffect(() => {
    localStorage.setItem('encomendas_sec_devices', JSON.stringify(devices));
  }, [devices]);

  useEffect(() => {
    localStorage.setItem('encomendas_sec_pending', JSON.stringify(pendingDevices));
  }, [pendingDevices]);

  useEffect(() => {
    localStorage.setItem('encomendas_sec_attempts', JSON.stringify(attempts));
  }, [attempts]);

  useEffect(() => {
    localStorage.setItem('encomendas_sec_logs', JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem('encomendas_sec_alerts', JSON.stringify(alerts));
  }, [alerts]);

  useEffect(() => {
    localStorage.setItem('encomendas_sec_settings', JSON.stringify(secSettings));
  }, [secSettings]);

  // Push notification autohide
  useEffect(() => {
    if (activePushNotification) {
      const timer = setTimeout(() => {
        setActivePushNotification(null);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [activePushNotification]);

  // 1. Authorize Device
  const handleAuthorizeDevice = (dev: SecurityDevice, isTemporary: boolean = false) => {
    const updatedDev: SecurityDevice = {
      ...dev,
      status: isTemporary ? 'temporary' : 'authorized',
      authorized_at: new Date().toISOString(),
      expires_at: isTemporary ? new Date(Date.now() + 24 * 3600 * 1000).toISOString() : undefined,
      last_accessed_at: new Date().toISOString()
    };

    setDevices(prev => [updatedDev, ...prev]);
    setPendingDevices(prev => prev.filter(x => x.id !== dev.id));

    // Register Log & Access Attempt update
    const newLog: SecurityAccessLog = {
      id: `slog-${Date.now()}`,
      user_name: dev.user_name,
      user_role: dev.user_role,
      ip: dev.ip,
      city: dev.city,
      country: dev.country,
      device: dev.model,
      created_at: new Date().toISOString()
    };
    setLogs(prev => [newLog, ...prev]);

    // Update Access Attempt list too if matched
    setAttempts(prev => prev.map(att => {
      if (att.ip === dev.ip && att.login_used.includes(dev.user_name.split(' ')[0].toLowerCase())) {
        return { ...att, status: 'permitido' };
      }
      return att;
    }));

    toast.success(`Dispositivo ${dev.model} ${isTemporary ? 'temporariamente' : ''} autorizado com sucesso!`);
  };

  // 2. Reject/Block Device
  const handleBlockDevice = (dev: SecurityDevice) => {
    // If pending
    if (dev.status === 'pending') {
      setPendingDevices(prev => prev.filter(x => x.id !== dev.id));
    } else {
      setDevices(prev => prev.filter(x => x.id !== dev.id));
    }

    // Add to attempts with blocked status or generate warning alert
    const blockedDevice: SecurityDevice = {
      ...dev,
      status: 'blocked',
      last_accessed_at: new Date().toISOString()
    };

    // Save blocked log
    const alertId = `alt-${Date.now()}`;
    const newAlert: SecurityAlert = {
      id: alertId,
      event_type: 'tentativa_bloqueada',
      title: 'Dispositivo Bloqueado do Sistema',
      description: `Acesso negado e credenciais revogadas para ${dev.model} (${dev.user_name})`,
      device_name: dev.model,
      user_name: dev.user_name,
      city: dev.city,
      ip: dev.ip,
      created_at: new Date().toISOString(),
      read: false,
      critical: true
    };

    setAlerts(prev => [newAlert, ...prev]);
    
    // Add persistent blocked attempt
    const newAttempt: SecurityAccessAttempt = {
      id: `att-${Date.now()}`,
      login_used: dev.user_name.toLowerCase().replace(/\s+/g, '') + '@demo.com',
      ip: dev.ip,
      city: dev.city,
      country: dev.country,
      device: dev.model,
      created_at: new Date().toISOString(),
      status: 'bloqueado'
    };
    setAttempts(prev => [newAttempt, ...prev]);

    toast.error(`Dispositivo ${dev.model} bloqueado e removido do sistema.`);
  };

  // 3. Revoke active authorized device
  const handleRevokeDevice = (devId: string) => {
    const dev = devices.find(x => x.id === devId);
    if (!dev) return;

    setDevices(prev => prev.filter(x => x.id !== devId));

    // Create log that access was terminated
    const endAlert: SecurityAlert = {
      id: `alt-${Date.now()}`,
      event_type: 'sessao_encerrada',
      title: 'Sessão Revogada pelo Administrador',
      description: `Dispositivo ${dev.model} teve seu acesso revogado e foi deslogado.`,
      device_name: dev.model,
      user_name: dev.user_name,
      city: dev.city,
      ip: dev.ip,
      created_at: new Date().toISOString(),
      read: false,
      critical: false
    };
    setAlerts(prev => [endAlert, ...prev]);
    toast.success(`Acesso revogado do ${dev.model}.`);
  };

  // 4. Terminate active session (simply trigger logs/alerts and mock disconnect)
  const handleTerminateSession = (dev: SecurityDevice) => {
    toast.success(`Conexão ativa encerrada para ${dev.model}.`);
    
    const sessAlert: SecurityAlert = {
      id: `alt-${Date.now()}`,
      event_type: 'sessao_encerrada',
      title: 'Sessão Encerrada Forçadamente',
      description: `A sessão ativa no dispositivo ${dev.model} (${dev.user_name}) foi terminated.`,
      device_name: dev.model,
      user_name: dev.user_name,
      city: dev.city,
      ip: dev.ip,
      created_at: new Date().toISOString(),
      read: true,
      critical: false
    };
    setAlerts(prev => [sessAlert, ...prev]);
  };

  // 5. Emergency Button: Lock all accesses except admin
  const handleEmergencyLock = () => {
    setIsLockingEverything(true);
    setTimeout(() => {
      // Keep only admin device
      const adminDevs = devices.filter(d => d.user_role === 'admin');
      setDevices(adminDevs);
      setPendingDevices([]);

      // Generate Critical Alert
      const alertId = `alt-${Date.now()}`;
      const critAlert: SecurityAlert = {
        id: alertId,
        event_type: 'alerta_critico',
        title: '🔒 BLOQUEIO GERAL ATIVADO',
        description: 'Botão de emergência acionado! Todos os acessos de usuários normais foram revogados e as sessões encerradas imediatamente.',
        device_name: 'Painel Central',
        user_name: user.full_name,
        city: 'Curitiba',
        ip: '191.185.12.105',
        created_at: new Date().toISOString(),
        read: false,
        critical: true
      };
      setAlerts(prev => [critAlert, ...prev]);

      // Add Access Attempt block logs
      const blockAttempt: SecurityAccessAttempt = {
        id: `att-${Date.now()}`,
        login_used: 'SISTEMA_BLOQUEIO_EMERGENCIA',
        ip: '0.0.0.0',
        city: 'Local',
        country: 'Sindicato',
        device: 'Sistema Central',
        created_at: new Date().toISOString(),
        status: 'bloqueado'
      };
      setAttempts(prev => [blockAttempt, ...prev]);

      setIsLockingEverything(false);
      setShowEmergencyModal(false);
      toast.error('Emergência: Todos os acessos de porteiros, síndicos e moradores foram revogados!');
    }, 1500);
  };

  // 6. Reset all simulated security data to initial default
  const handleResetData = () => {
    setDevices(DEFAULT_DEVICES);
    setPendingDevices(DEFAULT_PENDING_DEVICES);
    setAttempts(DEFAULT_ATTEMPTS);
    setLogs(DEFAULT_LOGS);
    setAlerts(DEFAULT_ALERTS);
    setSecSettings(DEFAULT_SETTINGS);
    toast.success('Central de Segurança reiniciada com dados padrão!');
  };

  // Event Simulation engine
  const handleSimulateEvent = (type: 'new_device' | 'international' | 'critical_admin' | 'repeated_fails') => {
    const timestamp = new Date().toISOString();
    
    if (type === 'new_device') {
      const pendingId = `dev-pending-${Date.now()}`;
      const deviceNames = ['Xiaomi Redmi Note 13', 'iPhone 11', 'Motorola Edge 40', 'MacBook Air M2'];
      const randomDevice = deviceNames[Math.floor(Math.random() * deviceNames.length)];
      const names = ['Moradora Luciana (Apto 102)', 'Zelador Carlos Bento', 'Porteiro Noturno Marcos'];
      const randomName = names[Math.floor(Math.random() * names.length)];
      
      const newPending: SecurityDevice = {
        id: pendingId,
        user_id: `user-${Date.now()}`,
        user_name: randomName,
        user_role: randomName.includes('Porteiro') ? 'porteiro' : randomName.includes('Zelador') ? 'porteiro' : 'resident',
        device_id: `FP-GEN-${Math.floor(10000 + Math.random() * 90000)}`,
        model: randomDevice,
        system_os: 'Dispositivo Móvel / Webkit',
        status: 'pending',
        ip: '177.105.42.' + Math.floor(1 + Math.random() * 254),
        city: 'Curitiba',
        country: 'Brasil',
        last_accessed_at: timestamp
      };

      setPendingDevices(prev => [newPending, ...prev]);

      const alertId = `alt-${Date.now()}`;
      const newAlert: SecurityAlert = {
        id: alertId,
        event_type: 'novo_dispositivo',
        title: '⚠ NOVO DISPOSITIVO DETECTADO',
        description: `Dispositivo pendente de autorização detectado para ${randomName} (${randomDevice})`,
        device_name: randomDevice,
        user_name: randomName,
        city: 'Curitiba',
        ip: newPending.ip,
        created_at: timestamp,
        read: false,
        critical: false
      };

      setAlerts(prev => [newAlert, ...prev]);

      // Trigger Push Simulated Notification
      if (secSettings.alerts_push_enabled) {
        setActivePushNotification(newAlert);
      }

      // Add to attempts
      const newAttempt: SecurityAccessAttempt = {
        id: `att-${Date.now()}`,
        login_used: randomName.toLowerCase().replace(/\s+/g, '') + '@edificio.com',
        ip: newPending.ip,
        city: 'Curitiba',
        country: 'Brasil',
        device: randomDevice,
        created_at: timestamp,
        status: 'pendente'
      };
      setAttempts(prev => [newAttempt, ...prev]);

      toast('Novo dispositivo solicitando autorização!', { icon: '📱' });

    } else if (type === 'international') {
      const randomCountry = ['Rússia', 'China', 'Ucrânia', 'Estados Unidos', 'Irã'][Math.floor(Math.random() * 5)];
      const randomCity = ['Moscou', 'Shenzhen', 'Kiev', 'Miami', 'Teerã'][Math.floor(Math.random() * 5)];
      const randomIP = `${Math.floor(45 + Math.random() * 150)}.${Math.floor(10 + Math.random() * 80)}.${Math.floor(12 + Math.random() * 200)}.${Math.floor(1 + Math.random() * 254)}`;
      
      const alertId = `alt-${Date.now()}`;
      const newAlert: SecurityAlert = {
        id: alertId,
        read: false,
        event_type: 'bloqueio_internacional',
        title: '🌎 BLOQUEIO INTERNACIONAL AUTOMÁTICO',
        description: `Tentativa de login bloqueada automaticamente proveniente de ${randomCity}, ${randomCountry} (IP: ${randomIP})`,
        device_name: 'Chrome / Linux x86_64',
        user_name: 'porteiro_automatico@condominio.com',
        city: randomCity,
        ip: randomIP,
        created_at: timestamp,
        critical: true
      };

      setAlerts(prev => [newAlert, ...prev]);

      if (secSettings.alerts_push_enabled) {
        setActivePushNotification(newAlert);
      }

      // Record access attempt
      const newAttempt: SecurityAccessAttempt = {
        id: `att-${Date.now()}`,
        login_used: 'porteiro@demo.com',
        ip: randomIP,
        city: randomCity,
        country: randomCountry,
        device: 'Mozilla / Linux x86',
        created_at: timestamp,
        status: 'bloqueado'
      };
      setAttempts(prev => [newAttempt, ...prev]);

      toast.error(`Bloqueio de tentativa estrangeira: Origem ${randomCity}, ${randomCountry}`);

    } else if (type === 'critical_admin') {
      const alertId = `alt-${Date.now()}`;
      const newAlert: SecurityAlert = {
        id: alertId,
        read: false,
        event_type: 'alerta_critico',
        title: '🚨 LOGIN ADMIN EM DISPOSITIVO DESCONHECIDO',
        description: 'Login da conta ADMINISTRADOR detectado fora do dispositivo confiável cadastrado. Verifique a segurança imediatamente.',
        device_name: 'Safari / MacBook Pro Desconhecido',
        user_name: 'Administrador Principal (admin@demo.com)',
        city: 'Porto Alegre',
        ip: '177.200.41.' + Math.floor(1 + Math.random() * 254),
        created_at: timestamp,
        critical: true
      };

      setAlerts(prev => [newAlert, ...prev]);

      if (secSettings.alerts_push_enabled) {
        setActivePushNotification(newAlert);
      }

      // Record attempt
      const newAttempt: SecurityAccessAttempt = {
        id: `att-${Date.now()}`,
        login_used: 'admin@demo.com',
        ip: newAlert.ip,
        city: 'Porto Alegre',
        country: 'Brasil',
        device: 'MacBook Pro Desconhecido',
        created_at: timestamp,
        status: 'bloqueado' // Blocked because not on trusted device while critical mode is ON
      };
      setAttempts(prev => [newAttempt, ...prev]);

      toast.error('Alerta Crítico: Login ADMIN detectado em dispositivo suspeito!');

    } else if (type === 'repeated_fails') {
      const alertId = `alt-${Date.now()}`;
      const newAlert: SecurityAlert = {
        id: alertId,
        read: false,
        event_type: 'alerta_critico',
        title: '🚨 ATAQUE DE FORÇA BRUTA DETECTADO',
        description: 'Mais de 5 tentativas consecutivas de acesso falhas em menos de 1 minuto para a conta syndic@demo.com.',
        device_name: 'Python Request Script',
        user_name: 'Desconhecido',
        city: 'Guarulhos',
        ip: '185.190.140.10',
        created_at: timestamp,
        critical: true
      };

      setAlerts(prev => [newAlert, ...prev]);

      if (secSettings.alerts_push_enabled) {
        setActivePushNotification(newAlert);
      }

      // Multiple false attempts
      for (let i = 0; i < 3; i++) {
        const dummyAttempt: SecurityAccessAttempt = {
          id: `att-${Date.now()}-${i}`,
          login_used: 'sindico@demo.com',
          ip: '185.190.140.10',
          city: 'Guarulhos',
          country: 'Brasil',
          device: 'Python-urllib/3.10',
          created_at: new Date(Date.now() - (3 - i) * 1000).toISOString(),
          status: 'bloqueado'
        };
        setAttempts(prev => [dummyAttempt, ...prev]);
      }

      toast.error('Ataque de Força Bruta detectado e IP bloqueado permanentemente.');
    }
  };

  // Filter lists based on search term
  const filteredAuthorizedDevices = devices.filter(d => 
    d.user_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.device_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.ip.includes(searchTerm)
  );

  const filteredPendingDevices = pendingDevices.filter(d => 
    d.user_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.ip.includes(searchTerm)
  );

  const filteredAttempts = attempts.filter(att => 
    att.login_used.toLowerCase().includes(searchTerm.toLowerCase()) ||
    att.ip.includes(searchTerm) ||
    att.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
    att.country.toLowerCase().includes(searchTerm.toLowerCase()) ||
    att.device.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredLogs = logs.filter(log => 
    log.user_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.ip.includes(searchTerm) ||
    log.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.device.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Stats computation for Dashboard
  const activeAlertsCount = alerts.filter(a => !a.read).length;
  const criticalAlertsCount = alerts.filter(a => a.critical && !a.read).length;
  const totalAuthorizedCount = devices.length;
  const totalPendingCount = pendingDevices.length;
  const totalBlockCount = attempts.filter(a => a.status === 'bloqueado').length;

  return (
    <div className="bg-slate-50 border border-slate-100 rounded-3xl p-6 sm:p-8 shadow-sm space-y-8 relative overflow-hidden">
      
      {/* Real-time Push Notification Simulation banner */}
      <AnimatePresence>
        {activePushNotification && (
          <motion.div 
            initial={{ opacity: 0, y: -50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="absolute top-4 left-4 right-4 z-50 bg-slate-900 text-white rounded-2xl shadow-2xl p-4 border border-red-500/30 flex gap-4 cursor-pointer"
            onClick={() => {
              setActiveTab('dashboard');
              setAlerts(prev => prev.map(a => a.id === activePushNotification.id ? { ...a, read: true } : a));
              setActivePushNotification(null);
              toast.success('Central de Segurança aberta no painel de alertas.');
            }}
          >
            <div className="w-12 h-12 rounded-xl bg-red-950/50 border border-red-700/50 flex items-center justify-center text-red-500 shrink-0 animate-pulse">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-bold text-red-400 text-sm flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                  {activePushNotification.title}
                </span>
                <span className="text-[10px] text-slate-500 font-medium">Agora</span>
              </div>
              <h4 className="text-sm font-semibold truncate text-slate-100 mt-1">
                Dispositivo: {activePushNotification.device_name}
              </h4>
              <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                Usuário: {activePushNotification.user_name} • Local: {activePushNotification.city} • IP: {activePushNotification.ip}
              </p>
              <div className="text-[10px] text-emerald-400 font-bold mt-1 inline-flex items-center gap-1">
                Clique para abrir a Central de Segurança <ChevronRight className="w-3 h-3" />
              </div>
            </div>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setActivePushNotification(null);
              }}
              className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors shrink-0 max-h-min"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header Central de Segurança */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-slate-900 border-2 border-slate-700 shadow-lg shadow-slate-200 text-slate-200 rounded-2xl flex items-center justify-center shrink-0">
            <Shield className="w-7 h-7 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Central de Segurança do Sistema</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-900 text-emerald-400 ring-1 ring-emerald-500/20 uppercase tracking-widest">
                Admin Only
              </span>
            </div>
            <p className="text-slate-500 text-sm">Monitoramento de acessos, dispositivos cadastrados, bloqueios e logs de auditoria de rede.</p>
          </div>
        </div>

        {/* Emergency lock & Simulation Controls */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowSimulator(!showSimulator)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl transition-all text-xs border border-slate-300"
          >
            <Sliders className="w-4 h-4 text-slate-600" />
            {showSimulator ? 'Ocultar Simulação' : 'Painel de Simulação'}
          </button>

          <button
            onClick={() => setShowEmergencyModal(true)}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-black rounded-xl transition-all text-xs shadow-lg shadow-red-100 uppercase tracking-wider animate-pulse"
          >
            <ShieldX className="w-4 h-4" />
            Bloqueio de Emergência
          </button>
        </div>
      </div>

      {/* Real-time Simulator Panel */}
      <AnimatePresence>
        {showSimulator && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden bg-slate-900 border border-slate-800 rounded-2xl p-6 text-white space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 text-emerald-400" />
                <h3 className="font-extrabold text-sm uppercase tracking-wider text-slate-200">Simulador de Eventos de Segurança</h3>
              </div>
              <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">Ambiente de Demonstração</span>
            </div>
            <p className="text-xs text-slate-400">
              Utilize os triggers abaixo para simular notificações do sistema e comportamentos reais de intrusão, proteção de rede e controle de acesso em tempo real.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <button
                onClick={() => handleSimulateEvent('new_device')}
                className="p-3 bg-slate-800 hover:bg-slate-700 text-left rounded-xl transition-all border border-slate-700/50 space-y-1 group"
              >
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 group-hover:animate-ping" />
                  <span className="text-xs font-bold text-slate-100">Dispositivo Novo</span>
                </div>
                <p className="text-[10px] text-slate-400">Gera um novo smartphone solicitando autorização na fila.</p>
              </button>

              <button
                onClick={() => handleSimulateEvent('international')}
                className="p-3 bg-slate-800 hover:bg-slate-700 text-left rounded-xl transition-all border border-slate-700/50 space-y-1 group"
              >
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 group-hover:animate-ping" />
                  <span className="text-xs font-bold text-slate-100">Bloqueio Internacional</span>
                </div>
                <p className="text-[10px] text-slate-400">Simula tentativa de fora do Brasil com bloqueio instantâneo.</p>
              </button>

              <button
                onClick={() => handleSimulateEvent('critical_admin')}
                className="p-3 bg-slate-800 hover:bg-slate-700 text-left rounded-xl transition-all border border-slate-700/50 space-y-1 group"
              >
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 group-hover:animate-ping" />
                  <span className="text-xs font-bold text-slate-100">Login Admin Desconhecido</span>
                </div>
                <p className="text-[10px] text-slate-400">Gera alerta de login admin fora do laptop primário.</p>
              </button>

              <button
                onClick={() => handleSimulateEvent('repeated_fails')}
                className="p-3 bg-slate-800 hover:bg-slate-700 text-left rounded-xl transition-all border border-slate-700/50 space-y-1 group"
              >
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500 group-hover:animate-ping" />
                  <span className="text-xs font-bold text-slate-100">Força Bruta / Ataque</span>
                </div>
                <p className="text-[10px] text-slate-400">Gera 5 logins incorretos seguidos bloqueando o IP atacante.</p>
              </button>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-slate-800 text-[11px] text-slate-500">
              <span>Para retornar os dados padrão a qualquer hora:</span>
              <button 
                onClick={handleResetData}
                className="text-emerald-400 hover:text-emerald-300 font-bold underline"
              >
                Resetar Todos os Dados da Central
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs Menu Bar */}
      <div className="flex bg-slate-200/65 p-1 rounded-2xl md:max-w-max border border-slate-200 overflow-x-auto gap-1">
        <button
          onClick={() => { setActiveTab('dashboard'); setSearchTerm(''); }}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'dashboard' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Shield className="w-4 h-4 text-emerald-600" />
          Painel Geral
          {activeAlertsCount > 0 && (
            <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-black animate-pulse">
              {activeAlertsCount}
            </span>
          )}
        </button>

        <button
          onClick={() => { setActiveTab('authorized'); setSearchTerm(''); }}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'authorized' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Laptop className="w-4 h-4 text-indigo-600" />
          Autorizados
          <span className="bg-slate-300 text-slate-800 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
            {totalAuthorizedCount}
          </span>
        </button>

        <button
          onClick={() => { setActiveTab('pending'); setSearchTerm(''); }}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'pending' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Smartphone className="w-4 h-4 text-amber-500" />
          Pendentes
          {totalPendingCount > 0 && (
            <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-black animate-bounce">
              {totalPendingCount}
            </span>
          )}
        </button>

        <button
          onClick={() => { setActiveTab('attempts'); setSearchTerm(''); }}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'attempts' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Globe className="w-4 h-4 text-red-500" />
          Tentativas de Acesso
        </button>

        <button
          onClick={() => { setActiveTab('logs'); setSearchTerm(''); }}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'logs' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Clock className="w-4 h-4 text-slate-600" />
          Logs de Acessos
        </button>

        <button
          onClick={() => { setActiveTab('settings'); setSearchTerm(''); }}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'settings' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sliders className="w-4 h-4 text-violet-600" />
          Configurações de Segurança
        </button>
      </div>

      {/* SEARCH BOX FOR INNER TAB MANAGEMENT */}
      {activeTab !== 'dashboard' && activeTab !== 'settings' && (
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 group-focus-within:text-slate-700 transition-colors" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`Filtrar registros por usuário, dispositivo, IP ou local...`}
            className="w-full pl-12 pr-4 py-3.5 rounded-2xl border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500 bg-white transition-all text-sm font-medium"
          />
        </div>
      )}

      {/* SUB-VIEW CONTENTS */}
      <AnimatePresence mode="wait">
        
        {/* TAB 1: PAINEL DE SEGURANÇA */}
        {activeTab === 'dashboard' && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="space-y-8"
          >
            {/* Quick Metrics Bento Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Status do Sistema</h4>
                  <p className="text-lg font-black text-slate-950 mt-1 uppercase">
                    {criticalAlertsCount > 0 ? 'Sob Alerta' : 'Seguro'}
                  </p>
                </div>
              </div>

              <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shrink-0">
                  <Laptop className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Dispositivos</h4>
                  <p className="text-lg font-black text-slate-950 mt-1">{totalAuthorizedCount} Autorizados</p>
                </div>
              </div>

              <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-sm flex items-center gap-4 relative">
                <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center shrink-0">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Pendentes</h4>
                  <p className="text-lg font-black text-slate-950 mt-1">
                    {totalPendingCount} Aparelhos
                  </p>
                </div>
                {totalPendingCount > 0 && (
                  <span className="absolute top-4 right-4 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                  </span>
                )}
              </div>

              <div className="bg-white border border-slate-100 p-6 rounded-3xl shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center shrink-0">
                  <Ban className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Ataques Evitados</h4>
                  <p className="text-lg font-black text-slate-950 mt-1">{totalBlockCount} Bloqueios</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* Left Column: Alerts Feed */}
              <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-extrabold text-slate-900 uppercase tracking-wider text-sm flex items-center gap-2">
                    <Bell className="w-4.5 h-4.5 text-slate-600" />
                    Alertas e Atividades Recentes
                  </h3>
                  {alerts.some(a => !a.read) && (
                    <button 
                      onClick={() => setAlerts(prev => prev.map(a => ({ ...a, read: true })))}
                      className="text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline transition-colors"
                    >
                      Marcar todos como lidos
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {alerts.length === 0 ? (
                    <div className="bg-white rounded-3xl p-8 text-center text-slate-400 border border-slate-100 flex flex-col items-center justify-center gap-3">
                      <ShieldCheck className="w-12 h-12 text-slate-300" />
                      <p className="font-bold text-sm">Nenhum evento de segurança emitido nas últimas 24 horas.</p>
                      <p className="text-xs text-slate-400 max-w-xs">Tudo azul! O sistema continuará bloqueando novos aparelhos sem o seu aval.</p>
                    </div>
                  ) : (
                    alerts.map((alert) => (
                      <div 
                        key={alert.id} 
                        className={`bg-white rounded-3xl p-5 border transition-all ${
                          alert.critical 
                            ? 'border-red-100 hover:border-red-200 bg-red-50/15' 
                            : 'border-slate-100 hover:border-slate-200'
                        } flex gap-4 ${!alert.read ? 'ring-2 ring-emerald-500/20' : ''}`}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          alert.critical ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-600'
                        }`}>
                          {alert.critical ? <ShieldAlert className="w-5 h-5" /> : <Info className="w-5 h-5" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className={`text-sm font-bold leading-tight ${alert.critical ? 'text-red-950 font-black' : 'text-slate-900'}`}>
                              {alert.title}
                            </h4>
                            <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">
                              {new Date(alert.created_at).toLocaleTimeString('pt-BR')}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-1">{alert.description}</p>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-400 mt-2.5 font-semibold">
                            <span>Dispositivo: <span className="text-slate-700">{alert.device_name}</span></span>
                            <span>•</span>
                            <span>IP: <span className="text-slate-700">{alert.ip}</span></span>
                            <span>•</span>
                            <span>Cidade: <span className="text-slate-700">{alert.city}</span></span>
                          </div>
                        </div>

                        {!alert.read && (
                          <div className="flex flex-col justify-center">
                            <button
                              onClick={() => setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, read: true } : a))}
                              className="text-[10px] uppercase font-black text-emerald-600 hover:text-emerald-700 px-2 py-1 bg-emerald-50 rounded-lg"
                            >
                              Lido
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Right Column: Device Status Sidebar Card */}
              <div className="space-y-6">
                
                {/* Pending Device Queue Quick Card */}
                <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-extrabold text-slate-900 uppercase tracking-wider text-xs">Fila de Autorização</h3>
                    <span className="bg-amber-100 text-amber-800 text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase">
                      Exige Ação ({pendingDevices.length})
                    </span>
                  </div>

                  {pendingDevices.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 space-y-2">
                      <Smartphone className="w-10 h-10 text-slate-200 mx-auto" />
                      <p className="text-xs font-bold">Nenhum aparelho aguardando autorização.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {pendingDevices.slice(0, 2).map((dev) => (
                        <div key={dev.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                          <div className="flex items-start gap-2.5">
                            <Smartphone className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                            <div>
                              <h4 className="text-xs font-black text-slate-800 truncate">{dev.model}</h4>
                              <p className="text-[10px] text-slate-500 font-medium">Usuário: {dev.user_name}</p>
                              <p className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1">
                                <MapPin className="w-3.5 h-3.5" /> {dev.city}, {dev.country}
                              </p>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-3 gap-1.5 pt-1">
                            <button
                              onClick={() => handleAuthorizeDevice(dev, false)}
                              className="px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[9px] uppercase transition-all"
                            >
                              Autorizar
                            </button>
                            <button
                              onClick={() => handleAuthorizeDevice(dev, true)}
                              className="px-2 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-bold text-[9px] uppercase transition-all"
                            >
                              Temporário
                            </button>
                            <button
                              onClick={() => handleBlockDevice(dev)}
                              className="px-2 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg font-bold text-[9px] uppercase transition-all"
                            >
                              Bloquear
                            </button>
                          </div>
                        </div>
                      ))}
                      {pendingDevices.length > 2 && (
                        <button 
                          onClick={() => setActiveTab('pending')}
                          className="w-full text-center text-xs font-bold text-emerald-600 hover:underline pt-1 block"
                        >
                          Ver todos os {pendingDevices.length} pendentes
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Simulated Stats chart or summary of countries logged */}
                <div className="bg-slate-900 text-white border border-slate-800 rounded-3xl p-6 space-y-4">
                  <h3 className="font-extrabold uppercase tracking-wider text-xs text-slate-300">Geodefesas & Firewall</h3>
                  
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1">
                        <span>Brasil (Permitido)</span>
                        <span className="text-emerald-400">100% de Confiança</span>
                      </div>
                      <div className="w-full h-2 bg-slate-850 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: '100%' }}></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1">
                        <span>Exterior (Países Suspeitos)</span>
                        <span className="text-red-400">Totalmente Bloqueado</span>
                      </div>
                      <div className="w-full h-2 bg-slate-850 rounded-full overflow-hidden">
                        <div className="h-full bg-red-500 rounded-full" style={{ width: '100%' }}></div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-850 p-4 rounded-2xl text-[11px] text-slate-400 flex items-start gap-2.5 border border-slate-800">
                    <Globe className="w-5 h-5 text-emerald-400 shrink-0" />
                    <p>
                      <strong>Bloqueio Internacional Ativo:</strong> Tentativas geradas fora do território brasileiro são interceptadas antes de bater no banco de dados, enviando push ao Administrador.
                    </p>
                  </div>
                </div>

              </div>

            </div>
          </motion.div>
        )}

        {/* TAB 2: DISPOSITIVOS AUTORIZADOS */}
        {activeTab === 'authorized' && (
          <motion.div
            key="authorized"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="space-y-4"
          >
            <div className="flex justify-between items-center bg-white p-5 rounded-3xl border border-slate-100 shadow-sm col-span-3">
              <div>
                <h3 className="text-md font-black text-slate-900 uppercase tracking-tight">Dispositivos Autorizados</h3>
                <p className="text-xs text-slate-500 mt-0.5">Aparelhos credenciados para realizar alterações no condomínio.</p>
              </div>
              <span className="bg-indigo-50 text-indigo-700 text-xs px-3 py-1 rounded-full font-bold">
                {filteredAuthorizedDevices.length} Conectados
              </span>
            </div>

            {filteredAuthorizedDevices.length === 0 ? (
              <div className="text-center p-12 bg-white rounded-3xl border border-slate-100 text-slate-400">
                Sem correspondências para "{searchTerm}".
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredAuthorizedDevices.map((dev) => (
                  <div key={dev.id} className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm space-y-4 relative group">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          dev.user_role === 'admin' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-600'
                        }`}>
                          {dev.system_os.toLowerCase().includes('windows') || dev.system_os.toLowerCase().includes('macos') ? (
                            <Laptop className="w-5 h-5 bg-transparent" />
                          ) : (
                            <Smartphone className="w-5 h-5 bg-transparent" />
                          )}
                        </div>
                        <div>
                          <h4 className="font-extrabold text-slate-900 text-sm leading-tight">{dev.model}</h4>
                          <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">{dev.device_id}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase ${
                          dev.status === 'temporary' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {dev.status === 'temporary' ? 'Temporário' : 'Confiável'}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 pt-3 border-t border-slate-50 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Usuário</span>
                        <span className="font-bold text-slate-800">{dev.user_name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Perfil</span>
                        <span className="font-bold text-slate-600 uppercase tracking-widest text-[10px]">{dev.user_role}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Endereço IP</span>
                        <span className="font-mono text-slate-700">{dev.ip}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Localização</span>
                        <span className="font-bold text-slate-700 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" /> {dev.city}, {dev.country}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400 font-medium">Data Cadastro</span>
                        <span className="font-semibold text-slate-600">
                          {dev.authorized_at ? new Date(dev.authorized_at).toLocaleDateString('pt-BR') : '-'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400 font-medium">Último Acesso</span>
                        <span className="font-semibold text-slate-600">
                          {new Date(dev.last_accessed_at).toLocaleString('pt-BR')}
                        </span>
                      </div>
                      {dev.expires_at && (
                        <div className="flex justify-between text-violet-700 font-medium">
                          <span>Expira em</span>
                          <span>{new Date(dev.expires_at).toLocaleString('pt-BR')}</span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <button
                        onClick={() => handleTerminateSession(dev)}
                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold text-xs transition-colors"
                      >
                        Deslogar
                      </button>
                      <button
                        onClick={() => handleBlockDevice(dev)}
                        className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl font-bold text-xs transition-colors"
                      >
                        Bloquear
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* TAB 3: DISPOSITIVOS PENDENTES */}
        {activeTab === 'pending' && (
          <motion.div
            key="pending"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="space-y-4"
          >
            <div className="bg-amber-50/75 border border-amber-100 p-6 rounded-3xl flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <Smartphone className="w-5 h-5 animate-pulse" />
              </div>
              <div className="flex-1">
                <h3 className="font-black text-amber-900 uppercase tracking-tight text-sm">Controle Estrito de Dispositivos Novos</h3>
                <p className="text-xs text-amber-800 mt-1">
                  <strong>REGRA DE SEGURANÇA:</strong> Nenhum novo celular, tablet ou laptop consegue realizar qualquer ação ou leitura de encomendas no condomínio sem que você, administrador, aprove seu acesso abaixo.
                </p>
              </div>
            </div>

            {filteredPendingDevices.length === 0 ? (
              <div className="bg-white border border-slate-100 rounded-3xl p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-4">
                <ShieldCheck className="w-14 h-14 text-slate-300" />
                <div>
                  <p className="font-bold text-md text-slate-700">Fila limpa!</p>
                  <p className="text-xs text-slate-400 mt-1">Sem novas solicitações de aparelhos pendentes.</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredPendingDevices.map((dev) => (
                  <div key={dev.id} className="bg-white border-2 border-amber-500/20 rounded-3xl p-6 shadow-sm space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center shrink-0">
                          <Smartphone className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-black text-slate-900 text-sm leading-tight">{dev.model}</h4>
                          <span className="text-[10px] font-mono text-amber-600 uppercase tracking-wide">Pendente de Autorização</span>
                        </div>
                      </div>
                      <span className="text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">
                        Novo Dispositivo
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs pt-2 border-t border-slate-100">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Solicitante</span>
                        <span className="font-extrabold text-slate-800">{dev.user_name}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Perfil</span>
                        <span className="font-bold text-slate-700 uppercase tracking-widest text-[9px]">{dev.user_role}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">IP de Origem</span>
                        <span className="font-mono text-slate-800">{dev.ip}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold font-medium">Localidade</span>
                        <span className="font-extrabold text-slate-800 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-zinc-400" /> {dev.city}, {dev.country}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Device Index Fingerprint</span>
                        <span className="font-mono text-xs text-slate-500">{dev.device_id}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Data & Hora</span>
                        <span className="font-semibold text-slate-700">{new Date(dev.last_accessed_at).toLocaleString('pt-BR')}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5 pt-4">
                      <button
                        onClick={() => handleAuthorizeDevice(dev, false)}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition-colors flex items-center justify-center gap-1 shadow-sm"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Autorizar
                      </button>
                      <button
                        onClick={() => handleAuthorizeDevice(dev, true)}
                        className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl font-bold text-xs transition-colors flex items-center justify-center gap-1"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        Temporário
                      </button>
                      <button
                        onClick={() => handleBlockDevice(dev)}
                        className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl font-bold text-xs transition-colors flex items-center justify-center gap-1"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        Bloquear
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* TAB 4: TENTATIVAS DE ACESSO */}
        {activeTab === 'attempts' && (
          <motion.div
            key="attempts"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="space-y-4"
          >
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-zinc-100 flex items-center justify-between">
                <div>
                  <h3 className="text-md font-black text-slate-900 uppercase tracking-tight">Histórico de Conexões de Rede</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Logs brutos de rede contendo tentativas permitidas, pendentes e bloqueadas do sistema.</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 text-xs font-bold border-b border-zinc-100">
                      <th className="p-4">Login Utilizado</th>
                      <th className="p-4">Dispositivo</th>
                      <th className="p-4">Endereço IP</th>
                      <th className="p-4">Localização</th>
                      <th className="p-4">Horário</th>
                      <th className="p-4">Status de Entrada</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-zinc-700 text-xs">
                    {filteredAttempts.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-400">
                          Nenhuma tentativa de acesso encontrada.
                        </td>
                      </tr>
                    ) : (
                      filteredAttempts.map((att) => (
                        <tr key={att.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="p-4 font-bold text-slate-900">{att.login_used}</td>
                          <td className="p-4 max-w-xs truncate">{att.device}</td>
                          <td className="p-4 font-mono font-semibold">{att.ip}</td>
                          <td className="p-4 font-medium">
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5 text-slate-400" />
                              {att.city}, {att.country}
                            </span>
                          </td>
                          <td className="p-4 text-slate-500 font-semibold">{new Date(att.created_at).toLocaleString('pt-BR')}</td>
                          <td className="p-4">
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                              att.status === 'permitido' ? 'bg-emerald-100 text-emerald-800' :
                              att.status === 'bloqueado' ? 'bg-red-100 text-red-800 font-extrabold' : 'bg-amber-100 text-amber-800 font-bold'
                            }`}>
                              {att.status === 'permitido' ? 'Permitido' :
                               att.status === 'bloqueado' ? '🔒 Bloqueado' : 'Aguardando'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* TAB 5: LOG DE ACESSOS */}
        {activeTab === 'logs' && (
          <motion.div
            key="logs"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="space-y-4"
          >
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-zinc-100">
                <h3 className="text-md font-black text-slate-900 uppercase tracking-tight">Logs de Logs Geral</h3>
                <p className="text-xs text-slate-500 mt-0.5">Logs de auditoria de conexões de usuários com sessões ativas correntes no sistema.</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 text-xs font-bold border-b border-zinc-100">
                      <th className="p-4">Usuário</th>
                      <th className="p-4">Perfil</th>
                      <th className="p-4">Dispositivo</th>
                      <th className="p-4">IP</th>
                      <th className="p-4">Cidade</th>
                      <th className="p-4">Data/Hora</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-zinc-700 text-xs">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-400">
                          Nenhum acesso gravado.
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="p-4 font-bold text-slate-900">{log.user_name}</td>
                          <td className="p-4">
                            <span className="uppercase text-[10px] font-bold tracking-widest bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
                              {log.user_role}
                            </span>
                          </td>
                          <td className="p-4">{log.device}</td>
                          <td className="p-4 font-mono">{log.ip}</td>
                          <td className="p-4 font-semibold">{log.city}</td>
                          <td className="p-4 text-slate-500">{new Date(log.created_at).toLocaleString('pt-BR')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* TAB 6: CONFIGURAÇÕES DE SEGURANÇA */}
        {activeTab === 'settings' && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-8"
          >
            {/* Title / Description */}
            <div className="space-y-2">
              <h2 className="font-extrabold text-slate-950 uppercase flex items-center gap-2">
                <Sliders className="w-5 h-5 text-violet-600" />
                Configurações de Segurança
              </h2>
              <p className="text-xs text-slate-500">
                Ajuste os canais de contingência, alertas, sessões válidas e defina o dispositivo primário confiável para as contas de administração.
              </p>
              <div className="pt-4">
                <div className={`p-4 rounded-2xl border ${
                  secSettings.critical_alert_mode_active 
                    ? 'border-indigo-150 bg-indigo-50/25 text-indigo-950 animate-pulse' 
                    : 'border-slate-200 bg-slate-100 text-slate-600'
                }`}>
                  <p className="text-[11px] font-bold flex items-center gap-1.5 uppercase leading-none">
                    <ShieldCheck className="w-4 h-4" />
                    Modo Crítico: {secSettings.critical_alert_mode_active ? 'ATIVADO' : 'DESACTIVADO'}
                  </p>
                  <p className="text-[10px] mt-1 text-slate-500">
                    O bloqueio e monitoramento intensivo de IPs está habilitado globalmente para proteger o banco de dados de moradores.
                  </p>
                </div>
              </div>
            </div>

            {/* Config Fields Form card */}
            <div className="md:col-span-2 bg-white rounded-3xl border border-slate-150 p-6 sm:p-8 shadow-sm space-y-6">
              
              {/* Alert switch fields */}
              <div className="space-y-4">
                <h3 className="font-bold text-slate-900 border-b border-slate-50 pb-2 text-xs uppercase text-slate-400">Canais de Notificação & Alertas</h3>
                
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-bold text-slate-800 block">Notificações Push no Painel</label>
                    <span className="text-xs text-slate-500">Exibir banners pop-up para o administrador em tempo real.</span>
                  </div>
                  <button
                    onClick={() => setSecSettings({ ...secSettings, alerts_push_enabled: !secSettings.alerts_push_enabled })}
                    className={`px-3 py-1.5 rounded-xl font-bold text-xs uppercase ${
                      secSettings.alerts_push_enabled ? 'bg-emerald-50 text-emerald-700 border-2 border-emerald-100' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {secSettings.alerts_push_enabled ? 'Ativo' : 'Desativo'}
                  </button>
                </div>

                <div className="flex items-center justify-between border-t border-slate-50 pt-3">
                  <div>
                    <label className="text-sm font-bold text-slate-800 block">Alertas por E-mail</label>
                    <span className="text-xs text-slate-500">Enviar e-mail automático ao administrador em cada ação suspeita.</span>
                  </div>
                  <button
                    onClick={() => setSecSettings({ ...secSettings, alerts_email_enabled: !secSettings.alerts_email_enabled })}
                    className={`px-3 py-1.5 rounded-xl font-bold text-xs uppercase ${
                      secSettings.alerts_email_enabled ? 'bg-emerald-50 text-emerald-700 border-2 border-emerald-100' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {secSettings.alerts_email_enabled ? 'Ativo' : 'Desativo'}
                  </button>
                </div>

                <div className="flex items-center justify-between border-t border-slate-50 pt-3">
                  <div>
                    <label className="text-sm font-bold text-slate-800 block">Sinalizadores Críticos Ativos</label>
                    <span className="text-xs text-slate-500">Gerar alertas urgentes para tentativas de acesso internacionais.</span>
                  </div>
                  <button
                    onClick={() => setSecSettings({ ...secSettings, alerts_critical_enabled: !secSettings.alerts_critical_enabled })}
                    className={`px-3 py-1.5 rounded-xl font-bold text-xs uppercase ${
                      secSettings.alerts_critical_enabled ? 'bg-emerald-50 text-emerald-700 border-2 border-emerald-100' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {secSettings.alerts_critical_enabled ? 'Ativo' : 'Desativo'}
                  </button>
                </div>
              </div>

              {/* Contact targets */}
              <div className="space-y-4 pt-4 border-t border-slate-100">
                <h3 className="font-bold text-slate-900 border-b border-slate-50 pb-2 text-xs uppercase text-slate-400">Contatos de Contingência</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-2 uppercase">E-mail Principal de Segurança</label>
                    <input
                      type="email"
                      value={secSettings.primary_email}
                      onChange={(e) => setSecSettings({ ...secSettings, primary_email: e.target.value })}
                      className="w-full p-3 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-2 uppercase">E-mail Secundário (Suporte)</label>
                    <input
                      type="email"
                      value={secSettings.secondary_email || ''}
                      onChange={(e) => setSecSettings({ ...secSettings, secondary_email: e.target.value })}
                      placeholder="Não cadastrado"
                      className="w-full p-3 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-semibold"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-2 uppercase">WhatsApp para Alertas Críticos</label>
                    <div className="relative">
                      <MessageSquare className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
                      <input
                        type="text"
                        value={secSettings.whatsapp_admin || ''}
                        onChange={(e) => setSecSettings({ ...secSettings, whatsapp_admin: e.target.value })}
                        placeholder="Ex: 5541999998888"
                        className="w-full pl-11 pr-3 py-3 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-mono font-semibold"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Trusted Primary Device */}
              <div className="space-y-4 pt-4 border-t border-slate-100">
                <h3 className="font-bold text-slate-900 border-b border-slate-50 pb-2 text-xs uppercase text-slate-400">Dispositivo Primário Confiável</h3>

                <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Laptop className="w-6 h-6 text-emerald-600" />
                    <div>
                      <p className="text-xs font-bold text-slate-800">{secSettings.primary_device_name || 'Nenhum definido'}</p>
                      <p className="text-[10px] font-mono text-slate-500 mt-0.5">ID: {secSettings.primary_device_id || '-'}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {secSettings.primary_device_id ? (
                      <button
                        onClick={() => {
                          setSecSettings({ ...secSettings, primary_device_id: '', primary_device_name: '' });
                          toast.success('Dispositivo principal revogado.');
                        }}
                        className="px-2.5 py-1 text-[10px] uppercase font-black text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        Revogar
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setSecSettings({ 
                            ...secSettings, 
                            primary_device_id: 'FP-WIN-88392-ADMIN', 
                            primary_device_name: 'Dell XPS 15 (Windows 11)' 
                          });
                          toast.success('Definido seu dispositivo atual como confiável principal!');
                        }}
                        className="px-2.5 py-1 text-[10px] uppercase font-black text-emerald-600 hover:bg-emerald-50 rounded-lg"
                      >
                        Definar Atual
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Session Control limits */}
              <div className="space-y-4 pt-4 border-t border-slate-100">
                <h3 className="font-bold text-slate-900 border-b border-slate-50 pb-2 text-xs uppercase text-slate-400">Controle de Sessões</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-2">LIMITE DE SESSÕES SIMULTÂNEAS</label>
                    <select
                      value={secSettings.max_simultaneous_sessions}
                      onChange={(e) => setSecSettings({ ...secSettings, max_simultaneous_sessions: parseInt(e.target.value) })}
                      className="w-full p-3 rounded-xl border border-slate-200 text-xs font-semibold"
                    >
                      <option value={1}>1 Sessão (Máxima Rigidez)</option>
                      <option value={2}>2 Sessões Simultâneas</option>
                      <option value={3}>3 Sessões Simultâneas (Padrão)</option>
                      <option value={5}>5 Sessões Simultâneas</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-2">TEMPO DE EXPIRAÇÃO DE SESSÃO</label>
                    <select
                      value={secSettings.session_timeout_minutes}
                      onChange={(e) => setSecSettings({ ...secSettings, session_timeout_minutes: parseInt(e.target.value) })}
                      className="w-full p-3 rounded-xl border border-slate-200 text-xs font-semibold"
                    >
                      <option value={15}>15 minutos inativo</option>
                      <option value={30}>30 minutos de inatividade</option>
                      <option value={60}>1 hora (Recomendado)</option>
                      <option value={180}>3 horas deslogado</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Master critical trigger */}
              <div className="space-y-4 pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-bold text-slate-900 block uppercase">Modo Alerta Crítico Permanente</label>
                    <span className="text-xs text-slate-500">Ao ativar, exige aprovação imediata no celular do admin secundário para logar.</span>
                  </div>
                  <button
                    onClick={() => {
                      const active = !secSettings.critical_alert_mode_active;
                      setSecSettings({ ...secSettings, critical_alert_mode_active: active });
                      if (active) {
                        toast.success('Modo de Alerta Crítico habilitado para o condomínio!');
                      } else {
                        toast.error('Modo de Alerta Crítico desativado.');
                      }
                    }}
                    className={`w-14 h-8 rounded-full transition-all relative ${
                      secSettings.critical_alert_mode_active ? 'bg-red-600' : 'bg-slate-300'
                    }`}
                  >
                    <span className={`w-6 h-6 bg-white rounded-full absolute top-1 transition-all ${
                      secSettings.critical_alert_mode_active ? 'right-1' : 'left-1'
                    }`} />
                  </button>
                </div>
              </div>

            </div>
          </motion.div>
        )}

      </AnimatePresence>

      {/* EMERGENCY PANIC MODAL */}
      <AnimatePresence>
        {showEmergencyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-md w-full p-6 space-y-6 border border-slate-100 shadow-2xl"
            >
              <div className="flex flex-col items-center justify-center text-center space-y-3">
                <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center animate-bounce">
                  <ShieldX className="w-9 h-9" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Bloquear Todos os Acessos?</h3>
                  <p className="text-xs text-red-600 font-bold mt-1">ESTA AÇÃO É ALTAMENTE CRÍTICA E IRREVERSÍVEL!</p>
                </div>
              </div>

              <div className="bg-red-50 p-4 rounded-2xl text-xs text-red-800 space-y-2 font-medium">
                <p><strong>Abaixo o que ocorrerá imediatamente:</strong></p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Todas as conexões de porteiros no condomínio serão desconectadas.</li>
                  <li>Todas as sessões de síndicos e moradores serão liquidadas.</li>
                  <li>Novos logins serão bloqueados temporariamente.</li>
                  <li>Apenas a sua conta de Administrador continuará online e autorizada.</li>
                </ul>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowEmergencyModal(false)}
                  disabled={isLockingEverything}
                  className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-2xl font-bold text-xs uppercase"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleEmergencyLock}
                  disabled={isLockingEverything}
                  className="px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-xs uppercase shadow-lg shadow-red-150 flex items-center justify-center gap-1.5"
                >
                  {isLockingEverything ? (
                    'Efetuando Bloqueio...'
                  ) : (
                    <>
                      <Ban className="w-4 h-4" /> Bloquear Tudo
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
