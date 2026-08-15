import React, { useState, useEffect, useRef } from 'react';
import {
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  HelpCircle,
  ArrowRight,
  ArrowLeft,
  Download,
  X,
  RefreshCw,
  Search,
  Check,
  Filter,
  UserCheck,
  PhoneCall,
  Home,
  User,
  Phone,
  Layers,
  ShieldCheck,
  FlaskConical,
  Radio
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Profile, Morador } from '../types';
import { supabase } from '../lib/supabase';
import {
  readSpreadsheetFile,
  detectColumnMapping,
  processRawResidents,
  executeResidentImport,
  downloadSampleSpreadsheet,
  RawSpreadsheetData,
  ColumnMapping,
  ImportPreviewSummary,
  ProcessedResident,
  DuplicateStrategy
} from '../services/residentImporter';
import { ImportMode } from '../services/residentModeService';

interface ResidentImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: Profile;
  onImportComplete?: () => void;
}

type Step = 'upload' | 'mapping' | 'preview' | 'importing' | 'summary';

export default function ResidentImporterModal({
  isOpen,
  onClose,
  user,
  onImportComplete
}: ResidentImporterModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  // Modo de Importação: 'teste' ou 'real' (padrão 'teste' para segurança)
  const [importMode, setImportMode] = useState<ImportMode>('teste');
  const [showRealConfirmModal, setShowRealConfirmModal] = useState(false);

  // Dados da planilha
  const [rawData, setRawData] = useState<RawSpreadsheetData | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    nameColumn: '',
    unitColumn: '',
    phoneColumn: ''
  });

  // Base existente de moradores para detecção de duplicidades
  const [existingResidents, setExistingResidents] = useState<Morador[]>([]);
  const [previewSummary, setPreviewSummary] = useState<ImportPreviewSummary | null>(null);

  // Configurações de importação
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>('ignore_existing');
  const [previewFilter, setPreviewFilter] = useState<'all' | 'complete' | 'pending' | 'inconsistent' | 'duplicates'>('all');
  const [previewSearch, setPreviewSearch] = useState('');

  // Progresso e Resultado
  const [progress, setProgress] = useState({ current: 0, total: 0, percentage: 0 });
  const [importResult, setImportResult] = useState<{
    successCount: number;
    updatedCount: number;
    skippedCount: number;
    errors: string[];
    importMode?: ImportMode;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carregar moradores existentes ao abrir o modal
  useEffect(() => {
    if (isOpen && user.condominium_id) {
      fetchExistingResidents();
    }
  }, [isOpen, user.condominium_id]);

  const fetchExistingResidents = async () => {
    try {
      const { data, error } = await supabase
        .from('moradores')
        .select('id, nome, unidade, telefone, ativo, observacoes, created_at, condominium_id')
        .eq('condominium_id', user.condominium_id);

      if (!error && data) {
        setExistingResidents(data as Morador[]);
      }
    } catch (err) {
      console.warn('Erro ao carregar moradores existentes para checagem de duplicidade:', err);
    }
  };

  const resetState = () => {
    setStep('upload');
    setFile(null);
    setRawData(null);
    setPreviewSummary(null);
    setImportResult(null);
    setProgress({ current: 0, total: 0, percentage: 0 });
    setPreviewFilter('all');
    setPreviewSearch('');
    setImportMode('teste');
    setShowRealConfirmModal(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFileSelect = async (selectedFile: File) => {
    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const fileName = selectedFile.name.toLowerCase();
    const isValid = validExtensions.some(ext => fileName.endsWith(ext));

    if (!isValid) {
      toast.error('Formato inválido. Por favor envie um arquivo .xlsx, .xls ou .csv');
      return;
    }

    setIsLoadingFile(true);
    setFile(selectedFile);

    try {
      const parsedData = await readSpreadsheetFile(selectedFile);
      setRawData(parsedData);

      const mapping = detectColumnMapping(parsedData.headers);
      setColumnMapping(mapping);

      // Processa prévia inicial
      const summary = processRawResidents(parsedData, mapping, existingResidents);
      setPreviewSummary(summary);

      // Se todas as colunas essenciais foram encontradas com clareza, vai para prévia, senão pede mapeamento
      if (mapping.nameColumn && mapping.unitColumn && mapping.phoneColumn) {
        setStep('preview');
      } else {
        setStep('mapping');
      }
    } catch (err: any) {
      console.error('Erro ao ler planilha:', err);
      toast.error(err.message || 'Erro ao processar arquivo.');
      setFile(null);
    } finally {
      setIsLoadingFile(false);
    }
  };

  const handleRecalculatePreview = (mapping: ColumnMapping) => {
    if (!rawData) return;
    const summary = processRawResidents(rawData, mapping, existingResidents);
    setPreviewSummary(summary);
    setStep('preview');
  };

  const handleToggleSelectAll = (select: boolean) => {
    if (!previewSummary) return;
    const updatedRecords = previewSummary.records.map(r => ({
      ...r,
      isSelected: select && r.status !== 'inconsistent' && Boolean(r.unidade && r.unidade.trim())
    }));

    setPreviewSummary({
      ...previewSummary,
      selectedToImport: updatedRecords.filter(r => r.isSelected).length,
      records: updatedRecords
    });
  };

  const handleToggleRecord = (recordId: string) => {
    if (!previewSummary) return;
    const updatedRecords = previewSummary.records.map(r => {
      if (r.id === recordId) {
        if (r.status === 'inconsistent' || !r.unidade || !r.unidade.trim()) {
          toast.error('Registros inconsistentes sem residência não podem ser selecionados para importação.');
          return { ...r, isSelected: false };
        }
        return { ...r, isSelected: !r.isSelected };
      }
      return r;
    });

    setPreviewSummary({
      ...previewSummary,
      selectedToImport: updatedRecords.filter(r => r.isSelected).length,
      records: updatedRecords
    });
  };

  const handleRequestImport = () => {
    if (!previewSummary || !user.condominium_id) {
      toast.error('Dados de importação inválidos.');
      return;
    }

    const selectedCount = previewSummary.records.filter(r => r.isSelected).length;
    if (selectedCount === 0) {
      toast.error('Nenhum registro selecionado para importação.');
      return;
    }

    if (importMode === 'real') {
      setShowRealConfirmModal(true);
    } else {
      executeImportProcess('teste');
    }
  };

  const executeImportProcess = async (mode: ImportMode) => {
    setShowRealConfirmModal(false);
    if (!previewSummary || !user.condominium_id) return;

    const selectedCount = previewSummary.records.filter(r => r.isSelected).length;

    setStep('importing');
    setProgress({ current: 0, total: selectedCount, percentage: 0 });

    try {
      const result = await executeResidentImport({
        condominiumId: user.condominium_id,
        records: previewSummary.records,
        duplicateStrategy,
        currentUser: {
          id: user.id,
          full_name: user.full_name,
          role: user.role
        },
        importMode: mode,
        onProgress: (p) => setProgress(p)
      });

      setImportResult({ ...result, importMode: mode });
      setStep('summary');

      if (result.successCount > 0 || result.updatedCount > 0) {
        toast.success(
          `${result.successCount} moradores importados (${mode === 'teste' ? '🧪 MODO TESTE' : '🟢 MODO REAL'})!`,
          { duration: 4000 }
        );
        if (onImportComplete) {
          onImportComplete();
        }
      } else {
        toast('Nenhum morador novo foi inserido.', { icon: 'ℹ️' });
      }
    } catch (err: any) {
      console.error('Erro na importação:', err);
      toast.error('Falha na importação: ' + err.message);
      setStep('preview');
    }
  };

  if (!isOpen) return null;

  // Filtragem dos registros na pré-visualização
  const filteredRecords = (previewSummary?.records || []).filter(record => {
    // Filtro por status
    if (previewFilter === 'complete' && record.status !== 'complete') return false;
    if (previewFilter === 'pending' && record.status !== 'pending') return false;
    if (previewFilter === 'inconsistent' && record.status !== 'inconsistent') return false;
    if (previewFilter === 'duplicates' && record.duplicateStatus === 'new') return false;

    // Filtro por termo de busca
    if (previewSearch.trim()) {
      const term = previewSearch.toLowerCase();
      const matchName = record.nome.toLowerCase().includes(term);
      const matchUnit = record.unidade.toLowerCase().includes(term);
      const matchPhone = record.telefone.includes(term);
      return matchName || matchUnit || matchPhone;
    }

    return true;
  });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl border border-zinc-100 flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-sm">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-zinc-900 flex items-center gap-2">
                Importador Inteligente de Moradores
              </h2>
              <p className="text-xs sm:text-sm text-zinc-500">
                Extração precisa de Nome, Residência e WhatsApp a partir de planilhas
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="p-2 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-xl transition-all"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content by Step */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          
          {/* STEP 1: UPLOAD */}
          {step === 'upload' && (
            <div className="space-y-6 max-w-2xl mx-auto py-2">
              
              {/* ESCOLHA OBRIGATÓRIA: MODO TESTE OU MODO REAL */}
              <div className="bg-zinc-50 border border-zinc-200 rounded-3xl p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs sm:text-sm font-black text-zinc-900 tracking-wide uppercase">
                      COMO DESEJA IMPORTAR ESTA PLANILHA?
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Defina como o sistema e o WhatsApp devem se comportar para os moradores desta planilha:
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {/* CARD MODO TESTE */}
                  <button
                    type="button"
                    onClick={() => setImportMode('teste')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all relative flex flex-col justify-between ${
                      importMode === 'teste'
                        ? 'border-indigo-600 bg-indigo-50/60 shadow-sm ring-2 ring-indigo-500/20'
                        : 'border-zinc-200 hover:border-zinc-300 bg-white'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-black bg-indigo-600 text-white shadow-xs">
                          <FlaskConical className="w-3.5 h-3.5" />
                          🧪 MODO TESTE
                        </span>
                        {importMode === 'teste' && (
                          <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse" />
                        )}
                      </div>
                      <p className="text-xs font-bold text-zinc-900 mb-1">
                        Testes seguros do fluxo
                      </p>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        Nenhuma notificação real será enviada para o WhatsApp. O envio é <strong>100% simulado</strong> mesmo para números reais.
                      </p>
                    </div>
                  </button>

                  {/* CARD MODO REAL */}
                  <button
                    type="button"
                    onClick={() => setImportMode('real')}
                    className={`p-4 rounded-2xl border-2 text-left transition-all relative flex flex-col justify-between ${
                      importMode === 'real'
                        ? 'border-emerald-600 bg-emerald-50/60 shadow-sm ring-2 ring-emerald-500/20'
                        : 'border-zinc-200 hover:border-zinc-300 bg-white'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-black bg-emerald-700 text-white shadow-xs">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          🟢 MODO REAL
                        </span>
                        {importMode === 'real' && (
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 animate-pulse" />
                        )}
                      </div>
                      <p className="text-xs font-bold text-zinc-900 mb-1">
                        Produção e moradores oficiais
                      </p>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        Os moradores participarão do fluxo normal de notificações e receberão mensagens reais no WhatsApp.
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Box de Instruções Claras */}
              <div className="bg-emerald-50/60 border border-emerald-100 rounded-2xl p-4 sm:p-5 flex items-start gap-3">
                <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-xs sm:text-sm text-emerald-900 space-y-1">
                  <p className="font-semibold text-emerald-950">Privacidade e Blindagem de Dados:</p>
                  <p className="text-emerald-800">
                    O importador processará <strong>apenas Nome, Residência e WhatsApp</strong>. Quaisquer outras colunas da planilha (CPF, RG, e-mails, observações financeiras, veículos) são <strong>automaticamente ignoradas e descartadas</strong>.
                  </p>
                </div>
              </div>

              {/* Drag and Drop Zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileSelect(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-3xl p-8 sm:p-12 text-center cursor-pointer transition-all flex flex-col items-center justify-center ${
                  isDragging
                    ? 'border-emerald-600 bg-emerald-50/40 scale-[0.99]'
                    : 'border-zinc-200 hover:border-emerald-500 hover:bg-zinc-50/80 bg-zinc-50/30'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                />

                {isLoadingFile ? (
                  <div className="space-y-3">
                    <RefreshCw className="w-10 h-10 text-emerald-600 animate-spin mx-auto" />
                    <p className="text-sm font-medium text-zinc-700">Lendo e analisando colunas da planilha...</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-inner">
                      <Upload className="w-8 h-8" />
                    </div>
                    <div>
                      <p className="text-base sm:text-lg font-bold text-zinc-800">
                        Arraste e solte sua planilha aqui
                      </p>
                      <p className="text-xs sm:text-sm text-zinc-500 mt-1">
                        Suporte a arquivos <strong>.xlsx</strong>, <strong>.xls</strong> e <strong>.csv</strong>
                      </p>
                    </div>
                    <button
                      type="button"
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-sm transition-all"
                    >
                      Selecionar Arquivo do Computador
                    </button>
                  </div>
                )}
              </div>

              {/* Botão Baixar Modelo */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-zinc-500">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Preserva identificações como CASA 426, AP 426, BLOCO 11/CASA 426</span>
                </div>
                <button
                  type="button"
                  onClick={downloadSampleSpreadsheet}
                  className="flex items-center gap-1.5 text-emerald-700 hover:text-emerald-800 font-semibold hover:underline"
                >
                  <Download className="w-4 h-4" />
                  Baixar Planilha Modelo (.xlsx)
                </button>
              </div>

            </div>
          )}

          {/* STEP 2: MAPPING (Revisão das Colunas) */}
          {step === 'mapping' && rawData && (
            <div className="space-y-6 max-w-xl mx-auto py-2">
              <div className="text-center space-y-1">
                <h3 className="text-base sm:text-lg font-bold text-zinc-900">
                  Confirmar Correspondência das Colunas
                </h3>
                <p className="text-xs sm:text-sm text-zinc-500">
                  Verifique se as colunas da planilha foram associadas corretamente:
                </p>
              </div>

              <div className="space-y-4 bg-zinc-50/70 p-5 rounded-2xl border border-zinc-200">
                {/* Nome */}
                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1.5">
                    Nome do Morador <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={columnMapping.nameColumn}
                    onChange={(e) => setColumnMapping({ ...columnMapping, nameColumn: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm font-medium text-zinc-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="">-- Selecione a coluna de Nome --</option>
                    {rawData.headers.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                {/* Residência / Unidade */}
                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1.5">
                    Residência / Unidade (Casa, AP, Bloco/Casa) <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={columnMapping.unitColumn}
                    onChange={(e) => setColumnMapping({ ...columnMapping, unitColumn: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm font-medium text-zinc-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="">-- Selecione a coluna de Residência --</option>
                    {rawData.headers.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                {/* WhatsApp / Telefone */}
                <div>
                  <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider mb-1.5">
                    WhatsApp / Telefone
                  </label>
                  <select
                    value={columnMapping.phoneColumn}
                    onChange={(e) => setColumnMapping({ ...columnMapping, phoneColumn: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm font-medium text-zinc-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="">-- Selecione a coluna de Telefone --</option>
                    {rawData.headers.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                {/* Coluna adicional de Bloco (Opcional) */}
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
                    Coluna Separada de Bloco/Torre (Opcional)
                  </label>
                  <select
                    value={columnMapping.blockColumn || ''}
                    onChange={(e) => setColumnMapping({ ...columnMapping, blockColumn: e.target.value || undefined })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm font-medium text-zinc-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="">-- Nenhuma (unidade já contém bloco ou é casa única) --</option>
                    {rawData.headers.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep('upload')}
                  className="px-4 py-2 text-zinc-600 hover:text-zinc-900 font-semibold text-sm flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Trocar Arquivo
                </button>
                <button
                  type="button"
                  disabled={!columnMapping.nameColumn || !columnMapping.unitColumn}
                  onClick={() => handleRecalculatePreview(columnMapping)}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-sm flex items-center gap-2 transition-all"
                >
                  Avançar para Pré-Visualização
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW (Pré-Visualização Obrigatória) */}
          {step === 'preview' && previewSummary && (
            <div className="space-y-5">
              
              {/* BANNER DE MODO DE IMPORTAÇÃO (TESTE OU REAL) COM ALTERNADOR RÁPIDO */}
              <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                importMode === 'teste'
                  ? 'bg-indigo-50/70 border-indigo-200'
                  : 'bg-emerald-50/70 border-emerald-200'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    importMode === 'teste'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-emerald-700 text-white'
                  }`}>
                    {importMode === 'teste' ? (
                      <FlaskConical className="w-5 h-5" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider ${
                        importMode === 'teste'
                          ? 'bg-indigo-200 text-indigo-900'
                          : 'bg-emerald-200 text-emerald-950'
                      }`}>
                        {importMode === 'teste' ? '🧪 MODO TESTE ATIVO' : '🟢 MODO REAL ATIVO'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-600 mt-1">
                      {importMode === 'teste'
                        ? 'Envio de WhatsApp 100% seguro e simulado (nenhuma mensagem real será disparada).'
                        : 'Moradores participarão do fluxo de envio real de notificações no WhatsApp.'}
                    </p>
                  </div>
                </div>

                {/* Botão de Alternar Modo */}
                <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-zinc-200 shadow-2xs self-stretch sm:self-auto justify-center">
                  <button
                    type="button"
                    onClick={() => setImportMode('teste')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                      importMode === 'teste'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    🧪 Teste
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportMode('real')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                      importMode === 'real'
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    🟢 Real
                  </button>
                </div>
              </div>

              {/* Cards de Métricas */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-zinc-100/70 p-3 rounded-2xl border border-zinc-200">
                  <p className="text-xs font-bold text-zinc-500 uppercase">Total Encontrado</p>
                  <p className="text-2xl font-black text-zinc-900 mt-1">{previewSummary.total}</p>
                </div>

                <div className="bg-emerald-50 border border-emerald-100 p-3 rounded-2xl">
                  <p className="text-xs font-bold text-emerald-700 uppercase flex items-center gap-1">
                    🟢 Completos
                  </p>
                  <p className="text-2xl font-black text-emerald-900 mt-1">{previewSummary.complete}</p>
                </div>

                <div className="bg-amber-50 border border-amber-100 p-3 rounded-2xl">
                  <p className="text-xs font-bold text-amber-700 uppercase flex items-center gap-1">
                    🟠 Sem WhatsApp
                  </p>
                  <p className="text-2xl font-black text-amber-900 mt-1">{previewSummary.pending}</p>
                </div>

                <div className="bg-red-50 border border-red-100 p-3 rounded-2xl">
                  <p className="text-xs font-bold text-red-700 uppercase flex items-center gap-1">
                    🔴 Inconsistentes
                  </p>
                  <p className="text-2xl font-black text-red-900 mt-1">{previewSummary.inconsistent}</p>
                </div>

                <div className="bg-blue-50 border border-blue-100 p-3 rounded-2xl col-span-2 sm:col-span-1">
                  <p className="text-xs font-bold text-blue-700 uppercase flex items-center gap-1">
                    ⚠️ Duplicados
                  </p>
                  <p className="text-2xl font-black text-blue-900 mt-1">{previewSummary.duplicates}</p>
                </div>
              </div>

              {/* Estratégia de Duplicidade (quando houver) */}
              {previewSummary.duplicates > 0 && (
                <div className="bg-blue-50/70 border border-blue-200 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <AlertCircle className="w-5 h-5 text-blue-600 shrink-0" />
                    <div>
                      <p className="text-xs sm:text-sm font-bold text-blue-950">
                        {previewSummary.duplicates} registro(s) já possuem cadastro neste condomínio.
                      </p>
                      <p className="text-xs text-blue-800">
                        Escolha como o sistema deve tratar os registros que já existem:
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <select
                      value={duplicateStrategy}
                      onChange={(e) => setDuplicateStrategy(e.target.value as DuplicateStrategy)}
                      className="w-full sm:w-auto px-3 py-1.5 rounded-xl border border-blue-300 bg-white text-xs font-bold text-blue-950 outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="ignore_existing">Ignorar Existentes (Seguro)</option>
                      <option value="update_existing">Atualizar Telefone dos Existentes</option>
                      <option value="import_all">Importar Todos como Novos</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Barra de Filtros e Busca */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                {/* Filtros em Abas */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 text-xs">
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('all')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap ${
                      previewFilter === 'all'
                        ? 'bg-zinc-900 text-white'
                        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                    }`}
                  >
                    Todos ({previewSummary.total})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('complete')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap ${
                      previewFilter === 'complete'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    Completos ({previewSummary.complete})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('pending')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap ${
                      previewFilter === 'pending'
                        ? 'bg-amber-500 text-white'
                        : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                    }`}
                  >
                    Sem WhatsApp ({previewSummary.pending})
                  </button>
                  {previewSummary.inconsistent > 0 && (
                    <button
                      type="button"
                      onClick={() => setPreviewFilter('inconsistent')}
                      className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap ${
                        previewFilter === 'inconsistent'
                          ? 'bg-red-600 text-white'
                          : 'bg-red-50 text-red-700 hover:bg-red-100'
                      }`}
                    >
                      Inconsistentes ({previewSummary.inconsistent})
                    </button>
                  )}
                </div>

                {/* Busca rápida */}
                <div className="relative min-w-[220px]">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    placeholder="Filtrar por nome ou casa/ap..."
                    className="w-full pl-9 pr-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs text-zinc-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              {/* Tabela de Pré-visualização dos Registros */}
              <div className="border border-zinc-200 rounded-2xl overflow-hidden max-h-[300px] overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-100/80 sticky top-0 z-10 text-zinc-700 font-bold uppercase tracking-wider">
                    <tr>
                      <th className="p-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={previewSummary.selectedToImport === previewSummary.records.filter(r => r.status !== 'inconsistent').length}
                          onChange={(e) => handleToggleSelectAll(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                      </th>
                      <th className="p-3">Morador</th>
                      <th className="p-3">Residência Completa</th>
                      <th className="p-3">WhatsApp / Telefone</th>
                      <th className="p-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredRecords.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-zinc-400">
                          Nenhum registro encontrado para este filtro.
                        </td>
                      </tr>
                    ) : (
                      filteredRecords.map((item) => (
                        <tr
                          key={item.id}
                          className={`hover:bg-zinc-50/80 transition-colors ${
                            !item.isSelected ? 'opacity-50 bg-zinc-50/30' : ''
                          }`}
                        >
                          <td className="p-3 text-center">
                            <input
                              type="checkbox"
                              checked={item.isSelected}
                              disabled={item.status === 'inconsistent' || !item.unidade || !item.unidade.trim()}
                              onChange={() => handleToggleRecord(item.id)}
                              className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                            />
                          </td>
                          <td className="p-3 font-semibold text-zinc-900">
                            {item.nome || <span className="text-red-500 font-bold italic">Nome Ausente</span>}
                          </td>
                          <td className="p-3 font-mono font-bold text-zinc-800">
                            {item.unidade ? (
                              <span>{item.unidade}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200">
                                Residência Ausente
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-zinc-600">
                            {item.telefone ? (
                              <span className="font-mono">{item.telefone}</span>
                            ) : item.unidade ? (
                              <span className="text-amber-700 font-medium italic">Não informado (Pendente)</span>
                            ) : (
                              <span className="text-zinc-400 italic">Não informado</span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            {item.status === 'complete' && item.duplicateStatus === 'new' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                🟢 Completo
                              </span>
                            )}
                            {item.status === 'pending' && item.duplicateStatus === 'new' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                🟠 Pendente
                              </span>
                            )}
                            {item.status === 'inconsistent' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-200" title={item.statusReasons.join(', ')}>
                                🔴 {!item.unidade ? 'Inconsistente — Residência obrigatória' : 'Inconsistente'}
                              </span>
                            )}
                            {item.duplicateStatus !== 'new' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800" title="Já existente">
                                ⚠️ Já Existe
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Botões de Ação */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setStep('mapping')}
                  className="w-full sm:w-auto px-4 py-2 text-zinc-600 hover:text-zinc-900 font-semibold text-xs flex items-center justify-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Ajustar Mapeamento de Colunas
                </button>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="w-full sm:w-auto px-4 py-2.5 text-zinc-600 hover:text-zinc-900 font-bold text-xs"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleRequestImport}
                    disabled={previewSummary.selectedToImport === 0}
                    className={`w-full sm:w-auto px-6 py-2.5 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-sm flex items-center justify-center gap-2 transition-all ${
                      importMode === 'teste'
                        ? 'bg-indigo-600 hover:bg-indigo-700'
                        : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                    IMPORTAR {previewSummary.selectedToImport} MORADORES ({importMode === 'teste' ? '🧪 MODO TESTE' : '🟢 MODO REAL'})
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* STEP 4: IMPORTING (Progresso) */}
          {step === 'importing' && (
            <div className="py-12 px-4 max-w-md mx-auto text-center space-y-6">
              <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
                <RefreshCw className="w-8 h-8 animate-spin" />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-zinc-900">Gravando moradores no banco...</h3>
                <p className="text-xs text-zinc-500">
                  Processando registros com validação de integridade e registro de auditoria.
                </p>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="w-full bg-zinc-100 rounded-full h-3 overflow-hidden border border-zinc-200">
                  <div
                    className="bg-emerald-600 h-full rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progress.percentage}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs font-semibold text-zinc-500">
                  <span>{progress.current} de {progress.total} registros</span>
                  <span>{progress.percentage}%</span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: SUMMARY (Resultado Final) */}
          {step === 'summary' && importResult && (
            <div className="py-6 px-4 max-w-lg mx-auto text-center space-y-6">
              <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div className="space-y-1">
                <h3 className="text-xl font-bold text-zinc-900">Importação Concluída com Sucesso!</h3>
                <p className="text-xs text-zinc-500">
                  Os moradores já estão disponíveis para busca imediata no Registro de Encomendas.
                </p>
              </div>

              {/* Card de Resumo das Gravações */}
              <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4 divide-y divide-zinc-100 text-xs">
                <div className="flex justify-between py-2 items-center">
                  <span className="text-zinc-600">Tipo de Importação:</span>
                  <span className={`font-black px-2.5 py-0.5 rounded-md ${
                    importResult.importMode === 'teste'
                      ? 'bg-indigo-100 text-indigo-900'
                      : 'bg-emerald-100 text-emerald-900'
                  }`}>
                    {importResult.importMode === 'teste' ? '🧪 MODO TESTE (Simulação Segura)' : '🟢 MODO REAL (Notificações Ativas)'}
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-zinc-600">Novos Moradores Inseridos:</span>
                  <span className="font-bold text-emerald-700">+{importResult.successCount}</span>
                </div>
                {importResult.updatedCount > 0 && (
                  <div className="flex justify-between py-2">
                    <span className="text-zinc-600">Moradores Atualizados:</span>
                    <span className="font-bold text-blue-700">{importResult.updatedCount}</span>
                  </div>
                )}
                {importResult.skippedCount > 0 && (
                  <div className="flex justify-between py-2">
                    <span className="text-zinc-600">Registros Duplicados Ignorados:</span>
                    <span className="font-bold text-zinc-500">{importResult.skippedCount}</span>
                  </div>
                )}
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-sm transition-all"
                >
                  Concluir e Voltar
                </button>
              </div>
            </div>
          )}

        </div>

        {/* MODAL DE CONFIRMAÇÃO OBRIGATÓRIA PARA MODO REAL */}
        {showRealConfirmModal && (
          <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-zinc-200 space-y-5 animate-in fade-in zoom-in duration-150">
              <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-7 h-7" />
              </div>

              <div className="text-center space-y-2">
                <h4 className="text-lg font-black text-zinc-900 tracking-tight">
                  ⚠️ IMPORTAÇÃO EM MODO REAL
                </h4>
                <p className="text-xs sm:text-sm text-zinc-600 leading-relaxed">
                  Os moradores e contatos desta planilha serão tratados como <strong>dados reais</strong> e poderão participar do <strong>fluxo normal de notificações no WhatsApp</strong>.
                </p>
              </div>

              <div className="bg-amber-50 rounded-2xl p-3.5 border border-amber-200 text-xs text-amber-900 space-y-1">
                <p className="font-bold">Atenção:</p>
                <p className="text-amber-800">
                  Certifique-se de que a planilha pertence à operação oficial do condomínio e que os números de telefone estão corretos.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRealConfirmModal(false)}
                  className="py-2.5 px-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold text-xs rounded-xl transition-all"
                >
                  CANCELAR
                </button>
                <button
                  type="button"
                  onClick={() => executeImportProcess('real')}
                  className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all shadow-sm"
                >
                  CONFIRMAR IMPORTAÇÃO REAL
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
