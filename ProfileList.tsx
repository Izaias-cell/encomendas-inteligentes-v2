import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Shield, Key, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function ChangePassword({ onUpdateUser }: { onUpdateUser?: (profile: any) => void }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('As senhas não coincidem');
      return;
    }

    if (password.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({
        password: password
      });

      if (authError) throw authError;

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: updatedProfile, error: profileError } = await supabase
          .from('profiles')
          .update({ must_change_password: false })
          .eq('id', user.id)
          .select()
          .single();

        if (profileError) throw profileError;

        if (updatedProfile && onUpdateUser) {
          onUpdateUser(updatedProfile);
        }
      }

      setSuccess(true);
      toast.success('Senha alterada com sucesso!');
      setTimeout(() => {
        navigate('/dashboard');
      }, 2000);
    } catch (error: any) {
      toast.error('Erro ao alterar senha: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
        <div className="bg-white p-12 rounded-[40px] shadow-2xl shadow-zinc-200/50 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-emerald-600" />
          </div>
          <h1 className="text-3xl font-bold text-zinc-900 mb-4">Senha Alterada!</h1>
          <p className="text-zinc-500 mb-8">Sua senha foi atualizada com sucesso. Redirecionando para o painel...</p>
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <div className="bg-white p-12 rounded-[40px] shadow-2xl shadow-zinc-200/50 max-w-md w-full">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-200">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Nova Senha</h1>
            <p className="text-sm text-zinc-500">Altere sua senha para continuar</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 mb-6">
            <p className="text-sm text-amber-700 flex items-start gap-2">
              <Key className="w-4 h-4 mt-0.5" />
              Por segurança, você deve alterar sua senha temporária no primeiro acesso.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-2">Nova Senha</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-5 py-4 rounded-2xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-2">Confirmar Nova Senha</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-5 py-4 rounded-2xl border border-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-bold text-lg hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-3 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              'Alterar Senha'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
