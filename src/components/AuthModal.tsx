import React, { useState } from 'react';
import { X, Loader2, ShieldCheck } from 'lucide-react';

interface AuthModalProps {
  open: boolean;
  hasUsers: boolean;
  storageMode: 'postgresql' | 'memory';
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (name: string, email: string, password: string) => Promise<void>;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  hasUsers,
  storageMode,
  onClose,
  onLogin,
  onRegister,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(hasUsers ? 'login' : 'register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'register') {
        await onRegister(name, email, password);
      } else {
        await onLogin(email, password);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-md bg-white border border-[#E5E7EB] rounded-xl shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#1D4ED8]" />
            <h2 className="text-[15px] font-semibold text-[#111827]">
              {!hasUsers && mode === 'register'
                ? 'DBLens Admin Setup'
                : mode === 'register'
                  ? 'Create DBLens Account'
                  : 'Sign In to DBLens'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[#F3F4F6] text-[#6B7280] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {!hasUsers && (
            <div className="px-3 py-2.5 rounded-md bg-[#EFF6FF] border border-[#BFDBFE] text-[12px] text-[#1E40AF]">
              First-run setup: the first account created claims the Admin role for managing PostgreSQL datasources and migrations.
            </div>
          )}

          {mode === 'register' && (
            <div>
              <label className="block text-[12px] font-medium text-[#374151] mb-1">
                Full Name
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Rivera"
                className="w-full h-9 px-3 text-[13px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#9CA3AF]"
              />
            </div>
          )}

          <div>
            <label className="block text-[12px] font-medium text-[#374151] mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full h-9 px-3 text-[13px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#9CA3AF]"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#374151] mb-1">
              Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              className="w-full h-9 px-3 text-[13px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#9CA3AF]"
            />
          </div>

          {error && (
            <p className="text-[12px] text-[#DC2626] bg-[#FEF2F2] border border-[#FECACA] rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-9 bg-[#111827] hover:bg-[#1F2937] text-white text-[13px] font-medium rounded-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'register' ? 'Create Account & Continue' : 'Sign In'}
          </button>

          <div className="pt-2 border-t border-[#F3F4F6] flex items-center justify-between text-[12px] text-[#6B7280]">
            <span>Backend: {storageMode === 'postgresql' ? 'PostgreSQL (Drizzle)' : 'Preview Store'}</span>
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError(null);
              }}
              className="text-[#1D4ED8] hover:underline font-medium cursor-pointer"
            >
              {mode === 'login' ? 'Create account' : 'Already have an account?'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
