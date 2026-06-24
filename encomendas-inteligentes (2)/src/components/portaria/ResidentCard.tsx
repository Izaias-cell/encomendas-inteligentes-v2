import React from 'react';
import { User, MoreVertical, Edit, Phone, Home, Building2, Trash2, Power } from 'lucide-react';
import { Morador } from '../../types';

interface ResidentCardProps {
  resident: Morador;
  activeResidentMenu: string | null;
  setActiveResidentMenu: (id: string | null) => void;
  onEdit: (resident: Morador) => void;
  onDelete: (resident: Morador) => void;
  onToggleStatus: (resident: Morador) => void;
  userRole: string;
}

const ResidentCard: React.FC<ResidentCardProps> = ({ 
  resident, 
  activeResidentMenu, 
  setActiveResidentMenu,
  onEdit,
  onDelete,
  onToggleStatus,
  userRole
}) => {
  return (
    <div className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-6 hover:shadow-md transition-all group relative">
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
                      onEdit(resident);
                      setActiveResidentMenu(null);
                    }}
                    className="w-full px-4 py-3 text-left text-sm font-bold text-zinc-700 hover:bg-zinc-50 flex items-center gap-3 transition-colors"
                  >
                    <Edit className="w-4 h-4 text-emerald-600" />
                    Editar Morador
                  </button>

                  {(userRole === 'admin' || userRole === 'sindico') && (
                    <>
                      <button
                        onClick={() => {
                          onToggleStatus(resident);
                          setActiveResidentMenu(null);
                        }}
                        className={`w-full px-4 py-3 text-left text-sm font-bold flex items-center gap-3 transition-colors ${resident.ativo ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`}
                      >
                        <Power className="w-4 h-4" />
                        {resident.ativo ? 'Desativar Morador' : 'Ativar Morador'}
                      </button>

                      <div className="h-px bg-zinc-100 my-1" />

                      <button
                        onClick={() => {
                          onDelete(resident);
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

      <h3 className="text-xl font-bold text-zinc-900 mb-2 truncate pr-8">{resident.nome}</h3>
      
      <div className="space-y-3 mb-4">
        <div className="flex items-center gap-3 text-zinc-500 text-sm">
          <Home className="w-4 h-4 flex-shrink-0" />
          <p className="font-medium">
            {resident.unit_type
              ? `${resident.unidade} ${resident.unit_type}`
              : resident.unidade}
          </p>
        </div>
        {(resident.block || resident.street) && (
          <div className="flex items-center gap-3 text-zinc-500 text-sm">
            <Building2 className="w-4 h-4 flex-shrink-0" />
            <p className="truncate">
              {resident.block && `Bloco ${resident.block}`}
              {resident.block && resident.street && ' • '}
              {resident.street && `Rua ${resident.street}`}
            </p>
          </div>
        )}
        {resident.telefone && (
          <div className="flex items-center gap-3 text-zinc-500 text-sm">
            <Phone className="w-4 h-4 flex-shrink-0" />
            <p className="font-mono">{resident.telefone}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(ResidentCard);
